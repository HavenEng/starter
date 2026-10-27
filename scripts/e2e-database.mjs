import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { isHostedEnvironment } from "../src/lib/firebase/emulator-config.ts";
const running = new Set();

export async function run(command, args, env) {
  const child = spawn(command, args, { env, stdio: "inherit" });
  running.add(child);
  await new Promise((resolve, reject) => {
    child.once("error", (error) => {
      running.delete(child);
      reject(error);
    });
    child.once("exit", (code) => {
      running.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`${command} failed.`));
    });
  });
}

export async function createTestDatabase(port, env, onOwnership = () => {}) {
  if (isHostedEnvironment(env) || (env.APP_ENV && env.APP_ENV !== "local"))
    throw new Error("Browser test databases are local-only.");
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
  const compose = [
    "compose",
    "--project-name",
    `starter-browser-e2e-${process.pid}`,
    "--file",
    "compose.browser-e2e.yaml",
  ];
  env.E2E_DATABASE_PORT = String(port);
  env.DATABASE_URL = `postgresql://browser_e2e:browser_e2e@127.0.0.1:${port}/browser_e2e`;
  env.APP_ENV = "local";
  env.RATE_LIMIT_KEY_SECRET = "isolated-browser-e2e-rate-limit-secret";
  env.BROWSER_E2E = "1";
  env.RATE_LIMIT_TEST_MODE = "high";
  env.RATE_LIMIT_TRUSTED_IP_HEADER = "";
  let cleanup;
  const stop = () =>
    (cleanup ??= (async () => {
      await Promise.all(
        [...running].map(async (child) => {
          const exited = new Promise((resolve) => child.once("exit", resolve));
          child.kill("SIGTERM");
          const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
          await exited;
          clearTimeout(timer);
        }),
      );
      await run(
        "docker",
        [...compose, "down", "--volumes", "--remove-orphans"],
        env,
      );
    })());
  onOwnership(stop);
  try {
    await run("docker", [...compose, "up", "-d", "--wait"], env);
    await run("pnpm", ["db:migrate"], env);
  } catch (error) {
    await stop();
    throw error;
  }
  return stop;
}
