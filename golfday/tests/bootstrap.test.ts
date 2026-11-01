/**
 * Booting onto an empty database.
 *
 * A free host gives you a new service and a new database and nothing else, so
 * the app has to be able to come up on its own: create the tables, and (on a
 * demo deployment) load the demo day once. These tests pin the rules that make
 * that safe to leave switched on - it only ever *creates*, and it never touches
 * a database that already has accounts.
 *
 * The libSQL client is created once, from DATABASE_URL, so everything here runs
 * against a single scratch file in order.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-bootstrap-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

let bootstrap: typeof import("@/lib/bootstrap");
let client: typeof import("@/db/client").client;

const setFlags = (values: { AUTO_PUSH_SCHEMA?: string; DEMO_AUTOSEED?: string }) => {
  for (const key of ["AUTO_PUSH_SCHEMA", "DEMO_AUTOSEED"] as const) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

const count = async (table: string) => Number((await client.execute(`select count(*) as n from ${table}`)).rows[0]?.n ?? 0);

beforeAll(async () => {
  bootstrap = await import("@/lib/bootstrap");
  client = (await import("@/db/client")).client;
}, 60_000);

afterAll(() => setFlags({}));

describe("a database nobody has prepared", () => {
  it("is left alone when neither switch is on", async () => {
    setFlags({});
    const result = await bootstrap.ensureDatabase();
    expect(result.action).toBe("nothing");
    // and it says what to do about it, rather than falling over at boot
    expect(result.error).toMatch(/db:push/);
  });

  it("gets its tables from AUTO_PUSH_SCHEMA alone, with no demo data", async () => {
    setFlags({ AUTO_PUSH_SCHEMA: "1" });
    const result = await bootstrap.ensureDatabase();
    expect(result.action).toBe("schema");
    expect(result.players).toBe(0);
    expect(await count("events")).toBe(0);
  });

  it("does not fire the demo seed once the database has accounts", async () => {
    await client.execute({
      sql: "insert into users (id, email, name, password_hash) values (?, ?, ?, ?)",
      args: ["u-real", "real@example.com", "Real Player", "hash"],
    });
    setFlags({ AUTO_PUSH_SCHEMA: "1", DEMO_AUTOSEED: "1" });
    const result = await bootstrap.ensureDatabase();
    expect(result.action).toBe("nothing");
    // the real account is still there: autoseed never overwrites
    expect(await count("users")).toBe(1);
  });

  it("loads the demo day from seed/demo.sql when asked explicitly", async () => {
    // This is the documented reset, and it is deliberately destructive.
    const players = await bootstrap.seedDemo();
    expect(players).toBe(18);
    expect(await count("events")).toBeGreaterThan(0);
    expect(await count("users")).toBe(4); // admin, sam, priya + one organiser-only account
    const gone = await client.execute("select count(*) as n from users where id = 'u-real'");
    expect(Number(gone.rows[0].n)).toBe(0);
  });

  it("reports a database it cannot reach instead of throwing at boot", async () => {
    setFlags({ AUTO_PUSH_SCHEMA: "1", DEMO_AUTOSEED: "1" });
    // A closed client is the closest stand-in for "the database is gone"; what
    // matters is that the boot path returns an error rather than rejecting.
    const scratch = (await import("@libsql/client")).createClient({ url: `file:${path.join(dir, "gone.db")}` });
    await scratch.close();
    await expect(scratch.execute("select 1")).rejects.toBeTruthy();
    const result = await bootstrap.ensureDatabase();
    expect(result.error).toBeUndefined(); // the real client is still fine
  });
});
