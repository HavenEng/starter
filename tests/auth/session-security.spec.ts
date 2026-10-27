import type { AuthAudience } from "@/lib/auth/audience";
import {
  AUTH_EMULATOR_HOST,
  AUTH_EMULATOR_PROJECTS,
  AUTH_EMULATOR_URL,
} from "@/lib/firebase/emulator-config";
import { test, expect, signIn, getIdToken, type Scenario } from "./fixtures";
import type { Page } from "@playwright/test";

function changeEmulatorClaims(token: string, changes: Record<string, unknown>) {
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== AUTH_EMULATOR_HOST ||
    JSON.parse(Buffer.from(header, "base64url").toString()).alg !== "none" ||
    signature !== "" ||
    !Object.values(AUTH_EMULATOR_PROJECTS).some((id) => id === claims.aud)
  )
    throw new Error(
      "Synthetic claims are restricted to local emulator tokens.",
    );
  return `${header}.${Buffer.from(JSON.stringify({ ...claims, ...changes })).toString("base64url")}.`;
}

async function waitAfter(authTime: number) {
  await expect
    .poll(() => Math.floor(Date.now() / 1000), {
      timeout: 5_000,
      intervals: [50, 100],
    })
    .toBeGreaterThan(authTime);
}

async function profile(scenario: Scenario, audience: AuthAudience) {
  const table = audience === "staff" ? "staff_users" : "users";
  return (
    await scenario.db.query(`SELECT * FROM ${table} WHERE firebase_uid = $1`, [
      scenario.uid,
    ])
  ).rows;
}

