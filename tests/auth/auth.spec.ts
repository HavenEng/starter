import { test, expect, signIn, getIdToken } from "./fixtures";
import {
  AUTH_EMULATOR_PROJECTS,
  AUTH_EMULATOR_URL,
} from "@/lib/firebase/emulator-config";

test("signup creates a Firebase identity, database record, and persistent secure session", async ({
  page,
  scenario,
}) => {
  await page.goto("/signup");
  await page.getByLabel("Email", { exact: true }).fill(scenario.email);
  await page.getByLabel("Password", { exact: true }).fill(scenario.password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(scenario.email, { exact: true })).toBeVisible();
  const identity = await scenario.auth.user.getUserByEmail(scenario.email);
  const { rows } = await scenario.db.query(
    "SELECT * FROM users WHERE firebase_uid = $1",
    [identity.uid],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    email: scenario.email,
    email_verified: false,
  });
  const cookie = (await page.context().cookies()).find(
    (item) => item.name === "firebase_session",
  );
  expect(cookie).toMatchObject({
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain(
    "firebase_session",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your account" }),
  ).toBeVisible();
});

test("signup recovers after a gateway failure without creating the account twice", async ({
  page,
  scenario,
}) => {
  let attempts = 0;
  await page.route("**/api/auth/session", async (route) => {
    attempts++;
    if (attempts === 1)
      await route.fulfill({
        status: 503,
        json: { error: "Test gateway unavailable" },
      });
    else await route.continue();
  });
  await page.goto("/signup");
  await page.getByLabel("Email", { exact: true }).fill(scenario.email);
  await page.getByLabel("Password", { exact: true }).fill(scenario.password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(
    page.getByRole("button", { name: "Retry sign-in" }),
  ).toBeEnabled();
  const identity = await scenario.auth.user.getUserByEmail(scenario.email);
  await page.getByRole("button", { name: "Retry sign-in" }).click();
  await expect(page).toHaveURL(/\/account$/);
  expect((await scenario.auth.user.getUserByEmail(scenario.email)).uid).toBe(
    identity.uid,
  );
  expect(
    (
      await scenario.db.query("SELECT id FROM users WHERE firebase_uid = $1", [
        identity.uid,
      ])
    ).rows,
  ).toHaveLength(1);
});

test("repeated user login refreshes the existing profile without duplicating its record", async ({
  page,
  scenario,
}) => {
  await scenario.seed("user");
  await signIn(page, scenario, "user");
  await expect(page).toHaveURL(/\/account$/);
  const { rows: before } = await scenario.db.query(
    "SELECT * FROM users WHERE firebase_uid = $1",
    [scenario.uid],
  );
  await scenario.auth.user.updateUser(scenario.uid, {
    displayName: "Updated profile",
    emailVerified: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/:3102\/$/);
  await signIn(page, scenario, "user");
  await expect(page).toHaveURL(/\/account$/);
  const { rows: after } = await scenario.db.query(
    "SELECT * FROM users WHERE firebase_uid = $1",
    [scenario.uid],
  );
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({
    id: before[0].id,
    display_name: "Updated profile",
    email_verified: true,
    created_at: before[0].created_at,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Your account" }),
  ).toBeVisible();
});

test("staff login refreshes the administratively provisioned record", async ({
  page,
  scenario,
}) => {
  await scenario.seed("staff", true);
  const { rows: before } = await scenario.db.query(
    "SELECT id FROM staff_users WHERE firebase_uid = $1",
    [scenario.uid],
  );
  await signIn(page, scenario, "staff");
  await expect(page).toHaveURL(/\/private$/);
  await expect(
    page.getByRole("heading", { name: "Private area" }),
  ).toBeVisible();
  const { rows } = await scenario.db.query(
    "SELECT * FROM staff_users WHERE firebase_uid = $1",
    [scenario.uid],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id: before[0].id,
    email: scenario.email,
    display_name: "Initial profile",
    email_verified: false,
  });
  expect(
    (await page.context().cookies()).find(
      (cookie) => cookie.name === "firebase_staff_session",
    ),
  ).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Private area" }),
  ).toBeVisible();
});

test("a staff Firebase account without an allow-list row cannot obtain a session", async ({
  page,
  scenario,
}) => {
  await scenario.seed("staff");
  await signIn(page, scenario, "staff");
  await expect(
    page.getByText("This account is not provisioned for staff access."),
  ).toBeVisible();
  expect(
    (
      await scenario.db.query(
        "SELECT id FROM staff_users WHERE firebase_uid = $1",
        [scenario.uid],
      )
    ).rows,
  ).toHaveLength(0);
  expect(
    (await page.context().cookies()).some(
      (cookie) => cookie.name === "firebase_staff_session",
    ),
  ).toBe(false);
  await page.goto("/private");
  await expect(page).toHaveURL(/\/staff\/login$/);
});

test("valid cross-project ID tokens are rejected even when both identities share a UID", async ({
  request,
  scenario,
  baseURL,
}) => {
  await scenario.seed("user");
  await scenario.seed("staff", true);
  for (const audience of ["user", "staff"] as const) {
    const token = await getIdToken(scenario, audience);
    const claims = await scenario.auth[audience].verifyIdToken(token);
    expect(claims).toMatchObject({
      uid: scenario.uid,
      aud: AUTH_EMULATOR_PROJECTS[audience],
    });
    const target =
      audience === "user" ? "/api/auth/staff/session" : "/api/auth/session";
    const response = await request.post(target, {
      headers: { Origin: baseURL! },
      data: { idToken: token },
    });
    expect(response.status()).toBe(401);
    expect(response.headers()["set-cookie"]).toBeUndefined();
  }
  expect(
    (
      await scenario.db.query("SELECT id FROM users WHERE firebase_uid = $1", [
        scenario.uid,
      ])
    ).rows,
  ).toHaveLength(0);
});

test("valid session cookies cannot authorize the other population under a swapped cookie name", async ({
  page,
  browser,
  scenario,
  baseURL,
}) => {
  await scenario.seed("user");
  await scenario.seed("staff", true);
  await signIn(page, scenario, "user");
  await expect(page).toHaveURL(/\/account$/);
  await signIn(page, scenario, "staff");
  await expect(page).toHaveURL(/\/private$/);
  const cookies = await page.context().cookies();
  for (const [source, name, target, login] of [
    ["firebase_session", "firebase_staff_session", "/private", "/staff/login"],
    ["firebase_staff_session", "firebase_session", "/account", "/login"],
  ]) {
    const context = await browser.newContext({ baseURL });
    try {
      const cookie = cookies.find((item) => item.name === source)!;
      await context.addCookies([{ ...cookie, name }]);
      const otherPage = await context.newPage();
      await otherPage.goto(target);
      await expect(otherPage).toHaveURL(`${baseURL}${login}`);
    } finally {
      await context.close();
    }
  }
});

for (const audience of ["user", "staff"] as const) {
  const prefix = audience === "staff" ? "/staff" : "";
  const protectedPath = audience === "staff" ? "/private" : "/account";

  test(`${audience} logout clears its session and blocks subsequent protected requests`, async ({
    page,
    scenario,
  }) => {
    await scenario.seed(audience, true);
    await signIn(page, scenario, audience);
    await expect(page).toHaveURL(new RegExp(`${protectedPath}$`));
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(
      audience === "staff" ? /\/staff\/login$/ : /:3102\/$/,
    );
    expect(
      (await page.context().cookies()).some(
        (item) =>
          item.name ===
          (audience === "staff"
            ? "firebase_staff_session"
            : "firebase_session"),
      ),
    ).toBe(false);
    await page.goto(protectedPath);
    await expect(page).toHaveURL(new RegExp(`${prefix}/login$`));
  });

  test(`${audience} sessions stop authorizing a disabled Firebase account`, async ({
    page,
    scenario,
  }) => {
    await scenario.seed(audience, true);
    await signIn(page, scenario, audience);
    await expect(page).toHaveURL(new RegExp(`${protectedPath}$`));
    await scenario.auth[audience].updateUser(scenario.uid, { disabled: true });
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${prefix}/login$`));
  });

  test(`${audience} password reset works through the app's request and confirmation forms`, async ({
    page,
    scenario,
  }) => {
    await scenario.seed(audience, true);
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
    const body = (await response.json()) as {
      oobCodes: { email: string; requestType: string; oobCode: string }[];
    };
    const reset = body.oobCodes.find(
      (item) =>
        item.email === scenario.email && item.requestType === "PASSWORD_RESET",
    );
    expect(reset).toBeDefined();
    const confirmPath = `${prefix}/reset-password/confirm?mode=resetPassword&oobCode=${encodeURIComponent(reset!.oobCode)}`;
    await page.goto(confirmPath);
    await expect(
      page.getByText(`Set a new password for ${scenario.email}.`),
    ).toBeVisible();
    const newPassword = "Updated-starter-9!";
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill(newPassword);
    await page.getByRole("button", { name: "Update password" }).click();
    await expect(
      page.getByRole("heading", { name: "Password updated" }),
    ).toBeVisible();
    await signIn(page, scenario, audience);
    await expect(
      page.getByText("The email or password is incorrect."),
    ).toBeVisible();
    await signIn(page, scenario, audience, newPassword);
    await expect(page).toHaveURL(new RegExp(`${protectedPath}$`));
    await page.goto(confirmPath);
    await expect(
      page.getByText(
        "This reset link is invalid or has expired. Request a new one.",
      ),
    ).toBeVisible();
  });

  test(`${audience} invalid reset links offer recovery`, async ({ page }) => {
    await page.goto(
      `${prefix}/reset-password/confirm?mode=resetPassword&oobCode=invalid-test-code`,
    );
    await expect(
      page.getByText(
        "This reset link is invalid or has expired. Request a new one.",
      ),
    ).toBeVisible();
    await page.getByRole("link", { name: "Request a new reset link" }).click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/reset-password$`));
  });
}

test("removing a staff allow-list row stops an existing session from authorizing access", async ({
  page,
  scenario,
}) => {
  await scenario.seed("staff", true);
  await signIn(page, scenario, "staff");
  await expect(page).toHaveURL(/\/private$/);
  await scenario.db.query("DELETE FROM staff_users WHERE firebase_uid = $1", [
    scenario.uid,
  ]);
  await page.reload();
  await expect(page).toHaveURL(/\/staff\/login$/);
});
