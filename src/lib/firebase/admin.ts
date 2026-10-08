import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { AuthAudience } from "@/lib/auth/audience";

function requiredEnvironmentVariable(audience: AuthAudience, key: string) {
  const name = `FIREBASE_${audience.toUpperCase()}_${key}`;
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required to use Firebase Admin.`);
  }

  return value;
}

export function getFirebaseAdminAuth(audience: AuthAudience) {
  const appName = `starter-firebase-${audience}-admin`;
  const existingApp = getApps().find((app) => app.name === appName);
  const app =
    existingApp ??
    initializeApp(
      {
        credential: cert({
          projectId: requiredEnvironmentVariable(audience, "PROJECT_ID"),
          clientEmail: requiredEnvironmentVariable(audience, "CLIENT_EMAIL"),
          privateKey: requiredEnvironmentVariable(
            audience,
            "PRIVATE_KEY",
          ).replace(/\\n/g, "\n"),
        }),
      },
      appName,
    );

  return getAuth(app);
}
