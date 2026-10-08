import "server-only";

import { cookies } from "next/headers";
import { getUserByFirebaseUid } from "@/db/users";
import { getStaffUserByFirebaseUid } from "@/db/staff-users";
import type { AuthAudience } from "@/lib/auth/audience";
import { getFirebaseAdminAuth } from "@/lib/firebase/admin";

export const USER_SESSION_COOKIE_NAME = "firebase_session";
export const STAFF_SESSION_COOKIE_NAME = "firebase_staff_session";
export const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000;

async function getSessionClaims(audience: AuthAudience, cookieName: string) {
  const sessionCookie = (await cookies()).get(cookieName)?.value;

  if (!sessionCookie) {
    return null;
  }

  let claims;

  try {
    claims = await getFirebaseAdminAuth(audience).verifySessionCookie(
      sessionCookie,
      true,
    );
  } catch {
    return null;
  }

  if (claims.firebase.sign_in_provider !== "password") {
    return null;
  }

  return claims;
}

export async function getCurrentUser() {
  const claims = await getSessionClaims("user", USER_SESSION_COOKIE_NAME);

  if (!claims) {
    return null;
  }

  return getUserByFirebaseUid(claims.uid);
}

export async function getCurrentStaffUser() {
  const claims = await getSessionClaims("staff", STAFF_SESSION_COOKIE_NAME);

  if (!claims) {
    return null;
  }

  return getStaffUserByFirebaseUid(claims.uid);
}
