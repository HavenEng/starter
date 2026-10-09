# Web app starter

A reusable Next.js App Router starter with TypeScript, Tailwind CSS, Firebase Authentication, PostgreSQL, Drizzle, Vitest, Playwright, ESLint, and Prettier. Firebase handles identity and sessions; PostgreSQL stores application user records and future app data.

## Requirements

- Node.js 24 LTS
- pnpm 12.6.0 (the `packageManager` field pins this version)
- Docker with Docker Compose for the included local PostgreSQL service

## First run

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
docker compose up -d --wait
pnpm db:smoke
pnpm db:migrate
pnpm dev
```

Open <http://localhost:3000>. The app can build and render without a database connection; PostgreSQL is needed when you begin querying data or applying migrations. Set `DATABASE_URL` in the deployment environment for a hosted PostgreSQL instance.

The home page and production build work before Firebase is configured. Sign-up and sign-in need separate Firebase projects for regular users and staff, both sets of web app/Admin configuration, and the PostgreSQL migration for `users` and `staff_users`.

The production build uses Next.js's supported Webpack mode. The development server uses the default Turbopack mode.

The local database uses the credentials in `compose.yaml` and `.env.example`. They are development-only values. Compose stores data in a named volume. `docker compose down` stops the service while retaining that data.

## Database workflow

`src/db/schema.ts` defines separate `users` and `staff_users` records. Each table maps a Firebase UID from its corresponding Firebase project to an internal UUID. Generate or update migrations with:

```bash
pnpm db:generate
pnpm db:migrate
```

`db:generate` compares the TypeScript schema with committed snapshots and writes SQL migration files to `drizzle/`. Review and commit the SQL and snapshots with the schema change. `db:migrate` applies unapplied files to the database named by `DATABASE_URL`. It is a separate command and never runs when the app starts. Run it as an explicit deployment step when you have a production database. `db:generate` does not need a database URL; `db:migrate` and `db:studio` do.

Import `getDb` from `src/db` in server code to query PostgreSQL. The connection pool is created on first use and reused in the process. Do not import the database module into client components.

## Firebase Authentication

For an overview of the app's authentication flows and protections, see [`docs/AUTH_IMPLEMENTATION.md`](docs/AUTH_IMPLEMENTATION.md).

1. Create two Firebase projects: one for regular users and one for staff. Register a Web app in each project.
2. In both projects, enable Email/Password under **Authentication → Sign-in method** and disable other sign-in providers. Add `localhost` and the app's deployed domains under **Authorized domains**.
3. Copy each Web app's values into its matching `NEXT_PUBLIC_FIREBASE_USER_*` or `NEXT_PUBLIC_FIREBASE_STAFF_*` variables in `.env.local`. These values are included in the browser bundle and need to be set in Vercel before its build.
4. Create an Admin service account in each Firebase project. Set the regular-user credentials in `FIREBASE_USER_PROJECT_ID`, `FIREBASE_USER_CLIENT_EMAIL`, and `FIREBASE_USER_PRIVATE_KEY`; set the staff credentials in the corresponding `FIREBASE_STAFF_*` variables. Keep these server-only values out of `NEXT_PUBLIC_*` variables and source control. For private keys in `.env.local`, preserve newlines or encode them with backslash-n sequences.
5. In each project's **Authentication → Templates**, set the Password reset email action URL. Use `https://<your-domain>/reset-password/confirm` for regular users and `https://<your-domain>/staff/reset-password/confirm` for staff. Those routes handle Firebase's `mode` and `oobCode` parameters. Authorize the hostname in both projects. Each template action URL is project-wide, so point it at the environment you are testing.
6. Start local PostgreSQL and apply the migration that creates both user tables with `pnpm db:migrate`.
7. Set both projects' web config and server-only Admin credentials in the Vercel environments where sign-in will be available. Add the production and preview hostnames to both Firebase projects' Authorized domains.

Regular users sign up at `/signup` and sign in at `/login`; staff sign in at `/staff/login`. Staff accounts are provisioned administratively and have no public signup page. Before first staff sign-in, create the account in the staff Firebase project and insert its Firebase UID into `staff_users`; the staff session endpoint rejects UIDs that are not already in that table, including accounts created outside the app. The app uses separate Firebase projects, session cookies, and database tables for the two populations. Staff sessions are issued through `/api/auth/staff/session`; `/private/**` pages require a staff session and redirect other visitors to `/staff/login`. Call `requireStaffUser()` in each staff page and protected data access, API handler, and server action. Layout checks can be skipped during partial RSC requests and do not protect API endpoints.

Both reset-request pages return the same confirmation for existing and unknown email addresses. Regular users use `/reset-password`; staff use `/staff/reset-password`. The server maps verified Firebase UIDs to `users.firebase_uid` or `staff_users.firebase_uid` according to the separate session endpoint. The session endpoints accept only Email/Password ID tokens, check the request origin, and reject stale sign-ins.

If signup creates a Firebase account but cannot start the app session, the form offers **Retry sign-in** using the existing account. Session endpoints enforce a 12,000-byte limit while reading the body and reject oversized requests with `413`, including chunked requests that have not finished sending.

Session and logout origin checks compare the browser's `Origin` against the request protocol and HTTP `Host`, preserving loopback hostnames such as `127.0.0.1`. Reverse proxies must preserve the public `Host` and supply the correct protocol to Next.js.

## Observability

Sentry reports unexpected browser/server errors in configured Vercel production and preview deployments. Pino writes structured server logs to Vercel's existing Runtime Logs viewer. Tracing, profiling, Session Replay, and Sentry Logs are disabled. Normal local development, CI, and unconfigured builds work without sending Sentry events.

Set both Sentry DSNs and the server-only source-map upload settings from `.env.example` in Vercel, then redeploy. See [`docs/OBSERVABILITY.md`](docs/OBSERVABILITY.md) for setup, privacy filtering, request IDs, cost/retention limits, verification, and disabling reporting.

The landing page includes an observability setup checklist covering Sentry configuration, source-map upload credentials, preview verification, and Pino logging defaults.

## Commands

| Command                             | Purpose                                          |
| ----------------------------------- | ------------------------------------------------ |
| `pnpm dev`                          | Start the Next.js development server             |
| `pnpm build` / `pnpm start`         | Build and serve the production app               |
| `pnpm lint` / `pnpm lint:fix`       | Check or fix ESLint findings                     |
| `pnpm format:check` / `pnpm format` | Check or apply Prettier formatting               |
| `pnpm typecheck`                    | Check TypeScript types                           |
| `pnpm test` / `pnpm test:watch`     | Run or watch Vitest unit tests                   |
| `pnpm test:e2e`                     | Start the app and run Chromium Playwright tests  |
| `pnpm db:generate`                  | Generate SQL migrations from TypeScript schema   |
| `pnpm db:migrate`                   | Apply generated SQL migrations to `DATABASE_URL` |
| `pnpm db:check`                     | Check generated migration history for conflicts  |
| `pnpm db:studio`                    | Open Drizzle Studio for `DATABASE_URL`           |
| `pnpm db:smoke`                     | Verify the PostgreSQL connection                 |

Playwright installs a browser separately: `pnpm exec playwright install chromium`. The GitHub Actions workflow installs the browser and runs formatting, lint, types, unit tests, build, and browser tests on pushes and pull requests. Database checks and migrations run separately from CI.

Run `pnpm test:e2e --config playwright.observability.config.ts` for the additional production-build observability suite with a local mock Sentry collector. It uses no remote Sentry credentials or quota; CI runs it after the regular browser suite.
