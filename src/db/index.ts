import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { getPool } from "./pool";
import * as schema from "./schema";

export function getDb() {
  return drizzle({ client: getPool(), schema });
}
