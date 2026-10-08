export type AuthAudience = "user" | "staff";

export function getAuthPath(audience: AuthAudience, path: string) {
  return audience === "staff" ? `/staff${path}` : path;
}

export function getSessionApiPath(
  audience: AuthAudience,
  action: "session" | "logout",
) {
  return audience === "staff"
    ? `/api/auth/staff/${action}`
    : `/api/auth/${action}`;
}
