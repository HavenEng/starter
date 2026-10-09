import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/observability",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3101", trace: "on-first-retry" },
  projects: [{ name: "observability", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/observability-e2e-server.mjs",
    url: "http://127.0.0.1:3101",
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
