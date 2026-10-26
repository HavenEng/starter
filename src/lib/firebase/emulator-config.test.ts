import { describe, expect, it } from "vitest";
import { assertAuthBuildMode, getAuthEmulatorConfig } from "./emulator-config";
import { getAuthTestEnvironment } from "../../../scripts/auth-e2e-settings.mjs";

describe("Auth Emulator configuration boundary", () => {
  it("leaves ordinary builds disabled, including a forged public flag", () => {
    expect(getAuthEmulatorConfig({})).toBeNull();
    expect(getAuthEmulatorConfig({ NEXT_PUBLIC_AUTH_E2E: "1" })).toBeNull();
  });

  it("requires explicit opt-in before Admin can accept unsigned tokens", () => {
    expect(() =>
      getAuthEmulatorConfig({ FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }),
    ).toThrow("AUTH_E2E=1");
  });

  it("allows a local production-mode app with the two demo projects", () => {
    expect(
      getAuthEmulatorConfig({
        ...getAuthTestEnvironment({}),
        NODE_ENV: "production",
      }),
    ).toMatchObject({
      host: "127.0.0.1:9099",
      projects: { user: "demo-starter-user", staff: "demo-starter-staff" },
    });
  });

  it.each([
    { APP_ENV: undefined },
    { APP_ENV: "" },
    { APP_ENV: "preview" },
    { APP_ENV: "production" },
    { APP_ENV: "invalid" },
    { VERCEL: "1" },
    { VERCEL_ENV: "preview" },
    { VERCEL_ENV: "production" },
    { NETLIFY: "true" },
    { AWS_EXECUTION_ENV: "AWS_Lambda_nodejs24.x" },
    { K_SERVICE: "deployed-app" },
    { FLY_APP_NAME: "deployed-app" },
    { RAILWAY_ENVIRONMENT_ID: "deployed-app" },
    { OBSERVABILITY_E2E: "1" },
    { FIREBASE_AUTH_EMULATOR_HOST: "example.com:9099" },
    { FIREBASE_AUTH_EMULATOR_HOST: "http://127.0.0.1:9099" },
    { FIREBASE_STAFF_PROJECT_ID: "demo-starter-user" },
    { NEXT_PUBLIC_FIREBASE_USER_PROJECT_ID: "real-production-project" },
    { DATABASE_URL: "postgresql://production.invalid/live" },
    { DATABASE_URL: "postgresql://starter:starter@127.0.0.1:5432/starter" },
  ])("rejects unsafe or conflicting settings: %j", (override) => {
    expect(() =>
      getAuthEmulatorConfig({ ...getAuthTestEnvironment({}), ...override }),
    ).toThrow();
  });

  it("checks the compiled mode against the runtime configuration", () => {
    const local = getAuthTestEnvironment({});
    expect(assertAuthBuildMode("1", local)).not.toBeNull();
    expect(assertAuthBuildMode("0", { APP_ENV: "preview" })).toBeNull();
    expect(() => assertAuthBuildMode("1", { APP_ENV: "preview" })).toThrow(
      "modes differ",
    );
    expect(() => assertAuthBuildMode("0", local)).toThrow("modes differ");
    expect(() => assertAuthBuildMode(undefined, {})).toThrow("modes differ");
    expect(() => getAuthTestEnvironment({ APP_ENV: "production" })).toThrow(
      "local-only",
    );
  });

  it("overrides inherited credentials, database URLs, and reporting settings", () => {
    expect(
      getAuthTestEnvironment({
        DATABASE_URL: "postgresql://production.invalid/live",
        FIREBASE_USER_PRIVATE_KEY: "live-key",
        NEXT_PUBLIC_FIREBASE_STAFF_API_KEY: "live-api-key",
        GOOGLE_APPLICATION_CREDENTIALS: "/live/key.json",
        SENTRY_DSN: "https://live.invalid/1",
      }),
    ).toMatchObject({
      DATABASE_URL: "postgresql://auth_e2e:auth_e2e@127.0.0.1:5433/auth_e2e",
      FIREBASE_USER_PRIVATE_KEY: "",
      NEXT_PUBLIC_FIREBASE_STAFF_API_KEY: "fake-staff-api-key",
      GOOGLE_APPLICATION_CREDENTIALS: "",
      SENTRY_DSN: "",
    });
    expect(() => getAuthTestEnvironment({ VERCEL_ENV: "preview" })).toThrow(
      "local-only",
    );
  });
});
