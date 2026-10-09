import "server-only";

import pino, { type Level, type Logger } from "pino";
import { scrubText, scrubUrl } from "./privacy";

const fields = new Set([
  "requestId",
  "route",
  "method",
  "audience",
  "status",
  "durationMs",
  "operation",
  "errorCode",
  "eventId",
  "digest",
]);
const levels = new Set([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
]);

export function getLogLevel(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return env.LOG_LEVEL && levels.has(env.LOG_LEVEL)
    ? env.LOG_LEVEL
    : env.VERCEL
      ? "info"
      : "debug";
}

function safeFields(input: Record<string, unknown> = {}) {
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(input);
  } catch {
    return {};
  }
  return Object.fromEntries(
    Object.entries(descriptors)
      .filter(
        ([key, descriptor]) =>
          fields.has(key) &&
          ["string", "number", "boolean"].includes(typeof descriptor.value),
      )
      .map(([key, descriptor]) => [key, descriptor.value] as const)
      .map(([key, value]) => [
        key,
        typeof value === "string"
          ? key === "route"
            ? scrubUrl(value)
            : scrubText(value)
          : value,
      ]),
  );
}

export function createLogger(level = getLogLevel(), output = console) {
  const instance = pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: [
        "password",
        "idToken",
        "oobCode",
        "cookie",
        "authorization",
        "DATABASE_URL",
      ],
      formatters: { bindings: safeFields, log: safeFields },
      hooks: {
        logMethod(args, method) {
          // Static messages are preferred; redact common secret formats defensively.
          const safeArgs = args.map((arg) =>
            typeof arg === "string"
              ? scrubText(arg)
              : arg && typeof arg === "object"
                ? safeFields(arg as Record<string, unknown>)
                : arg,
          );
          method.apply(this, safeArgs as Parameters<typeof method>);
        },
      },
    },
    {
      write(line) {
        const record = JSON.parse(line) as {
          level: number;
          time: string;
          msg?: string;
        };
        // Pino interpolates after logMethod. Redact the resulting message too.
        if (typeof record.msg === "string") record.msg = scrubText(record.msg);
        const severity = record.level;
        const method: "log" | "warn" | "error" =
          severity >= 50 ? "error" : severity >= 40 ? "warn" : "log";
        output[method](
          JSON.stringify({
            ...safeFields(record),
            level: severity,
            time: record.time,
            msg: record.msg,
          }),
        );
      },
    },
  );
  return wrapLogger(instance);
}

export type StructuredLogger = Pick<
  Logger,
  "trace" | "debug" | "info" | "warn" | "error" | "fatal"
> & {
  child: (bindings: Record<string, unknown>) => StructuredLogger;
};
function wrapLogger(instance: Logger): StructuredLogger {
  return {
    trace: instance.trace.bind(instance),
    debug: instance.debug.bind(instance),
    info: instance.info.bind(instance),
    warn: instance.warn.bind(instance),
    error: instance.error.bind(instance),
    fatal: instance.fatal.bind(instance),
    // Pino resets binding formatters on children, so filter before child creation.
    child: (bindings) => wrapLogger(instance.child(safeFields(bindings))),
  };
}

export const logger = createLogger();
export type LogLevel = Level;
