import { expect, test } from "@playwright/test";
import { Pool } from "pg";

test("development startup makes PostgreSQL available", async () => {
  const database = new Pool({
    connectionString: "postgresql://starter:starter@127.0.0.1:5432/starter",
    connectionTimeoutMillis: 5_000,
    query_timeout: 5_000,
  });

  try {
    const result = await database.query(
      "SELECT current_database() AS database, current_user AS user",
    );
    expect(result.rows).toEqual([{ database: "starter", user: "starter" }]);
  } finally {
    await database.end();
  }
});