async function resetThroughForms(
  page: Page,
  scenario: Scenario,
  audience: AuthAudience,
  password: string,
) {
  const prefix = audience === "staff" ? "/staff" : "";
  await page.goto(`${prefix}/reset-password`);
  await page.getByLabel("Email", { exact: true }).fill(scenario.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(
    page.getByText(`If an account uses ${scenario.email}`, { exact: false }),
  ).toBeVisible();
  const response = await fetch(
    `${AUTH_EMULATOR_URL}/emulator/v1/projects/${AUTH_EMULATOR_PROJECTS[audience]}/oobCodes`,
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  const reset = body.oobCodes.find(
    (item: { email: string; requestType: string }) =>
      item.email === scenario.email && item.requestType === "PASSWORD_RESET",
  );
  expect(reset).toBeDefined();
  // Emulator form coverage constructs the URL; copied apps verify delivered links.
  await page.goto(
    `${prefix}/reset-password/confirm?mode=resetPassword&oobCode=${encodeURIComponent(reset.oobCode)}`,
  );
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(
    page.getByRole("heading", { name: "Password updated" }),
  ).toBeVisible();
}

for (const audience of ["user", "staff"] as const) {
  const protectedPath = audience === "staff" ? "/private" : "/account";
  const loginPath = audience === "staff" ? "/staff/login" : "/login";
  const sessionPath =
    audience === "staff" ? "/api/auth/staff/session" : "/api/auth/session";
  const cookieName =
    audience === "staff" ? "firebase_staff_session" : "firebase_session";

  test(`${audience} revocation rejects the active cookie and a new exchange of the old ID token`, async ({
    page,
    request,
    scenario,
    baseURL,
  }) => {
    await scenario.seed(audience, true);
    await signIn(page, scenario, audience);
    await expect(page).toHaveURL(`${baseURL}${protectedPath}`);
    const token = await getIdToken(scenario, audience);
    const claims = await scenario.auth[audience].verifyIdToken(token);
    const before = await profile(scenario, audience);
    await waitAfter(claims.auth_time);
    await scenario.auth[audience].revokeRefreshTokens(scenario.uid);
    expect(
      new Date(
        (await scenario.auth[audience].getUser(scenario.uid))
          .tokensValidAfterTime!,
      ).getTime() / 1_000,
    ).toBeGreaterThan(claims.auth_time);
    await page.reload();
    await expect(page).toHaveURL(`${baseURL}${loginPath}`);
    const response = await request.post(sessionPath, {
      headers: { Origin: baseURL! },
      data: { idToken: token },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["set-cookie"]).toBeUndefined();
    expect(await profile(scenario, audience)).toEqual(before);
    await signIn(page, scenario, audience);
    await expect(page).toHaveURL(`${baseURL}${protectedPath}`);
  });

  test(`${audience} password reset invalidates a session in another browser context`, async ({
    page,
    browser,
    scenario,
    baseURL,
  }) => {
    await scenario.seed(audience, true);
    await signIn(page, scenario, audience);
    await expect(page).toHaveURL(`${baseURL}${protectedPath}`);
    const cookie = (await page.context().cookies()).find(
      (item) => item.name === cookieName,
    )!;
    const claims = await scenario.auth[audience].verifySessionCookie(
      cookie.value,
      true,
    );
    await waitAfter(claims.auth_time);
    const context = await browser.newContext({ baseURL });
    try {
      const resetPage = await context.newPage();
      const password = "Session-reset-9!";
      await resetThroughForms(resetPage, scenario, audience, password);
      await page.reload();
      await expect(page).toHaveURL(`${baseURL}${loginPath}`);
      await signIn(resetPage, scenario, audience, password);
      await expect(resetPage).toHaveURL(`${baseURL}${protectedPath}`);
    } finally {
      await context.close();
    }
  });

  test(`${audience} rejects an expired session token while the browser retains its cookie`, async ({
    page,
    scenario,
    baseURL,
  }) => {
    await scenario.seed(audience, true);
    await signIn(page, scenario, audience);
    await expect(page).toHaveURL(`${baseURL}${protectedPath}`);
    const cookie = (await page.context().cookies()).find(
      (item) => item.name === cookieName,
    )!;
    const value = changeEmulatorClaims(cookie.value, {
      exp: Math.floor(Date.now() / 1_000) - 60,
    });
    await page.context().addCookies([{ ...cookie, value }]);
    expect(
      (await page.context().cookies()).find((item) => item.name === cookieName)
        ?.value,
    ).toBe(value);
    await page.reload();
    await expect(page).toHaveURL(`${baseURL}${loginPath}`);
    await signIn(page, scenario, audience);
    await expect(page).toHaveURL(`${baseURL}${protectedPath}`);
  });

  for (const variant of [
    "expired",
    "stale",
    "future",
    "provider",
    "missing-time",
  ] as const) {
    test(`${audience} rejects a ${variant} ID token without synchronizing its profile`, async ({
      request,
      scenario,
      baseURL,
    }) => {
      await scenario.seed(audience, true);
      // Isolate recent-auth policy from revocation of an account created just now.
      const response = await fetch(
        `${AUTH_EMULATOR_URL}/identitytoolkit.googleapis.com/v1/projects/${AUTH_EMULATOR_PROJECTS[audience]}/accounts:update`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer owner",
          },
          body: JSON.stringify({
            localId: scenario.uid,
            validSince: String(Math.floor(Date.now() / 1_000) - 3_600),
          }),
        },
      );
      expect(response.status).toBe(200);
      const token = await getIdToken(scenario, audience);
      const now = Math.floor(Date.now() / 1_000);
      const changes =
        variant === "expired"
          ? { exp: now - 60 }
          : variant === "stale"
            ? { auth_time: now - 600 }
            : variant === "future"
              ? { auth_time: now + 600 }
              : variant === "missing-time"
                ? { auth_time: undefined }
                : {
                    firebase: {
                      sign_in_provider: "google.com",
                      identities: {},
                    },
                  };
      const before = await profile(scenario, audience);
      const rejected = await request.post(sessionPath, {
        headers: { Origin: baseURL! },
        data: { idToken: changeEmulatorClaims(token, changes) },
      });
      expect(rejected.status()).toBe(variant === "provider" ? 403 : 401);
      if (
        variant === "stale" ||
        variant === "future" ||
        variant === "missing-time"
      )
        expect(await rejected.json()).toMatchObject({
          error: "Please sign in again to start a session.",
        });
      expect(rejected.headers()["set-cookie"]).toBeUndefined();
      expect(await profile(scenario, audience)).toEqual(before);
      const accepted = await request.post(sessionPath, {
        headers: { Origin: baseURL! },
        data: { idToken: token },
      });
      expect(accepted.status()).toBe(200);
      expect(accepted.headers()["set-cookie"]).toContain(cookieName);
    });
  }
}
