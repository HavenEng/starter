import "server-only";

import { cookies } from "next/headers";
import { getUserByFirebaseUid } from "@/db/users";
import { getStaffUserByFirebaseUid, getStaffRoleKeys } from "@/db/staff-users";
import type { AuthAudience } from "@/lib/auth/audience";
import { getFirebaseAdminAuth } from "@/lib/firebase/admin";
import { isExpectedError } from "@/lib/observability/report";
import { errors } from "@/lib/api/application-error";

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
  } catch (error) {
    if (isExpectedError(error, "auth.verify-session")) return null;
    throw errors.unavailable(error);
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

  const user = await getUserByFirebaseUid(claims.uid);
  return user && !user.disabledAt ? user : null;
}

export async function getCurrentStaffUser() {
  const claims = await getSessionClaims("staff", STAFF_SESSION_COOKIE_NAME);

  if (!claims) {
    return null;
  }

  const user = await getStaffUserByFirebaseUid(claims.uid);
  return user && !user.disabledAt
    ? { ...user, roles: await getStaffRoleKeys(user.id) }
    : null;
}
