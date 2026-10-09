# Authentication Implementation Summary

## Account populations

The app has two independent Firebase Authentication projects and two PostgreSQL tables:

- Regular users authenticate against the user Firebase project and map to `users`.
- Staff authenticate against the staff Firebase project and map to `staff_users`.

The projects use distinct browser configuration, Admin credentials, server session cookies, session endpoints, and reset-email handlers. Firebase UID uniqueness is scoped to its table. The shared `DATABASE_URL` points both tables at the same PostgreSQL database.

There is no public staff signup page. Staff accounts must be provisioned in the staff Firebase project by an administrator and allow-listed with a matching `staff_users.firebase_uid` record before first sign-in. The staff session endpoint does not create staff records: Firebase accounts whose UID is not already in `staff_users` are rejected, even if someone creates them outside the app.

## Sign-in and session flows

The shared form in [`src/app/(auth)/auth-form.tsx`](<../src/app/(auth)/auth-form.tsx>) uses the user Firebase project for `/login` and `/signup`; `/staff/login` uses the staff project and permits sign-in only. Both flows use email/password and in-memory Firebase Auth persistence.

After Firebase sign-in, the browser sends the ID token to the audience-specific session endpoint:

- Regular users: `POST /api/auth/session`
- Staff: `POST /api/auth/staff/session`

[`src/lib/auth/session-handlers.ts`](../src/lib/auth/session-handlers.ts) checks request origin, content type, request size, token validity, the Email/Password provider claim, and that authentication happened within five minutes. It verifies each token with the matching Firebase Admin project. Regular-user identity is upserted into `users`; staff identity must already exist in `staff_users` and its profile is refreshed. It then creates a five-day Firebase session cookie. The regular-user cookie keeps its existing name, `firebase_session`; the staff cookie is `firebase_staff_session`.

The browser signs out of the Firebase client SDK after the server cookie is created. The cookies are `httpOnly`, `SameSite=Lax`, scoped to `/`, and marked `Secure` in production. Separate logout endpoints clear the corresponding cookie.

If Firebase creates a regular-user account but session creation fails, the signup form keeps that email fixed and switches to **Retry sign-in**. Retrying signs in the existing account with the entered password before exchanging a fresh ID token, satisfying the server's recent-authentication requirement. The account is not created again. Recovery state lasts while the form is open; after a reload, users can sign in at `/login` with the account they already created.

Session requests are limited to 12,000 raw bytes. [`src/lib/auth/read-request-body.ts`](../src/lib/auth/read-request-body.ts) rejects oversized `Content-Length` values before reading, counts every streamed chunk before buffering it, and cancels oversized streams without waiting for the sender to finish. Both session endpoints return `413` for oversized bodies and `400` for unreadable or invalid JSON bodies. Missing or inaccurate length headers do not bypass the streamed limit.

Session and logout endpoints require an `Origin` header that matches the request protocol and HTTP `Host` header, including its port. This preserves the browser's actual hostname when Next.js normalizes loopback IPs, so both `localhost` and `127.0.0.1` work without treating them as interchangeable origins. Missing, opaque (`null`), and foreign origins are rejected. Reverse proxies must preserve the public `Host` header and supply the correct request protocol to Next.js.

## Password reset

Regular users request a reset email at `/reset-password`; staff use `/staff/reset-password`. The client sends the email through the corresponding Firebase project. Both pages return the same confirmation for existing and unknown addresses.

Reset links are handled at `/reset-password/confirm` for regular users and `/staff/reset-password/confirm` for staff. Each route validates Firebase's `mode=resetPassword` and `oobCode` parameters, then the shared client form calls `verifyPasswordResetCode()` and `confirmPasswordReset()` against the matching Firebase project. Resetting a password does not create an app session.

