// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firebasePasswordRequest, FirebasePasswordError } from "./password-api";

vi.mock("server-only", () => ({}));
vi.mock("./emulator-config", () => ({ assertAuthBuildMode: () => null }));
const send = vi.fn();
beforeEach(() => {
  send.mockReset();
  vi.stubGlobal("fetch", send);
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_USER_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Firebase password error diagnostics", () => {
  it("retains transport causes and identifies the audience and operation", async () => {
    const cause = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Connection refused"), {
        code: "ECONNREFUSED",
      }),
    });
    send.mockRejectedValue(cause);
    const failure = await firebasePasswordRequest("user", "update", {}).catch(
      (error) => error,
    );
    expect(failure).toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
    expect(failure.cause).toBeInstanceOf(FirebasePasswordError);
    expect(failure.cause).toMatchObject({
      code: "TRANSPORT_ERROR",
      operation: "update",
      cause,
    });
    expect(failure.cause.message).toContain("Firebase user update");
  });
  it("retains provider status/code without copying private payloads or detail text", async () => {
    send.mockResolvedValue(
      Response.json(
        {
          error: {
            message: "OPERATION_NOT_ALLOWED : private-detail",
            password: "private-password",
          },
        },
        { status: 400 },
      ),
    );
    const failure = await firebasePasswordRequest(
      "user",
      "sendOobCode",
      {},
    ).catch((error) => error);
    expect(failure.cause).toMatchObject({
      status: 400,
      code: "OPERATION_NOT_ALLOWED",
      operation: "sendOobCode",
    });
    expect(failure.cause.message).toContain("HTTP 400");
    expect(JSON.stringify(failure)).not.toContain("private-");
    expect(failure.cause.message).not.toContain("private-");
  });
  it("does not retain free-form messages as provider error codes", async () => {
    send.mockResolvedValue(
      Response.json(
        { error: { message: "private provider payload" } },
        { status: 500 },
      ),
    );
    await expect(
      firebasePasswordRequest("user", "update", {}),
    ).rejects.toMatchObject({
      cause: { code: "UNKNOWN_ERROR", status: 500 },
    });
  });
  it("retains response decoding failures", async () => {
    send.mockResolvedValue(new Response("not JSON", { status: 502 }));
    await expect(
      firebasePasswordRequest("user", "update", {}),
    ).rejects.toMatchObject({
      cause: {
        code: "INVALID_RESPONSE",
        status: 502,
        cause: expect.any(SyntaxError),
      },
    });
  });
  it("identifies missing configuration without making a provider request", async () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_USER_API_KEY", "");
    await expect(
      firebasePasswordRequest("user", "update", {}),
    ).rejects.toMatchObject({
      cause: { code: "MISSING_API_KEY" },
    });
    expect(send).not.toHaveBeenCalled();
  });
  it("keeps expected credential errors and non-JSON throttling responses classified", async () => {
    send.mockResolvedValueOnce(
      Response.json(
        { error: { message: "INVALID_PASSWORD" } },
        { status: 400 },
      ),
    );
    await expect(
      firebasePasswordRequest("user", "signInWithPassword", {}),
    ).rejects.toMatchObject({ status: 400 });
    send.mockResolvedValueOnce(new Response("Throttled", { status: 429 }));
    await expect(
      firebasePasswordRequest("user", "update", {}),
    ).rejects.toMatchObject({ status: 429 });
  });
});
