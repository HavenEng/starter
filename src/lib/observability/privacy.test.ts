import { describe, expect, it } from "vitest";
import {
  sanitizeBreadcrumb,
  sanitizeEvent,
  scrubText,
  scrubUrl,
  scrubLogValue,
} from "./privacy";
import { setErrorRequestId } from "./error-request-id";

describe("telemetry privacy", () => {
  it.each([
    JSON.stringify({
      password: "encoded-secret",
      refreshToken: "refresh-secret",
    }),
    JSON.stringify(
      JSON.stringify({
        password: "encoded-secret",
        refreshToken: "refresh-secret",
      }),
    ),
    "Provider response: " +
      JSON.stringify(
        JSON.stringify({
          password: 'escaped "encoded-secret" value',
          refreshToken: "refresh-secret",
        }),
      ),
    'Provider response: {"credentials":{"raw":"encoded-secret"},"refreshToken":"refresh-secret"}',
  ])("scrubs encoded credentials in %s", (value) => {
    expect(scrubText(value)).not.toContain("encoded-secret");
    expect(scrubText(value)).not.toContain("refresh-secret");
    expect(
      JSON.stringify(
        sanitizeEvent({ type: undefined, exception: { values: [{ value }] } }),
      ),
    ).not.toContain("encoded-secret");
  });
  it.each([
    " //user:url-secret@example.com/reset?oobCode=reset-secret",
    "\\\\user:url-secret@example.com/reset?oobCode=reset-secret",
    " https:\\\\user:url-secret@example.com/reset?oobCode=reset-secret",
    "https:\n//user:url-secret@example.com/reset?oobCode=reset-secret",
    "\u0000https://user:url-secret@example.com/reset?oobCode=reset-secret\u001f",
  ])("normalizes URL forms before stripping credentials in %s", (url) => {
    const event = sanitizeEvent({
      type: undefined,
      request: { url },
      contexts: { nextjs: { request_path: url } },
      breadcrumbs: [{ category: "navigation", data: { to: url } }],
    });
    expect(scrubUrl(url)).not.toContain("url-secret");
    expect(JSON.stringify(event)).not.toContain("url-secret");
    expect(JSON.stringify(event)).not.toContain("reset-secret");
  });
  it.each([
    "Cookie: sid=cookie-secret; refresh=refresh-secret",
    "Authorization: Basic basic-secret",
    "Authorization=Bearer bearer-secret",
    'Bearer "bearer-secret"',
    "FIREBASE_USER_PRIVATE_KEY='private-key-secret'",
    "API Key: api-secret",
    '{"apiKey":"api-secret","credentials":{"password":"nested-secret"}}',
  ])("scrubs credential headers and fields in %s", (value) => {
    expect(scrubText(value)).not.toMatch(
      /(?:cookie|refresh|basic|bearer|private-key|api|nested)-secret/,
    );
  });
  it("keeps log contact details, valid JSON and stable redaction markers", () => {
    const value = JSON.stringify({
      email: "person@example.com",
      phone: "555-1234",
      password: "json-secret",
    });
    const scrubbed = scrubText(value);
    expect(JSON.parse(scrubbed)).toEqual({
      email: "person@example.com",
      phone: "555-1234",
      password: "[Redacted]",
    });
    expect(scrubText(scrubbed)).toBe(scrubbed);
    expect(scrubText("password=[Redacted]")).toBe("password=[Redacted]");
    expect(scrubUrl("C:\\app\\src\\page.tsx")).toBe("C:\\app\\src\\page.tsx");
    expect(scrubUrl("app://user:source-secret@host/server/page.js")).toBe(
      "app://host/server/page.js",
    );
    expect(scrubUrl(" app:\\\\user:source-secret@host/server/page.js")).toBe(
      "app://host/server/page.js",
    );
  });
  it("sanitizes error causes and credential-valued objects without changing the originals", () => {
    const cause = Object.assign(new Error('Failure password="cause-secret"'), {
      credentials: { raw: "nested-secret" },
    });
    const original = Object.assign(
      new Error("Failure token=error-secret", { cause }),
      { email: "person@example.com" },
    );
    const safe = scrubLogValue(original) as Error & { email: string };
    expect(safe).not.toBe(original);
    expect(safe.stack).toContain("privacy.test.ts");
    expect(safe.message).not.toContain("error-secret");
    expect((safe.cause as Error).message).not.toContain("cause-secret");
    expect(safe.email).toBe("person@example.com");
    expect(original.message).toContain("error-secret");
    expect(cause.credentials.raw).toBe("nested-secret");
  });
  it.each([
    [
      '{"password":"synthetic-password","idToken":"synthetic-token"}',
      ["synthetic-password", "synthetic-token"],
    ],
    ['password="two word synthetic secret"', ["two word", "synthetic secret"]],
    [
      String.raw`{"password":"escaped \"synthetic-secret\" value"}`,
      ["synthetic-secret", "escaped"],
    ],
    [
      "'refreshToken': 'multi word synthetic-token'",
      ["multi", "word", "synthetic-token"],
    ],
    ['password="unterminated synthetic-secret', ["synthetic-secret"]],
    [
      "//user:synthetic-password@example.com/reset?oobCode=synthetic-code",
      ["user:", "synthetic-password", "synthetic-code"],
    ],
  ] as const)(
    "scrubs serialized and quoted credentials in %s",
    (message, secrets) => {
      const event = sanitizeEvent({
        type: undefined,
        exception: { values: [{ value: message }] },
      });
      for (const secret of secrets) {
        expect(scrubText(message)).not.toContain(secret);
        expect(JSON.stringify(event)).not.toContain(secret);
      }
    },
  );
  it("strips userinfo from protocol-relative URLs in every URL-bearing field", () => {
    const url =
      "//user:synthetic-password@example.com/reset?oobCode=synthetic-code";
    expect(scrubUrl(url)).toBe("//example.com/reset");
    const event = sanitizeEvent({
      type: undefined,
      request: { url },
      contexts: { nextjs: { request_path: url } },
      breadcrumbs: [{ category: "navigation", data: { to: url } }],
    });
    expect(JSON.stringify(event)).not.toContain("synthetic-");
    expect(event.breadcrumbs?.[0].data?.to).toBe("//example.com/reset");
  });
  it("removes request credentials, bodies, identity, reset URLs, arbitrary extras and locals", () => {
    const cleaned = sanitizeEvent({
      type: undefined,
      user: {
        email: "person@example.com",
        ip_address: "127.0.0.1",
        id: "private-user",
      },
      request: {
        url: "https://user:password@example.com/reset?oobCode=reset-secret#secret",
        headers: { cookie: "session-secret" },
        data: { idToken: "id-secret" },
      },
      extra: {
        customData: { email: "person@example.com" },
        credentials: "private",
      },
      contexts: {
        auth: { password: "password-secret", idToken: "id-secret" },
        nextjs: { request_path: "/reset?oobCode=reset-secret" },
      },
      exception: {
        values: [
          {
            value:
              "person@example.com password=password-secret postgres://user:db-secret@localhost/db",
            stacktrace: {
              frames: [
                {
                  filename: "https://example.com/app.js?oobCode=reset-secret",
                  vars: { password: "password-secret" },
                  context_line: "const key = 'secret'",
                },
              ],
            },
          },
        ],
      },
      breadcrumbs: [
        { category: "console", message: "session-secret" },
        {
          category: "navigation",
          data: {
            to: "/reset?oobCode=reset-secret",
            password: "password-secret",
          },
        },
      ],
    });
    const serialized = JSON.stringify(cleaned);
    for (const secret of [
      "person@example.com",
      "private-user",
      "reset-secret",
      "session-secret",
      "id-secret",
      "password-secret",
      "db-secret",
    ])
      expect(serialized).not.toContain(secret);
    expect(cleaned.request?.url).toBe("https://example.com/reset");
    expect(
      cleaned.exception?.values?.[0].stacktrace?.frames?.[0].filename,
    ).toBe("https://example.com/app.js");
    expect(cleaned.breadcrumbs).toHaveLength(1);
  });

  it("keeps useful safe diagnostics while scrubbing nested strings and JWTs", () => {
    expect(
      scrubText("Bearer token-secret eyJheader.eyJpayload.signature"),
    ).not.toContain("token-secret");
    expect(
      sanitizeEvent({
        type: undefined,
        tags: {
          operation: "auth.sign-in",
          audience: "staff",
          requestId: "request-123",
        },
      }).tags,
    ).toEqual({
      operation: "auth.sign-in",
      audience: "staff",
      requestId: "request-123",
    });
    expect(
      sanitizeBreadcrumb({
        category: "ui.click",
        message: "input email value",
      }),
    ).toBeNull();
  });

  it("preserves source-map filenames and correlates automatically captured route errors", () => {
    const error = new Error("Route failed");
    setErrorRequestId(error, "request-123");
    const event = sanitizeEvent(
      {
        type: undefined,
        exception: {
          values: [
            {
              stacktrace: {
                frames: [
                  { filename: "app:///_next/server/page.js" },
                  { filename: "./src/lib/auth/session.ts" },
                ],
              },
            },
          ],
        },
      },
      { originalException: error },
    );
    expect(event.tags?.requestId).toBe("request-123");
    expect(
      event.exception?.values?.[0].stacktrace?.frames?.map(
        (frame) => frame.filename,
      ),
    ).toEqual(["app:///_next/server/page.js", "./src/lib/auth/session.ts"]);
  });
});
