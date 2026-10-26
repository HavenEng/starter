# Authentication integration tests

The starter includes Playwright tests of the production app against Firebase Auth Emulators and disposable PostgreSQL. Copied repositories inherit the tests and CI without Firebase projects, login, credentials, or repository secrets.

## Run

Use Node.js 24, pnpm 12, a running Docker engine with Docker Compose, and Playwright Chromium:

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:e2e:auth
```

The shortcut runs `pnpm test:e2e --config playwright.auth.config.ts`. No `.env.local` setup is required. The first run may pull `postgres:18`. The Auth Emulator uses the pinned `firebase-tools` development dependency; this suite uses no Java-based emulators.

## Services and lifecycle

Playwright manages `scripts/auth-e2e-server.mjs`. The runner checks test ports, starts the test Compose service under a unique `starter-auth-e2e-<pid>` project, waits for PostgreSQL and both emulators, and starts the auth proxy. It applies committed migrations to the empty database, builds the app with Webpack into `.next-auth-e2e`, then starts the production server. Completion, startup failures, and SIGINT/SIGTERM stop owned child processes, remove the test Compose resources, and delete temporary CLI configuration.

| Service                       | Loopback port |
| ----------------------------- | ------------- |
| Production app                | 3102          |
| Test PostgreSQL               | 5433          |
| Auth proxy used by SDKs       | 9099          |
| User / staff Auth Emulators   | 9098 / 9100   |
| User / staff emulator hubs    | 4402 / 4403   |
| User / staff emulator logging | 4502 / 4503   |

All services bind to `127.0.0.1`. Parallel auth-suite runs are rejected instead of reusing servers or resetting another run's data. Normal browser tests use 3100; observability tests use 3101 and 4319.

The `auth_e2e` database uses test-only `auth_e2e` credentials and tmpfs storage. The runner never invokes the development `compose.yaml`, uses its named volume, or migrates an inherited `DATABASE_URL`. Cleanup removes only the runner's uniquely named Compose project.

## Separate populations

Users use `demo-starter-user`; staff use `demo-starter-staff`, with independent account stores. The CLI Auth Emulator assigns browser API-key requests to its default project, so each population has its own instance, configured by `firebase.json` or `firebase.staff.json`.

`scripts/auth-emulator-proxy.mjs` routes browser requests by fixed fake API key and Admin/emulator REST requests by the project ID in the path. Payloads are forwarded unchanged to the matching emulator; unknown projects and keys are rejected. This supports one `FIREBASE_AUTH_EMULATOR_HOST` while retaining two projects and the real SDK flows.

The app uses its existing endpoints, token/cookie verification, database synchronization, route guards, and reset forms. There are no test-only application API routes or authentication bypasses.

## Configuration boundary

`scripts/auth-e2e-settings.mjs` supplies fixed endpoints, demo IDs, and fake public config. It overrides inherited Firebase credentials, Google credential-file settings, `DATABASE_URL`, Sentry settings, and observability fixture mode. Explicit child-process values override `.env.local`. Each run uses a temporary CLI configuration directory instead of existing Firebase login state.

`src/lib/firebase/emulator-config.ts` requires `APP_ENV=local`, `AUTH_E2E=1`, the exact loopback emulator host, matching public/Admin demo IDs, and the isolated test database URL. Missing/invalid app environments, preview/production declarations, and mixing emulator identities with the development or a remote database are rejected. Next.js configuration, Node instrumentation, and lazy Admin initialization enforce the boundary. An emulator host without explicit test mode fails. Deployment metadata from Vercel, Netlify, AWS Lambda, Cloud Run, Azure App Service, Render, Fly, and Railway is an additional rejection check. Simultaneous observability fixture mode is rejected.

The browser flag is derived by the build; setting only `NEXT_PUBLIC_AUTH_E2E` cannot enable it. Instrumentation and Admin initialization also compare the compiled flag with runtime configuration, so an emulator-built artifact cannot start in a declared preview/production environment. `APP_ENV` is a configuration contract, not proof of physical location; set it appropriately in every copied app's hosting environment.

Local production-mode tests are supported: `NODE_ENV=production` does not disable emulation. The runner binds the app to loopback. Do not copy these test flags into a deployment.

Normal `pnpm dev` can use real development Firebase projects from `.env.local`. It does not need emulator flags or an app-environment marker. The automated suite supplies its own local marker and overrides service configuration.

## Coverage and fixtures

Fixtures create unique identities per test with the Admin SDK and provision staff allow-list rows through PostgreSQL. Teardown removes those identities and records. Cross-project tests deliberately share a UID between populations to ensure project identity governs access. Tests use one worker, independent browser contexts, and fresh identities on retries.

The suite covers signup and secure/httpOnly cookies, reload persistence, signup retry after a simulated gateway failure, repeated login/profile synchronization, staff provisioning and rejection without an allow-list row, valid cross-project ID tokens and swapped session cookies, logout, disabled accounts, and removal of an active staff member's allow-list row. Both populations exercise password reset, old/new passwords, consumed codes, and invalid-link recovery. Reset codes come from the emulator's out-of-band REST interface; confirmation uses the app's existing routes. These form tests construct the confirmation URL and cannot verify a real project's email-template link or delivery.

Both populations also exercise explicit refresh-token revocation, rejection of the old ID token at session creation, invalidation of an active session after a password reset in another browser context, and expired server session tokens retained in browser cookies. Expired ID tokens, stale/future/missing authentication times, and non-password providers are rejected before profile synchronization. Valid tokens serve as positive controls. Synthetic unsigned claim fixtures exist only under `tests/auth`, require a local emulator token from one of the demo projects, and never change app clocks or production session duration. Revocation/reset tests wait across the original authentication second to avoid Firebase timestamp races; unit tests cover the exact five-minute boundary.

CI runs this suite after normal browser and observability tests without secrets. It checks migration history and applies the SQL to an empty database.

## Harness validation and upgrades

After `pnpm test:e2e:auth` has produced `.next-auth-e2e`, run:

```bash
pnpm test:auth-harness
```

The harness checks project/API-key routing, unchanged request payloads, preflight forwarding, invalid targets, upstream failures, and consistency between checked-in service ports and the shared runner constants. Process checks verify build/start rejection without Vercel metadata, rejection by compiled instrumentation when the auth artifact is promoted into a non-emulator runtime, occupied-port failure without disturbing its owner, and cleanup during interrupted startup. The interruption check uses disposable Docker/emulator services and also verifies removal of their CLI configuration and release of all nine ports. CI runs it after the browser suite.

Keep one auth run per host at a time. The fixed-port policy is deliberate; configurable ports can be introduced if concurrent copied apps need it. When updating the browser/Admin SDKs or pinned `firebase-tools`, run unit tests, all three Playwright suites, and the harness checks. Recheck the installed emulator's browser project routing before changing the proxy or replacing the two instances. Read the bundled Next.js guides before updating build/runtime integration.

## Troubleshooting

- **Docker unavailable:** start the engine and check `docker info`; socket permission errors require access to Docker.
- **Port unavailable:** stop the owner of the listed port. The runner does not attach to it or delete its resources.
- **Forced termination:** SIGKILL or a host crash cannot run cleanup. Remove the specific project identified in output with `docker compose --project-name starter-auth-e2e-<pid> --file compose.auth-e2e.yaml down --volumes`, then retry.
- **Browser unavailable:** run `pnpm exec playwright install chromium`; Linux may need `--with-deps`.
- **Test failure:** inspect the retained Playwright trace under `test-results/`. Traces contain synthetic test credentials.

## Verify each deployed copy

Emulators validate integration logic rather than production configuration. Tokens are unsigned; the emulator does not send real email or reproduce production IAM and anti-abuse controls. See [Firebase's emulator guide](https://firebase.google.com/docs/emulator-suite/connect_auth).

Before launching a copied app, verify in its configured preview:

1. Set `APP_ENV=preview` or `APP_ENV=production` at build and runtime, remove emulator flags/hosts, and create a fresh build for that deployment.
2. Both real Firebase projects have correct public config, Admin credentials, enabled providers, and authorized app domains. Confirm the app can perform its required Admin operations; emulators cannot verify real IAM permissions.
3. Signup/login and provisioned staff login work; regular users cannot access `/private`.
4. Request both reset emails through the app and open the link from each received message. Verify its HTTPS host and user/staff confirmation route, old-password rejection, new-password login, consumed-link rejection, and invalidation of a previously open session.
5. Reload and logout work with secure/httpOnly cookies over the deployed HTTPS origin. Verify same-origin requests through the actual reverse proxy.
6. Explicit revocation of a disposable account rejects its existing session and old ID token; reauthentication works.
7. Migrations have been applied to the intended deployment database.

The starter has no live test command, mailbox adapter, or workflow requiring real infrastructure. Real credentials, email delivery/templates, signed-token configuration, and deployment behavior are verification tasks for each copied app. A copied app can add live smoke checks after provisioning its infrastructure; they are not prerequisites for running or validating this starter.
