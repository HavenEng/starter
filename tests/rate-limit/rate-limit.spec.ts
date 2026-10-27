import { test, expect, type APIResponse } from "@playwright/test";
import { Pool } from "pg";
const db = new Pool({
  connectionString:
    "postgresql://browser_e2e:browser_e2e@127.0.0.1:5436/browser_e2e",
});
test.afterAll(() => db.end());
test.beforeEach(async () => {
  await db.query("TRUNCATE rate_limit_buckets");
});
async function minimal(response: APIResponse) {
  expect(response.status()).toBe(429);
  expect(await response.json()).toEqual({ error: "Too many requests" });
  for (const key of Object.keys(response.headers())) {
    expect(key).not.toMatch(
      /^(retry-after|ratelimit.*|x-ratelimit.*|x-request-id|x-sentry-event-id)$/i,
    );
  }
}
test("default limits cover future paths, unsupported methods, query variations, and forged identity headers", async ({
  request,
}) => {
  for (let i = 0; i < 4; i++) {
    const response = await request.get(`/api/unknown-${i}?q=${i}`, {
      headers: {
        "x-forwarded-for": `10.0.0.${i}`,
        "x-request-id": `caller-${i}`,
      },
    });
    expect(response.status()).toBe(404);
    expect(
      Object.keys(response.headers()).some((key) =>
        /^(ratelimit|x-ratelimit)/i.test(key),
      ),
    ).toBe(false);
  }
  await minimal(await request.get("/api/another-path"));
  await minimal(await request.put("/api/auth/session"));
  await minimal(
    await request.fetch("/api/auth/session", { method: "OPTIONS" }),
  );
});
test("route overrides throttle earlier and recover when the stored window expires", async ({
  request,
  baseURL,
}) => {
  for (let i = 0; i < 2; i++)
    expect(
      (
        await request.post("/api/auth/session", {
          headers: { Origin: baseURL! },
          data: {},
        })
      ).status(),
    ).toBe(400);
  await minimal(
    await request.post("/api/auth/staff/session", {
      headers: { Origin: baseURL! },
      data: {},
    }),
  );
  await db.query(
    "UPDATE rate_limit_buckets SET expires_at = now() - interval '1 second'",
  );
  expect(
    (
      await request.post("/api/auth/session", {
        headers: { Origin: baseURL! },
        data: {},
      })
    ).status(),
  ).toBe(400);
});
test("store outages return a logged operational failure while logout can still clear its cookie", async ({
  request,
  baseURL,
}) => {
  await db.query(
    "ALTER TABLE rate_limit_buckets RENAME TO unavailable_buckets",
  );
  try {
    const failure = await request.get("/api/future");
    expect(failure.status()).toBe(503);
    expect(await failure.json()).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    const logout = await request.post("/api/auth/logout", {
      headers: { Origin: baseURL! },
    });
    expect(logout.status()).toBe(200);
    expect(logout.headers()["set-cookie"]).toContain("Max-Age=0");
  } finally {
    await db.query(
      "ALTER TABLE unavailable_buckets RENAME TO rate_limit_buckets",
    );
  }
});
