import { expect, test } from "@playwright/test";

const collector = "http://127.0.0.1:4319";
type Event = {
  event_id: string;
  environment: string;
  release: string;
  tags?: Record<string, string>;
  exception?: { values: { value: string }[] };
};
test.beforeEach(async ({ request }) => {
  await request.delete(collector);
});
test.afterEach(async ({ request }) => {
  const output = await (await request.get(collector + "/output")).json();
  const combined = output.stdout + output.stderr;
  for (const secret of [
    "reset-secret",
    "db-password",
    "json-password",
    "json-token",
    "quoted-secret",
    "url-password",
    "url-code",
    "root-password-secret",
    "console-quoted-secret",
    "console-object-secret",
    "console-auth-secret",
    "console-password-secret",
    "console-encoded-secret",
    "console-refresh-secret",
    "console-fragment-secret",
    "pino-interpolated-secret",
    "child-fixture-secret",
  ])
    expect(combined).not.toContain(secret);
});

test("protects the complete console output and keeps contact details and structured JSON", async ({
  request,
}) => {
  expect(
    (await request.get("/api/observability-test?mode=console")).status(),
  ).toBe(200);
  const output = await (await request.get(collector + "/output")).json();
  expect(output.stderr).toContain("Console fixture");
  expect(output.stderr).toContain("contact@example.com");
  const records = output.stdout
    .split("\n")
    .filter((line: string) => line.startsWith("{"))
    .map((line: string) => JSON.parse(line));
  expect(
    records.find((record: { msg: string }) => record.msg === "Fixture child"),
  ).toMatchObject({ level: 30, requestId: expect.any(String) });
  expect(JSON.stringify(records)).not.toContain("refreshToken");
});

test("captures a root-layout failure once and recovers through the global error boundary", async ({
  page,
  request,
  baseURL,
}) => {
  await page
    .context()
    .addCookies([
      { name: "observability-root-error", value: "1", url: baseURL! },
    ]);
  await page.goto("/observability-test");
  await expect(
    page.getByRole("heading", { name: "Something went wrong" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get(collector + "/events")).json()).length,
    )
    .toBe(1);
  const [event]: Event[] = await (
    await request.get(collector + "/events")
  ).json();
  expect(event.exception?.values[0].value).toContain(
    "Observability root fixture",
  );
  expect(JSON.stringify(event)).not.toContain("root-password-secret");
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Observability test fixture" }),
  ).toBeVisible();
  expect(await (await request.get(collector + "/events")).json()).toHaveLength(
    1,
  );
});

test("captures a browser render failure once and retries the production boundary", async ({
  page,
  request,
}) => {
  await page.goto("/observability-test");
  await page.getByRole("button", { name: "Crash browser render" }).click();
  await expect(
    page.getByRole("heading", { name: "Something went wrong" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${collector}/events`)).json()).length,
    )
    .toBe(1);
  const events: Event[] = await (
    await request.get(`${collector}/events`)
  ).json();
  expect(events[0]).toMatchObject({
    environment: "e2e",
    release: "observability-e2e",
  });
  expect(JSON.stringify(events)).not.toContain("user@example.com");
  expect(JSON.stringify(events)).not.toContain("secret-password");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByRole("heading", { name: "Observability test fixture" }),
  ).toBeVisible();
});

test("captures original server render errors without duplicate browser issues", async ({
  page,
  request,
}) => {
  await page.goto("/observability-test?mode=server&oobCode=reset-secret");
  await expect(
    page.getByRole("heading", { name: "Something went wrong" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${collector}/events`)).json()).length,
    )
    .toBe(1);
  const events: Event[] = await (
    await request.get(`${collector}/events`)
  ).json();
  expect(events[0]).toMatchObject({
    environment: "e2e",
    release: "observability-e2e",
  });
  expect(events[0].exception?.values[0].value).toContain(
    "Observability server fixture",
  );
  expect(JSON.stringify(events)).not.toContain("user@example.com");
  expect(JSON.stringify(events)).not.toContain("reset-secret");
});

