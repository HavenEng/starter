import "server-only";
import { requireStaffUser } from "./require-staff-user";
import { hasStaffScope, type StaffScope } from "./permissions";

export async function requireStaffScope(scope: StaffScope) {
  const user = await requireStaffUser();
  return hasStaffScope(user.roles, scope) ? user : null;
}
