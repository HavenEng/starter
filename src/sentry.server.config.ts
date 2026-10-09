import * as Sentry from "@sentry/nextjs";
import {
  getSentryOptions,
  isObservabilityTestEnabled,
} from "@/lib/observability/config";

Sentry.init(
  getSentryOptions({
    dsn: process.env.SENTRY_DSN,
    environment:
      process.env.VERCEL_ENV ||
      (isObservabilityTestEnabled() ? "e2e" : "development"),
    release: process.env.VERCEL_GIT_COMMIT_SHA || process.env.SENTRY_RELEASE,
    testEnabled: isObservabilityTestEnabled(),
  }),
);
