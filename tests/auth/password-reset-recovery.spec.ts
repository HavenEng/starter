import type { Page } from "@playwright/test";
import { test, expect, signIn, type Scenario } from "./fixtures";
import type { AuthAudience } from "@/lib/auth/audience";
import {
  AUTH_EMULATOR_PROJECTS,
  AUTH_EMULATOR_URL,
} from "@/lib/firebase/emulator-config";

const newPassword = "Reset-recovery-9!";
const unconfirmedMessage =
  "We couldn’t confirm the password update. Please sign in to continue.";

async function openReset(
  page: Page,
  scenario: Scenario,
  audience: AuthAudience,
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
  const codes = (await response.json()) as {
    oobCodes: { email: string; requestType: string; oobCode: string }[];
  };
  const reset = codes.oobCodes.find(
    (code) =>
      code.email === scenario.email && code.requestType === "PASSWORD_RESET",
  );
  expect(reset).toBeDefined();
  await page.goto(
    `${prefix}/reset-password/confirm?mode=resetPassword&oobCode=${encodeURIComponent(reset!.oobCode)}`,
  );
  await expect(
    page.getByText(`Set a new password for ${scenario.email}.`),
  ).toBeVisible();
}

async function submitReset(page: Page) {
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill(newPassword);
  await page
    .getByRole("button", { name: "Update password", exact: true })
    .click();
}

