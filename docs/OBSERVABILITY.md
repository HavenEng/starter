# Observability

The starter uses `@sentry/nextjs` for unexpected browser and server errors and Pino for structured server logs. Production and preview deployments report to one Sentry project, distinguished by environment and commit SHA. Application logs stay in Vercel Runtime Logs. Tracing, profiling, Session Replay, Sentry Logs, and automatic session tracking are disabled.

No observability configuration is required to develop, test, or build the app. Normal local development and CI do not send Sentry events, even if a DSN is present. Pino writes to the local console.

## Vercel and Sentry setup

1. Create a Next.js project in your Sentry organization. Use the same project for browser and server errors.
2. Set `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` to that project's DSN in the Vercel **Production** and **Preview** environments. The browser DSN is public; it is not a source-map upload credential. Its value must be set before the build.
3. Create a Sentry organization auth token with source-map/release upload permissions. Set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` in Vercel. The token is a secret: never prefix it with `NEXT_PUBLIC_`, commit it, or include it in client code.
4. Keep Vercel's system environment variables available. `VERCEL_ENV` determines the Sentry environment, and `VERCEL_GIT_COMMIT_SHA` determines the release. The Next.js config injects only these public metadata values into the browser bundle. A server-only `SENTRY_RELEASE` can supply a release when a commit SHA is unavailable.
5. Deploy a preview and perform the verification below before rolling out to production.

The Sentry build wrapper uploads maps only on Vercel when all three upload settings are present. It deletes the SDK-generated source maps after upload. Outside configured Vercel builds, map generation/upload and release creation are disabled, and an explicit empty upload token prevents the SDK from falling back to shell credentials. Ordinary local/CI builds therefore stay offline even if upload credentials are present. A throwing `errorHandler` makes upload failures in configured builds fail the build; the SDK's default handling would log those failures and continue. Do not enable Next.js `productionBrowserSourceMaps` separately: Next.js serves those maps publicly.

Browser initialization uses `src/instrumentation-client.ts`. Server registration loads the Node or Edge SDK configuration from `src/instrumentation.ts`; Node services such as Pino, PostgreSQL, and Firebase Admin stay out of the Edge configuration. The current auth endpoints run on Node. `onRequestError` captures server failures and waits up to two seconds for delivery. App/global error boundaries report client render failures and use Next.js 16.3's `retry()` for recovery. Errors carrying a server digest are not reported again by the browser boundary.

Client events go directly to Sentry. Browser extensions or network filtering can block delivery; there is no app-hosted Sentry tunnel in this initial integration.

## Logging and correlation

Import `logger` from `@/lib/observability/logger` in server code:

```ts
import { logger } from "@/lib/observability/logger";

