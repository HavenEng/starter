import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { updateStaffUserFromFirebase } from "@/db/staff-users";
import { syncUserFromFirebase } from "@/db/users";
import type { AuthAudience } from "@/lib/auth/audience";
import {
  readRequestBody,
  RequestBodyTooLargeError,
} from "@/lib/auth/read-request-body";
import { getFirebaseAdminAuth } from "@/lib/firebase/admin";
import {
  SESSION_DURATION_MS,
  STAFF_SESSION_COOKIE_NAME,
  USER_SESSION_COOKIE_NAME,
} from "@/lib/auth/session";

const MAX_REQUEST_BYTES = 12_000;
const MAX_AUTH_AGE_SECONDS = 5 * 60;

function reject(message: string, status: number) {
  return NextResponse.json(
    { error: message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function getCookieName(audience: AuthAudience) {
  return audience === "staff"
    ? STAFF_SESSION_COOKIE_NAME
    : USER_SESSION_COOKIE_NAME;
}

function hasSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin || !host) {
    return false;
  }

  // NextURL normalizes loopback IPs to localhost. Preserve the HTTP host so
  // the comparison uses the same hostname and port as the browser.
  const expectedOrigin = new URL(request.nextUrl.origin);
  expectedOrigin.host = host;

  return origin === expectedOrigin.origin;
}

export async function createSession(
  request: NextRequest,
  audience: AuthAudience,
) {
  if (!hasSameOrigin(request)) {
    return reject("Invalid request origin.", 403);
  }

  if (!request.headers.get("content-type")?.includes("application/json")) {
    return reject("Expected a JSON request.", 415);
  }

  let rawBody: string;
  try {
    rawBody = await readRequestBody(request, MAX_REQUEST_BYTES);
  } catch (error) {
    return error instanceof RequestBodyTooLargeError
      ? reject("Request is too large.", 413)
      : reject("Invalid request body.", 400);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return reject("Invalid JSON request.", 400);
  }

  const idToken =
    typeof body === "object" && body !== null && "idToken" in body
      ? body.idToken
      : null;

  if (
    typeof idToken !== "string" ||
    idToken.length === 0 ||
    idToken.length > 10_000
  ) {
    return reject("A valid Firebase ID token is required.", 400);
  }

  const firebaseAuth = getFirebaseAdminAuth(audience);
  let claims;

  try {
    claims = await firebaseAuth.verifyIdToken(idToken);
  } catch {
    return reject("The Firebase sign-in token is invalid.", 401);
  }

  if (claims.firebase.sign_in_provider !== "password") {
    return reject("Only email/password sign-in is supported.", 403);
  }

  const authAgeSeconds = Math.floor(Date.now() / 1000) - claims.auth_time;
  if (authAgeSeconds < 0 || authAgeSeconds > MAX_AUTH_AGE_SECONDS) {
    return reject("Please sign in again to start a session.", 401);
  }

  if (audience === "staff") {
    const staffUser = await updateStaffUserFromFirebase(claims);
    if (!staffUser) {
      return reject("This account is not provisioned for staff access.", 403);
    }
  } else {
    await syncUserFromFirebase(claims);
  }

  const sessionCookie = await firebaseAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_DURATION_MS,
  });

  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(getCookieName(audience), sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });

  return response;
}

export async function clearSession(
  request: NextRequest,
  audience: AuthAudience,
) {
  if (!hasSameOrigin(request)) {
    return reject("Invalid request origin.", 403);
  }

  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(getCookieName(audience), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}