test("reports caught failures with tags and sanitizes breadcrumbs and SDK metadata", async ({
  page,
  request,
}) => {
  await page.goto("/observability-test?oobCode=reset-secret");
  await page.getByRole("button", { name: "Report unexpected error" }).click();
  await expect(page.getByText("Reporting finished")).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${collector}/events`)).json()).length,
    )
    .toBe(1);
  const events: Event[] = await (
    await request.get(`${collector}/events`)
  ).json();
  expect(events[0].tags).toMatchObject({
    operation: "auth.sign-in",
    audience: "staff",
  });
  for (const secret of [
    "user@example.com",
    "reset-secret",
    "secret-password",
    "token-secret",
    "json-password",
    "json-token",
    "two word",
    "quoted-secret",
    "url-password",
    "url-code",
  ])
    expect(JSON.stringify(events)).not.toContain(secret);
});

test("reports a gateway failure from the real logout UI and preserves recovery", async ({
  page,
  request,
}) => {
  await page.route("**/api/auth/staff/logout", (route) =>
    route.fulfill({ status: 504, body: "Gateway timeout" }),
  );
  await page.goto("/observability-test");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByText("We could not sign you out. Please try again."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeEnabled();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${collector}/events`)).json()).length,
    )
    .toBe(1);
  const [event]: Event[] = await (
    await request.get(`${collector}/events`)
  ).json();
  expect(event.tags).toMatchObject({
    operation: "auth.logout",
    audience: "staff",
    status: "504",
  });
});

test("captures a returned server failure once and acknowledges it to the logout UI", async ({
  page,
  request,
}) => {
  let eventId: string | undefined;
  let requestId: string | undefined;
  await page.route("**/api/auth/staff/logout", async (route) => {
    const response = await request.get("/api/observability-test?mode=returned");
    eventId = response.headers()["x-sentry-event-id"];
    requestId = response.headers()["x-request-id"];
    await route.fulfill({ response });
  });
  await page.goto("/observability-test");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByText("We could not sign you out. Please try again."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeEnabled();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${collector}/events`)).json()).length,
    )
    .toBe(1);
  const [event]: Event[] = await (
    await request.get(`${collector}/events`)
  ).json();
  expect(eventId).toMatch(/^[a-f\d]{32}$/);
  expect(event.event_id).toBe(eventId);
  expect(event.tags).toMatchObject({
    operation: "http.response",
    requestId,
    status: "503",
  });
  const [log] = await (await request.get(`${collector}/logs`)).json();
  expect(log).toMatchObject({
    status: 503,
    level: 50,
    stream: "error",
    requestId,
  });
});

test("reports Admin credential configuration failures and suppresses expired tokens", async ({
  request,
}) => {
  const response = await request.get(
    "/api/observability-test?mode=admin-credential",
  );
  expect(response.status()).toBe(200);
  await expect
    .poll(
      async () =>
        (await (await request.get(`${collector}/events`)).json()).length,
    )
    .toBe(1);
  const [event]: Event[] = await (
    await request.get(`${collector}/events`)
  ).json();
  expect(event.tags).toMatchObject({
    operation: "auth.verify-id-token",
    audience: "staff",
    errorCode: "auth/invalid-credential",
    requestId: response.headers()["x-request-id"],
  });
  await request.delete(collector);
  expect(
    (await request.get("/api/observability-test?mode=expired-token")).status(),
  ).toBe(200);
  expect(await (await request.get(`${collector}/events`)).json()).toEqual([]);
});

test("keeps expected auth failures out of Sentry and logs API responses by severity", async ({
  page,
  request,
  baseURL,
}) => {
  await page.goto("/observability-test");
  await page.getByRole("button", { name: "Report expected error" }).click();
  await expect(page.getByText("Reporting finished")).toBeVisible();
  expect(await (await request.get(`${collector}/events`)).json()).toEqual([]);
  for (const prefix of ["/api/auth", "/api/auth/staff"]) {
    const rejected = await request.post(`${prefix}/session`, { data: {} });
    expect(rejected.status()).toBe(403);
    const logout = await request.post(`${prefix}/logout`, {
      headers: { Origin: new URL(baseURL!).origin },
    });
    expect(logout.status()).toBe(200);
  }
  await expect
    .poll(
      async () =>
        (await (await request.get(`${collector}/logs`)).json()).length,
    )
    .toBe(4);
  const logs = await (await request.get(`${collector}/logs`)).json();
  expect(
    logs.filter(
      (log: { level: number; status: number }) =>
        log.level === 40 && log.status === 403,
    ),
  ).toHaveLength(2);
  expect(
    logs.filter(
      (log: { level: number; status: number }) =>
        log.level === 30 && log.status === 200,
    ),
  ).toHaveLength(2);
  expect(await (await request.get(`${collector}/events`)).json()).toEqual([]);
});

test("captures an unhandled route failure with its logged request ID", async ({
  request,
}) => {
  expect((await request.get("/api/observability-test")).status()).toBe(500);
  await expect
    .poll(
      async () =>
        (await (await request.get(`${collector}/events`)).json()).length,
    )
    .toBe(1);
  const [event]: Event[] = await (
    await request.get(`${collector}/events`)
  ).json();
  const [log] = await (await request.get(`${collector}/logs`)).json();
  expect(log).toMatchObject({ status: 500, level: 50, stream: "error" });
  expect(event.tags?.requestId).toBe(log.requestId);
  expect(JSON.stringify(event)).not.toContain("db-password");
});
