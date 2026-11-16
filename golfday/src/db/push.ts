import { readFileSync } from "node:fs";
import path from "node:path";
import { client } from "./client";
import { ADDED_COLUMNS, ADDED_INDEXES, LEGACY_INDEX_DROPS, reconcileColumns } from "./reconcile";

/**
 * Create the tables (idempotent) and then bring an existing database up to date.
 *
 * Two steps, because they solve different problems:
 *
 *   1. `schema.sql` - `CREATE TABLE IF NOT EXISTS` for a brand-new database.
 *   2. `reconcileColumns` - `ALTER TABLE ... ADD COLUMN` for columns added after
 *      a table shipped, on a database that already has the tables. Skipping this
 *      step is what let a demo database boot without `event_settings.flights`
 *      and then error on every page that read it.
 *
 * Safe to run on every boot; nothing here deletes or rewrites data.
 */

/** Kept for anything that wants to know the full additive contract. */
export { ADDED_COLUMNS, ADDED_INDEXES };

export type PushResult = {
  /** Statements run from schema.sql. */
  statements: number;
  /** Columns that were missing and have just been added, e.g. "event_settings.flights". */
  added: string[];
};

export async function pushSchema(): Promise<number> {
  return (await pushSchemaDetailed()).statements;
}

export async function pushSchemaDetailed(): Promise<PushResult> {
  const sqlFile = path.join(process.cwd(), "src/db/schema.sql");
  const ddl = readFileSync(sqlFile, "utf8");
  const statements = ddl
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await client.execute(statement);
  }

  // Columns first, then indexes: an index that names a column added in this run
  // cannot be created before the ALTER, and `IF NOT EXISTS` keeps the rest cheap.
  const { applied } = await reconcileColumns(client);

  for (const statement of ADDED_INDEXES) {
    try {
      await client.execute(statement);
    } catch (err) {
      if (!/already exists|no such column/i.test(String(err))) throw err;
    }
  }

  // Last: indexes the schema replaced (e.g. the old three-column score key).
  // The wider index exists by now, so the uniqueness guard never lapses.
  for (const statement of LEGACY_INDEX_DROPS) {
    await client.execute(statement);
  }

  return { statements: statements.length, added: applied };
}

if (process.argv[1]?.endsWith("push.ts") || process.argv[1]?.endsWith("db-push.ts")) {
  pushSchemaDetailed()
    .then(({ statements, added }) => {
      console.log(`✅ schema applied (${statements} statements) to ${process.env.DATABASE_URL ?? "file:./data/golfday.db"}`);
      console.log(added.length === 0 ? "✅ columns already current" : `✅ added columns: ${added.join(", ")}`);
    })
    .catch((err) => {
      console.error("❌ schema push failed", err);
      process.exit(1);
    });
}
