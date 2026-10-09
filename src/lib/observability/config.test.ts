import { describe, expect, it } from "vitest";
import { getSentryOptions, isObservabilityTestEnabled } from "./config";

describe("Sentry configuration", () => {
  it.each(["production", "preview"])(
    "enables configured %s errors without paid features",
    (environment) => {
      expect(
        getSentryOptions({
          dsn: "https://key@example.com/1",
          environment,
          release: "commit",
        }),
      ).toMatchObject({
        enabled: true,
        environment,
        release: "commit",
        sampleRate: 1,
        tracesSampleRate: 0,
        profilesSampleRate: 0,
        enableLogs: false,
        sendDefaultPii: false,
        includeLocalVariables: false,
        replaysOnErrorSampleRate: 0,
      });
    },
  );
  it("allows missing configuration and disables local and CI reporting", () => {
    expect(getSentryOptions({ environment: "production" }).enabled).toBe(false);
    expect(getSentryOptions({ dsn: "https://key@example.com/1" }).enabled).toBe(
      false,
    );
    expect(
      getSentryOptions({
        dsn: "https://key@example.com/1",
        environment: "test",
      }).enabled,
    ).toBe(false);
  });
  it("allows only explicitly enabled local E2E fixtures", () => {
    expect(isObservabilityTestEnabled({ OBSERVABILITY_E2E: "1" })).toBe(true);
    expect(
      isObservabilityTestEnabled({ OBSERVABILITY_E2E: "1", VERCEL: "1" }),
    ).toBe(false);
    expect(
      isObservabilityTestEnabled({
        OBSERVABILITY_E2E: "1",
        VERCEL_ENV: "preview",
      }),
    ).toBe(false);
    expect(
      isObservabilityTestEnabled({ NEXT_PUBLIC_OBSERVABILITY_E2E: "1" }),
    ).toBe(false);
  });
});
