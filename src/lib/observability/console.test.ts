// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { inspect } from "node:util";
import { installConsoleRedaction } from "./console";
vi.mock("server-only", () => ({}));

function output() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    dir: vi.fn(),
    table: vi.fn(),
    assert: vi.fn(),
  };
}
describe("server console credential protection", () => {
  it("protects directory/table objects and assertion formatting without changing assertion truthiness", () => {
    const target = output();
    const originalDir = target.dir;
    const originalTable = target.table;
    const originalAssert = target.assert;
    installConsoleRedaction(target);
    target.dir({
      credentials: { raw: "dir-secret" },
      email: "person@example.com",
    });
    target.table([{ password: "table-secret" }]);
    target.assert(true, "password=assert-secret");
    expect(originalAssert).not.toHaveBeenCalled();
    target.assert(false, "%s=%s", "password", "assert-secret");
    expect(originalAssert).toHaveBeenCalledWith(false, "password=[Redacted]");
    expect(originalDir).toHaveBeenCalledWith(
      { credentials: "[Redacted]", email: "person@example.com" },
      undefined,
    );
    expect(originalTable).toHaveBeenCalledWith(
      [{ password: "[Redacted]" }],
      undefined,
    );
  });
  it("keeps severity, formatted diagnostics and contact details, and installs once", () => {
    const target = output();
    const originalError = target.error;
    const originalLog = target.log;
    installConsoleRedaction(target);
    const guarded = target.error;
    installConsoleRedaction(target);
    expect(target.error).toBe(guarded);
    target.error("%s=%s", "password", "console-secret");
    target.log("Contact %s %d", "person@example.com", 42);
    expect(originalError).toHaveBeenCalledExactlyOnceWith(
      "password=[Redacted]",
    );
    expect(originalLog).toHaveBeenCalledExactlyOnceWith(
      "Contact person@example.com 42",
    );
  });
  it("sanitizes raw Error stacks, causes and custom properties without mutation", () => {
    const target = output();
    const originalError = target.error;
    installConsoleRedaction(target);
    const error = Object.assign(
      new Error("Database postgres://user:db-secret@localhost/db", {
        cause: new Error('password="cause-secret"'),
      }),
      { credentials: { raw: "nested-secret" }, email: "person@example.com" },
    );
    target.error("Next failure", error);
    const message = originalError.mock.calls[0][0];
    for (const secret of ["db-secret", "cause-secret", "nested-secret"])
      expect(message).not.toContain(secret);
    expect(message).toContain("console.test.ts");
    expect(message).toContain("person@example.com");
    expect(error.message).toContain("db-secret");
  });
  it("handles circular objects and omits accessors and custom inspect hooks", () => {
    const target = output();
    const originalWarn = target.warn;
    installConsoleRedaction(target);
    const getter = vi.fn(() => "getter-secret");
    const custom = vi.fn(() => "inspect-secret");
    const value: Record<string | symbol, unknown> = {
      password: { raw: "nested-secret" },
      [inspect.custom]: custom,
    };
    value.self = value;
    Object.defineProperty(value, "detail", { enumerable: true, get: getter });
    target.warn(value);
    expect(getter).not.toHaveBeenCalled();
    expect(custom).not.toHaveBeenCalled();
    expect(originalWarn.mock.calls[0][0]).not.toContain("nested-secret");
    expect(originalWarn.mock.calls[0][0]).toContain("[Circular]");
  });
  it("omits array accessors without invoking overridden collection methods", () => {
    const target = output();
    const originalLog = target.log;
    installConsoleRedaction(target);
    const getter = vi.fn(() => "array-secret");
    const map = vi.fn(() => ["array-secret"]);
    const value: unknown[] = [{ password: "array-secret" }];
    Object.defineProperty(value, "1", { enumerable: true, get: getter });
    Object.defineProperty(value, "map", { value: map });
    target.log(value);
    expect(getter).not.toHaveBeenCalled();
    expect(map).not.toHaveBeenCalled();
    expect(originalLog.mock.calls[0][0]).not.toContain("array-secret");
  });
});
