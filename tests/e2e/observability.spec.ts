import { expect, test } from "@playwright/test";

test("synthetic observability fixtures are inaccessible by default", async ({
  request,
}) => {
  for (const route of ["/observability-test", "/api/observability-test"])
    expect((await request.get(route)).status()).toBe(404);
});

test("root error fixtures cannot be triggered during normal app runs", async ({
  page,
  baseURL,
}) => {
  await page
    .context()
    .addCookies([
      { name: "observability-root-error", value: "1", url: baseURL! },
    ]);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "User and staff authentication" }),
  ).toBeVisible();
});

test("auth responses expose distinct generated request IDs", async ({
  request,
  baseURL,
}) => {
  const ids = new Set<string>();
  for (const prefix of ["/api/auth", "/api/auth/staff"]) {
    for (const action of ["session", "logout"]) {
      const response = await request.post(`${prefix}/${action}`, {
        headers: { Origin: new URL(baseURL!).origin },
        data: {},
      });
      const id = response.headers()["x-request-id"];
      expect(id).toMatch(/^[a-f\d-]{36}$/);
      ids.add(id);
    }
  }
  expect(ids.size).toBe(4);
});
