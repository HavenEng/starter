// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
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
}));
vi.mock("server-only", () => ({}));
vi.mock("./logger", () => ({ logger: { child: mocks.child } }));
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