for (const audience of ["user", "staff"] as const) {
  const prefix = audience === "staff" ? "/staff" : "";
  const cookieName =
    audience === "staff" ? "firebase_staff_session" : "firebase_session";
  const other = audience === "staff" ? "user" : "staff";
  const otherCookieName =
    other === "staff" ? "firebase_staff_session" : "firebase_session";

  for (const fault of [
    "before-update",
    "after-commit",
    "invalid-success",
    "gateway-failure",
    "timeout-late-success",
    "confirmed-success",
  ] as const) {
    test(`${audience} reset uses fresh sign-in after ${fault} and preserves the other session`, async ({
      page,
      scenario,
    }) => {
      await scenario.seed(other, true);
      await scenario.seed(audience, true);
      await signIn(page, scenario, other);
      await expect(page).toHaveURL(
        other === "staff" ? /\/private$/ : /\/account$/,
      );
      await signIn(page, scenario, audience);
      await expect(page).toHaveURL(
        audience === "staff" ? /\/private$/ : /\/account$/,
      );
      const cookies = await page.context().cookies();
      const untouched = cookies.find(
        (cookie) => cookie.name === otherCookieName,
      )!;
      await openReset(page, scenario, audience);
      let updates = 0;
      let logouts = 0;
      let committed = false;
      let delivered = false;
      let release!: () => void;
      const lateResponse = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/v1/accounts:resetPassword?*", async (route) => {
        if (!route.request().postDataJSON().newPassword)
          return route.continue();
        updates++;
        if (fault === "before-update") return route.abort("failed");
        if (fault === "gateway-failure")
          return route.fulfill({
            status: 502,
            json: { error: { message: "INTERNAL_ERROR" } },
          });
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        committed = true;
        if (fault === "after-commit") return route.abort("failed");
        if (fault === "invalid-success")
          return route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "Gateway response",
          });
        if (fault === "timeout-late-success") await lateResponse;
        await route.fulfill({ response });
        delivered = true;
      });
      await page.route(`**/api/auth${prefix}/logout`, async (route) => {
        logouts++;
        if (fault === "after-commit" && logouts === 1)
          await route.fulfill({
            status: 503,
            json: { error: "Service unavailable" },
          });
        else await route.continue();
      });
      try {
        if (fault === "timeout-late-success") await page.clock.install();
        await submitReset(page);
        if (fault === "timeout-late-success") {
          await expect.poll(() => committed).toBe(true);
          await page.clock.fastForward(30_001);
        }
        await expect(
          page.getByRole("heading", {
            name:
              fault === "confirmed-success"
                ? "Password updated"
                : "Sign in again",
            exact: true,
          }),
        ).toBeVisible();
        if (fault !== "confirmed-success") {
          await expect(page.getByRole("main").getByRole("alert")).toHaveText(
            unconfirmedMessage,
          );
          await expect(
            page.getByRole("link", {
              name: "Request a new reset link",
              exact: true,
            }),
          ).toHaveAttribute("href", `${prefix}/reset-password`);
        }
        await expect(
          page.getByLabel("New password", { exact: true }),
        ).toHaveCount(0);
        if (fault === "timeout-late-success") {
          release();
          await expect.poll(() => delivered).toBe(true);
          await expect(
            page.getByRole("heading", { name: "Sign in again", exact: true }),
          ).toBeVisible();
        }
        expect(updates).toBe(1);
        expect(
          (await page.context().cookies()).some(
            (cookie) => cookie.name === cookieName,
          ),
        ).toBe(true);
        await page
          .getByRole("button", { name: "Sign in again", exact: true })
          .click();
        if (fault === "after-commit") {
          await expect(
            page.getByText("We could not prepare sign-in. Please try again."),
          ).toBeVisible();
          expect(
            (await page.context().cookies()).some(
              (cookie) => cookie.name === cookieName,
            ),
          ).toBe(true);
          await page
            .getByRole("button", { name: "Sign in again", exact: true })
            .click();
        }
        await expect(page).toHaveURL(new RegExp(`${prefix}/login$`));
        const after = await page.context().cookies();
        expect(after.some((cookie) => cookie.name === cookieName)).toBe(false);
        expect(
          after.find((cookie) => cookie.name === otherCookieName)?.value,
        ).toBe(untouched.value);
        await page.getByLabel("Email", { exact: true }).fill(scenario.email);
        await page
          .getByLabel("Password", { exact: true })
          .fill(committed ? newPassword : scenario.password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(page).toHaveURL(
          audience === "staff" ? /\/private$/ : /\/account$/,
        );
        expect(updates).toBe(1);
        expect(logouts).toBe(fault === "after-commit" ? 2 : 1);
        await page.goto(other === "staff" ? "/private" : "/account");
        await expect(page).toHaveURL(
          other === "staff" ? /\/private$/ : /\/account$/,
        );
        await expect(
          page.getByRole("heading", {
            name: other === "staff" ? "Private area" : "Your account",
            exact: true,
          }),
        ).toBeVisible();
      } finally {
        release();
      }
    });
  }

  test(`${audience} reset keeps explicit rejections editable and removes an expired-code form`, async ({
    page,
    scenario,
  }) => {
    await scenario.seed(audience, true);
    await openReset(page, scenario, audience);
    let providerCode = "WEAK_PASSWORD : rejected";
    let updates = 0;
    await page.route("**/v1/accounts:resetPassword?*", async (route) => {
      if (!route.request().postDataJSON().newPassword) return route.continue();
      updates++;
      await route.fulfill({
        status: 400,
        json: { error: { message: providerCode } },
      });
    });
    for (const [code, message] of [
      [
        "WEAK_PASSWORD : rejected",
        "Choose a password that meets the password requirements.",
      ],
      [
        "PASSWORD_DOES_NOT_MEET_REQUIREMENTS",
        "Choose a password that meets the password requirements.",
      ],
      ["TOO_MANY_ATTEMPTS_TRY_LATER", "Too many requests"],
    ]) {
      providerCode = code;
      await submitReset(page);
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      await expect(
        page.getByLabel("New password", { exact: true }),
      ).toHaveValue(newPassword);
      await expect(
        page.getByRole("button", { name: "Update password", exact: true }),
      ).toBeEnabled();
    }
    providerCode = "EXPIRED_OOB_CODE";
    await submitReset(page);
    await expect(
      page.getByText(
        "This reset link is invalid or has expired. Request a new one.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(
      0,
    );
    expect(updates).toBe(4);
    await page
      .getByRole("link", { name: "Request a new reset link", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/reset-password$`));
  });
}
