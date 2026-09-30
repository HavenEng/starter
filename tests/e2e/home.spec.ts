import { expect, test } from "@playwright/test";

test("the starter page loads", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Ready to build." }),
  ).toBeVisible();
  await expect(page).toHaveTitle("Web App Starter");
});
