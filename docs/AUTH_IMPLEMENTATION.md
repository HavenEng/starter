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

[`src/lib/auth/session-handlers.ts`](../src/lib/auth/session-handlers.ts) checks request origin, content type, request size, token validity and revocation, the Email/Password provider claim, and that authentication happened within five minutes. It verifies each token with the matching Firebase Admin project using revocation checks before synchronizing database profiles, rejecting disabled or revoked identities. The recent-authentication policy rejects missing, non-integer, stale, or future timestamps. Regular-user identity is upserted into `users`; staff identity must already exist in `staff_users` and its profile is refreshed. It then creates a five-day Firebase session cookie. The regular-user cookie keeps its existing name, `firebase_session`; the staff cookie is `firebase_staff_session`.

The browser signs out of the Firebase client SDK after the server cookie is created. The cookies are `httpOnly`, `SameSite=Lax`, scoped to `/`, and marked `Secure` in production. Separate logout endpoints clear the corresponding cookie.

If Firebase creates a regular-user account but session creation fails, the signup form keeps that email fixed and switches to **Retry sign-in**. Retrying signs in the existing account with the entered password before exchanging a fresh ID token, satisfying the server's recent-authentication requirement. The account is not created again. Recovery state lasts while the form is open; after a reload, users can sign in at `/login` with the account they already created.

Session requests are limited to 12,000 raw bytes. [`src/lib/auth/read-request-body.ts`](../src/lib/auth/read-request-body.ts) rejects oversized `Content-Length` values before reading, counts every streamed chunk before buffering it, and cancels oversized streams without waiting for the sender to finish. Both session endpoints return `413` for oversized bodies and `400` for unreadable or invalid JSON bodies. Missing or inaccurate length headers do not bypass the streamed limit.

Session and logout endpoints require an `Origin` header that matches the request protocol and HTTP `Host` header, including its port. This preserves the browser's actual hostname when Next.js normalizes loopback IPs, so both `localhost` and `127.0.0.1` work without treating them as interchangeable origins. Missing, opaque (`null`), and foreign origins are rejected. Reverse proxies must preserve the public `Host` header and supply the correct request protocol to Next.js.

## Password reset

Regular users request a reset email at `/reset-password`; staff use `/staff/reset-password`. The client posts to the audience-specific `/api/auth/password-reset` or `/api/auth/staff/password-reset` route. The server uses the corresponding Firebase project to send the email, with application rate limiting and common error handling. Both pages return the same confirmation for existing and unknown addresses.

Reset links are handled at `/reset-password/confirm` for regular users and `/staff/reset-password/confirm` for staff. Each route validates Firebase's `mode=resetPassword` and `oobCode` parameters, then the shared client form calls `verifyPasswordResetCode()` and `confirmPasswordReset()` against the matching Firebase project. Resetting a password does not create an app session.

Reset confirmation keeps explicit password-policy rejections editable and shows only “Too many requests” for throttling. Invalid or expired codes remove the password form and offer a new reset link. Confirmed success clears the form and offers **Sign in again**, using the same audience-specific session cleanup as signed-in password changes before navigating to login.

An interrupted response, an unclassified provider failure, or a 30-second UI timeout removes/resets the form and shows “We couldn’t confirm the password update. Please sign in to continue.” The user can choose **Sign in again** or **Request a new reset link**. The app never automatically replays the reset. The Firebase SDK mutation cannot be cancelled by the UI timeout; a late success or failure cannot replace recovery or start another request. Code validity is not proof that a particular password update completed, so recovery does not infer success from a consumed code. Session cleanup clears only the matching audience's cookie and is independently retryable if it fails.

