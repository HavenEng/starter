import { Pool } from "pg";
import { getDatabaseUrl } from "./env";

const shared = globalThis as typeof globalThis & { __starterPgPool?: Pool };

export function getPool() {
  if (!shared.__starterPgPool) {
    const pool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 5,
      connectionTimeoutMillis: 2_000,
      query_timeout: 3_000,
      statement_timeout: 3_000,
    });
    pool.on("error", () => console.error("PostgreSQL idle connection failed"));
    shared.__starterPgPool = pool;
  }
  return shared.__starterPgPool;
}
