/**
 * The guard that would have caught the production error.
 *
 * On 2 November the live demo booted, said "Available at your primary URL", and
 * then threw `no such column: "flights"` on every page, because the column had
 * been added to `schema.ts` and to `schema.sql` but the bootstrap only pushed the
 * schema onto an *empty* database. Nothing in CI noticed, because every test
 * starts from a brand-new database where `CREATE TABLE IF NOT EXISTS` builds the
 * complete table.
 *
 * So: for every column drizzle knows about, assert the database can actually get
 * it - either the table is created with it (`schema.sql`) or something adds it
 * to an existing table (`ADDED_COLUMNS`). A future column that satisfies neither
 * fails here, in `npm test`, before it can reach a deployment.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import * as schema from "@/db/schema";
import { ADDED_COLUMNS, ADDED_INDEXES } from "@/db/reconcile";

const SQL = readFileSync(path.join(process.cwd(), "src/db/schema.sql"), "utf8");
const DEMO = readFileSync(path.join(process.cwd(), "seed/demo.sql"), "utf8");

/** table -> the columns named in its CREATE TABLE, ignoring constraints. */
function columnsFromSql(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const lines = sql.split("\n").filter((line) => !line.trim().startsWith("--"));
  let current: Set<string> | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const open = /^CREATE TABLE IF NOT EXISTS (\w+) \($/i.exec(line);
    if (open) {
      current = new Set();
      tables.set(open[1], current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith(")")) {
      current = null;
      continue;
    }
    if (!line) continue;
    if (/^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\b/i.test(line)) continue;
    const name = /^(\w+)\s/.exec(line)?.[1];
    if (name) current.add(name);
  }
  return tables;
}

const drizzleTables = Object.values(schema).filter((value) => is(value, Table)) as Table[];
const sqlColumns = columnsFromSql(SQL);
const demoColumns = columnsFromSql(DEMO);
const addedSet = new Set(ADDED_COLUMNS.map((c) => `${c.table}.${c.column}`));

describe("every column this build reads can exist in a deployed database", () => {
  it("knows the tables it is looking at", () => {
    expect(sqlColumns.size).toBeGreaterThan(20);
    expect(drizzleTables.length).toBeGreaterThan(20);
  });

  it("has no column that neither schema.sql nor ADDED_COLUMNS can create", () => {
    const unreachable: string[] = [];
    for (const table of drizzleTables) {
      const name = getTableName(table);
      const inSql = sqlColumns.get(name);
      if (!inSql) {
        unreachable.push(`${name} (table is not in schema.sql)`);
        continue;
      }
      for (const column of Object.values(getTableColumns(table))) {
        const columnName = column.name;
        if (inSql.has(columnName)) continue;
        if (addedSet.has(`${name}.${columnName}`)) continue;
        unreachable.push(`${name}.${columnName}`);
      }
    }
    // The message is the fix: either add the column to schema.sql (new tables),
    // or to ADDED_COLUMNS in src/db/reconcile.ts (tables that already shipped).
    expect(unreachable, `these columns would be missing on an existing database: ${unreachable.join(", ")}`).toEqual([]);
  });

  it("has no stale ADDED_COLUMNS entry", () => {
    const known = new Set<string>(drizzleTables.map((table) => getTableName(table)));
    for (const entry of ADDED_COLUMNS) {
      expect(known.has(entry.table), `ADDED_COLUMNS names a table that is not in schema.ts: ${entry.table}`).toBe(true);
      const columns = Object.values(getTableColumns(drizzleTables.find((t) => getTableName(t) === entry.table)!));
      expect(
        columns.some((column) => column.name === entry.column),
        `ADDED_COLUMNS names a column that is not in schema.ts: ${entry.table}.${entry.column}`,
      ).toBe(true);
      // A column that is in ADDED_COLUMNS but not in schema.sql is the normal
      // case (it shipped later). A column in *neither* would be a typo, and the
      // ddl has to name the same table and column as the entry.
      expect(entry.ddl).toContain(`TABLE ${entry.table} ADD COLUMN ${entry.column} `);
    }
  });

  it("keeps the DDL statements runnable on an old SQLite", () => {
    for (const entry of ADDED_COLUMNS) {
      // SQLite refuses NOT NULL without a default on an existing table, which
      // would make the ALTER fail on somebody's year-old demo database.
      if (/NOT NULL/i.test(entry.ddl)) expect(entry.ddl, `${entry.table}.${entry.column}`).toMatch(/DEFAULT/i);
      expect(entry.ddl).not.toMatch(/;\s*$/);
    }
  });

  it("has index statements that are idempotent and name a real table", () => {
    for (const statement of ADDED_INDEXES) {
      expect(statement).toMatch(/^CREATE (UNIQUE )?INDEX IF NOT EXISTS/);
      const table = /ON (\w+)/i.exec(statement)?.[1];
      expect(table && sqlColumns.has(table), `index on unknown table: ${statement}`).toBe(true);
    }
  });

  it("keeps seed/demo.sql in step with the schema", () => {
    // `seed/demo.sql` drops and rebuilds every table from its own copy of the
    // DDL. If that copy goes stale, `npm run db:reset` (and the documented
    // `turso db shell < seed/demo.sql`) quietly removes columns the app needs -
    // which is how the demo database lost `flights` in the first place.
    const stale: string[] = [];
    for (const [table, columns] of sqlColumns) {
      const dumped = demoColumns.get(table);
      if (!dumped) {
        stale.push(`${table} (table missing from seed/demo.sql)`);
        continue;
      }
      for (const name of columns) {
        if (!dumped.has(name)) stale.push(`${table}.${name}`);
      }
    }
    expect(
      stale,
      `seed/demo.sql is out of date: ${stale.join(", ")} - run \`npm run db:reset && npm run seed:dump\``,
    ).toEqual([]);
  });
});
