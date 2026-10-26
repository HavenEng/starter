import "server-only";

import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { AuthAudience } from "@/lib/auth/audience";
import { assertAuthBuildMode } from "./emulator-config";

function requiredEnvironmentVariable(audience: AuthAudience, key: string) {
  const name = `FIREBASE_${audience.toUpperCase()}_${key}`;
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required to use Firebase Admin.`);
  }

  return value;
}

export function getFirebaseAdminAuth(audience: AuthAudience) {
  const emulator = assertAuthBuildMode(process.env.NEXT_PUBLIC_AUTH_E2E);
  const appName = `starter-firebase-${audience}-admin`;
  const existingApp = getApps().find((app) => app.name === appName);
  const app =
    existingApp ??
    initializeApp(
      emulator
        ? { projectId: emulator.projects[audience] }
        : {
            credential: cert({
              projectId: requiredEnvironmentVariable(audience, "PROJECT_ID"),
              clientEmail: requiredEnvironmentVariable(
                audience,
                "CLIENT_EMAIL",
              ),
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
