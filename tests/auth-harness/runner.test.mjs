import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { AUTH_TEST_PORTS } from "../../src/lib/firebase/emulator-config.ts";
import { getAuthTestEnvironment } from "../../scripts/auth-e2e-settings.mjs";

const exec = promisify(execFile);

function start(script, args = [], overrides = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    env: { ...getAuthTestEnvironment(), ...overrides },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  const done = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
  return { child, done, output: () => output };
}

async function stop(run) {
  if (run.child.exitCode !== null || run.child.signalCode !== null) return;
  run.child.kill("SIGTERM");
  const result = await Promise.race([
    run.done,
    delay(30_000, undefined, { ref: false }).then(() => null),
  ]);
  if (!result) {
    run.child.kill("SIGKILL");
    assert.fail("Auth runner did not complete cleanup within 30 seconds.");
  }
}

test(
  "Next build and start reject declared deployment environments without Vercel metadata",
  { timeout: 30_000 },
  async () => {
    for (const command of ["build", "start"]) {
      const run = start(
        "node_modules/next/dist/bin/next",
        [
          command,
          ...(command === "build"
            ? ["--webpack"]
            : ["--port", String(AUTH_TEST_PORTS.app)]),
        ],
        { APP_ENV: "preview" },
      );
      try {
        const result = await run.done;
        assert.notEqual(result.code, 0);
        assert.match(
          result.output,
          /Auth Emulator tests require APP_ENV=local/,
        );
      } finally {
        await stop(run);
      }
    }
  },
);

test(
  "compiled emulator instrumentation rejects promotion to a non-emulator runtime",
  { timeout: 15_000 },
  async () => {
    const run = start(
      "-e",
      [
        "require('./.next-auth-e2e/server/instrumentation.js').register().catch(error => { console.error(error.message); process.exitCode = 1; });",
      ],
      { AUTH_E2E: "0", FIREBASE_AUTH_EMULATOR_HOST: "", APP_ENV: "preview" },
    );
    try {
      const result = await run.done;
      assert.notEqual(result.code, 0);
      assert.match(result.output, /Auth build\/runtime modes differ/);
    } finally {
      await stop(run);
    }
  },
);

test(
  "an occupied test port is left alone and produces an actionable error",
  { timeout: 15_000 },
  async () => {
    const owner = createServer();
    await new Promise((resolve, reject) => {
      owner.once("error", reject);
      owner.listen(AUTH_TEST_PORTS.app, "127.0.0.1", resolve);
    });
    const run = start("scripts/auth-e2e-server.mjs");
    try {
      const result = await run.done;
      assert.notEqual(result.code, 0);
      assert.match(result.output, /Auth test port 3102 is unavailable/);
      assert.equal(owner.listening, true);
    } finally {
      await stop(run);
      await new Promise((resolve) => owner.close(resolve));
    }
  },
);

test(
  "interrupted startup removes only its own services, ports, and CLI configuration",
  { timeout: 120_000 },
  async () => {
    const run = start("scripts/auth-e2e-server.mjs");
    const project = `starter-auth-e2e-${run.child.pid}`;
    try {
      const deadline = Date.now() + 60_000;
      let ready = false;
      while (Date.now() < deadline) {
        assert.equal(
          run.child.exitCode,
          null,
          "Runner exited before services became ready.",
        );
        try {
          const response = await fetch(
            `http://127.0.0.1:${AUTH_TEST_PORTS.proxy}`,
            { signal: AbortSignal.timeout(500) },
          );
          ready = response.ok && (await response.json()).authEmulator?.ready;
          if (ready) break;
        } catch {
          /* Startup is still in progress. */
        }
        await delay(100);
      }
      assert.equal(ready, true, "Local emulator proxy did not become ready.");
      await stop(run);
      assert.equal((await run.done).code, 0);
      for (const [command, format] of [
        ["ps", "{{.Names}}"],
        ["network", "{{.Name}}"],
        ["volume", "{{.Name}}"],
      ]) {
        const args = command === "ps" ? ["ps", "-a"] : [command, "ls"];
        const { stdout } = await exec("docker", [
          ...args,
          "--filter",
          `label=com.docker.compose.project=${project}`,
          "--format",
          format,
        ]);
        assert.equal(stdout.trim(), "");
      }
      const directory = run
        .output()
        .match(/Auth test CLI configuration: (.+)/)?.[1];
      assert.ok(
        directory,
        "Runner did not identify its CLI configuration directory.",
      );
      await assert.rejects(access(directory), { code: "ENOENT" });
      for (const port of Object.values(AUTH_TEST_PORTS)) {
        const server = createServer();
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(port, "127.0.0.1", resolve);
        });
        await new Promise((resolve) => server.close(resolve));
      }
    } finally {
      await stop(run);
    }
  },
);
