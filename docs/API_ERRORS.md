# API errors and request handling

Every `src/app/api/**/route.ts` exports all seven HTTP methods through `apiRoute` from `@/lib/api/handler`. The factory applies PostgreSQL rate limiting, error normalization, request IDs, Sentry acknowledgement, and completion logging to supported methods, OPTIONS, and method-not-allowed responses. Catch-all routes cover unknown API paths. `pnpm api:check` enforces the export pattern in CI.

```ts
import { apiRoute } from "@/lib/api/handler";
import { errors } from "@/lib/api/application-error";

export const { GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS } = apiRoute(
  { route: "/api/example" },
  {
    POST: async () => {
      throw errors.invalid("Choose a valid value.");
    },
  },
);
```

Dynamic handlers can type their second argument as `{ params: Promise<{ id: string }> }`. Metadata should contain a constant route template, rather than a URL with user input or query parameters.

`ApplicationError` supplies a stable code, status, safe public message, and optional internal cause. Use the `errors` helpers for validation, authentication, authorization, missing resources, conflicts, throttling, and dependency failures. Ordinary errors return `{ error, code, requestId }` with `x-request-id`. Unknown exceptions return a generic 500; private server error details are never serialized. Auth clients retain the existing string `error` field.

HTTP 429 is an explicit exception: the body is exactly `{"error":"Too many requests"}`. It contains no code, request ID, Sentry ID, retry estimate, or quota headers. Correlation remains internal. See [Rate limiting](RATE_LIMITING.md).

The existing request logger owns one completion-log attempt in `finally`: info for success, warn for 4xx, and error for 5xx. Unexpected errors are captured once with Sentry when configured; the response acknowledges server capture with `x-sentry-event-id`, allowing clients to avoid duplicate reporting. A queued event is not a guarantee of remote delivery. Logging/reporting failures do not replace the application response. Normal Next.js redirect/not-found control flow is rethrown.

Use API guards in APIs, page guards in webpages, and permission checks at protected data-access boundaries. Do not call redirecting page guards from API handlers. Mutation handlers should use `requireSameOrigin` or `readJson`; the latter also validates JSON content type, a 12,000-byte streamed body limit, and an object-shaped payload.

The API adapter deliberately replaces a global Next.js Proxy: this installed version buffers unfinished request bodies before completing Node Proxy execution. A global Proxy caused the existing streamed-body rejection tests to hang. Factory enforcement plus explicit fallback/method handling preserves immediate oversized-stream rejection while covering API paths.

For a dependency error that is deliberately recovered, `reportRequestFailure(error, { operation, audience })` writes a separate operational error record and reports it with the current request ID. The enclosing request still has exactly one completion record reflecting the response actually returned. The logout limiter-store exception uses this helper; other limiter failures continue to return generic 503 responses.

Password updates whose result cannot be confirmed return HTTP 503 with `code: "PASSWORD_CHANGE_UNCONFIRMED"`. The API preserves the generic 5xx message, correlation, and server-capture acknowledgement. Password-change clients use that code to offer session clearing and fresh sign-in rather than retrying the mutation. Confirmed update success remains HTTP 200 even if a later revocation/cookie-cleanup step fails; those recovered failures use `reportRequestFailure` and the sign-in action retries local cookie cleanup.
