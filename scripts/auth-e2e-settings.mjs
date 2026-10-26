import {
  AUTH_EMULATOR_DATABASE_URL,
  AUTH_EMULATOR_HOST,
  AUTH_EMULATOR_PROJECTS,
  AUTH_TEST_PORTS,
  isHostedEnvironment,
} from "../src/lib/firebase/emulator-config.ts";

export const AUTH_TEST_DATABASE_URL = AUTH_EMULATOR_DATABASE_URL;
export const AUTH_TEST_APP_URL = `http://127.0.0.1:${AUTH_TEST_PORTS.app}`;

/** @param {Readonly<Record<string, string | undefined>>} [source] */
export function getAuthTestEnvironment(source = process.env) {
  if (
    isHostedEnvironment(source) ||
    (source.APP_ENV && source.APP_ENV !== "local")
  ) {
    throw new Error("Auth Emulator tests are local-only.");
  }
  const env = {
    ...source,
    APP_ENV: "local",
    AUTH_E2E: "1",
    FIREBASE_AUTH_EMULATOR_HOST: AUTH_EMULATOR_HOST,
    DATABASE_URL: AUTH_TEST_DATABASE_URL,
    GCLOUD_PROJECT: AUTH_EMULATOR_PROJECTS.user,
    GOOGLE_CLOUD_PROJECT: AUTH_EMULATOR_PROJECTS.user,
    GOOGLE_APPLICATION_CREDENTIALS: "",
    OBSERVABILITY_E2E: "0",
    NEXT_PUBLIC_OBSERVABILITY_E2E: "0",
    NEXT_PUBLIC_AUTH_E2E: "1",
    SENTRY_DSN: "",
    NEXT_PUBLIC_SENTRY_DSN: "",
    SENTRY_AUTH_TOKEN: "",
    SENTRY_ORG: "",
    SENTRY_PROJECT: "",
    SENTRY_RELEASE: "",
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: "development",
    NEXT_PUBLIC_SENTRY_RELEASE: "",
    FIREBASE_TOKEN: "",
    NO_UPDATE_NOTIFIER: "1",
    CI: "true",
    DEBUG: "",
    LOG_LEVEL: "warn",
    NEXT_TELEMETRY_DISABLED: "1",
  };
  // Playwright can inherit both color flags; keep service output unambiguous.
  delete env.FORCE_COLOR;
  for (const [audience, projectId] of Object.entries(AUTH_EMULATOR_PROJECTS)) {
    const prefix = audience.toUpperCase();
    Object.assign(env, {
      [`FIREBASE_${prefix}_PROJECT_ID`]: projectId,
      [`FIREBASE_${prefix}_CLIENT_EMAIL`]: "",
      [`FIREBASE_${prefix}_PRIVATE_KEY`]: "",
      [`NEXT_PUBLIC_FIREBASE_${prefix}_PROJECT_ID`]: projectId,
      [`NEXT_PUBLIC_FIREBASE_${prefix}_API_KEY`]: `fake-${audience}-api-key`,
      [`NEXT_PUBLIC_FIREBASE_${prefix}_AUTH_DOMAIN`]: `${projectId}.firebaseapp.com`,
      [`NEXT_PUBLIC_FIREBASE_${prefix}_APP_ID`]: `fake-${audience}-app-id`,
    });
  }
  return env;
}
