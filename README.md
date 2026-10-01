# Web app starter

A reusable Next.js App Router starter with TypeScript, Tailwind CSS, PostgreSQL, Drizzle, Vitest, Playwright, ESLint, and Prettier. The app intentionally starts without authentication, a UI component library, or application tables.

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
pnpm dev
```

Open <http://localhost:3000>. The app can build and render without a database connection; PostgreSQL is needed when you begin querying data or applying migrations. Set `DATABASE_URL` in the deployment environment for a hosted PostgreSQL instance.

The production build uses Next.js's supported Webpack mode. The development server uses the default Turbopack mode.

The local database uses the credentials in `compose.yaml` and `.env.example`. They are development-only values. Compose stores data in a named volume. `docker compose down` stops the service while retaining that data.

## Database workflow

`src/db/schema.ts` is intentionally empty, so there is no initial migration. Define and export your first Drizzle `pgTable` there, then run:

```bash
pnpm db:generate
pnpm db:migrate
```

`db:generate` compares the TypeScript schema with committed snapshots and writes SQL migration files to `drizzle/`. Review and commit the SQL and snapshots with the schema change. `db:migrate` applies unapplied files to the database named by `DATABASE_URL`. It is a separate command and never runs when the app starts. Run it as an explicit deployment step when you have a production database. `db:generate` does not need a database URL; `db:migrate` and `db:studio` do.

Import `getDb` from `src/db` in server code to query PostgreSQL. The connection pool is created on first use and reused in the process. Do not import the database module into client components.

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
