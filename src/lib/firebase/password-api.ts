import "server-only";
import type { AuthAudience } from "@/lib/auth/audience";
import { ApplicationError, errors } from "@/lib/api/application-error";
import { assertAuthBuildMode } from "./emulator-config";

type PasswordOperation = "sendOobCode" | "signInWithPassword" | "update";

export class FirebasePasswordError extends Error {
  constructor(
    audience: AuthAudience,
    readonly operation: PasswordOperation,
    readonly code: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(
      `Firebase ${audience} ${operation} failed (${code}${status ? `; HTTP ${status}` : ""}).`,
      options,
    );
    this.name = "FirebasePasswordError";
  }
}

export async function firebasePasswordRequest(
  audience: AuthAudience,
  operation: PasswordOperation,
  body: Record<string, unknown>,
) {
  const unavailable = (code: string, status?: number, cause?: unknown) =>
    errors.unavailable(
      new FirebasePasswordError(audience, operation, code, status, { cause }),
    );
  const emulator = assertAuthBuildMode(process.env.NEXT_PUBLIC_AUTH_E2E);
  const apiKey =
    process.env[`NEXT_PUBLIC_FIREBASE_${audience.toUpperCase()}_API_KEY`];
  if (!apiKey) throw unavailable("MISSING_API_KEY");
  const origin = emulator
    ? `http://${emulator.host}/identitytoolkit.googleapis.com`
    : "https://identitytoolkit.googleapis.com";
  let response: Response;
  try {
    response = await fetch(
      `${origin}/v1/accounts:${operation}?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      },
    );
  } catch (cause) {
    throw unavailable("TRANSPORT_ERROR", undefined, cause);
  }
  if (response.status === 429) throw errors.limited();
  let result;
  try {
    result = await response.json();
  } catch (cause) {
    throw unavailable("INVALID_RESPONSE", response.status, cause);
  }
  if (response.ok) {
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw unavailable("INVALID_RESPONSE", response.status);
    return result as Record<string, unknown>;
  }
  const code =
    typeof result?.error?.message === "string"
      ? result.error.message.split(" : ")[0]
      : "";
  if (
    operation === "sendOobCode" &&
    ["EMAIL_NOT_FOUND", "USER_DISABLED"].includes(code)
  )
    return {};
  if (
    [
      "TOO_MANY_ATTEMPTS_TRY_LATER",
      "TOO_MANY_REQUESTS",
      "QUOTA_EXCEEDED",
    ].includes(code)
  )
    throw errors.limited();
  if (
    [
      "INVALID_PASSWORD",
      "INVALID_LOGIN_CREDENTIALS",
      "EMAIL_NOT_FOUND",
    ].includes(code)
  )
    throw errors.invalid("The current password is incorrect.");
  if (
    code.startsWith("WEAK_PASSWORD") ||
    code === "PASSWORD_DOES_NOT_MEET_REQUIREMENTS"
  )
    throw errors.invalid(
      "Choose a password that meets the password requirements.",
    );
  if (code === "INVALID_EMAIL")
    throw errors.invalid("Enter a valid email address.");
  if (["USER_DISABLED", "INVALID_ID_TOKEN", "TOKEN_EXPIRED"].includes(code))
    throw new ApplicationError("UNAUTHENTICATED", 401, "Please sign in again.");
  // Keep only a bounded provider code, never its free-form payload or details.
  throw unavailable(
    /^[A-Z][A-Z0-9_]{0,79}$/.test(code) ? code : "UNKNOWN_ERROR",
    response.status,
  );
}
