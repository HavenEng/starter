import nextEnv from "@next/env";
import pg from "pg";
import { seeds, selectSeeds, runSeeds } from "../src/db/seeds/registry.ts";
import { isHostedEnvironment } from "../src/lib/firebase/emulator-config.ts";

let pool;
try {
  if (process.env.NODE_ENV !== "development")
    throw new Error("Database seeding requires NODE_ENV=development.");
  nextEnv.loadEnvConfig(process.cwd(), true);
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--only"))
    throw new Error("Use db:seed [--only seed1,seed2].");
  const selected = selectSeeds(
    seeds,
    args.length ? args[1].split(",") : undefined,
  );
  const target = new URL(process.env.DATABASE_URL);
  // pg connection-string query parameters can override the URL's hostname.
  // Check the same effective connection settings that the pool will use.
  const connection = new pg.Client({
    connectionString: target.toString(),
  }).connectionParameters;
  if (
    isHostedEnvironment(process.env) ||
    ![undefined, "local"].includes(process.env.APP_ENV) ||
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1", "::1"].includes(connection.host) ||
    !["starter", "auth_e2e", process.env.SEED_DATABASE_NAME]
      .filter(Boolean)
      .includes(connection.database)
  ) {
    throw new Error(
      "Example seeds require an explicitly recognized local database.",
    );
  }
  pool = new pg.Pool({
    connectionString: target.toString(),
    connectionTimeoutMillis: 2_000,
  });
  const db = await pool.connect();
  try {
    await runSeeds(db, selected, (name) =>
      console.log(`Seed completed: ${name}`),
    );
  } finally {
    db.release();
  }
} catch {
  console.error(
    "Database seeding failed. Require NODE_ENV=development, a recognized local target, valid seed selection, and applied migrations.",
  );
  process.exitCode = 1;
} finally {
  await pool?.end();
}
