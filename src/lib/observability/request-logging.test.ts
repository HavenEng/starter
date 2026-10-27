// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { errors } from "@/lib/api/application-error";
import { withApiHandler } from "@/lib/api/handler";
import {
  getErrorRequestId,
  getRequestId,
  withRequestLogging,
} from "./request-logging";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn(),
  setTag: vi.fn(),
  capture: vi.fn(() => "a".repeat(32)),
  enabled: vi.fn(() => true),
  consume: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./logger", () => ({
  logger: { child: mocks.child, error: mocks.error },
}));
vi.mock("@/lib/rate-limit/store", () => ({ enforceRateLimit: mocks.consume }));
vi.mock("@sentry/nextjs", () => ({
  captureException: mocks.capture,
  isEnabled: mocks.enabled,
  withIsolationScope: (
    callback: (scope: { setTag: typeof mocks.setTag }) => unknown,
  ) => callback({ setTag: mocks.setTag }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.child.mockReturnValue(mocks);
  mocks.enabled.mockReturnValue(true);
  mocks.capture.mockReturnValue("a".repeat(32));
});

describe("request logging", () => {
  it("reports a recovered logout limiter failure and completes the successful request once", async () => {
    const error = errors.unavailable(new Error("Store unavailable"));
    mocks.consume.mockRejectedValueOnce(error);
    const response = await withApiHandler<undefined>(
      async () =>
        new Response(null, {
          headers: { "Set-Cookie": "session=; Max-Age=0" },
        }),
      { route: "/api/auth/staff/logout", audience: "staff" },
    )(
      new NextRequest("http://localhost/api/auth/staff/logout", {
        method: "POST",
      }),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(mocks.info).toHaveBeenCalledExactlyOnceWith(
      { status: 200, durationMs: expect.any(Number) },
      "Request completed",
    );
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
      {
        operation: "rate-limit.consume",
        audience: "staff",
        requestId: response.headers.get("x-request-id"),
        errorCode: "SERVICE_UNAVAILABLE",
      },
      "Request dependency failed",
    );
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(error, {
      tags: {
        operation: "rate-limit.consume",
        audience: "staff",
        requestId: response.headers.get("x-request-id"),
        errorCode: "SERVICE_UNAVAILABLE",
      },
    });
  });
  it("preserves recovered logout success when diagnostic sinks fail", async () => {
    mocks.consume.mockRejectedValueOnce(errors.unavailable());
    mocks.error.mockImplementationOnce(() => {
      throw new Error("Broken sink");
    });
    mocks.capture.mockImplementationOnce(() => {
      throw new Error("Broken reporting");
    });
    const response = await withApiHandler<undefined>(
      async () => Response.json({ ok: true }),
      {
        route: "/api/auth/logout",
        audience: "user",
      },
    )(
      new NextRequest("http://localhost/api/auth/logout", { method: "POST" }),
      undefined,
    );
    expect(response.status).toBe(200);
    expect(mocks.info).toHaveBeenCalledOnce();
  });
  it("serializes unknown failures without leaking causes and completes logging once", async () => {
    const response = await withRequestLogging(
      async () => {
        throw new Error("password=private-password");
      },
      { route: "/api/example" },
      true,
    )(new NextRequest("http://localhost/api/example"));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Service unavailable. Please try again.",
      code: "INTERNAL_ERROR",
      requestId: response.headers.get("x-request-id"),
    });
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.capture).toHaveBeenCalledOnce();
  });
  it("keeps rate-limit correlation internal and returns only a generic rejection", async () => {
    const response = await withRequestLogging(
      async () => {
        throw errors.limited();
      },
      { route: "/api/example" },
      true,
    )(new NextRequest("http://localhost/api/example"));
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "Too many requests" });
    expect(response.headers.has("x-request-id")).toBe(false);
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.capture).not.toHaveBeenCalled();
  });
  it.each([
    [200, "info"],
    [403, "warn"],
    [503, "error"],
  ] as const)(
    "logs %s once at %s without changing response contents",
    async (status, level) => {
      const response = new Response("original", {
        status,
        headers: { "Set-Cookie": "existing-cookie" },
      });
      const handler = withRequestLogging(async () => response, {
        route: "/api/auth/session",
        audience: "user",
      });
      const result = await handler(
        new NextRequest("http://localhost/api/auth/session?oobCode=secret", {
          method: "POST",
          headers: { "x-request-id": "untrusted" },
        }),
      );
      expect(await result.text()).toBe("original");
      expect(result.headers.get("set-cookie")).toBe("existing-cookie");
      expect(result.headers.get("x-request-id")).toMatch(/^[a-f\d-]{36}$/);
      expect(mocks.child).toHaveBeenCalledWith({
        requestId: result.headers.get("x-request-id"),
        route: "/api/auth/session",
        method: "POST",
        audience: "user",
      });
      expect(mocks[level]).toHaveBeenCalledExactlyOnceWith(
        { status, durationMs: expect.any(Number) },
        "Request completed",
      );
      if (status >= 500) {
        expect(mocks.capture).toHaveBeenCalledOnce();
        expect(mocks.capture.mock.calls[0]).toEqual([
          expect.any(Error),
          {
            tags: {
              operation: "http.response",
              audience: "user",
              requestId: result.headers.get("x-request-id"),
              errorCode: undefined,
              status: String(status),
            },
          },
        ]);
        expect(result.headers.get("x-sentry-event-id")).toBe("a".repeat(32));
      } else {
        expect(mocks.capture).not.toHaveBeenCalled();
        expect(result.headers.has("x-sentry-event-id")).toBe(false);
      }
    },
  );
  it("does not acknowledge a server event when reporting is disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    const result = await withRequestLogging(
      async () => new Response(null, { status: 503 }),
      { route: "/api/auth/session" },
    )(new NextRequest("http://localhost/"));
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(result.headers.has("x-sentry-event-id")).toBe(false);
  });
  it("preserves a failure response when capturing fails and leaves it unacknowledged", async () => {
    mocks.capture.mockImplementationOnce(() => {
      throw new Error("SDK failure");
    });
    const result = await withRequestLogging(
      async () => new Response("original", { status: 503 }),
      { route: "/api/auth/session" },
    )(new NextRequest("http://localhost/"));
    expect(await result.text()).toBe("original");
    expect(result.headers.has("x-sentry-event-id")).toBe(false);
  });
  it("isolates concurrent IDs and retains metadata for the server error hook", async () => {
    const error = new Error("Original failure");
    const ids: string[] = [];
    const handler = withRequestLogging(
      async () => {
        const id = getRequestId()!;
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(getRequestId()).toBe(id);
        ids.push(id);
        throw error;
      },
      { route: "/api/auth/session" },
    );
    const results = await Promise.allSettled([
      handler(new NextRequest("http://localhost/")),
      handler(new NextRequest("http://localhost/")),
    ]);
    expect(new Set(ids).size).toBe(2);
    expect(results).toEqual([
      { status: "rejected", reason: error },
      { status: "rejected", reason: error },
    ]);
    expect(ids).toContain(getErrorRequestId(error));
    expect(mocks.error).toHaveBeenCalledTimes(2);
    expect(getRequestId()).toBeUndefined();
  });
});
