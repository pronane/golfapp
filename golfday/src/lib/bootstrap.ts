import { readFileSync } from "node:fs";
import path from "node:path";
import { client } from "@/db/client";
import { pushSchemaDetailed } from "@/db/push";
import { missingColumns } from "@/db/reconcile";
import { applySql } from "@/lib/demoSql";

/**
 * Makes a fresh deployment work with nothing but three environment variables.
 *
 * On the free hosts this app targets, a new service is usually pointed at a new
 * database, and the first visitor would otherwise meet "no such table: users".
 * Two switches, both off by default so a real deployment stays deliberate:
 *
 *   AUTO_PUSH_SCHEMA=1   create the tables if they are missing *and* add any
 *                        columns this build expects but the database has not got
 *   DEMO_AUTOSEED=1      ...and, if the database has no accounts at all, load
 *                        seed/demo.sql so the demo day is there on first load
 *
 * The second half of the first switch is the important one, and it is the bug
 * this file used to have: the schema push only ran when `users` was *missing*, so
 * a demo database created before a new column (flights, hide_board) booted with
 * the column absent and every page that read it threw `no such column`. Now the
 * additive reconciliation runs on every boot - it reads `PRAGMA table_info`
 * first, so an up-to-date database costs a few cheap queries and writes nothing.
 *
 * Both switches are safe to leave on for a demo: neither ever deletes anything,
 * which is why "reset the demo" is still an explicit `turso db shell < seed/demo.sql`
 * rather than something a restart can do.
 */

export type EnsureResult = {
  /** What was done, for the log line at boot. */
  action: "nothing" | "schema" | "schema+seed";
  /** Rows in `players` afterwards, or null if the database could not be read. */
  players: number | null;
  /** Columns added to bring an existing database up to date. */
  addedColumns?: string[];
  /** Columns this build expects that are still missing (empty is the good case). */
  missingColumns?: string[];
  /** Set when the database could not be reached, or the schema is behind. */
  error?: string;
};

const flag = (name: string) => process.env[name] === "1" || process.env[name]?.toLowerCase() === "true";

async function hasSchema(): Promise<boolean> {
  try {
    await client.execute("select 1 from users limit 1");
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A missing table is the expected case; anything else (bad URL, bad token)
    // is a configuration problem and must not be mistaken for "empty database".
    if (/no such table/i.test(message)) return false;
    throw err;
  }
}

async function userCount(): Promise<number> {
  const res = await client.execute("select count(*) as n from users");
  return Number(res.rows[0]?.n ?? 0);
}

async function playerCount(): Promise<number> {
  const res = await client.execute("select count(*) as n from players");
  return Number(res.rows[0]?.n ?? 0);
}

/** Applies `seed/demo.sql` (committed, so it is there at runtime). */
export async function seedDemo(): Promise<number> {
  const file = path.join(process.cwd(), "seed", "demo.sql");
  const sql = readFileSync(file, "utf8");
  await applySql(client, sql);
  return playerCount();
}

export async function ensureDatabase(): Promise<EnsureResult> {
  const pushAllowed = flag("AUTO_PUSH_SCHEMA") || flag("DEMO_AUTOSEED");
  let actions: EnsureResult["action"] = "nothing";
  const addedColumns: string[] = [];

  try {
    const ready = await hasSchema();

    if (pushAllowed) {
      // Always: `CREATE TABLE IF NOT EXISTS` costs a few milliseconds on a
      // database that is current, and it covers a half-created one too. The
      // second half of the push is the column reconciliation, which is what
      // stops "the app boots, then every page 500s" on a database created by an
      // older build.
      const { statements, added } = await pushSchemaDetailed();
      if (!ready) {
        console.log(`[bootstrap] schema applied (${statements} statements) to ${process.env.DATABASE_URL ?? "the local file"}`);
        actions = "schema";
      }
      if (added.length > 0) {
        console.log(`[bootstrap] upgraded an existing database: added ${added.join(", ")}`);
        actions = "schema";
        addedColumns.push(...added);
      }
    }

    const missing = await missingColumns(client);
    if (!ready && !pushAllowed) {
      // Nothing was allowed to be created, so report what a visitor would see.
      return {
        action: "nothing",
        players: null,
        addedColumns,
        missingColumns: missing,
        error: "schema not applied - run `npm run db:push`",
      };
    }
    if (missing.length > 0) {
      // Reachable, but this build needs columns the database has not got. Say so
      // in plain words at boot rather than letting it surface as a 500 later.
      return {
        action: actions,
        players: await playerCount().catch(() => null),
        addedColumns,
        missingColumns: missing,
        error: `schema is behind this build - missing ${missing.join(", ")}. Run \`npm run db:push\` against this database.`,
      };
    }

    if (flag("DEMO_AUTOSEED") && (await userCount()) === 0) {
      const players = await seedDemo();
      console.log(`[bootstrap] database was empty - loaded seed/demo.sql (${players} players)`);
      return { action: "schema+seed", players, addedColumns, missingColumns: [] };
    }

    return { action: actions, players: await playerCount(), addedColumns, missingColumns: [] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never take the server down over this: the app still serves, and
    // /api/health explains what is wrong.
    return { action: actions, players: null, error: message };
  }
}
