import "server-only";

import { eq } from "drizzle-orm";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getDb } from "@/db";
import { staffUsers } from "@/db/schema";

export async function updateStaffUserFromFirebase(claims: DecodedIdToken) {
  const profile = {
    firebaseUid: claims.uid,
    email: claims.email ?? null,
    displayName: typeof claims.name === "string" ? claims.name : null,
    emailVerified: claims.email_verified === true,
  };

  const [user] = await getDb()
    .update(staffUsers)
    .set({ ...profile, updatedAt: new Date() })
    .where(eq(staffUsers.firebaseUid, claims.uid))
    .returning();

  return user ?? null;
}

export async function getStaffUserByFirebaseUid(firebaseUid: string) {
  const [user] = await getDb()
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.firebaseUid, firebaseUid))
    .limit(1);

  return user ?? null;
}
