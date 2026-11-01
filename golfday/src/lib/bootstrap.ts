import { readFileSync } from "node:fs";
import path from "node:path";
import { client } from "@/db/client";
import { pushSchema } from "@/db/push";
import { applySql } from "@/lib/demoSql";

/**
 * Makes a fresh deployment work with nothing but three environment variables.
 *
 * On the free hosts this app targets, a new service is usually pointed at a new
 * database, and the first visitor would otherwise meet "no such table: users".
 * Two switches, both off by default so a real deployment stays deliberate:
 *
 *   AUTO_PUSH_SCHEMA=1   create the tables if they are missing
 *   DEMO_AUTOSEED=1      ...and, if the database has no accounts at all, load
 *                        seed/demo.sql so the demo day is there on first load
 *
 * Both are safe to leave on for a demo: the schema push is idempotent, and the
 * seed only fires on an empty database. Neither ever deletes anything, which is
 * why "reset the demo" is still an explicit `turso db shell < seed/demo.sql`
 * rather than something a restart can do.
 */

export type EnsureResult = {
  /** What was done, for the log line at boot. */
  action: "nothing" | "schema" | "schema+seed";
  /** Rows in `players` afterwards, or null if the database could not be read. */
  players: number | null;
  /** Set when the database could not be reached at all. */
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

  try {
    let ready = await hasSchema();
    if (!ready && pushAllowed) {
      const statements = await pushSchema();
      console.log(`[bootstrap] schema applied (${statements} statements) to ${process.env.DATABASE_URL ?? "the local file"}`);
      actions = "schema";
      ready = await hasSchema();
    }
    if (!ready) {
      // Nothing was allowed to be created, so report what a visitor would see.
      return { action: "nothing", players: null, error: "schema not applied - run `npm run db:push`" };
    }

    if (flag("DEMO_AUTOSEED") && (await userCount()) === 0) {
      const players = await seedDemo();
      console.log(`[bootstrap] database was empty - loaded seed/demo.sql (${players} players)`);
      return { action: "schema+seed", players };
    }

    return { action: actions, players: await playerCount() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never take the server down over this: the app still serves, and
    // /api/health explains what is wrong.
    return { action: actions, players: null, error: message };
  }
}
