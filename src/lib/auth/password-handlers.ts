import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { AuthAudience } from "./audience";
import { requireApiUser } from "./api-guards";
import { clearSession } from "./session-handlers";
import { readJson } from "@/lib/api/request";
import { ApplicationError, errors } from "@/lib/api/application-error";
import {
  firebasePasswordRequest,
  FirebasePasswordError,
} from "@/lib/firebase/password-api";
import { getFirebaseAdminAuth } from "@/lib/firebase/admin";
import { reportRequestFailure } from "@/lib/observability/request-logging";
import { PASSWORD_CHANGE_UNCONFIRMED } from "./password-change-result";
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  PASSWORD_LENGTH_MESSAGE,
} from "./password-policy";

export async function requestPasswordReset(
  request: NextRequest,
  audience: AuthAudience,
) {
  const body = await readJson(request);
  if (
    typeof body.email !== "string" ||
    body.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
  )
    throw errors.invalid("Enter a valid email address.");
  await firebasePasswordRequest(audience, "sendOobCode", {
    requestType: "PASSWORD_RESET",
    email: body.email.trim(),
  });
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function changePassword(
  request: NextRequest,
  audience: AuthAudience,
) {
  const body = await readJson(request);
  const user = await requireApiUser(audience);
  if (
    typeof body.currentPassword !== "string" ||
    !body.currentPassword.length ||
    body.currentPassword.length > MAX_PASSWORD_LENGTH
  )
    throw errors.invalid(
      `Enter your current password (up to ${MAX_PASSWORD_LENGTH} characters).`,
    );
  if (
    typeof body.newPassword !== "string" ||
    body.newPassword.length < MIN_PASSWORD_LENGTH ||
    body.newPassword.length > MAX_PASSWORD_LENGTH
  )
    throw errors.invalid(PASSWORD_LENGTH_MESSAGE);
  if (body.newPassword !== body.passwordConfirmation)
    throw errors.invalid("The passwords do not match.");
  const auth = getFirebaseAdminAuth(audience);
  const identity = await auth.getUser(user.firebaseUid);
  if (!identity.email || identity.disabled) throw errors.unauthenticated();
  const credential = await firebasePasswordRequest(
    audience,
    "signInWithPassword",
    {
      email: identity.email,
      password: body.currentPassword,
      returnSecureToken: true,
    },
  );
  if (
    credential.localId !== user.firebaseUid ||
    typeof credential.idToken !== "string"
  )
    throw errors.forbidden();
  const claims = await auth.verifyIdToken(credential.idToken, true);
  if (claims.uid !== user.firebaseUid) throw errors.forbidden();
  try {
    const updated = await firebasePasswordRequest(audience, "update", {
      idToken: credential.idToken,
      password: body.newPassword,
      returnSecureToken: false,
    });
    if (updated.localId !== user.firebaseUid)
      throw errors.unavailable(
        new FirebasePasswordError(audience, "update", "INVALID_RESPONSE", 200),
      );
  } catch (cause) {
    if (cause instanceof ApplicationError) {
      const provider = cause.cause;
      // An explicit rejection or missing configuration did not change credentials.
      // Transport loss, invalid success responses, and upstream 5xx may have.
      if (
        cause.status < 500 ||
        (provider instanceof FirebasePasswordError &&
          (provider.code === "MISSING_API_KEY" ||
            (provider.status !== undefined &&
              provider.status >= 400 &&
              provider.status < 500)))
      )
        throw cause;
    }
    throw new ApplicationError(
      PASSWORD_CHANGE_UNCONFIRMED.code,
      503,
      PASSWORD_CHANGE_UNCONFIRMED.message,
      { cause },
    );
  }
  // Firebase invalidates prior sessions on a password change. Explicitly revoke
  // too, but never describe a completed credential update as a failed update.
  try {
    await auth.revokeRefreshTokens(user.firebaseUid);
  } catch (error) {
    reportRequestFailure(error, {
      operation: "auth.change-password.revoke",
      audience,
    });
  }
  try {
    return await clearSession(request, audience);
  } catch (error) {
    reportRequestFailure(error, {
      operation: "auth.change-password.clear-session",
      audience,
    });
    // The password update is confirmed. The sign-in action retries cookie cleanup.
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
