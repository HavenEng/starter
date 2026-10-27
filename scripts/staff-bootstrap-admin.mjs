import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd());
let pool;
try {
  const [uidFlag, uid, databaseFlag, expectedDatabase] = process.argv.slice(2);
  const target = new URL(process.env.DATABASE_URL);
  if (
    process.argv.length !== 6 ||
    uidFlag !== "--uid" ||
    !uid ||
    databaseFlag !== "--database" ||
    !expectedDatabase ||
    decodeURIComponent(target.pathname.slice(1)) !== expectedDatabase ||
    !["local", "preview", "production"].includes(process.env.APP_ENV)
  ) {
    throw new Error("Explicit identity, database, and APP_ENV required.");
  }
  pool = new pg.Pool({
    connectionString: target.toString(),
    connectionTimeoutMillis: 2_000,
  });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(829401)");
    const result = await db.query(
      `INSERT INTO staff_user_roles (staff_user_id, role_id)
      SELECT s.id, r.id FROM staff_users s CROSS JOIN roles r
      WHERE s.firebase_uid = $1 AND s.disabled_at IS NULL AND r.key = 'admin'
      ON CONFLICT DO NOTHING RETURNING staff_user_id`,
      [uid],
    );
    const exists = await db.query(
      "SELECT s.id FROM staff_users s JOIN staff_user_roles a ON a.staff_user_id = s.id JOIN roles r ON r.id = a.role_id WHERE s.firebase_uid = $1 AND s.disabled_at IS NULL AND r.key = 'admin'",
      [uid],
    );
    if (!exists.rowCount)
      throw new Error("An enabled provisioned staff account is required.");
    await db.query("COMMIT");
    console.log(
      result.rowCount ? "Admin role assigned." : "Admin role already assigned.",
    );
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
} catch {
  console.error(
    "Admin bootstrap failed. Verify arguments, APP_ENV, migrations, and enabled staff identity.",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
