import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createAuthEmulatorProxy } from "../../scripts/auth-emulator-proxy.mjs";
import { AUTH_TEST_PORTS } from "../../src/lib/firebase/emulator-config.ts";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

test("proxy preserves project routing, request bodies, and browser preflight responses", async () => {
  const received = [];
  const servers = ["user", "staff"].map((audience) =>
    createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      received.push({ audience, method: req.method, path: req.url, body });
      res.writeHead(req.method === "OPTIONS" ? 204 : 200, {
        "Access-Control-Allow-Origin": req.headers.origin ?? "*",
        "Access-Control-Allow-Headers": "content-type",
        "Content-Type": "application/json",
      });
      res.end(
        req.method === "OPTIONS"
          ? undefined
          : JSON.stringify({ audience, body }),
      );
    }),
  );
  const [user, staff] = await Promise.all(servers.map(listen));
  const proxy = createAuthEmulatorProxy({ user, staff });
  const origin = `http://127.0.0.1:${await listen(proxy)}`;
  try {
    for (const audience of ["user", "staff"]) {
      const path = `/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-${audience}-api-key`;
      const body = JSON.stringify({
        email: "synthetic@example.test",
        password: "test",
        returnSecureToken: true,
      });
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { audience, body });
      const preflight = await fetch(`${origin}${path}`, {
        method: "OPTIONS",
        headers: { Origin: "http://127.0.0.1:3102" },
      });
      assert.equal(preflight.status, 204);
      assert.equal(
        preflight.headers.get("access-control-allow-origin"),
        "http://127.0.0.1:3102",
      );
      const admin = await fetch(
        `${origin}/identitytoolkit.googleapis.com/v1/projects/demo-starter-${audience}:createSessionCookie`,
        { method: "POST", body },
      );
      assert.equal((await admin.json()).audience, audience);
    }
    const before = received.length;
    for (const path of [
      "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=unknown",
      "/emulator/v1/projects/unknown/oobCodes",
      "/emulator/v1/projects/demo-starter-staff/oobCodes?key=fake-user-api-key",
    ])
      assert.equal((await fetch(`${origin}${path}`)).status, 400);
    assert.equal(received.length, before);
    await close(servers[0]);
    assert.equal(
      (await fetch(`${origin}/emulator/v1/projects/demo-starter-user/oobCodes`))
        .status,
      502,
    );
  } finally {
    await close(proxy);
    await Promise.all(servers.filter((server) => server.listening).map(close));
  }
});

test("checked-in emulator/Compose ports agree with the runner configuration", async () => {
  for (const audience of ["user", "staff"]) {
    const config = JSON.parse(
      await readFile(
        audience === "user" ? "firebase.json" : "firebase.staff.json",
        "utf8",
      ),
    );
    assert.equal(config.emulators.auth.port, AUTH_TEST_PORTS[audience]);
    assert.equal(config.emulators.hub.port, AUTH_TEST_PORTS[`${audience}Hub`]);
    assert.equal(
      config.emulators.logging.port,
      AUTH_TEST_PORTS[`${audience}Logging`],
    );
    assert.equal(config.emulators.auth.host, "127.0.0.1");
  }
  assert.ok(
    (await readFile("compose.auth-e2e.yaml", "utf8")).includes(
      `127.0.0.1:${AUTH_TEST_PORTS.database}:5432`,
    ),
  );
});
