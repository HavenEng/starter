<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

## Service documentation

The top-level `docs/` directory contains overviews for the services and integrations used by this app. Before changing a service, check for its existing documentation in `docs/` and elsewhere in the repository. Update the relevant docs alongside the implementation whenever a change affects documented setup, configuration, behavior, routes, security boundaries, or known gaps. Add new service overviews under `docs/`.

## End-to-end validation

Every feature implementation must include end-to-end validation before it is considered complete. Add or update Playwright tests when user-visible behavior changes, and run the relevant tests with `pnpm test:e2e` (use the full suite when the affected scope is unclear). Fix failures caused by the implementation and report the validation results. If the tests cannot run, state the reason and what remains unvalidated.
