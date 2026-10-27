import { test, expect } from "@playwright/test";
import { Pool } from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  readdir,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { PostgresRateLimitStore } from "@/lib/rate-limit/store";
import { runSeeds } from "@/db/seeds/registry";

const execute = promisify(execFile);
const databaseUrl =
  "postgresql://browser_e2e:browser_e2e@127.0.0.1:5434/browser_e2e";

test("migration generation requires descriptive names and keeps SQL/journal names aligned", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-migration-names-"));
  const script = resolve("scripts/db-generate.mjs");
  try {
    await symlink(
      resolve("node_modules"),
      join(directory, "node_modules"),
      "dir",
    );
    await writeFile(
      join(directory, "drizzle.config.ts"),
      `export default { dialect: "postgresql", schema: "./schema.ts", out: "./drizzle" };`,
    );
    await writeFile(
      join(directory, "schema.ts"),
      `import { pgTable, text } from "drizzle-orm/pg-core";
      export const records = pgTable("example_records", { id: text("id").primaryKey() });`,
    );
    for (const args of [
      [],
      ["--name", ""],
      ["--name", "Bad-Name"],
      ["--custom"],
    ]) {
      await expect(
        execute(process.execPath, [script, ...args], { cwd: directory }),
      ).rejects.toMatchObject({ code: 1 });
      expect(await readdir(directory)).not.toContain("drizzle");
    }
    await execute(
      process.execPath,
      [script, "--name", "create_example_records"],
      { cwd: directory },
    );
    await execute(
      process.execPath,
      [script, "--name", "backfill_example_records", "--custom"],
      { cwd: directory },
    );
    expect(await readdir(join(directory, "drizzle"))).toEqual(
      expect.arrayContaining([
        "0000_create_example_records.sql",
        "0001_backfill_example_records.sql",
      ]),
    );
    const journal = JSON.parse(
      await readFile(join(directory, "drizzle/meta/_journal.json"), "utf8"),
    );
    expect(journal.entries.map((entry: { tag: string }) => entry.tag)).toEqual([
      "0000_create_example_records",
      "0001_backfill_example_records",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("seed CLI is repeatable, preserves changes, and rolls back a failed seed", async () => {
  const db = new Pool({ connectionString: databaseUrl });
  const env = {
    ...process.env,
    NODE_ENV: "development" as const,
    APP_ENV: "local",
    DATABASE_URL: databaseUrl,
    SEED_DATABASE_NAME: "browser_e2e",
  };
  try {
    await execute(
      process.execPath,
      ["scripts/db-seed.mjs", "--only", "users"],
      { env },
    );
    const before = await db.query(
      "SELECT id, firebase_uid FROM users WHERE firebase_uid LIKE 'seed-user-%' ORDER BY firebase_uid",
    );
    expect(before.rows).toHaveLength(2);
    await db.query(
      "UPDATE users SET display_name = 'Preserved', disabled_at = now() WHERE firebase_uid = 'seed-user-alex'",
    );
    await execute(
      process.execPath,
      ["scripts/db-seed.mjs", "--only", "users"],
      { env },
    );
    expect(
      (
        await db.query(
          "SELECT id, firebase_uid FROM users WHERE firebase_uid LIKE 'seed-user-%' ORDER BY firebase_uid",
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (
        await db.query(
          "SELECT display_name, disabled_at FROM users WHERE firebase_uid = 'seed-user-alex'",
        )
      ).rows[0],
    ).toMatchObject({
      display_name: "Preserved",
      disabled_at: expect.any(Date),
    });
    const client = await db.connect();
    try {
      await expect(
        runSeeds(client, [
          {
            name: "failure",
            async run({ db }) {
              await db.query(
                "INSERT INTO users (firebase_uid) VALUES ('rolled-back-seed')",
              );
              throw new Error("Seed failure");
            },
          },
        ]),
      ).rejects.toThrow("Seed failure");
      expect(
        (
          await client.query(
            "SELECT id FROM users WHERE firebase_uid = 'rolled-back-seed'",
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      client.release();
    }
    await expect(
      execute(process.execPath, ["scripts/db-seed.mjs", "--only", "missing"], {
        env,
      }),
    ).rejects.toMatchObject({ code: 1 });
    await expect(
      execute(process.execPath, ["scripts/db-seed.mjs"], {
        env: { ...env, APP_ENV: "production" },
      }),
    ).rejects.toMatchObject({ code: 1 });
  } finally {
    await db.query("DELETE FROM users WHERE firebase_uid LIKE 'seed-user-%'");
    await db.end();
  }
});

test("seed CLI rejects non-development modes and effective remote hosts before connecting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "starter-seed-guard-"));
  const preload = join(directory, "connection-probe.mjs");
  const repoRequire = createRequire(join(process.cwd(), "package.json"));
  await writeFile(
    preload,
    `import pg from ${JSON.stringify(repoRequire.resolve("pg"))};
    pg.Pool.prototype.connect = async () => {
      console.error("TEST_DATABASE_CONNECTION_ATTEMPTED");
      throw new Error("Connection probe");
    };`,
  );
  const env = {
    ...process.env,
    NODE_ENV: "development" as const,
    APP_ENV: "local",
    DATABASE_URL: databaseUrl,
    SEED_DATABASE_NAME: "browser_e2e",
  };
  const run = (changes: Record<string, string | undefined>) =>
    execute(
      process.execPath,
      ["--import", pathToFileURL(preload).href, "scripts/db-seed.mjs"],
      { env: { ...env, ...changes } },
    ).catch((error) => error);
  try {
    const control = await run({});
    expect(control.stderr).toContain("TEST_DATABASE_CONNECTION_ATTEMPTED");
    for (const changes of [
      { NODE_ENV: undefined },
      { NODE_ENV: "" },
      { NODE_ENV: "test" },
      { NODE_ENV: "production" },
      { APP_ENV: "production" },
      { VERCEL: "1" },
      { DATABASE_URL: `${databaseUrl}?host=remote.example.test` },
      { DATABASE_URL: databaseUrl.replace("127.0.0.1", "remote.example.test") },
    ]) {
      const failure = await run(changes);
      expect(failure.code).toBe(1);
      expect(failure.stderr).not.toContain(
        "TEST_DATABASE_CONNECTION_ATTEMPTED",
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("limiter counters are atomic across connections, survive new instances, and expire", async () => {
  const first = new Pool({ connectionString: databaseUrl });
  const second = new Pool({ connectionString: databaseUrl });
  const key = `concurrency-${randomUUID()}`;
  const policy = { id: "integration", limit: 5, windowSeconds: 86400 };
  try {
    const a = new PostgresRateLimitStore(first);
    const b = new PostgresRateLimitStore(second);
    const outcomes = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        (i % 2 ? a : b).consume(key, policy),
      ),
    );
    expect(outcomes.filter(Boolean)).toHaveLength(5);
    expect(await new PostgresRateLimitStore(second).consume(key, policy)).toBe(
      false,
    );
    await first.query(
      "UPDATE rate_limit_buckets SET expires_at = now() - interval '1 second' WHERE key = $1",
      [key],
    );
    expect(await b.consume(key, policy)).toBe(true);
  } finally {
    await first.query("DELETE FROM rate_limit_buckets WHERE key = $1", [key]);
    await Promise.all([first.end(), second.end()]);
  }
});

test("cleanup skips a renewing locked bucket and retains its active allowance", async () => {
  const db = new Pool({ connectionString: databaseUrl });
  const renewingKey = `renewing-${randomUUID()}`;
  const expiredKey = `expired-${randomUUID()}`;
  const updater = await db.connect();
  try {
    await db.query(
      `INSERT INTO rate_limit_buckets (key, window_start, count, expires_at)
       SELECT key, now() - interval '2 days', 5, now() - interval '1 day'
       FROM unnest($1::text[]) AS key`,
      [[renewingKey, expiredKey]],
    );
    await updater.query("BEGIN");
    await updater.query(
      "UPDATE rate_limit_buckets SET count = 5, window_start = now(), expires_at = now() + interval '1 day' WHERE key = $1",
      [renewingKey],
    );
    // Run the real command while the renewal is uncommitted. Cleanup must skip
    // the locked old row, not wait and then delete the freshly renewed counter.
    await execute(process.execPath, ["scripts/rate-limit-prune.mjs"], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 5_000,
    });
    await updater.query("COMMIT");
    expect(
      (
        await db.query("SELECT key FROM rate_limit_buckets WHERE key = $1", [
          expiredKey,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.query("SELECT count FROM rate_limit_buckets WHERE key = $1", [
          renewingKey,
        ])
      ).rows,
    ).toEqual([{ count: 5 }]);
    expect(
      await new PostgresRateLimitStore(db).consume(renewingKey, {
        id: "cleanup",
        limit: 5,
        windowSeconds: 86400,
      }),
    ).toBe(false);
  } finally {
    await updater.query("ROLLBACK");
    updater.release();
    await db.query(
      "DELETE FROM rate_limit_buckets WHERE key = ANY($1::text[])",
      [[renewingKey, expiredKey]],
    );
    await db.end();
  }
});

test("baseline databases upgrade with staff assignments and enabled defaults", async () => {
  const admin = new Pool({ connectionString: databaseUrl });
  const name = `upgrade_${randomUUID().replaceAll("-", "")}`;
  const target = new URL(databaseUrl);
  target.pathname = `/${name}`;
  let db: Pool | undefined;
  try {
    await admin.query(`CREATE DATABASE ${name}`);
    db = new Pool({ connectionString: target.toString() });
    await db.query(
      await readFile("drizzle/0000_initial_auth_schema.sql", "utf8"),
    );
    await db.query(
      "INSERT INTO staff_users (firebase_uid) VALUES ('existing-staff')",
    );
    await execute("pnpm", ["db:migrate"], {
      env: { ...process.env, DATABASE_URL: target.toString() },
    });
    expect(
      (
        await db.query(
          `SELECT r.key, s.disabled_at FROM staff_users s JOIN staff_user_roles a ON a.staff_user_id = s.id JOIN roles r ON r.id = a.role_id`,
        )
      ).rows,
    ).toEqual([{ key: "staff", disabled_at: null }]);
    await db.query(
      "INSERT INTO staff_users (firebase_uid) VALUES ('new-staff')",
    );
    expect(
      (
        await db.query(
          "SELECT a.* FROM staff_user_roles a JOIN staff_users s ON s.id = a.staff_user_id WHERE s.firebase_uid = 'new-staff'",
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await db?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  }
});
