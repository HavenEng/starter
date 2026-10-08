import "server-only";

import { eq } from "drizzle-orm";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export async function syncUserFromFirebase(claims: DecodedIdToken) {
  const profile = {
    firebaseUid: claims.uid,
    email: claims.email ?? null,
    displayName: typeof claims.name === "string" ? claims.name : null,
    emailVerified: claims.email_verified === true,
  };

  const [user] = await getDb()
    .insert(users)
    .values(profile)
    .onConflictDoUpdate({
      target: users.firebaseUid,
      set: { ...profile, updatedAt: new Date() },
    })
    .returning();

  return user;
}

export async function getUserByFirebaseUid(firebaseUid: string) {
  const [user] = await getDb()
    .select()
    .from(users)
    .where(eq(users.firebaseUid, firebaseUid))
    .limit(1);

  return user ?? null;
}
