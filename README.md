# Web app starter

A reusable Next.js App Router starter with TypeScript, Tailwind CSS, Firebase Authentication, PostgreSQL, Drizzle, Vitest, Playwright, ESLint, and Prettier. Firebase handles identity and sessions; PostgreSQL stores application user records and future app data.

## Requirements

- Node.js 24 LTS
- pnpm 12.6.0 (the `packageManager` field pins this version)
- Docker with Docker Compose and a running Docker engine for the included local PostgreSQL service

## First run

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

`pnpm dev` (or `npm run dev`) starts the local PostgreSQL container, waits for its health check to pass, then starts Next.js at <http://localhost:3000>. Use that single command for subsequent development sessions too. Repeated starts reuse the existing container and database volume. If Docker startup or the health check fails, the command exits before starting Next.js.

In another terminal, verify the database connection and apply committed migrations before using authentication or other database features:

```bash
pnpm db:smoke
pnpm db:migrate
```

The home page and production build can render without a database connection. Set `DATABASE_URL` in the deployment environment for a hosted PostgreSQL instance.

The home page and production build work before Firebase is configured. Sign-up and sign-in need separate Firebase projects for regular users and staff, both sets of web app/Admin configuration, and the PostgreSQL migration for `users` and `staff_users`.

The production build uses Next.js's supported Webpack mode. The development server uses the default Turbopack mode.

The local database uses the credentials in `compose.yaml` and `.env.example`. They are development-only values. Compose stores data in a named volume. Ctrl+C stops Next.js and leaves PostgreSQL running in the background. Use `docker compose stop postgres` to stop the database, or `docker compose down` to remove its container and network while retaining the database volume.

## Database workflow

`src/db/schema.ts` defines separate `users` and `staff_users` records. Each table maps a Firebase UID from its corresponding Firebase project to an internal UUID. Generate or update migrations with:

```bash
pnpm db:generate
pnpm db:migrate
```

`db:generate` compares the TypeScript schema with committed snapshots and writes SQL migration files to `drizzle/`. Review and commit the SQL and snapshots with the schema change. `db:migrate` applies unapplied files to the database named by `DATABASE_URL`. It is a separate command and never runs when the app starts. Run it as an explicit deployment step when you have a production database. `db:generate` does not need a database URL; `db:migrate` and `db:studio` do.

`pnpm dev` starts the local database automatically. To start only PostgreSQL, for example before running migrations, use `docker compose up -d --wait postgres`.

Import `getDb` from `src/db` in server code to query PostgreSQL. The connection pool is created on first use and reused in the process. Do not import the database module into client components.

## Firebase Authentication

For an overview of the app's authentication flows and protections, see [`docs/AUTH_IMPLEMENTATION.md`](docs/AUTH_IMPLEMENTATION.md).

1. Create two Firebase projects: one for regular users and one for staff. Register a Web app in each project.
2. In both projects, enable Email/Password under **Authentication → Sign-in method** and disable other sign-in providers. Add `localhost` and the app's deployed domains under **Authorized domains**.
3. Copy each Web app's values into its matching `NEXT_PUBLIC_FIREBASE_USER_*` or `NEXT_PUBLIC_FIREBASE_STAFF_*` variables in `.env.local`. These values are included in the browser bundle and need to be set in Vercel before its build.
4. Create an Admin service account in each Firebase project. Set the regular-user credentials in `FIREBASE_USER_PROJECT_ID`, `FIREBASE_USER_CLIENT_EMAIL`, and `FIREBASE_USER_PRIVATE_KEY`; set the staff credentials in the corresponding `FIREBASE_STAFF_*` variables. Keep these server-only values out of `NEXT_PUBLIC_*` variables and source control. For private keys in `.env.local`, preserve newlines or encode them with backslash-n sequences.
5. In each project's **Authentication → Templates**, set the Password reset email action URL. Use `https://<your-domain>/reset-password/confirm` for regular users and `https://<your-domain>/staff/reset-password/confirm` for staff. Those routes handle Firebase's `mode` and `oobCode` parameters. Authorize the hostname in both projects. Each template action URL is project-wide, so point it at the environment you are testing.
6. Run `pnpm dev` to start PostgreSQL and the app, then apply the migration that creates both user tables with `pnpm db:migrate` in another terminal.
7. Set both projects' web config and server-only Admin credentials in the Vercel environments where sign-in will be available. Add the production and preview hostnames to both Firebase projects' Authorized domains.

