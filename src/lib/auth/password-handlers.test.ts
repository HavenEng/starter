// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { changePassword } from "./password-handlers";
import { errors } from "@/lib/api/application-error";
import { FirebasePasswordError } from "@/lib/firebase/password-api";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  revoke: vi.fn(),
  report: vi.fn(),
  clear: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./api-guards", () => ({
  requireApiUser: async () => ({ firebaseUid: "current-user" }),
}));
vi.mock("./session-handlers", () => ({ clearSession: mocks.clear }));
vi.mock("@/lib/firebase/password-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/firebase/password-api")>()),
  firebasePasswordRequest: mocks.request,
}));
vi.mock("@/lib/firebase/admin", () => ({
  getFirebaseAdminAuth: () => ({
    getUser: async () => ({ email: "current@example.test", disabled: false }),
    verifyIdToken: async () => ({ uid: "current-user" }),
    revokeRefreshTokens: mocks.revoke,
  }),
}));
vi.mock("@/lib/observability/request-logging", () => ({
  reportRequestFailure: mocks.report,
}));
function request(extra = {}) {
  return new NextRequest("http://localhost/api/auth/change-password", {
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      currentPassword: "current-password",
      newPassword: "new-password",
      passwordConfirmation: "new-password",
      ...extra,
    }),
  });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.request
    .mockResolvedValueOnce({
      localId: "current-user",
      idToken: "private-token",
    })
    .mockResolvedValueOnce({ localId: "current-user" });
  mocks.clear.mockResolvedValue(Response.json({ ok: true }));
});
describe("password-change failure boundaries", () => {
  it.each([{}, { localId: "other-user" }])(
    "requires recovery when the update confirmation does not identify the current user",
    async (result) => {
      mocks.request
        .mockReset()
        .mockResolvedValueOnce({
          localId: "current-user",
          idToken: "private-token",
        })
        .mockResolvedValueOnce(result);
      await expect(changePassword(request(), "user")).rejects.toMatchObject({
        code: "PASSWORD_CHANGE_UNCONFIRMED",
        status: 503,
      });
      expect(mocks.revoke).not.toHaveBeenCalled();
      expect(mocks.clear).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["TRANSPORT_ERROR", undefined],
    ["INVALID_RESPONSE", 200],
    ["INTERNAL_ERROR", 500],
  ] as const)(
    "requires sign-in recovery for an unconfirmed update (%s)",
    async (code, status) => {
      const cause = errors.unavailable(
        new FirebasePasswordError("user", "update", code, status),
      );
      mocks.request
        .mockReset()
        .mockResolvedValueOnce({
          localId: "current-user",
          idToken: "private-token",
        })
        .mockRejectedValueOnce(cause);
      const failure = await changePassword(request(), "user").catch(
        (error) => error,
      );
      expect(failure).toMatchObject({
        code: "PASSWORD_CHANGE_UNCONFIRMED",
        status: 503,
        cause,
      });
      expect(mocks.request).toHaveBeenCalledTimes(2);
      expect(mocks.revoke).not.toHaveBeenCalled();
      expect(mocks.clear).not.toHaveBeenCalled();
      expect(mocks.report).not.toHaveBeenCalled(); // The API adapter owns capture.
    },
  );
  it.each([
    errors.invalid("The current password is incorrect."),
    errors.invalid("Choose a password that meets the password requirements."),
    errors.limited(),
    errors.unavailable(
      new FirebasePasswordError("user", "update", "MISSING_API_KEY"),
    ),
    errors.unavailable(
      new FirebasePasswordError("user", "update", "OPERATION_NOT_ALLOWED", 400),
    ),
  ])("preserves confirmed provider rejections", async (failure) => {
    mocks.request
      .mockReset()
      .mockResolvedValueOnce({
        localId: "current-user",
        idToken: "private-token",
      })
      .mockRejectedValueOnce(failure);
    await expect(changePassword(request(), "user")).rejects.toBe(failure);
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it("allows a normal retry when verification fails before the update was sent", async () => {
    const failure = errors.unavailable(
      new FirebasePasswordError(
        "user",
        "signInWithPassword",
        "TRANSPORT_ERROR",
      ),
    );
    mocks.request.mockReset().mockRejectedValueOnce(failure);
    await expect(changePassword(request(), "user")).rejects.toBe(failure);
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it("keeps a confirmed update successful when cookie cleanup fails", async () => {
    mocks.clear.mockRejectedValueOnce(new Error("Cookie cleanup failed"));
    const response = await changePassword(request(), "staff");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.report).toHaveBeenCalledExactlyOnceWith(expect.any(Error), {
      operation: "auth.change-password.clear-session",
      audience: "staff",
    });
  });
  it.each(["currentPassword", "newPassword"])(
    "rejects %s over 64 characters before contacting Firebase",
    async (field) => {
      await expect(
        changePassword(request({ [field]: "a".repeat(65) }), "user"),
      ).rejects.toMatchObject({ status: 400 });
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it("accepts a 64-character current and new password", async () => {
    const password = "a".repeat(64);
    expect(
      (
        await changePassword(
          request({
            currentPassword: password,
            newPassword: password,
            passwordConfirmation: password,
          }),
          "user",
        )
      ).status,
    ).toBe(200);
  });
  it("reports revocation follow-up failure but acknowledges the completed password change", async () => {
    mocks.revoke.mockRejectedValueOnce(new Error("Provider unavailable"));
    expect((await changePassword(request(), "user")).status).toBe(200);
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.report).toHaveBeenCalledOnce();
    expect(mocks.request.mock.calls[1]).toEqual([
      "user",
      "update",
      {
        idToken: "private-token",
        password: "new-password",
        returnSecureToken: false,
      },
    ]);
  });
  it("rejects a credential for another UID before a password update", async () => {
    mocks.request
      .mockReset()
      .mockResolvedValueOnce({ localId: "other-user", idToken: "other-token" });
    await expect(
      changePassword(
        request({ uid: "other-user", email: "other@example.test" }),
        "user",
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it("rejects confirmation mismatch before contacting the provider", async () => {
    await expect(
      changePassword(request({ passwordConfirmation: "different" }), "staff"),
    ).rejects.toMatchObject({ status: 400 });
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
