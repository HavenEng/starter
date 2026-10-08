import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";

const audiences = [
  {
    name: "user",
    loginPath: "/login",
    apiPath: "/api/auth",
    cookieName: "firebase_session",
  },
  {
    name: "staff",
    loginPath: "/staff/login",
    apiPath: "/api/auth/staff",
    cookieName: "firebase_staff_session",
  },
] as const;

for (const { path, loginPath, heading } of [
  { path: "/account", loginPath: "/login", heading: "Welcome back" },
  { path: "/private", loginPath: "/staff/login", heading: "Staff sign in" },
]) {
  test(`${path} redirects signed-out visitors to ${loginPath}`, async ({
    page,
  }) => {
    await page.goto(path);

    await expect(page).toHaveURL(new RegExp(`${loginPath}$`));
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  });
}

for (const partial of [false, true]) {
  test(`signed-out visitors cannot read the private ${partial ? "partial" : "full"} RSC payload`, async ({
    request,
  }) => {
    const headers: Record<string, string> = { RSC: "1" };
    if (partial) {
      // Ask for only the page segment, so the shared layout does not render.
      headers["Next-Router-State-Tree"] = encodeURIComponent(
        JSON.stringify([
          "",
          {
            children: [
              "private",
              { children: ["__PAGE__", {}, null, "refetch"] },
            ],
          },
        ]),
      );
    }

    const response = await request.get("/private", { headers });
    const body = await response.text();

    expect(body).toContain("NEXT_REDIRECT;replace;/staff/login;");
    expect(body).not.toContain("Private area");
    expect(body).not.toContain(
      "This route is available to authenticated staff accounts.",
    );
  });
}

test("a regular-user cookie cannot authorize a partial staff-page request", async ({
  request,
}) => {
  const response = await request.get("/private", {
    headers: {
      Cookie: "firebase_session=regular-user-session",
      RSC: "1",
      "Next-Router-State-Tree": encodeURIComponent(
        JSON.stringify([
          "",
          {
            children: [
              "private",
              { children: ["__PAGE__", {}, null, "refetch"] },
            ],
          },
        ]),
      ),
    },
  });
  const body = await response.text();

  expect(body).toContain("NEXT_REDIRECT;replace;/staff/login;");
  expect(body).not.toContain("Private area");
});

for (const hostname of ["127.0.0.1", "localhost"]) {
  for (const audience of audiences) {
    test(`${audience.name} session and logout accept the browser origin on ${hostname}`, async ({
      page,
      baseURL,
    }) => {
      const url = new URL(baseURL!);
      url.hostname = hostname;
      await page.goto(new URL(audience.loginPath, url.origin).href);
      await page.context().addCookies([
        {
          name: audience.cookieName,
          value: "existing-session",
          url: url.origin,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);

      const result = await page.evaluate(async (apiPath) => {
        const session = await fetch(`${apiPath}/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const logout = await fetch(`${apiPath}/logout`, { method: "POST" });

        return {
          sessionStatus: session.status,
          sessionBody: await session.json(),
          logoutStatus: logout.status,
          logoutBody: await logout.json(),
        };
      }, audience.apiPath);

      // An empty token should reach validation instead of failing the origin check.
      expect(result.sessionStatus).toBe(400);
      expect(result.sessionBody).toEqual({
        error: "A valid Firebase ID token is required.",
      });
      expect(result.logoutStatus).toBe(200);
      expect(result.logoutBody).toEqual({ ok: true });
      expect(await page.context().cookies(url.origin)).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: audience.cookieName }),
        ]),
      );
    });
  }
}

for (const audience of audiences) {
  test(`${audience.name} session rejects an oversized unfinished chunked body`, async ({
    baseURL,
  }) => {
    const url = new URL(`${audience.apiPath}/session`, baseURL);
    const response = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const request = httpRequest(
          url,
          {
            method: "POST",
            headers: {
              Origin: url.origin,
              "Content-Type": "application/json",
              "Transfer-Encoding": "chunked",
            },
          },
          (response) => {
            let body = "";
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
              body += chunk;
            });
            response.on("error", reject);
            response.on("end", () => {
              clearTimeout(timeout);
              resolve({ status: response.statusCode!, body });
              request.destroy();
            });
          },
        );
        const timeout = setTimeout(() => {
          request.destroy(
            new Error("The server waited for the oversized body to end."),
          );
        }, 5_000);
        request.on("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        // Leave the request open: rejection must happen before the sender ends it.
        request.write(" ".repeat(12_001));
      },
    );

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toEqual({
      error: "Request is too large.",
    });
  });

  test(`${audience.name} session rejects an oversized declared body`, async ({
    request,
    baseURL,
  }) => {
    const response = await request.post(`${audience.apiPath}/session`, {
      headers: {
        Origin: new URL(baseURL!).origin,
        "Content-Type": "application/json",
      },
      data: " ".repeat(12_001),
    });

    expect(response.status()).toBe(413);
    expect(await response.json()).toEqual({ error: "Request is too large." });
  });

  for (const action of ["session", "logout"]) {
    test(`${audience.name} ${action} rejects missing and foreign origins`, async ({
      request,
      baseURL,
    }) => {
      const differentPort = new URL(baseURL!);
      differentPort.port = String(Number(differentPort.port) + 1);
      const differentProtocol = new URL(baseURL!);
      differentProtocol.protocol = "https:";

      for (const origin of [
        undefined,
        "null",
        "https://example.com",
        differentPort.origin,
        differentProtocol.origin,
      ]) {
        await test.step(`origin: ${origin ?? "missing"}`, async () => {
          const response = await request.post(`${audience.apiPath}/${action}`, {
            data: {},
            headers: origin ? { Origin: origin } : {},
          });

          expect(response.status()).toBe(403);
          expect(await response.json()).toEqual({
            error: "Invalid request origin.",
          });
          expect(response.headers()["set-cookie"]).toBeUndefined();
        });
      }
    });
  }
}
