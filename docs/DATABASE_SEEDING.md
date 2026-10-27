# Database seeding

Run committed migrations before seeding:

```bash
pnpm db:migrate
NODE_ENV=development pnpm db:seed
NODE_ENV=development pnpm db:seed --only users
```

`scripts/db-seed.mjs` requires `NODE_ENV=development` before loading Next.js development environment files, validates the target and selection before connecting, and runs the registry in `src/db/seeds/registry.ts`. Each seed has a name, optional dependencies, and an async `run({ db })` function using a PostgreSQL transaction client. Dependencies execute first and only once. Unknown names and dependency cycles fail before writes.

Each seed commits independently. A failure rolls back that seed, exits nonzero, and closes the connection; earlier completed seeds remain committed. The runner reports completed seed names without printing credentials or provider payloads.

The example `users` seed inserts `seed-user-alex` / `alex@example.test` and `seed-user-sam` / `sam@example.test`. Conflicts on Firebase UID do nothing: reruns preserve internal IDs, profiles, disable state, and any other application changes. Register additional seeds in the registry and use stable keys with explicit conflict behavior.

Seeding is development-only: missing, test, and production `NODE_ENV` values are rejected before connecting. `APP_ENV` must also be local or unset and known hosted environments are rejected. The PostgreSQL driver's effective host must be loopback; connection-string query parameters cannot override this check to select a remote host. Recognized database names are `starter`, `auth_e2e`, or the explicitly supplied `SEED_DATABASE_NAME` for another local database. Test runners invoke the CLI explicitly in development mode against their disposable databases. There is no production override or destructive reset command.

Seeds insert application records only. They do not create Firebase identities, passwords, staff permissions, or administrators. To sign in as an example user, independently provision a matching Firebase UID in an emulator/development project. Role catalog records are created by migrations, independently of example seeds.

`tests/e2e/foundations.spec.ts` runs the actual CLI against disposable PostgreSQL and checks repeatability, preservation, rollback, rejected selection/targets, and baseline migration upgrades. The auth suite also verifies login with a matching seeded identity.
