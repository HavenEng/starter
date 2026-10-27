export const roleScopes = {
  staff: ["staff:portal:read"],
  admin: [
    "staff:portal:read",
    "staff:admin:read",
    "users:disable",
    "staff:disable",
    "staff:roles:write",
  ],
} as const;
export type StaffScope = (typeof roleScopes)[keyof typeof roleScopes][number];
export function isRoleKey(key: string): key is keyof typeof roleScopes {
  return Object.hasOwn(roleScopes, key);
}
export function hasStaffScope(roles: readonly string[], scope: StaffScope) {
  return roles.some(
    (key) =>
      isRoleKey(key) && (roleScopes[key] as readonly string[]).includes(scope),
  );
}
