import { expect, test } from "@playwright/test";

test("the starter page loads", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "User and staff authentication" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Web App Starter");
});

test("the landing page explains observability setup on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");

  const setup = page.getByRole("region", { name: "Observability setup" });
  await expect(setup).toBeVisible();
  await expect(setup.getByRole("listitem")).toHaveCount(4);
  for (const variable of [
    "NEXT_PUBLIC_SENTRY_DSN",
    "SENTRY_DSN",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
    "LOG_LEVEL",
  ])
    await expect(setup.getByText(variable, { exact: true })).toBeVisible();
  await expect(setup).toContainText("Production and Preview environments");
  await expect(setup).toContainText("keep it server-only");
  await expect(setup).toContainText("normal CI runs");
  await expect(setup).toContainText("Verify a preview");
  await expect(setup).toContainText("docs/OBSERVABILITY.md");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
