import type { Breadcrumb, ErrorEvent, EventHint } from "@sentry/nextjs";
import { getErrorRequestId } from "./error-request-id";

const credentialKey =
  /password|passwd|^pwd$|secret|token|cookie|authorization|oobcode|api.?key|private.?key|database.?url|connection.?string|credential/i;
const sensitiveKey =
  /password|passwd|^pwd$|secret|token|cookie|authorization|email|oobcode|api.?key|private.?key|database.?url|connection.?string|credential|customdata|headers|^body$|^data$/i;
const emailPattern = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi;
const maxDepth = 8;

export function scrubText(value: string): string {
  return scrubEncodedText(value, 0);
}

function scrubEncodedText(value: string, depth: number): string {
  if (depth > maxDepth) return "[Redacted]";
  // Decode complete JSON, including strings containing another JSON document.
  // Re-encode it after redaction so structured console output stays valid JSON.
  if (/^\s*[{["]/.test(value)) {
    try {
      return JSON.stringify(scrubLogValue(JSON.parse(value), depth + 1));
    } catch {
      // Provider messages often contain a JSON fragment or truncated JSON.
    }
  }
  return (
    scrubJsonFragments(value, depth)
      .replace(/"(?:\\[\s\S]|[^"\\])*"/g, (quoted) => {
        try {
          return JSON.stringify(
            scrubEncodedText(JSON.parse(quoted), depth + 1),
          );
        } catch {
          return quoted;
        }
      })
      .replace(/postgres(?:ql)?:\/\/[^\s)"']+/gi, "[Redacted database URL]")
      .replace(
        /-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g,
        "[Redacted private key]",
      )
      .replace(/(?<![\w:])(?:https?:[\\/]+|[\\/]{2})[^\s"'<>)}\]]+/gi, (url) =>
        scrubUrl(url),
      )
      // Unquoted HTTP credential headers can contain spaces and multiple cookies.
      .replace(
        /\b(authorization|cookie|set-cookie)\s*[=:]\s*(?!["'])\S[^\r\n]*/gi,
        "$1=[Redacted]",
      )
      .replace(
        /\b([\w.-]*(?:password|passwd|secret|token|cookie|authorization|oobcode|api[ _-]?key|private[ _-]?key|database[ _-]?url|connection[ _-]?string|credential)[\w.-]*|pwd)["']?\s*[=:]\s*(?:"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|\[Redacted[^\]]*\]|[^\s,;"'}\]]+)/gi,
        "$1=[Redacted]",
      )
      .replace(
        /\b(Bearer|Basic)\s+(?:"(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|\[Redacted\]|[^\s"'<>]+)/gi,
        "$1 [Redacted]",
      )
      .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[Redacted token]")
  );
}

function scrubJsonFragments(value: string, depth: number): string {
  const fragments: string[] = [];
  const closing: string[] = [];
  let start = -1;
  let copied = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (start >= 0 && quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === "{" || character === "[") {
      if (start < 0) start = index;
      closing.push(character === "{" ? "}" : "]");
    } else if (start >= 0 && character === '"') quoted = true;
    else if (start >= 0 && (character === "}" || character === "]")) {
      if (closing.pop() !== character) closing.length = 0;
      if (closing.length) continue;
      try {
        const parsed = JSON.parse(value.slice(start, index + 1));
        fragments.push(
          value.slice(copied, start),
          JSON.stringify(scrubLogValue(parsed, depth + 1)),
        );
        copied = index + 1;
      } catch {
        // Non-JSON diagnostics still pass through the credential text filters.
      }
      start = -1;
    }
  }
  fragments.push(value.slice(copied));
  return fragments.join("");
}

// Used before console formatting to remove entire credential-valued objects,
// accessors and custom inspection hooks, without mutating application values.
export function scrubLogValue(
  value: unknown,
  depth = 0,
  ancestors = new WeakSet<object>(),
): unknown {
  if (depth > maxDepth) return "[Redacted]";
  if (typeof value === "string") return scrubEncodedText(value, depth);
  if (typeof value === "function") return "[Function omitted]";
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value))
      return Array.from({ length: descriptors.length.value }, (_, index) => {
        const item = descriptors[index];
        return !item
          ? undefined
          : "value" in item
            ? scrubLogValue(item.value, depth + 1, ancestors)
            : "[Accessor omitted]";
      });
    const entries = Object.entries(descriptors)
      .filter(([, descriptor]) => descriptor.enumerable)
      .map(([key, descriptor]) => [
        key,
        credentialKey.test(key)
          ? "[Redacted]"
          : "value" in descriptor
            ? scrubLogValue(descriptor.value, depth + 1, ancestors)
            : "[Accessor omitted]",
      ]);
    if (value instanceof Error) {
      const safeError = new Error(scrubEncodedText(value.message, depth + 1));
      safeError.name = scrubEncodedText(value.name, depth + 1);
      if (value.stack)
        safeError.stack = scrubEncodedText(value.stack, depth + 1);
      if ("cause" in descriptors)
        entries.push([
          "cause",
          scrubLogValue(descriptors.cause.value, depth + 1, ancestors),
        ]);
      Object.defineProperties(
        safeError,
        Object.fromEntries(
          entries.map(([key, item]) => [
            key,
            {
              value: item,
              enumerable: true,
              configurable: true,
              writable: true,
            },
          ]),
        ),
      );
      return safeError;
    }
    return Object.fromEntries(entries);
  } catch {
    return "[Unserializable object omitted]";
  } finally {
    ancestors.delete(value);
  }
}

export function scrubUrl(value: string): string {
  // WHATWG URLs trim whitespace, ignore tabs/newlines, and accept backslashes.
  // Classify that normalized form while preserving SDK/Windows source filenames.
  const normalized = value
    .trim()
    .replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "")
    .replace(/[\t\r\n]/g, "")
    .replace(/\\/g, "/");
  if (/^[a-z]:\//i.test(normalized)) return value.split(/[?#]/, 1)[0];
  if (/^(?:app|webpack|webpack-internal|file):/i.test(normalized))
    return normalized
      .split(/[?#]/, 1)[0]
      .replace(/^((?:app|webpack|webpack-internal|file):\/\/)[^/]*@/i, "$1");
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(normalized);
  const protocolRelative = normalized.startsWith("//");
  if (!absolute && !protocolRelative) return value.split(/[?#]/, 1)[0];
  try {
    const url = new URL(normalized, "https://observability.invalid");
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return "[Redacted URL]";
    // Paths in this starter contain no user identifiers. Drop every query and fragment,
    // including Firebase reset codes, rather than maintaining a parameter blocklist.
    return protocolRelative
      ? `//${url.host}${url.pathname}`
      : `${url.origin}${url.pathname}`;
  } catch {
    return "[Redacted URL]";
  }
}

function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[Redacted]";
  if (typeof value === "string")
    return scrubText(value).replace(emailPattern, "[Redacted email]");
  if (Array.isArray(value))
    return value.map((item) => scrubValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !sensitiveKey.test(key) && key !== "vars")
        .map(([key, item]) => [
          key,
          typeof item === "string" && /url|path|^from$|^to$/i.test(key)
            ? scrubUrl(item)
            : scrubValue(item, depth + 1),
        ]),
    );
  }
  return value;
}

export function sanitizeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  // Console and DOM breadcrumbs can contain arbitrary form values or application data.
  if (
    !["http", "fetch", "xhr", "navigation"].includes(breadcrumb.category ?? "")
  )
    return null;
  const data = breadcrumb.data ?? {};
  return {
    category: breadcrumb.category,
    type: breadcrumb.type,
    level: breadcrumb.level,
    timestamp: breadcrumb.timestamp,
    data: Object.fromEntries(
      ["url", "from", "to", "method", "status_code"]
        .filter((key) => key in data)
        .map((key) => [
          key,
          ["url", "from", "to"].includes(key)
            ? scrubUrl(String(data[key]))
            : scrubValue(data[key]),
        ]),
    ),
  };
}

export function sanitizeEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent {
  const cleaned = scrubValue(event) as ErrorEvent;
  const requestId = getErrorRequestId(hint?.originalException);
  if (requestId) cleaned.tags = { ...cleaned.tags, requestId };
  delete cleaned.user;
  delete cleaned.extra;
  delete cleaned.server_name;
  delete cleaned.logentry;
  if (cleaned.contexts)
    cleaned.contexts = Object.fromEntries(
      Object.entries(cleaned.contexts).filter(([key]) =>
        ["app", "browser", "device", "os", "runtime", "nextjs"].includes(key),
      ),
    );
  if (event.request) {
    cleaned.request = {
      method: event.request.method,
      url: event.request.url ? scrubUrl(event.request.url) : undefined,
    };
  }
  cleaned.breadcrumbs = event.breadcrumbs?.flatMap((item) => {
    const breadcrumb = sanitizeBreadcrumb(item);
    return breadcrumb ? [breadcrumb] : [];
  });
  for (const exception of cleaned.exception?.values ?? []) {
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars;
      delete frame.pre_context;
      delete frame.post_context;
      delete frame.context_line;
      if (frame.filename) frame.filename = scrubUrl(frame.filename);
      if (frame.abs_path) frame.abs_path = scrubUrl(frame.abs_path);
    }
  }
  return cleaned;
}
