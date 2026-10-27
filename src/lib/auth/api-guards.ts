import "server-only";
import { getCurrentUser, getCurrentStaffUser } from "./session";
import { errors } from "@/lib/api/application-error";
import { hasStaffScope, type StaffScope } from "./permissions";
import type { AuthAudience } from "./audience";

export async function requireApiUser(audience: AuthAudience) {
  const user =
    audience === "staff" ? await getCurrentStaffUser() : await getCurrentUser();
  if (!user) throw errors.unauthenticated();
  return user;
}

export async function requireApiStaffScope(scope: StaffScope) {
  const user = await getCurrentStaffUser();
  if (!user) throw errors.unauthenticated();
  if (!hasStaffScope(user.roles, scope)) throw errors.forbidden();
  return user;
}
