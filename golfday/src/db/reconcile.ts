import type { Client } from "@libsql/client";

/**
 * Bringing an *existing* database up to date.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, and
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so every column added after a table
 * shipped needs its own `ALTER TABLE`. That is what this file is: an explicit,
 * checked list, applied by looking at what the database actually has
 * (`PRAGMA table_info`) rather than by firing the ALTER and swallowing the error.
 *
 * Why it is written like this: a demo database that predates a column used to
 * boot "successfully" and then throw `no such column: "flights"` on every page
 * that touched it, because the old bootstrap only pushed the schema onto an
 * *empty* database. See `tests/schema-drift.test.ts`, which fails the build if a
 * column exists in `schema.ts` and is not reachable here or in `schema.sql`.
 *
 * Nothing here deletes, renames or retypes anything. If a column is missing it
 * is added with its default; if it is there it is left exactly as it is.
 */

export type AddedColumn = {
  /** Table as it is spelled in SQL. */
  table: string;
  /** Column as it is spelled in SQL (snake_case). */
  column: string;
  /** The exact statement, so the repair is legible in a log. */
  ddl: string;
};

const column = (table: string, name: string, type: string): AddedColumn => ({
  table,
  column: name,
  ddl: `ALTER TABLE ${table} ADD COLUMN ${name} ${type}`,
});

export const ADDED_COLUMNS: AddedColumn[] = [
  // Stripe refunds
  column("event_payments", "stripe_payment_intent", "TEXT"),
  column("event_payments", "refunded_pence", "INTEGER NOT NULL DEFAULT 0"),
  column("event_payments", "refunded_at", "TEXT"),
  // per-society handicap integration
  column("societies", "handicap_source", "TEXT NOT NULL DEFAULT 'DIRECTORY'"),
  column("societies", "handicap_country", "TEXT NOT NULL DEFAULT 'eng'"),
  column("societies", "handicap_api_base", "TEXT"),
  column("societies", "handicap_api_username", "TEXT"),
  column("societies", "handicap_api_secret", "TEXT"),
  column("societies", "handicap_client_token", "TEXT"),
  column("societies", "handicap_updated_at", "TEXT"),
  // how an entry fee is collected (cash is the default)
  column("event_settings", "payment_mode", "TEXT NOT NULL DEFAULT 'CASH'"),
  // handicap provenance (a player needs no club to have a handicap)
  column("players", "handicap_verified", "INTEGER NOT NULL DEFAULT 0"),
  column("players", "handicap_note", "TEXT"),
  // social sign-in
  column("users", "oauth_provider", "TEXT"),
  column("users", "oauth_subject", "TEXT"),
  // flights and the hide-the-board anti-cheat toggle
  column("event_settings", "flights", "INTEGER NOT NULL DEFAULT 0"),
  column("event_settings", "hide_board", "INTEGER NOT NULL DEFAULT 0"),
  // multi-round events (two-day medals)
  column("events", "rounds", "INTEGER NOT NULL DEFAULT 1"),
  column("scores", "round", "INTEGER NOT NULL DEFAULT 1"),
  column("score_audit", "round", "INTEGER NOT NULL DEFAULT 1"),
  // pair scorecards for foursomes / greensomes
  column("event_pairs", "token", "TEXT"),
];

/** Indexes added after a table shipped. `IF NOT EXISTS` makes these idempotent. */
export const ADDED_INDEXES: string[] = [
  "CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_unique ON users (oauth_provider, oauth_subject)",
  // scores.round joined the key when multi-round events arrived; the old
  // three-column index would reject round 2 of hole 1.
  "CREATE UNIQUE INDEX IF NOT EXISTS score_round_unique ON scores (event_id, player_id, hole_number, round)",
];

/**
 * Indexes that were replaced by a wider one. Dropped after the replacement
 * exists (push runs these last) - dropping an index never touches data, and
 * leaving the old one in place would block the very writes the new one allows.
 */
export const LEGACY_INDEX_DROPS: string[] = ["DROP INDEX IF EXISTS score_unique"];

export type ReconcileResult = {
  /** Columns that were genuinely absent and have just been added. */
  applied: string[];
  /** How many columns were looked at. */
  checked: number;
  /** True when every table was present, so the answer is trustworthy. */
  tablesSeen: boolean;
};

/** Column names of a table, or null when the table does not exist yet. */
export async function tableColumns(client: Client, table: string): Promise<string[] | null> {
  try {
    const res = await client.execute(`PRAGMA table_info(${table})`);
    if (res.rows.length === 0) return null;
    return res.rows.map((row) => String(row.name));
  } catch {
    return null;
  }
}

/**
 * Add any missing columns (and indexes) to a database that already has tables.
 *
 * Safe to call on every boot: it reads `PRAGMA table_info` first, so a database
 * that is already current costs one cheap query per table and writes nothing.
 * A table that does not exist is skipped - creating tables is `pushSchema`'s
 * job, and `reconcile` is deliberately not allowed to invent one half-built.
 */
export async function reconcileColumns(client: Client): Promise<ReconcileResult> {
  const applied: string[] = [];
  let checked = 0;
  let missingTables = 0;

  const seen = new Map<string, string[] | null>();
  const tables = [...new Set(ADDED_COLUMNS.map((entry) => entry.table))];
  for (const table of tables) {
    const columns = await tableColumns(client, table);
    seen.set(table, columns);
    if (columns === null) missingTables += 1;
  }

  for (const entry of ADDED_COLUMNS) {
    const columns = seen.get(entry.table);
    if (columns === null || columns === undefined) continue;
    checked += 1;
    if (columns.includes(entry.column)) continue;
    await client.execute(entry.ddl);
    applied.push(`${entry.table}.${entry.column}`);
  }

  if (applied.length > 0) {
    for (const statement of ADDED_INDEXES) {
      // Only index a table that exists: reconcile is not allowed to invent one.
      const table = /ON (\w+)/i.exec(statement)?.[1];
      if (table && (seen.get(table) === null || seen.get(table) === undefined)) continue;
      try {
        await client.execute(statement);
      } catch (err) {
        if (!/already exists|no such (table|column)/i.test(String(err))) throw err;
      }
    }
  }

  return { applied, checked, tablesSeen: missingTables === 0 };
}

/**
 * Which expected columns this database is missing, without changing anything.
 * Used by `/api/health` and by the boot log, so "the app is up but the schema is
 * behind" is a sentence somebody can read rather than a stack trace.
 */
export async function missingColumns(client: Client): Promise<string[]> {
  const missing: string[] = [];
  const seen = new Map<string, string[] | null>();
  for (const entry of ADDED_COLUMNS) {
    if (!seen.has(entry.table)) seen.set(entry.table, await tableColumns(client, entry.table));
    const columns = seen.get(entry.table);
    if (columns === null || columns === undefined) {
      missing.push(`${entry.table} (table missing)`);
      continue;
    }
    if (!columns.includes(entry.column)) missing.push(`${entry.table}.${entry.column}`);
  }
  return missing;
}

/** True for the libSQL error a query throws when it names a column we have not added yet. */
export function isMissingColumnError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /no such column/i.test(message);
}
