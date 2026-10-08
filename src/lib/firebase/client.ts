"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import type { AuthAudience } from "@/lib/auth/audience";

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

  const appName = `starter-firebase-${audience}`;
  const app = getApps().some((existingApp) => existingApp.name === appName)
    ? getApp(appName)
    : initializeApp(config, appName);

  return getAuth(app);
}
