import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDatabaseUrl } from "./env";
import * as schema from "./schema";

const globalForDb = globalThis as typeof globalThis & {
  __starterPgPool?: Pool;
};

function getPool(): Pool {
  globalForDb.__starterPgPool ??= new Pool({
    connectionString: getDatabaseUrl(),
  });

  return globalForDb.__starterPgPool;
}

export function getDb() {
  return drizzle({ client: getPool(), schema });
}
