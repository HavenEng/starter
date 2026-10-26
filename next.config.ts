import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { isObservabilityTestEnabled } from "./src/lib/observability/config";
import { getSentryBuildOptions } from "./src/lib/observability/build-config";
import { getAuthEmulatorConfig } from "./src/lib/firebase/emulator-config";

const testing = isObservabilityTestEnabled();
const authTesting = Boolean(getAuthEmulatorConfig());
const release = process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE;
const nextConfig: NextConfig = {
  distDir: authTesting
    ? ".next-auth-e2e"
    : testing
      ? ".next-observability"
      : ".next",
  env: {
    NEXT_PUBLIC_SENTRY_ENVIRONMENT:
      process.env.VERCEL_ENV || (testing ? "e2e" : "development"),
    NEXT_PUBLIC_SENTRY_RELEASE: release || "",
    // Derived server-side. A public flag cannot enable fixtures/reporting on Vercel.
    NEXT_PUBLIC_OBSERVABILITY_E2E: testing ? "1" : "0",
    NEXT_PUBLIC_AUTH_E2E: authTesting ? "1" : "0",
  },
};

export default withSentryConfig(nextConfig, getSentryBuildOptions());