In each Firebase project's **Authentication → Templates**, set the Password reset action URL to the matching deployed route and authorize the hostname. See Firebase's [custom email action handler guide](https://firebase.google.com/docs/auth/custom-email-handler) for the action-link parameters and handler flow.

## Route protection

`/account` requires a regular-user session through [`src/lib/auth/require-user.ts`](../src/lib/auth/require-user.ts). Both [`src/app/private/layout.tsx`](../src/app/private/layout.tsx) and [`src/app/private/page.tsx`](../src/app/private/page.tsx) call [`requireStaffUser()`](../src/lib/auth/require-staff-user.ts) and redirect unauthenticated visitors to `/staff/login`. Staff routes read only the staff session and staff table; a regular-user cookie cannot authorize staff access.

App Router layouts can be reused or skipped during partial RSC requests and do not protect API route handlers or server actions. Every staff page must check `requireStaffUser()` before rendering protected content, and staff-only data access, API handlers, and server actions must check it at the access boundary. The current staff landing page performs its own check even when the shared layout does not render.

Session reads in [`src/lib/auth/session.ts`](../src/lib/auth/session.ts) verify Firebase session cookies with revocation checks and look up the UID in the corresponding table. The app does not use a Next.js Proxy for auth checks.

## Error reporting and request logs

Session/logout endpoints log one completion record and add a generated `x-request-id` to returned responses. Existing validation, status codes, cookies, and redirects are preserved. Unexpected failures caught during sign-in, logout, password reset, and server verification are reported to Sentry when configured. Expected errors are classified by operation: browser credential/validation failures, reset-link errors, and server malformed/expired/revoked tokens are suppressed; Firebase Admin credential/configuration failures are reported. Returned 5xx failures are captured by the wrapper and include `x-sentry-event-id` when server reporting is enabled. Auth clients report HTTP 5xx responses unless that header acknowledges server capture, covering gateway failures that never reach the app. Server-render errors carrying a digest are not reported again by browser error boundaries. See [Observability](OBSERVABILITY.md) for correlation and delivery limits.

Passwords, credentials, cookies, and Firebase tokens/reset codes are redacted from structured logs, Node console output, and Sentry events. Contact details are permitted in log messages; Sentry still removes user/contact fields and request bodies. The console guard copies errors for output without changing the original auth exceptions. See [`OBSERVABILITY.md`](OBSERVABILITY.md) for configuration, privacy boundaries, request correlation, and automated/live validation.

## Database

[`src/db/schema.ts`](../src/db/schema.ts) defines `users` and `staff_users`. Both records have an internal UUID, a unique Firebase UID within that table, email, display name, email-verification state, and timestamps. [`src/db/users.ts`](../src/db/users.ts) syncs regular-user claims; [`src/db/staff-users.ts`](../src/db/staff-users.ts) syncs staff claims. Application tables should reference the appropriate internal UUID.

The baseline migration [`drizzle/0000_initial_auth_schema.sql`](../drizzle/0000_initial_auth_schema.sql) creates both `users` and `staff_users`. Apply it with:

```bash
pnpm db:migrate
```

## Configuration

See [`.env.example`](../.env.example) for all required variable names.

- Public web config: `NEXT_PUBLIC_FIREBASE_USER_*` and `NEXT_PUBLIC_FIREBASE_STAFF_*`.
- Server-only Admin credentials: `FIREBASE_USER_PROJECT_ID`, `FIREBASE_USER_CLIENT_EMAIL`, `FIREBASE_USER_PRIVATE_KEY`, and the matching `FIREBASE_STAFF_*` variables.
- Both Firebase projects should enable Email/Password and disable other providers. Each needs the app hostnames authorized and its reset email action URL configured for the corresponding route.
- Vercel needs both public configs at build time and both Admin credential sets at runtime.
- To provision a staff member, create the email/password account in the staff Firebase project, then insert that account's UID and email into `staff_users` before its first login.

After applying migrations, an administrator can add the allow-list row with:

```sql
INSERT INTO staff_users (firebase_uid, email)
VALUES ('<staff-firebase-uid>', '<staff-email>');
```

The repository contains placeholders only; it does not include either Firebase project's IDs, credentials, or deployment settings.

## Current gaps

- Email verification is recorded but not required for sign-in or access.
- Staff provisioning, account deletion, and profile management are manual or not implemented in the app.
- There is no Firebase Auth Emulator configuration or automated coverage of successful Firebase sign-in, staff provisioning, or password reset against Firebase.
- Future staff pages and API handlers must perform their own `requireStaffUser()` checks before accessing protected data.

## Implementation checks

Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm db:check`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` when validating changes. Unit tests cover signup recovery with mocked Firebase/session services and body-reading limits, including UTF-8 chunk boundaries and streams that never finish. The Playwright suite covers the home page, signed-out account/staff redirects, full and partial RSC authorization, rejection of regular-user cookies on staff pages, same-origin session validation and logout on both loopback hostnames, rejection of missing or foreign origins, and oversized declared/chunked requests. These tests do not require Firebase credentials or a database connection.
