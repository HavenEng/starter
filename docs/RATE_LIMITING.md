# API rate limiting

`apiRoute` applies PostgreSQL-backed fixed-window limits to every exported API method. The root/catch-all API routes cover unknown paths; explicit method exports cover 405 and OPTIONS responses. CI runs `pnpm api:check` so future routes cannot accidentally omit the factory. There is no global Next.js Proxy; see [API errors](API_ERRORS.md) for the streamed-request constraint.

The store uses database time and one atomic upsert/check. Counters are shared across processes and survive restarts. Counts saturate once denied, avoiding integer growth during sustained abuse. Fixed windows can permit a burst across adjacent window boundaries.

Policies are defined in `src/lib/rate-limit/policies.ts`. Add a method/path override there with a stable policy ID; requests falling outside overrides use the default. Related user/staff endpoints share a policy bucket. Dynamic targets, query strings, unknown methods, and unknown paths do not create new buckets. The default is one shared group for otherwise unmatched API requests, not an extra quota on top of overrides.

| Group                  | Requests | Window     |
| ---------------------- | -------- | ---------- |
| Default                | 120      | 1 minute   |
| Session exchange       | 20       | 1 minute   |
| Password-reset request | 5        | 15 minutes |
| Password change        | 5        | 15 minutes |
| Staff administration   | 30       | 1 minute   |
| Logout                 | 60       | 1 minute   |

Buckets use a keyed SHA-256 digest of the client identifier. Set a private `RATE_LIMIT_KEY_SECRET` of at least 32 characters in hosted environments. Local development can use the local-only example value. Rotating the secret starts new buckets; do not rotate it per request or app instance.

On Vercel, identity comes from the platform's `x-vercel-forwarded-for` header; see [Vercel's request-header documentation](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for). Other hosts can set `RATE_LIMIT_TRUSTED_IP_HEADER` only when their ingress overwrites that header and direct origin access is blocked. Arbitrary `X-Forwarded-For`, cookies, and request IDs are ignored. Without a trusted IP, requests share the `unattributed` bucket. This conservative fallback requires configuring trusted ingress before serving multiple users on another host.

Rate-limit responses contain only HTTP 429 and `{"error":"Too many requests"}`. There is no `Retry-After`, quota/reset header, error code, request ID, or Sentry event ID. Allowed responses also omit rate-limit headers. Forms show the generic message without a countdown or automatic retry. Internal completion logs retain request correlation and status.

Store queries have bounded connection/query waits. Store failures return a generic 503 and are logged/reported. Logout may still clear its cookie during store failure; the recovered store failure receives its own operational error log and Sentry report, alongside one successful request completion log. Logout remains limited when the store is healthy. There is no process-local enforcement fallback.

Run `pnpm db:rate-limit:prune` periodically using the deployment's scheduler to remove up to 10,000 expired buckets per invocation. It requires an explicit `DATABASE_URL`, uses bounded database waits, locks candidates with `FOR UPDATE SKIP LOCKED`, and checks expiration again during deletion. Busy buckets are skipped so cleanup cannot delete a counter renewed by a concurrent request. Repeat for large backlogs. Expiration is enforced on access even before cleanup.

App limits cover app endpoints. Direct Firebase signup, reset-code confirmation, and other public provider calls still need provider-side abuse/quota configuration.

The browser/auth/observability runners supply guarded local test policies and private test database URLs. These overrides reject hosted environments and require explicit local test-runner configuration. Never deploy test flags. Run `pnpm test:e2e --config playwright.rate-limit.config.ts` for low-limit tests of generic responses, overrides, spoof resistance, recovery, and store outage/logout behavior. Unit/database tests cover policy selection and counter concurrency across independent connections.
