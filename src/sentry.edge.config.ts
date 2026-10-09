import * as Sentry from "@sentry/nextjs";
import { getSentryOptions } from "@/lib/observability/config";

Sentry.init(
  getSentryOptions({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  }),
);
