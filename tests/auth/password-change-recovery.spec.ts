import { test, expect, signIn } from "./fixtures";

const unconfirmedMessage =
  "We couldn’t confirm the password update. Please sign in again to continue.";
const newPassword = "Recovery-password-9!";

for (const audience of ["user", "staff"] as const) {
  const prefix = audience === "staff" ? "/staff" : "";
  const api = `/api/auth${prefix}`;
  const changePage =
    audience === "staff"
      ? "/private/account/change-password"
      : "/account/change-password";
  const protectedPage = audience === "staff" ? "/private" : "/account";
  const cookieName =
    audience === "staff" ? "firebase_staff_session" : "firebase_session";
  const other = audience === "staff" ? "user" : "staff";
  const otherCookieName =
    other === "staff" ? "firebase_staff_session" : "firebase_session";

  for (const fault of [
    "before-update",
    "after-commit",
    "invalid-success",
    "unconfirmed-response",
    "expired-session",
  ] as const) {
    test(`${audience} recovers through sign-in after ${fault} without replaying the password change`, async ({
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
      await expect(page).toHaveURL(new RegExp(`${protectedPage}$`));
      const cookies = await page.context().cookies();
      const untouched = cookies.find(
        (cookie) => cookie.name === otherCookieName,
      )!;
      let changes = 0;
      let logouts = 0;
      await page.route(`**${api}/change-password`, async (route) => {
        changes++;
        if (fault !== "before-update" && fault !== "expired-session") {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          expect(await response.json()).toEqual({ ok: true });
          // route.fetch can apply Set-Cookie to its associated context. Restore
          // the original cookies to model a response that never reached the browser.
          await page.context().addCookies(cookies);
        }
        if (fault === "expired-session") {
          await route.fulfill({
            status: 401,
            json: { error: "Please sign in.", code: "UNAUTHENTICATED" },
          });
        } else if (fault === "unconfirmed-response") {
          await route.fulfill({
            status: 503,
            json: {
              error: "Service unavailable. Please try again.",
              code: "PASSWORD_CHANGE_UNCONFIRMED",
            },
          });
        } else if (fault === "invalid-success") {
          await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "Gateway response",
          });
        } else {
          await route.abort("failed");
        }
      });
      await page.route(`**${api}/logout`, async (route) => {
        logouts++;
        if (fault === "unconfirmed-response" && logouts === 1)
          await route.fulfill({
            status: 503,
            json: { error: "Service unavailable" },
          });
        else await route.continue();
      });
      await page.goto(changePage);
      await page
        .getByLabel("Current password", { exact: true })
        .fill(scenario.password);
      await page.getByLabel("New password", { exact: true }).fill(newPassword);
      await page
        .getByLabel("Confirm new password", { exact: true })
        .fill(newPassword);
      await page
        .getByRole("button", { name: "Change password", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Sign in again", exact: true }),
      ).toBeVisible();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        fault === "expired-session"
          ? "Please sign in again to continue."
          : unconfirmedMessage,
      );
      await expect(
        page.getByLabel("Current password", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Forgot password?" }),
      ).toHaveAttribute("href", `${prefix}/reset-password`);
      expect(changes).toBe(1);
      expect(
        (await page.context().cookies()).some(
          (cookie) => cookie.name === cookieName,
        ),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Sign in again", exact: true })
        .click();
      if (fault === "unconfirmed-response") {
        await expect(
          page.getByText("We could not prepare sign-in. Please try again."),
        ).toBeVisible();
        await expect(page).toHaveURL(new RegExp(`${changePage}$`));
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
        .fill(
          fault === "before-update" || fault === "expired-session"
            ? scenario.password
            : newPassword,
        );
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${protectedPage}$`));
      expect(changes).toBe(1);
      expect(logouts).toBe(fault === "unconfirmed-response" ? 2 : 1);
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
    });
  }

  test(`${audience} retains normal retries for explicit rejections and requires sign-in after a gateway failure`, async ({
    page,
    scenario,
  }) => {
    await scenario.seed(audience, true);
    await signIn(page, scenario, audience);
    await expect(page).toHaveURL(new RegExp(`${protectedPage}$`));
    await page.goto(changePage);
    let status = 400;
    let body: Record<string, string> = {
      error: "Choose a different password.",
      code: "INVALID_INPUT",
    };
    let changes = 0;
    await page.route(`**${api}/change-password`, async (route) => {
      changes++;
      await route.fulfill({ status, json: body });
    });
    const rejections: { status: number; body: Record<string, string> }[] = [
      {
        status: 400,
        body: { error: "Choose a different password.", code: "INVALID_INPUT" },
      },
      {
        status: 503,
        body: {
          error: "Service unavailable. Please try again.",
          code: "SERVICE_UNAVAILABLE",
        },
      },
      { status: 429, body: { error: "Too many requests" } },
    ];
    for (const rejection of rejections) {
      status = rejection.status;
      body = rejection.body;
      await page
        .getByLabel("Current password", { exact: true })
        .fill(scenario.password);
      await page.getByLabel("New password", { exact: true }).fill(newPassword);
      await page
        .getByLabel("Confirm new password", { exact: true })
        .fill(newPassword);
      await page
        .getByRole("button", { name: "Change password", exact: true })
        .click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        body.error,
      );
      await expect(
        page.getByLabel("Current password", { exact: true }),
      ).toHaveValue(scenario.password);
      await expect(
        page.getByRole("button", { name: "Change password", exact: true }),
      ).toBeEnabled();
    }
    status = 504;
    body = { error: "Gateway timeout" };
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Sign in again", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      unconfirmedMessage,
    );
    await page
      .getByRole("button", { name: "Sign in again", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${prefix}/login$`));
    expect(changes).toBe(4);
  });
}
