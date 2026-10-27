import nextEnv from "@next/env";
import pg from "pg";
import { getDatabaseUrl } from "../src/db/env.ts";
nextEnv.loadEnvConfig(process.cwd());
let pool;
try {
  pool = new pg.Pool({
    connectionString: getDatabaseUrl(),
    connectionTimeoutMillis: 2_000,
    query_timeout: 3_000,
    statement_timeout: 3_000,
  });
  const result = await pool.query(
    `DELETE FROM rate_limit_buckets AS buckets
    USING (
      SELECT key FROM rate_limit_buckets WHERE expires_at < now()
      ORDER BY expires_at LIMIT 10000 FOR UPDATE SKIP LOCKED
    ) AS expired
    WHERE buckets.key = expired.key AND buckets.expires_at < now()`,
  );
  console.log(`Expired rate-limit buckets removed: ${result.rowCount}`);
} catch {
  console.error("Rate-limit cleanup failed.");
  process.exitCode = 1;
} finally {
  await pool?.end();
}
