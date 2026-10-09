import "server-only";
import { formatWithOptions } from "node:util";
import { scrubLogValue, scrubText } from "./privacy";

const methods = ["log", "info", "debug", "warn", "error", "trace"] as const;
type ConsoleOutput = Pick<
  Console,
  (typeof methods)[number] | "dir" | "table" | "assert"
>;
const globalForConsole = globalThis as typeof globalThis & {
  __observabilityConsoleTargets?: WeakSet<ConsoleOutput>;
};
const installed = (globalForConsole.__observabilityConsoleTargets ??=
  new WeakSet());

function safeFormat(args: unknown[]) {
  try {
    // Preserve format strings until interpolation, and structurally sanitize
    // objects first so credential-valued nested objects cannot escape.
    return scrubText(
      formatWithOptions(
        { colors: false, customInspect: false, getters: false },
        ...args.map((arg) =>
          typeof arg === "string" ? arg : scrubLogValue(arg),
        ),
      ),
    );
  } catch {
    return "[Unserializable log omitted]";
  }
}

export function installConsoleRedaction(target: ConsoleOutput = console) {
  if (installed.has(target)) return;
  installed.add(target);
  for (const method of methods) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      original(safeFormat(args));
    };
  }
  const dir = target.dir.bind(target);
  target.dir = (value, options) => dir(scrubLogValue(value), options);
  const table = target.table.bind(target);
  target.table = (value, properties) => table(scrubLogValue(value), properties);
  const assertion = target.assert.bind(target);
  target.assert = (condition, ...args: unknown[]) => {
    if (condition) return;
    assertion(condition, safeFormat(args));
  };
}
