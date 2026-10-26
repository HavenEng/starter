"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import type { AuthAudience } from "@/lib/auth/audience";
import { AUTH_EMULATOR_PROJECTS, AUTH_EMULATOR_URL } from "./emulator-config";

export function getFirebaseAuth(audience: AuthAudience = "user") {
  const config =
    audience === "staff"
      ? {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_STAFF_API_KEY,
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_STAFF_AUTH_DOMAIN,
          projectId: process.env.NEXT_PUBLIC_FIREBASE_STAFF_PROJECT_ID,
          appId: process.env.NEXT_PUBLIC_FIREBASE_STAFF_APP_ID,
        }
      : {
          apiKey: process.env.NEXT_PUBLIC_FIREBASE_USER_API_KEY,
          authDomain: process.env.NEXT_PUBLIC_FIREBASE_USER_AUTH_DOMAIN,
          projectId: process.env.NEXT_PUBLIC_FIREBASE_USER_PROJECT_ID,
          appId: process.env.NEXT_PUBLIC_FIREBASE_USER_APP_ID,
        };
  const missing = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase web configuration: ${missing.join(", ")}`,
    );
  }

  if (
    process.env.NEXT_PUBLIC_AUTH_E2E === "1" &&
    config.projectId !== AUTH_EMULATOR_PROJECTS[audience]
  ) {
    throw new Error("Auth Emulator tests require the matching demo project.");
  }
  const appName = `starter-firebase-${audience}`;
  const exists = getApps().some((existingApp) => existingApp.name === appName);
  const app = exists ? getApp(appName) : initializeApp(config, appName);
  const auth = getAuth(app);
  if (!exists && process.env.NEXT_PUBLIC_AUTH_E2E === "1") {
    connectAuthEmulator(auth, AUTH_EMULATOR_URL, { disableWarnings: true });
  }
  return auth;
}
