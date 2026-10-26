import { createServer, request as forwardRequest } from "node:http";
import {
  AUTH_EMULATOR_PROJECTS,
  AUTH_TEST_PORTS,
} from "../src/lib/firebase/emulator-config.ts";

export const AUTH_EMULATOR_PORTS = {
  user: AUTH_TEST_PORTS.user,
  staff: AUTH_TEST_PORTS.staff,
};

// The CLI Auth Emulator routes API-key requests to its default project. Run
// one instance per audience and route transports without altering SDK payloads.
export function createAuthEmulatorProxy(ports = AUTH_EMULATOR_PORTS) {
  return createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1:9099");
    if (url.pathname === "/") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ authEmulator: { ready: true } }));
      return;
    }
    const projectId = url.pathname.match(/\/projects\/([^/:]+)/)?.[1];
    const apiKey = url.searchParams.get("key");
    const audience = Object.keys(AUTH_EMULATOR_PROJECTS).find((candidate) =>
      projectId
        ? AUTH_EMULATOR_PROJECTS[candidate] === projectId
        : apiKey === `fake-${candidate}-api-key`,
    );
    if (!audience || (apiKey && apiKey !== `fake-${audience}-api-key`)) {
      response.writeHead(400, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          error: { message: "Unknown auth test project or API key." },
        }),
      );
      return;
    }
    const upstream = forwardRequest(
      {
        hostname: "127.0.0.1",
        port: ports[audience],
        method: request.method,
        path: request.url,
        headers: {
          ...request.headers,
          host: `127.0.0.1:${ports[audience]}`,
        },
      },
      (result) => {
        response.writeHead(result.statusCode, result.headers);
        result.on("error", () => response.destroy());
        result.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end("Auth test emulator unavailable.");
    });
    request.on("aborted", () => upstream.destroy());
    request.on("error", () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
}