Regular users sign up at `/signup` and sign in at `/login`; staff sign in at `/staff/login`. Staff accounts are provisioned administratively and have no public signup page. Before first staff sign-in, create the account in the staff Firebase project and insert its Firebase UID into `staff_users`; the staff session endpoint rejects UIDs that are not already in that table, including accounts created outside the app. The app uses separate Firebase projects, session cookies, and database tables for the two populations. Staff sessions are issued through `/api/auth/staff/session`; `/private/**` pages require a staff session and redirect other visitors to `/staff/login`. Call `requireStaffUser()` in each staff page and protected data access, API handler, and server action. Layout checks can be skipped during partial RSC requests and do not protect API endpoints.

Both reset-request pages return the same confirmation for existing and unknown email addresses. Regular users use `/reset-password`; staff use `/staff/reset-password`. The server maps verified Firebase UIDs to `users.firebase_uid` or `staff_users.firebase_uid` according to the separate session endpoint. The session endpoints accept only Email/Password ID tokens, check the request origin, and reject stale sign-ins.

If signup creates a Firebase account but cannot start the app session, the form offers **Retry sign-in** using the existing account. Session endpoints enforce a 12,000-byte limit while reading the body and reject oversized requests with `413`, including chunked requests that have not finished sending.

Session and logout origin checks compare the browser's `Origin` against the request protocol and HTTP `Host`, preserving loopback hostnames such as `127.0.0.1`. Reverse proxies must preserve the public `Host` and supply the correct protocol to Next.js.

## Observability

Sentry reports unexpected browser/server errors in configured Vercel production and preview deployments. Pino writes structured server logs to Vercel's existing Runtime Logs viewer. Tracing, profiling, Session Replay, and Sentry Logs are disabled. Normal local development, CI, and unconfigured builds work without sending Sentry events.

Set both Sentry DSNs and the server-only source-map upload settings from `.env.example` in Vercel, then redeploy. See [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) for setup, privacy filtering, request IDs, cost/retention limits, verification, and disabling reporting.

The landing page includes an observability setup checklist covering Sentry configuration, source-map upload credentials, preview verification, and Pino logging defaults.

## Authentication integration tests

Run `pnpm test:e2e:auth` with Docker running and Playwright Chromium installed. The runner starts separate user/staff Auth Emulators, migrates disposable PostgreSQL, and tests a production build of the app. It needs no Firebase projects, credentials, or `.env.local` setup and leaves the development database untouched. The copied GitHub Actions workflow runs the same suite without secrets. See [`docs/AUTH_EMULATOR.md`](docs/AUTH_EMULATOR.md) for ports, fixtures, cleanup, and deployed-copy verification.

The suite includes revocation, expiry, recent-authentication boundaries, and password-reset invalidation of existing sessions. Run `pnpm test:auth-harness` afterward for proxy, deployment guard, occupied-port, and interruption cleanup checks. Normal `pnpm dev` can continue using real development Firebase projects. Set `APP_ENV=preview` or `APP_ENV=production` on deployed copies; only the isolated runner enables local emulator mode. The starter requires no live preview, mailbox provider, or live-test secrets.

## Commands

| Command                             | Purpose                                          |
| ----------------------------------- | ------------------------------------------------ |
| `pnpm dev` / `npm run dev`          | Start PostgreSQL, then the Next.js dev server    |
| `pnpm build` / `pnpm start`         | Build and serve the production app               |
| `pnpm lint` / `pnpm lint:fix`       | Check or fix ESLint findings                     |
| `pnpm format:check` / `pnpm format` | Check or apply Prettier formatting               |
| `pnpm typecheck`                    | Check TypeScript types                           |
| `pnpm test` / `pnpm test:watch`     | Run or watch Vitest unit tests                   |
| `pnpm test:e2e`                     | Start the app and run Chromium Playwright tests  |
| `pnpm test:e2e:auth`                | Test auth with Firebase emulators and PostgreSQL |
| `pnpm test:auth-harness`            | Check auth proxy, deployment guards, and cleanup |
| `pnpm db:generate`                  | Generate SQL migrations from TypeScript schema   |
| `pnpm db:migrate`                   | Apply generated SQL migrations to `DATABASE_URL` |
| `pnpm db:check`                     | Check generated migration history for conflicts  |
| `pnpm db:studio`                    | Open Drizzle Studio for `DATABASE_URL`           |
| `pnpm db:smoke`                     | Verify the PostgreSQL connection                 |

Playwright installs a browser separately: `pnpm exec playwright install chromium`. The regular browser suite uses `pnpm dev` and checks database readiness, so it requires Docker running and local PostgreSQL port 5432 available. GitHub Actions installs the browser and runs formatting, lint, types, unit tests, migration-history checks, build, all three browser suites, and auth harness checks on pushes and pull requests. Auth integration tests apply migrations to a disposable database; production migrations remain an explicit deployment step.

Run `pnpm test:e2e --config playwright.observability.config.ts` for the additional production-build observability suite with a local mock Sentry collector. It uses no remote Sentry credentials or quota; CI runs it after the regular browser suite.
