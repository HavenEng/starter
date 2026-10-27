import { expect, test } from "@playwright/test";
import { Pool } from "pg";

test("browser runner provisions migrated isolated PostgreSQL", async () => {
  const database = new Pool({
    connectionString:
      "postgresql://browser_e2e:browser_e2e@127.0.0.1:5434/browser_e2e",
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });

  try {
    const result = await database.query(
      "SELECT current_database() AS database, current_user AS user",
    );
    expect(result.rows).toEqual([
      { database: "browser_e2e", user: "browser_e2e" },
    ]);
    expect(
      (await database.query("SELECT key FROM roles ORDER BY key")).rows,
    ).toEqual([{ key: "admin" }, { key: "staff" }]);
  } finally {
    await database.end();
  }
});
