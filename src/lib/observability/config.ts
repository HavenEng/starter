import { sanitizeBreadcrumb, sanitizeEvent } from "./privacy";

export function isObservabilityTestEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env.OBSERVABILITY_E2E === "1" && !env.VERCEL && !env.VERCEL_ENV;
}

export function getSentryOptions({
  dsn,
  environment,
  release,
  testEnabled = false,
}: {
  dsn?: string;
  environment?: string;
  release?: string;
  testEnabled?: boolean;
}) {
  return {
    dsn: dsn || undefined,
    enabled:
      Boolean(dsn) &&
      (environment === "production" ||
        environment === "preview" ||
        testEnabled),
    environment: environment || "development",
    release: release || undefined,
    sampleRate: 1,
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableLogs: false,
    sendDefaultPii: false,
    includeLocalVariables: false,
    autoSessionTracking: false,
    beforeSend: sanitizeEvent,
    beforeBreadcrumb: sanitizeBreadcrumb,
  };
}
