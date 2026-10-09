import * as Sentry from "@sentry/nextjs";
import { getSentryOptions } from "@/lib/observability/config";

Sentry.init(
  getSentryOptions({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
    testEnabled: process.env.NEXT_PUBLIC_OBSERVABILITY_E2E === "1",
  }),
);
