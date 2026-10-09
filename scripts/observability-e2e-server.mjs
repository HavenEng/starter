import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createGunzip } from "node:zlib";

if (process.env.VERCEL || process.env.VERCEL_ENV)
  throw new Error("Observability fixtures are local-only.");

const events = [];
const logs = [];
const output = { stdout: "", stderr: "" };
let next;
const collector = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "*");
  if (request.method === "OPTIONS") return response.writeHead(204).end();
  if (request.method === "GET") {
    const payload =
      request.url === "/events"
        ? events
        : request.url === "/logs"
          ? logs
          : request.url === "/output"
            ? output
            : { ready: true };
    response.setHeader("Content-Type", "application/json");
    return response.end(JSON.stringify(payload));
  }
  if (request.method === "DELETE") {
    events.length = 0;
    logs.length = 0;
    output.stdout = "";
    output.stderr = "";
    return response.writeHead(204).end();
  }
  const chunks = [];
  const input =
    request.headers["content-encoding"] === "gzip"
      ? request.pipe(createGunzip())
      : request;
  for await (const chunk of input) chunks.push(chunk);
  const lines = Buffer.concat(chunks).toString().split("\n");
  for (let index = 1; index < lines.length - 1; index += 2) {
    try {
      if (JSON.parse(lines[index]).type === "event")
        events.push(JSON.parse(lines[index + 1]));
    } catch {
      /* Ignore other envelope payloads. */
    }
  }
  response.end("{}");
});
await new Promise((resolve) => collector.listen(4319, "127.0.0.1", resolve));

const env = {
  ...process.env,
  OBSERVABILITY_E2E: "1",
  SENTRY_DSN: "http://test@127.0.0.1:4319/1",
  NEXT_PUBLIC_SENTRY_DSN: "http://test@127.0.0.1:4319/1",
  SENTRY_RELEASE: "observability-e2e",
  SENTRY_AUTH_TOKEN: "",
  SENTRY_ORG: "",
  SENTRY_PROJECT: "",
  LOG_LEVEL: "info",
};

function launch(args) {
  const child = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", ...args],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  for (const [severity, stream] of [
    ["log", child.stdout],
    ["error", child.stderr],
  ]) {
    let pending = "";
    stream.on("data", (chunk) => {
      output[severity === "error" ? "stderr" : "stdout"] += chunk.toString();
      (severity === "error" ? process.stderr : process.stdout).write(chunk);
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (record.msg === "Request completed")
            logs.push({ ...record, stream: severity });
        } catch {
          /* Next.js also writes unstructured diagnostic lines. */
        }
      }
    });
  }
  return child;
}

function stop() {
  next?.kill("SIGTERM");
  collector.close();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

next = launch(["build", "--webpack"]);
const result = await new Promise((resolve) => next.once("exit", resolve));
if (result !== 0) {
  collector.close();
  process.exit(result || 1);
}
next = launch(["start", "--hostname", "127.0.0.1", "--port", "3101"]);
next.once("exit", (code) => {
  collector.close();
  process.exit(code || 0);
});
