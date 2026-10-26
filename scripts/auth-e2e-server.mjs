import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AUTH_EMULATOR_PROJECTS,
  AUTH_TEST_PORTS,
} from "../src/lib/firebase/emulator-config.ts";
import { getAuthTestEnvironment } from "./auth-e2e-settings.mjs";
import {
  AUTH_EMULATOR_PORTS,
  createAuthEmulatorProxy,
} from "./auth-emulator-proxy.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const env = getAuthTestEnvironment();
const project = `starter-auth-e2e-${process.pid}`;
const compose = [
  "compose",
  "--project-name",
  project,
  "--file",
  "compose.auth-e2e.yaml",
];
const children = new Set();
let databaseStarted = false;
let stopping = false;
let cleanup;
let proxy;
let cliDirectory;

function launch(command, args, persistent = false) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });
  children.add(child);
  const finished = new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: 1, error }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  void finished.then((result) => {
    children.delete(child);
    if (persistent && !stopping) {
      console.error(`Auth test service stopped unexpectedly: ${command}`);
      void shutdown(1);
    }
    return result;
  });
  return { child, finished };
}

async function run(command, args) {
  const { finished } = launch(command, args);
  const result = await finished;
  if (stopping) throw new Error("Auth test startup was interrupted.");
  if (result.code !== 0) {
    throw (
      result.error ??
      new Error(`${command} failed (${result.code ?? result.signal}).`)
    );
  }
}

function signalChild(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // The process can exit between the liveness check and the signal.
  }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid)
    return;
  const exited = once(child, "exit").catch(() => {});
  signalChild(child, "SIGTERM");
  let timer;
  await Promise.race([
    exited,
    new Promise((resolve) => {
      timer = setTimeout(() => {
        signalChild(child, "SIGKILL");
        resolve();
      }, 5_000);
    }),
  ]);
  clearTimeout(timer);
}

function shutdown(code) {
  if (cleanup) return cleanup;
  stopping = true;
  cleanup = (async () => {
    proxy?.closeAllConnections();
    proxy?.close();
    await Promise.all([...children].map(stopChild));
    if (databaseStarted) {
      const child = spawn(
        "docker",
        [...compose, "down", "--volumes", "--remove-orphans"],
        {
          cwd: root,
          env,
          stdio: "inherit",
        },
      );
      const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
      const result = await new Promise((resolve) => {
        child.once("error", () => resolve(1));
        child.once("exit", (exitCode) => resolve(exitCode));
      });
      clearTimeout(timer);
      if (result !== 0) {
        console.error(
          `Cleanup failed. Run: docker ${compose.join(" ")} down --volumes`,
        );
        code = 1;
      }
    }
    if (cliDirectory) await rm(cliDirectory, { recursive: true, force: true });
    process.exit(code);
  })();
  return cleanup;
}

process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(130));

async function ensurePortFree(port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", resolve);
    });
  } catch {
    throw new Error(
      `Auth test port ${port} is unavailable. Stop its owner before retrying.`,
    );
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

try {
  // Never reuse a running server or reset another run's emulator/database.
  for (const port of Object.values(AUTH_TEST_PORTS)) await ensurePortFree(port);
  await run("docker", ["info", "--format", "{{.ServerVersion}}"]);
  cliDirectory = await mkdtemp(join(tmpdir(), "starter-auth-e2e-"));
  console.log(`Auth test CLI configuration: ${cliDirectory}`);
  env.XDG_CONFIG_HOME = cliDirectory;
  databaseStarted = true;
  await run("docker", [
    ...compose,
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "60",
  ]);
  for (const [audience, projectId] of Object.entries(AUTH_EMULATOR_PROJECTS)) {
    launch(
      process.execPath,
      [
        "node_modules/firebase-tools/lib/bin/firebase.js",
        "emulators:start",
        "--only",
        "auth",
        "--project",
        projectId,
        "--config",
        audience === "user" ? "firebase.json" : "firebase.staff.json",
        "--non-interactive",
      ],
      true,
    );
  }
  const deadline = Date.now() + 30_000;
  while (!stopping) {
    try {
      const ready = await Promise.all(
        Object.values(AUTH_EMULATOR_PORTS).map(async (port) => {
          const response = await fetch(`http://127.0.0.1:${port}`, {
            signal: AbortSignal.timeout(1_000),
          });
          return response.ok && (await response.json()).authEmulator?.ready;
        }),
      );
      if (ready.every(Boolean)) break;
    } catch {
      // The service is still starting.
    }
    if (Date.now() >= deadline)
      throw new Error("Auth Emulator did not become ready.");
    await delay(200);
  }
  if (stopping) throw new Error("Auth test startup was interrupted.");
  proxy = createAuthEmulatorProxy();
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(AUTH_TEST_PORTS.proxy, "127.0.0.1", resolve);
  });
  await run(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "migrate"]);
  await run(process.execPath, [
    "node_modules/next/dist/bin/next",
    "build",
    "--webpack",
  ]);
  launch(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(AUTH_TEST_PORTS.app),
    ],
    true,
  );
} catch (error) {
  if (!stopping)
    console.error(
      error instanceof Error ? error.message : "Auth test startup failed.",
    );
  await shutdown(1);
}
