import { spawn } from "node:child_process";
import { createTestDatabase } from "./e2e-database.mjs";
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const limits = process.argv.includes("--limits");
let next;
let stopDatabase;
let stopping;
async function stop(code = 0) {
  if (stopping) return stopping;
  stopping = (async () => {
    if (next && next.exitCode === null) {
      const exited = new Promise((resolve) => next.once("exit", resolve));
      next.kill("SIGTERM");
      await exited;
    }
    await stopDatabase?.();
    process.exit(code);
  })();
  return stopping;
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
try {
  stopDatabase = await createTestDatabase(
    limits ? 5436 : 5434,
    env,
    (cleanup) => {
      stopDatabase = cleanup;
    },
  );
  if (limits) env.RATE_LIMIT_TEST_MODE = "low";
  next = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      limits ? "3103" : "3100",
    ],
    { env, stdio: "inherit" },
  );
  next.once("exit", (code) => {
    if (!stopping) void stop(code || 0);
  });
} catch {
  console.error("Browser test startup failed.");
  await stop(1);
}