const log = logger.child({ operation: "inventory.refresh" });
log.info({ durationMs: 42 }, "Inventory refreshed");
```

Use static messages and safe operational fields. Allowed fields are `requestId`, `route`, `method`, `audience`, `status`, `durationMs`, `operation`, `errorCode`, `eventId`, and `digest`; other object fields are dropped, including on nested child loggers. Child bindings are filtered before creating the Pino child, and the output is filtered again. Nested objects and raw errors are not written by Pino. Credential formats in messages are redacted after interpolation as well as before it. Contact details such as email addresses are permitted in log messages; do not put passwords, tokens, reset codes, or other credentials in messages.

Node instrumentation installs a console guard before initializing Sentry. It protects `console.log`, `info`, `debug`, `warn`, `error`, `trace`, `dir`, `table`, and `assert`, including raw Next.js error output. Objects are copied with credential fields redacted; error messages, stacks, causes, and the final formatted text are scrubbed. Object field getters and custom inspection hooks are omitted. The original errors stay intact for authentication, redirects, retry, and Sentry capture. This protection is active even when reporting is disabled. Pino output remains valid JSON and uses the same console severity methods.

Pino sends information/debug output through `console.log`, warnings through `console.warn`, and errors/fatal output through `console.error`. Vercel's severity filter uses the console method, rather than Pino's numeric JSON `level`. Logging uses no file storage, worker transport, or external log delivery. The default level is `info` on Vercel and `debug` locally. `LOG_LEVEL` accepts `trace`, `debug`, `info`, `warn`, `error`, `fatal`, and `silent`; invalid values use the default.

Both populations' session and logout endpoints emit one completion record with route, method, audience, status, duration, and a generated UUID. Returned responses expose this ID in `x-request-id`; caller-provided IDs are ignored. Successful responses log at `info`, rejected requests at `warn`, and failed requests at `error`. Unexpected thrown failures are rethrown to Next.js, and their generated ID is also attached to the Sentry event. Framework-generated 500 responses may not include the response header; find their ID in the log/Sentry event instead. Request IDs are isolated across concurrent requests.

If a wrapped handler returns a 5xx response, the wrapper captures a generic failure with operation `http.response`, status, audience, and request ID, without reading its body. With server reporting enabled, the captured event ID is returned in `x-sentry-event-id`. This marks a queued SDK event, not guaranteed remote delivery. Auth clients suppress their HTTP error copy only when that header contains a valid event ID. Gateway failures, timeouts, and responses without this acknowledgement are reported by the browser. A thrown server failure can also produce a browser HTTP event when Next.js returns an unacknowledged 500; use the request ID where available to correlate these events.

In Vercel, open the project's **Logs**, filter by deployment/route/severity, and search the JSON message for the request ID. In Sentry, search `requestId:<id>` and filter `environment:preview` or `environment:production` and release. Sentry request IDs are diagnostic identifiers, not user or session identities.

## Handled errors and privacy

`reportUnexpectedError(error, { operation, audience, requestId })` reports caught infrastructure, configuration, and network failures. Sign-in, logout, password reset, and server token/session verification call it without changing their existing UI or auth responses. Expected Firebase codes are classified per operation: browser credential/validation rejections, reset-link errors, and server malformed/expired/revoked tokens are suppressed in their respective flows. Firebase Admin `auth/invalid-credential` and `auth/invalid-argument` are reported because they can indicate service-account or configuration failures. New operations report errors by default; add narrowly scoped expected codes when needed. HTTP 4xx auth responses are suppressed. HTTP 5xx responses are reported unless the server explicitly acknowledges capture as described above.

The SDK has `sendDefaultPii: false` and local-variable capture disabled. The Sentry event filter continues to remove user/contact fields, request bodies/headers/cookies, arbitrary extras, local variables, and source context lines. Only known runtime/browser/Next.js contexts are retained. Passwords, credential objects, cookies, authorization headers, API/private keys, Firebase tokens/reset codes, and database connection strings are scrubbed. Encoded JSON is decoded and redacted with a depth limit before re-encoding, including JSON fragments in provider messages and JSON embedded inside quoted error messages. Quoted values containing spaces and escaped quotes are covered. HTTP URLs are normalized before classification, including leading whitespace and backslash variants of protocol-relative URLs, then lose credentials, queries, and fragments. SDK and Windows source filenames remain usable for source maps. Console and DOM breadcrumbs are dropped; navigation/HTTP breadcrumbs retain only sanitized URLs, method, and status.

Application paths currently contain no credentials. Keep credentials out of URL paths and arbitrary unlabelled text. Key and format redaction cannot identify an opaque password printed without a label. Use the structured logger's operational fields instead of logging request bodies or provider payloads. The Node console guard protects app/Next.js console output; direct stream writes, logs emitted before instrumentation starts, Vercel platform request URLs, and Firebase provider telemetry have separate boundaries. The app currently has no Edge routes; future Edge code must apply equivalent console protection before logging.

## Cost and disabling

Unexpected errors use a 100% capture rate after expected-error filtering. Preview and production share the Sentry project's quota. Review the selected Sentry plan's event allowance and spending controls before production; the code does not purchase services or configure paid overages.

Vercel currently retains runtime logs for **one hour on Hobby** and **one day on Pro**. Longer retention requires an add-on or a dedicated log store. See [Vercel's current limits](https://vercel.com/docs/logs/runtime#limits). No Observability Plus, log drain, or separate logging subscription is required here. The console severity behavior is documented in [Vercel's structured logging guide](https://vercel.com/kb/guide/add-structured-application-logs-to-vercel-functions).

To disable Sentry, remove both DSNs from the affected Vercel environment and redeploy (the browser value is built into the bundle). Remove upload settings to disable uploads. Set `LOG_LEVEL=silent` to disable application logs. Vercel can still emit its own platform logs.

## Validation and rollout

Run:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm test:e2e --config playwright.observability.config.ts
```

The regular Playwright suite checks the existing auth behavior, generated request IDs, and that synthetic fixture routes and the root-error cookie cannot trigger failures during ordinary app runs. The observability suite builds and starts the real app in production mode using `.next-observability`, sends SDK envelopes to a localhost collector, and checks browser/server capture, server-render and acknowledged-response deduplication, app/global fallback and retry, gateway failures through the logout UI, Admin configuration failures versus token expiry, request correlation, and credential scrubbing. The collector retains complete stdout/stderr, including unstructured Next.js errors; every production test checks both streams for fixture credentials. Console fixtures also check contact-detail retention, valid Pino JSON, interpolation, and child binding filtering. Unit tests exercise encoded JSON, URL variants, nested errors, circular objects, and the installed SDK's upload failure path with its CLI network boundary replaced by a synthetic failure. It requires ports 3101 and 4319; normal browser tests use 3100. CI runs both suites.

Only the local test runner sets `OBSERVABILITY_E2E=1`. Test fixtures require that flag and the absence of **both** `VERCEL` and `VERCEL_ENV`; neither the fixtures nor the public test reporting override can be enabled on Vercel. The build derives the browser override from that server-side guard. There is no publicly accessible crash test in deployed environments. Do not manually enable this flag on an internet-accessible local server.

Before production rollout, use a temporary verification change in a configured preview to trigger one browser failure and one server failure; remove that change before merging. Verify both appear under `preview` with the commit release, readable source-mapped stacks, no sensitive payloads, and matching request IDs where applicable. Check a successful, rejected, and failed API request in Vercel's severity filters. Review Sentry usage after launch.

Automated tests verify local SDK delivery and production app/root-layout crash recovery. Sentry's remote processing, actual source-map uploads, and Vercel's UI require Sentry/Vercel credentials and a configured preview deployment.
