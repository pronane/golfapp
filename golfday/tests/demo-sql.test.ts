/**
 * `seed/demo.sql` - the demo database as one file.
 *
 * Turso can only be created from a `.db` file or a SQL dump, so the repository
 * carries the dump (git can diff it; a committed binary cannot). This test is
 * what keeps it honest: it builds a dump, replays it into a second database, and
 * checks the result is the same data - and that the columns in the file match
 * the tables in `schema.sql`, which is the way a stale dump actually fails.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-demodump-"));
process.env.DATABASE_URL = `file:${path.join(dir, "source.db")}`;

let demo: typeof import("@/lib/demoSql");
let push: typeof import("@/db/push");
let source: Client;
let target: Client;
let sql: string;

beforeAll(async () => {
  [demo, push] = await Promise.all([import("@/lib/demoSql"), import("@/db/push")]);
  source = createClient({ url: `file:${path.join(dir, "source.db")}` });
  await push.pushSchema();
  // a little data with the awkward bits: a quote in a name, a null, a float
  await source.execute(
    "insert into users (id, email, name, password_hash, is_site_admin) values ('u1', 'o''brien@example.com', 'O''Brien', 'hash', 1)",
  );
  await source.execute(
    "insert into players (id, user_id, name, handicap_index, claim_code, handicap_source) values ('p1', 'u1', 'Sean O''Brien', 12.4, 'CLAIM1', 'MANUAL')",
  );
  const dump = await demo.buildDemoDump(source);
  sql = dump.sql;
  target = createClient({ url: `file:${path.join(dir, "target.db")}` });
  // something that must not survive the import
  await target.execute("create table users (id text primary key, email text)");
  await target.execute("insert into users values ('stale', 'old@example.com')");
  await demo.applySql(target, sql);
}, 120_000);

describe("seed/demo.sql", () => {
  it("rebuilds every demo table from the schema in the file", async () => {
    for (const table of demo.DEMO_TABLES) {
      const res = await target.execute(`select count(*) as n from ${table}`);
      expect(res.rows.length, `${table} missing`).toBe(1);
    }
  });

  it("carries the rows across, quotes and all", async () => {
    const row = (await target.execute("select name, handicap_index, claim_code from players where id = 'p1'")).rows[0];
    expect(row.name).toBe("Sean O'Brien");
    expect(Number(row.handicap_index)).toBeCloseTo(12.4);
    expect(row.claim_code).toBe("CLAIM1");
  });

  it("leaves no sign of what used to be in the target database", async () => {
    const stale = await target.execute("select count(*) as n from users where id = 'stale'");
    expect(Number(stale.rows[0].n)).toBe(0);
  });

  it("has the refund columns, so an imported file matches a pushed schema", async () => {
    // The failure this guards against: a dump generated before a column was
    // added, replayed into a database built from today's schema.sql.
    const columns = (await target.execute("pragma table_info(event_payments)")).rows.map((r) => r.name);
    expect(columns).toEqual(expect.arrayContaining(["stripe_payment_intent", "refunded_pence", "refunded_at"]));
    const settings = (await target.execute("pragma table_info(event_settings)")).rows.map((r) => r.name);
    expect(settings).toContain("payment_mode");
  });

  it("is safe to run twice - the second run leaves the same demo day", async () => {
    await demo.applySql(target, sql);
    const res = await target.execute("select count(*) as n from players");
    expect(Number(res.rows[0].n)).toBe(1);
  });
});
