import * as Sentry from "@sentry/nextjs";
import type { AuthAudience } from "@/lib/auth/audience";

const signInCodes = new Set([
  "auth/invalid-credential",
  "auth/user-not-found",
  "auth/wrong-password",
  "auth/email-already-in-use",
  "auth/weak-password",
  "auth/invalid-email",
  "auth/password-does-not-meet-requirements",
  "auth/too-many-requests",
  "auth/user-disabled",
]);
const resetLinkCodes = new Set([
  "auth/expired-action-code",
  "auth/invalid-action-code",
  "auth/user-disabled",
  "auth/too-many-requests",
]);
const expectedAuthCodes: Readonly<Record<string, ReadonlySet<string>>> = {
  "auth.sign-in": signInCodes,
  "auth.request-password-reset": new Set([
    "auth/invalid-email",
    "auth/user-not-found",
    "auth/user-disabled",
    "auth/too-many-requests",
  ]),
  "auth.verify-password-reset": resetLinkCodes,
  "auth.confirm-password-reset": new Set([
    ...resetLinkCodes,
    "auth/weak-password",
    "auth/password-does-not-meet-requirements",
  ]),
  "auth.verify-id-token": new Set([
    "auth/id-token-expired",
    "auth/id-token-revoked",
    "auth/invalid-id-token",
    "auth/argument-error",
    "auth/user-disabled",
    "auth/user-not-found",
  ]),
  "auth.verify-session": new Set([
    "auth/session-cookie-expired",
    "auth/session-cookie-revoked",
    "auth/invalid-session-cookie",
    "auth/argument-error",
    "auth/user-disabled",
    "auth/user-not-found",
  ]),
};

export const SENTRY_EVENT_ID_HEADER = "x-sentry-event-id";
export function isSentryEventId(value: string | undefined): value is string {
  return typeof value === "string" && /^[a-f\d]{32}$/i.test(value);
}

export function getErrorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

// Carries response metadata without copying request bodies, tokens, or response text.
export class AuthResponseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly serverEventId?: string,
  ) {
    super(message);
    this.name = "AuthResponseError";
  }
}

export function isExpectedError(error: unknown, operation: string) {
  return (
    (Object.hasOwn(expectedAuthCodes, operation) &&
      expectedAuthCodes[operation].has(getErrorCode(error) ?? "")) ||
    (error instanceof AuthResponseError &&
      error.status >= 400 &&
      error.status < 500)
  );
}

export function reportUnexpectedError(
  error: unknown,
  context: {
    operation: string;
    audience?: AuthAudience;
    requestId?: string;
  },
): string | undefined {
  if (isExpectedError(error, context.operation)) return;
  // Platform/gateway failures may never reach the server SDK. Suppress only a
  // response that explicitly identifies an event captured by the application.
  if (
    error instanceof AuthResponseError &&
    isSentryEventId(error.serverEventId)
  )
    return;
  if (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    error.digest
  )
    return;
  try {
    return Sentry.captureException(error, {
      tags: {
        operation: context.operation,
        audience: context.audience,
        requestId:
          context.requestId ??
          (error instanceof AuthResponseError ? error.requestId : undefined),
        errorCode: getErrorCode(error),
        ...(error instanceof AuthResponseError
          ? { status: String(error.status) }
          : {}),
      },
    });
  } catch {
    // Reporting must never change the operation's result or its recovery flow.
  }
}
