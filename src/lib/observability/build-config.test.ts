// @vitest-environment node
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSentryBuildOptions } from "./build-config";

const configured = {
  VERCEL: "1",
  SENTRY_AUTH_TOKEN: "synthetic-test-token",
  SENTRY_ORG: "test-org",
  SENTRY_PROJECT: "test-project",
  VERCEL_GIT_COMMIT_SHA: "test-commit",
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("source-map build policy", () => {
  it("requires complete Vercel configuration and uses commit releases", () => {
    for (const env of [
      {},
      { ...configured, VERCEL: undefined },
      { ...configured, SENTRY_AUTH_TOKEN: undefined },
      { ...configured, SENTRY_ORG: undefined },
      { ...configured, SENTRY_PROJECT: undefined },
    ]) {
      expect(getSentryBuildOptions(env).sourcemaps?.disable).toBe(true);
      expect(getSentryBuildOptions(env).errorHandler).toBeUndefined();
      expect(getSentryBuildOptions(env).authToken).toBe("");
      expect(getSentryBuildOptions(env).release).toMatchObject({
        create: false,
        finalize: false,
        setCommits: false,
      });
    }
    expect(getSentryBuildOptions(configured)).toMatchObject({
      release: { name: "test-commit" },
      sourcemaps: { disable: false, deleteSourcemapsAfterUpload: true },
      telemetry: false,
    });
  });

  it("keeps SDK build operations offline outside configured Vercel builds even with credentials in the shell", async () => {
    vi.stubEnv("SENTRY_AUTH_TOKEN", "synthetic-shell-token");
    const require = createRequire(import.meta.url);
    const sdkRequire = createRequire(require.resolve("@sentry/nextjs"));
    const coreEntry = sdkRequire.resolve("@sentry/bundler-plugins/core");
    const { SentryCliAdapter } = sdkRequire(join(dirname(coreEntry), "cli.js"));
    const operations = [
      "createRelease",
      "setCommits",
      "finalizeRelease",
      "newDeploy",
      "uploadSourcemaps",
    ].map((method) =>
      vi.spyOn(SentryCliAdapter.prototype, method).mockResolvedValue(undefined),
    );
    const { createSentryBuildPluginManager } = sdkRequire(coreEntry);
    for (const env of [
      { ...configured, VERCEL: undefined },
      { ...configured, SENTRY_PROJECT: undefined },
    ]) {
      const manager = createSentryBuildPluginManager(
        getSentryBuildOptions(env),
        { buildTool: "webpack", loggerPrefix: "[offline-build-test]" },
      );
      await manager.createRelease();
      await manager.uploadSourcemaps(["synthetic-assets"], {
        prepareArtifacts: false,
      });
    }
    for (const operation of operations)
      expect(operation).not.toHaveBeenCalled();
  });

  it("rejects an actual SDK upload failure instead of silently succeeding", async () => {
    // Resolve the plugin bundled with this installed SDK. Replace only the CLI
    // network boundary; keep the SDK's upload/error handling path real.
    const require = createRequire(import.meta.url);
    const sdkRequire = createRequire(require.resolve("@sentry/nextjs"));
    const coreEntry = sdkRequire.resolve("@sentry/bundler-plugins/core");
    const { SentryCliAdapter } = sdkRequire(join(dirname(coreEntry), "cli.js"));
    const failure = new Error("Synthetic source-map upload failure");
    const upload = vi
      .spyOn(SentryCliAdapter.prototype, "uploadSourcemaps")
      .mockRejectedValue(failure);
    const { createSentryBuildPluginManager } = sdkRequire(coreEntry);
    const options = getSentryBuildOptions(configured);
    const manager = createSentryBuildPluginManager(
      {
        ...options,
        silent: true,
        release: { ...options.release, create: false, finalize: false },
        sourcemaps: { disable: false, assets: ["synthetic-assets"] },
      },
      { buildTool: "webpack", loggerPrefix: "[source-map-test]" },
    );
    await expect(
      manager.uploadSourcemaps(["synthetic-assets"], {
        prepareArtifacts: false,
      }),
    ).rejects.toBe(failure);
    expect(upload).toHaveBeenCalledOnce();
  });
});
