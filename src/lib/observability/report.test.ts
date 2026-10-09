import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthResponseError, reportUnexpectedError } from "./report";

const capture = vi.hoisted(() => vi.fn(() => "event-123"));
vi.mock("@sentry/nextjs", () => ({ captureException: capture }));
beforeEach(() => capture.mockClear());

describe("handled error reporting", () => {
  it.each([
    ["auth/invalid-credential", "auth.sign-in"],
    ["auth/too-many-requests", "auth.request-password-reset"],
    ["auth/id-token-expired", "auth.verify-id-token"],
    ["auth/argument-error", "auth.verify-id-token"],
    ["auth/invalid-action-code", "auth.verify-password-reset"],
    ["auth/expired-action-code", "auth.confirm-password-reset"],
    ["auth/too-many-requests", "auth.verify-password-reset"],
    ["auth/too-many-requests", "auth.confirm-password-reset"],
    ["auth/session-cookie-revoked", "auth.verify-session"],
  ])("suppresses expected %s in %s", (code, operation) => {
    reportUnexpectedError({ code }, { operation });
    expect(capture).not.toHaveBeenCalled();
  });
  it("reports infrastructure and network failures with operational tags", () => {
    const error = Object.assign(new Error("Firebase unavailable"), {
      code: "auth/internal-error",
    });
    expect(
      reportUnexpectedError(error, {
        operation: "auth.verify-id-token",
        audience: "staff",
        requestId: "request-123",
      }),
    ).toBe("event-123");
    expect(capture).toHaveBeenCalledWith(error, {
      tags: {
        operation: "auth.verify-id-token",
        audience: "staff",
        requestId: "request-123",
        errorCode: "auth/internal-error",
      },
    });
  });
  it.each(["auth.verify-id-token", "auth.verify-session"])(
    "reports Admin credentials and invalid arguments in %s",
    (operation) => {
      for (const code of ["auth/invalid-credential", "auth/invalid-argument"]) {
        const error = Object.assign(new Error("Admin configuration failure"), {
          code,
        });
        reportUnexpectedError(error, { operation, audience: "staff" });
        expect(capture).toHaveBeenLastCalledWith(error, {
          tags: {
            operation,
            audience: "staff",
            requestId: undefined,
            errorCode: code,
          },
        });
      }
      expect(capture).toHaveBeenCalledTimes(2);
    },
  );
  it.each(["ui.render", "toString"])(
    "does not apply credential filtering to unrelated operation %s",
    (operation) => {
      reportUnexpectedError({ code: "auth/invalid-credential" }, { operation });
      expect(capture).toHaveBeenCalledOnce();
    },
  );
  it("does not duplicate acknowledged server errors or report expected HTTP rejections", () => {
    for (const error of [
      new AuthResponseError("Rejected", 401),
      new AuthResponseError("Failed", 500, "request-123", "a".repeat(32)),
      Object.assign(new Error("Server render"), { digest: "server-digest" }),
    ])
      reportUnexpectedError(error, { operation: "ui.render" });
    expect(capture).not.toHaveBeenCalled();
  });
  it.each([500, 502, 504])(
    "reports unacknowledged HTTP %s even with a request ID",
    (status) => {
      const error = new AuthResponseError(
        "Session request failed",
        status,
        "request-123",
        "invalid-marker",
      );
      reportUnexpectedError(error, {
        operation: "auth.sign-in",
        audience: "user",
      });
      expect(capture).toHaveBeenCalledWith(error, {
        tags: {
          operation: "auth.sign-in",
          audience: "user",
          requestId: "request-123",
          errorCode: undefined,
          status: String(status),
        },
      });
    },
  );
  it("does not break a flow if reporting throws", () => {
    capture.mockImplementationOnce(() => {
      throw new Error("Collector down");
    });
    expect(() =>
      reportUnexpectedError(new Error("Unexpected"), {
        operation: "auth.sign-in",
      }),
    ).not.toThrow();
  });
});
