import type { SentryBuildOptions } from "@sentry/nextjs/config";

export function getSentryBuildOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SentryBuildOptions {
  const upload = Boolean(
    env.VERCEL && env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT,
  );
  return {
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
    // An explicit empty value blocks the SDK's SENTRY_AUTH_TOKEN fallback.
    authToken: upload ? env.SENTRY_AUTH_TOKEN : "",
    release: {
      name: env.VERCEL_GIT_COMMIT_SHA || env.SENTRY_RELEASE,
      create: upload,
      finalize: upload,
      setCommits: upload ? undefined : false,
    },
    sourcemaps: { disable: !upload, deleteSourcemapsAfterUpload: true },
    silent: !upload,
    telemetry: false,
    // The SDK otherwise logs upload failures and lets the build succeed.
    errorHandler: upload
      ? (error) => {
          throw error;
        }
      : undefined,
  };
}
