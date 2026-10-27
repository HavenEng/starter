import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/rate-limit",
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:3103", trace: "retain-on-failure" },
  projects: [{ name: "rate-limit", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/browser-e2e-server.mjs --limits",
    url: "http://127.0.0.1:3103",
    reuseExistingServer: false,
    timeout: 120_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
  },
});
