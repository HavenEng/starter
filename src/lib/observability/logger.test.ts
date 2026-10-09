// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createLogger, getLogLevel } from "./logger";

vi.mock("server-only", () => ({}));

describe("structured logging", () => {
  it("does not evaluate field getters or fail on uninspectable metadata", () => {
    const output = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const getter = vi.fn(() => {
      throw new Error("getter-secret");
    });
    const fields = Object.defineProperty({ status: 200 }, "password", {
      enumerable: true,
      get: getter,
    });
    const log = createLogger("info", output);
    expect(() => log.info(fields, "Request completed")).not.toThrow();
    expect(getter).not.toHaveBeenCalled();
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("proxy-secret");
        },
      },
    );
    expect(() => log.child(proxy).info("Request completed")).not.toThrow();
    expect(output.log).toHaveBeenCalledTimes(2);
  });
  it("scrubs the final interpolated message and preserves valid JSON and contact details", () => {
    const output = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const log = createLogger("info", output);
    log.info("%s=%s", "password", "interpolated-secret");
    log.warn(
      { status: 500 },
      '%s="%s"',
      "password",
      "two word interpolated-secret",
    );
    log.error(
      "Nested %s",
      JSON.stringify(JSON.stringify({ refreshToken: "encoded-secret" })),
    );
    log.info("Contact %s", "person@example.com");
    for (const line of [
      ...output.log.mock.calls,
      ...output.warn.mock.calls,
      ...output.error.mock.calls,
    ]) {
      expect(() => JSON.parse(line[0])).not.toThrow();
      expect(line[0]).not.toContain("interpolated-secret");
      expect(line[0]).not.toContain("encoded-secret");
    }
    expect(JSON.parse(output.log.mock.calls[1][0]).msg).toBe(
      "Contact person@example.com",
    );
  });
  it("filters nested child bindings, including credentials and reserved Pino fields", () => {
    const output = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const log = createLogger("info", output)
      .child({
        operation: "auth.sign-in",
        refreshToken: "child-secret",
        level: 10,
        msg: "child-secret",
      })
      .child({ requestId: "request-123", accessToken: "nested-secret" });
    log.error("Failure");
    expect(output.error).toHaveBeenCalledOnce();
    const record = JSON.parse(output.error.mock.calls[0][0]);
    expect(record).toMatchObject({
      level: 50,
      operation: "auth.sign-in",
      requestId: "request-123",
      msg: "Failure",
    });
    expect(record).not.toHaveProperty("refreshToken");
    expect(record).not.toHaveProperty("accessToken");
  });
  it("redacts JSON credentials, quoted spaces and protocol-relative URL credentials in messages", () => {
    const output = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const log = createLogger("info", output);
    log.error('{"password":"synthetic-password","idToken":"synthetic-token"}');
    log.error('password="two word synthetic secret"');
    log.error(
      "//user:synthetic-password@example.com/reset?oobCode=synthetic-code",
    );
    const serialized = JSON.stringify(output.error.mock.calls);
    for (const value of [
      "synthetic-password",
      "synthetic-token",
      "two word",
      "synthetic secret",
      "synthetic-code",
    ])
      expect(serialized).not.toContain(value);
    expect(output.error).toHaveBeenCalledTimes(3);
  });
  it("maps severity to Vercel console methods and filters unsafe fields and messages", () => {
    const output = { ...console, log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const log = createLogger("info", output).child({
      requestId: "request-123",
      audience: "staff",
      email: "private@example.com",
    });
    log.debug("Ignored debug");
    log.info(
      {
        status: 200,
        body: { idToken: "token-secret" },
        password: "password-secret",
      },
      "Request completed",
    );
    log.warn({ status: 401 }, "Rejected private@example.com");
    log.error(
      { status: 500, error: { message: "password-secret" } },
      "Failure password=password-secret",
    );
    expect(output.log).toHaveBeenCalledTimes(1);
    expect(output.warn).toHaveBeenCalledTimes(1);
    expect(output.error).toHaveBeenCalledTimes(1);
    const record = JSON.parse(output.log.mock.calls[0][0]);
    expect(record).toMatchObject({
      requestId: "request-123",
      audience: "staff",
      status: 200,
    });
    const serialized = JSON.stringify([
      output.log.mock.calls,
      output.warn.mock.calls,
      output.error.mock.calls,
    ]);
    expect(JSON.parse(output.warn.mock.calls[0][0]).msg).toContain(
      "private@example.com",
    );
    expect(record).not.toHaveProperty("email");
    for (const value of ["password-secret", "token-secret"])
      expect(serialized).not.toContain(value);
  });
  it("uses portable local defaults and supports a validated level override", () => {
    expect(getLogLevel({})).toBe("debug");
    expect(getLogLevel({ VERCEL: "1" })).toBe("info");
    expect(getLogLevel({ LOG_LEVEL: "warn" })).toBe("warn");
    expect(getLogLevel({ VERCEL: "1", LOG_LEVEL: "invalid" })).toBe("info");
    expect(getLogLevel({ LOG_LEVEL: "silent" })).toBe("silent");
  });
});
