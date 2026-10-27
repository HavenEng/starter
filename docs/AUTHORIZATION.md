# Staff authorization

Staff identity remains in the separate staff Firebase project and `staff_users` table. Staff users can have zero or more roles: `roles` contains UUIDs and unique stable keys, and `staff_user_roles` contains unique staff/role pairs. Foreign keys prevent orphan assignments; deleting a staff record removes its assignments, and deleting an assigned role is restricted.

Migrations create `staff` and `admin` role records and backfill existing staff with `staff`. New staff rows have no implicit assignments. Profile synchronization and example seeds never change assignments.

`src/lib/auth/permissions.ts` defines scopes in code. `staff` grants portal access. `admin` grants portal/admin access, disabling users/staff, and managing assignments. Effective scopes are the union of assigned roles; an admin does not also need `staff`. Unknown role keys grant nothing. Add future role catalog records through a migration and add their scope mapping in code; there are no role-catalog editing APIs.

`requireApiStaffScope(scope)` returns 401 for missing/invalid authentication and 403 for insufficient scope. `requireStaffScope(scope)` redirects signed-out visitors and lets a page render `AccessDenied` for insufficient permission. `/private` requires `staff:portal:read`; `/private/admin` requires `staff:admin:read`. The parent layout checks authentication, allowing zero-role staff to use their own password-change page. Layout checks never replace checks in pages, APIs, server actions, or data access.

Roles and local disable state are read from PostgreSQL at the authorization boundary, so assignment changes affect the next protected request using the existing cookie. Disabling overrides every role.

Access-denied pages retain the staff password-change link and a staff sign-out control. Staff with zero roles can clear their session and return to `/staff/login` without needing access to the portal.

## Initial administrator

Provision the Firebase staff identity and its database row first. With explicit `APP_ENV`, run:

```bash
pnpm staff:bootstrap-admin --uid <firebase-uid> --database <expected-database-name>
```

The command requires a matching database name and an enabled existing staff row. It adds `admin` idempotently without replacing other roles. It is a trusted operator action; there is no public bootstrap endpoint or admin seed.

## Assignment APIs

`PUT /api/staff/members/[staffUserId]/roles/[roleId]` assigns a role. `DELETE` on the same route removes it. Both require `staff:roles:write`, same-origin protection, and valid internal UUIDs. Missing targets/roles return 404 and unsupported role keys return 400. Assigning an existing role or removing an absent assignment is idempotent.

Every role/disable mutation and bootstrap uses advisory transaction lock `829401`. API mutations recheck the actor's enabled state and admin scope inside the lock. Removing an admin assignment or disabling staff counts distinct enabled staff with `admin` and rejects removal of the last one with 409. Concurrent requests cannot jointly remove every active admin. Operators should use the supported writer paths to retain these invariants.

Permission-matrix, existing-cookie revocation, partial RSC, duplicate assignment, last-admin concurrency, bootstrap, and disabling scenarios run in the auth Playwright suite.

## Operational limits

Request completion logs provide correlation and HTTP outcomes; they are not a durable administrative audit history. The starter does not yet store the acting admin, target account, and role/action for each access change. Applications needing that history should add transactional audit records for role changes and local disabling, with separate records for provider reconciliation. Never include passwords or provider tokens in audit data.
