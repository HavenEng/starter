import "server-only";
import type { PoolClient } from "pg";
import { getPool } from "@/db/pool";
import { errors } from "@/lib/api/application-error";
import { getFirebaseAdminAuth } from "@/lib/firebase/admin";
import { hasStaffScope, isRoleKey, type StaffScope } from "./permissions";
import type { AuthAudience } from "./audience";

async function mutateAsAdmin<T>(
  actorId: string,
  scope: StaffScope,
  mutation: (db: PoolClient) => Promise<T>,
) {
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    // All role/disable/bootstrap writers share this lock, including grants.
    await db.query("SELECT pg_advisory_xact_lock(829401)");
    const actor = await db.query(
      `SELECT r.key FROM staff_users s JOIN staff_user_roles a ON a.staff_user_id = s.id
      JOIN roles r ON r.id = a.role_id WHERE s.id = $1 AND s.disabled_at IS NULL`,
      [actorId],
    );
    const keys = actor.rows.map((row) => row.key as string);
    if (!keys.includes("admin") || !hasStaffScope(keys, scope))
      throw errors.forbidden();
    const value = await mutation(db);
    await db.query("COMMIT");
    return value;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

async function protectLastAdmin(db: PoolClient, targetId: string) {
  const admins =
    await db.query(`SELECT DISTINCT s.id FROM staff_users s JOIN staff_user_roles a ON a.staff_user_id = s.id
    JOIN roles r ON r.id = a.role_id WHERE r.key = 'admin' AND s.disabled_at IS NULL`);
  if (admins.rows.some((row) => row.id === targetId) && admins.rowCount === 1) {
    throw errors.conflict("The last active admin cannot be removed.");
  }
}

export async function setStaffRole(
  actorId: string,
  targetId: string,
  roleId: string,
  assign: boolean,
) {
  await mutateAsAdmin(actorId, "staff:roles:write", async (db) => {
    const target = await db.query("SELECT id FROM staff_users WHERE id = $1", [
      targetId,
    ]);
    const role = await db.query("SELECT key FROM roles WHERE id = $1", [
      roleId,
    ]);
    if (!target.rowCount || !role.rowCount) throw errors.missing();
    if (!isRoleKey(role.rows[0].key)) throw errors.invalid("Unsupported role.");
    if (!assign && role.rows[0].key === "admin")
      await protectLastAdmin(db, targetId);
    if (assign)
      await db.query(
        "INSERT INTO staff_user_roles (staff_user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [targetId, roleId],
      );
    else
      await db.query(
        "DELETE FROM staff_user_roles WHERE staff_user_id = $1 AND role_id = $2",
        [targetId, roleId],
      );
  });
}

export async function disableAccount(
  actorId: string,
  targetId: string,
  audience: AuthAudience,
) {
  const identity = await mutateAsAdmin(
    actorId,
    audience === "user" ? "users:disable" : "staff:disable",
    async (db) => {
      if (audience === "staff" && actorId === targetId)
        throw errors.conflict("You cannot disable your own staff account.");
      if (audience === "staff") await protectLastAdmin(db, targetId);
      const table = audience === "staff" ? "staff_users" : "users";
      const result = await db.query(
        `UPDATE ${table} SET disabled_at = COALESCE(disabled_at, now()), updated_at = now() WHERE id = $1 RETURNING firebase_uid`,
        [targetId],
      );
      if (!result.rowCount) throw errors.missing();
      return result.rows[0].firebase_uid as string;
    },
  );
  try {
    const auth = getFirebaseAdminAuth(audience);
    await auth.updateUser(identity, { disabled: true });
    await auth.revokeRefreshTokens(identity);
  } catch (cause) {
    // Local denial is already committed. A retry must still reconcile Firebase.
    throw errors.unavailable(cause);
  }
}
