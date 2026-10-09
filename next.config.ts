import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";
import { isObservabilityTestEnabled } from "./src/lib/observability/config";
import { getSentryBuildOptions } from "./src/lib/observability/build-config";

const testing = isObservabilityTestEnabled();
const release = process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE;
const nextConfig: NextConfig = {
  distDir: testing ? ".next-observability" : ".next",
  env: {
    NEXT_PUBLIC_SENTRY_ENVIRONMENT:
      process.env.VERCEL_ENV || (testing ? "e2e" : "development"),
    NEXT_PUBLIC_SENTRY_RELEASE: release || "",
    // Derived server-side. A public flag cannot enable fixtures/reporting on Vercel.
    NEXT_PUBLIC_OBSERVABILITY_E2E: testing ? "1" : "0",
  },
};

export default withSentryConfig(nextConfig, getSentryBuildOptions());