In each Firebase project's **Authentication → Templates**, set the Password reset action URL to the matching deployed route and authorize the hostname. See Firebase's [custom email action handler guide](https://firebase.google.com/docs/auth/custom-email-handler) for the action-link parameters and handler flow.

## Signed-in password change and account disabling

Regular users change passwords at `/account/change-password`; enabled staff, including zero-role staff, use `/private/account/change-password`. Their authenticated POST endpoints verify same origin, bounded JSON, current password, audience, and UID, then use Firebase's password update flow. Existing sessions are revoked and the caller cookie is cleared; the page confirms success and offers **Sign in again**. A failed revocation or cookie-cleanup follow-up is reported without describing the already confirmed credential update as a failed password change. The sign-in action repeats cookie cleanup before navigating to login.

Application password inputs accept at most 64 characters, including login and current-password inputs. New passwords require 8–64 characters in signup, reset confirmation, and signed-in change forms. Shared constants live in `src/lib/auth/password-policy.ts`; the change-password APIs also enforce these limits before contacting Firebase. Existing credentials longer than 64 characters must use forgot-password recovery through the app. Signup and reset confirmation still call Firebase directly, so configure each Firebase project's [password policy](https://firebase.google.com/docs/auth/web/password-auth#recommended_set_a_password_policy) to the same 8–64 range to enforce new-password limits outside the application forms as well.

Firebase revocation uses whole-second timestamps. Sessions authenticated in the same second as revocation can remain valid; this provider limitation is accepted for this starter. The existing revocation tests cross that boundary rather than claiming coverage of exact same-second invalidation.

An interrupted password-update response can leave the outcome unconfirmed even if Firebase committed the change. Transport failures, unreadable or mismatched-UID success responses, and upstream 5xx errors during the update return HTTP 503 with application code `PASSWORD_CHANGE_UNCONFIRMED`. A confirmed success must identify the verified session's Firebase UID. Provider details stay internal and the API keeps its generic 5xx message. Validation/credential rejections and recognized pre-update operational outages remain ordinary retryable form errors; throttling retains the minimal 429 contract. Authentication expiry instead requires fresh sign-in.

The form interprets the unconfirmed code, lost browser responses, invalid success payloads, and unclassified gateway failures as sign-in recovery. It removes/resets the password form and shows “We couldn’t confirm the password update. Please sign in again to continue.” There is no automatic password-change retry. Expired sessions also offer sign-in recovery. **Sign in again** first calls the matching logout endpoint, verifies its success response, and then performs a full navigation to `/login` or `/staff/login`. Only that audience's cookie is cleared. Failed/timed-out cookie cleanup keeps the recovery screen and permits another sign-in action without resubmitting the password update. **Forgot password?** links to the matching reset page. Password-change requests have a 30-second browser timeout and recovery logout has a 10-second timeout.

The starter does not persist password-change operation results or add a status endpoint. A confirmed provider response establishes success; an unconfirmed update uses fresh authentication and the existing reset flow for recovery. Passwords and provider tokens are never placed in recovery links or persisted for retries.

Admins disable regular users through `POST /api/staff/users/[userId]/disable` and staff through `POST /api/staff/members/[staffUserId]/disable`. The routes require the appropriate scope and reject self-disable or removal of the last active admin. Local `disabled_at` is committed first; Firebase disabling and token revocation follow outside the database lock. A provider failure retains local access denial and returns a retryable 503. Repeat the same request to finish reconciliation; the endpoint does not skip provider work for already-disabled rows. Data and role assignments are preserved. There are no re-enable endpoints.

The first admin is assigned through the trusted bootstrap CLI; role assignments and scope checks are described in [Authorization](AUTHORIZATION.md). All API methods, including fallback and unsupported methods, use the shared [API error adapter](API_ERRORS.md) and [rate limiter](RATE_LIMITING.md).

## Route protection

`/account` requires a regular-user session through [`src/lib/auth/require-user.ts`](../src/lib/auth/require-user.ts). The private layout checks the enabled staff session. `/private` additionally requires `staff:portal:read`, and `/private/admin` requires `staff:admin:read`; zero-role staff can use their own password-change page. Signed-out visitors redirect to `/staff/login` and staff without a required scope see an access-denied page. See [Authorization](AUTHORIZATION.md) for role assignments, guards, APIs, and initial admin provisioning. Staff routes read only the staff session and staff table; a regular-user cookie cannot authorize staff access.

App Router layouts can be reused or skipped during partial RSC requests and do not protect API route handlers or server actions. Every staff page must check `requireStaffUser()` before rendering protected content, and staff-only data access, API handlers, and server actions must check it at the access boundary. The current staff landing page performs its own check even when the shared layout does not render.

Session reads in [`src/lib/auth/session.ts`](../src/lib/auth/session.ts) verify Firebase session cookies with revocation checks and look up the UID in the corresponding table. The app does not use a Next.js Proxy for auth checks.

## Error reporting and request logs

Session/logout endpoints log one completion record and add a generated `x-request-id` to returned responses. Existing validation, status codes, cookies, and redirects are preserved. Unexpected failures caught during sign-in, logout, password reset, and server verification are reported to Sentry when configured. Expected errors are classified by operation: browser credential/validation failures, reset-link errors, and server malformed/expired/revoked tokens are suppressed; Firebase Admin credential/configuration failures are reported. Returned 5xx failures are captured by the wrapper and include `x-sentry-event-id` when server reporting is enabled. Auth clients report HTTP 5xx responses unless that header acknowledges server capture, covering gateway failures that never reach the app. Server-render errors carrying a digest are not reported again by browser error boundaries. See [Observability](OBSERVABILITY.md) for correlation and delivery limits.

Passwords, credentials, cookies, and Firebase tokens/reset codes are redacted from structured logs, Node console output, and Sentry events. Contact details are permitted in log messages; Sentry still removes user/contact fields and request bodies. The console guard copies errors for output without changing the original auth exceptions. See [`OBSERVABILITY.md`](OBSERVABILITY.md) for configuration, privacy boundaries, request correlation, and automated/live validation.

## Database

[`src/db/schema.ts`](../src/db/schema.ts) defines `users` and `staff_users`. Both records have an internal UUID, a unique Firebase UID within that table, email, display name, email-verification state, timestamps, and nullable local disable state. The additive foundation migration creates the role catalog, staff role assignments, and rate-limit buckets. [`src/db/users.ts`](../src/db/users.ts) syncs regular-user claims; [`src/db/staff-users.ts`](../src/db/staff-users.ts) syncs staff claims. Application tables should reference the appropriate internal UUID.

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
- Declare `APP_ENV=preview` or `APP_ENV=production` at deployment build and runtime, including on non-Vercel hosts. Emulator tests require `APP_ENV=local`; they reject known hosting metadata and compiled/runtime mode mismatches. Normal real-Firebase development does not need this marker.
- To provision a staff member, create the email/password account in the staff Firebase project, then insert that account's UID and email into `staff_users` before its first login.

After applying migrations, an administrator can add the allow-list row with:

```sql
INSERT INTO staff_users (firebase_uid, email)
VALUES ('<staff-firebase-uid>', '<staff-email>');
```

The repository contains placeholders only; it does not include either Firebase project's IDs, credentials, or deployment settings.

## Current gaps

- Email verification is recorded but not required for sign-in or access.
- Firebase identity/staff-row provisioning, account deletion, and profile management remain manual or not implemented in the app. Role assignment, password changes, and administrative disabling are implemented.
- Real Firebase credentials, authorized domains, email-template links, and actual reset-email delivery require verification in each copied app's deployed environment.
- Future staff pages, API handlers, and data access must enforce enabled sessions and their required scopes. Use `requireStaffScope()` for pages and `requireApiStaffScope()` for APIs.

## Implementation checks

Run `pnpm test:e2e:auth` for production-build integration coverage against separate user/staff Auth Emulators and disposable PostgreSQL. It verifies signup/login, profile synchronization, provisioning, cookies, logout, valid cross-project tokens/cookies, disabled accounts, staff allow-list removal, both reset flows, explicit revocation, password-reset session invalidation, expiry, recent-authentication failures, and provider rejection. Rejected exchanges leave profiles unchanged. The runner overrides service configuration and applies committed migrations to an empty test database. Follow it with `pnpm test:auth-harness` for proxy, deployment boundary, port ownership, and interrupted cleanup checks. See [Auth Emulator tests](AUTH_EMULATOR.md) for lifecycle and each copied app's deployment checklist. CI runs these checks without Firebase secrets or real infrastructure.

Run `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm db:check`, `pnpm test`, `pnpm build`, and `pnpm test:e2e` when validating changes. Unit tests cover signup recovery with mocked Firebase/session services and body-reading limits, including UTF-8 chunk boundaries and streams that never finish. The Playwright suite covers the home page, signed-out account/staff redirects, full and partial RSC authorization, rejection of regular-user cookies on staff pages, same-origin session validation and logout on both loopback hostnames, rejection of missing or foreign origins, and oversized declared/chunked requests. These tests do not require Firebase credentials. The regular Playwright suite starts a disposable migrated database on port 5434 and runs Next.js development mode through its isolated runner; Docker must be running. A startup check verifies that database and the migrated role catalog without touching development data.
