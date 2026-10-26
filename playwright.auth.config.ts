import { defineConfig, devices } from "@playwright/test";
import { AUTH_TEST_APP_URL } from "./scripts/auth-e2e-settings.mjs";

export default defineConfig({
  testDir: "./tests/auth",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: AUTH_TEST_APP_URL, trace: "retain-on-failure" },
  projects: [{ name: "auth", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/auth-e2e-server.mjs",
    url: AUTH_TEST_APP_URL,
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 30_000 },
  },
});
