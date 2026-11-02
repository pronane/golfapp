/**
 * The runtime safety net.
 *
 * Boot-time reconciliation fixes a database that is behind when the process
 * starts. This covers the rest: a column added while the service was asleep, a
 * rollback, two builds serving during a deploy. When AUTO_PUSH_SCHEMA is on, a
 * query that fails with `no such column` heals the schema and retries once
 * instead of taking the page down; everything else is rethrown untouched, and a
 * deployment that manages its own schema never gets altered behind its back.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { createClient, type Client } from "@libsql/client";
import { tmpdir } from "node:os";
import path from "node:path";
import { withSelfHealing } from "@/db/selfHeal";
import { missingColumns, reconcileColumns } from "@/db/reconcile";

const scratch = () => createClient({ url: `file:${path.join(mkdtempSync(path.join(tmpdir(), "golfday-heal-")), "t.db")}` });

const setFlag = (on: boolean) => {
  if (on) process.env.AUTO_PUSH_SCHEMA = "1";
  else delete process.env.AUTO_PUSH_SCHEMA;
  delete process.env.DEMO_AUTOSEED;
};

/** An `event_settings` table as it looked before `flights` and `hide_board` existed. */
async function oldEventSettings(c: Client) {
  await c.execute("create table event_settings (event_id text primary key, skins text)");
  await c.execute("insert into event_settings (event_id, skins) values ('e1', 'OFF')");
}

describe("a query that names a column the database has not got", () => {
  it("is repaired and retried when AUTO_PUSH_SCHEMA is on", async () => {
    setFlag(true);
    const base = scratch();
    await oldEventSettings(base);
    expect(await missingColumns(base)).toContain("event_settings.flights");

    const client = withSelfHealing(base);
    const res = await client.execute("select flights, hide_board from event_settings");

    expect(res.rows).toHaveLength(1);
    expect(Number(res.rows[0].flights)).toBe(0);
    expect(Number(res.rows[0].hide_board)).toBe(0);
    // and the repair really happened in the database, not just in this query
    expect((await missingColumns(base)).filter((entry) => entry.startsWith("event_settings."))).toEqual([]);
    setFlag(false);
  });

  it("is left exactly as it is when the switch is off", async () => {
    setFlag(false);
    const base = scratch();
    await oldEventSettings(base);
    const client = withSelfHealing(base);
    await expect(client.execute("select flights from event_settings")).rejects.toThrow(/no such column/i);
    expect(await missingColumns(base)).toContain("event_settings.flights");
  });

  it("does not disguise a different error", async () => {
    setFlag(true);
    const base = scratch();
    await oldEventSettings(base);
    const client = withSelfHealing(base);
    await expect(client.execute("select * from table_that_does_not_exist")).rejects.toThrow(/no such table/i);
    setFlag(false);
  });

  it("is a no-op on a database that is already current", async () => {
    setFlag(true);
    const base = scratch();
    await base.execute(
      "create table event_settings (event_id text primary key, flights integer not null default 0, hide_board integer not null default 0)",
    );
    const client = withSelfHealing(base);
    const res = await client.execute("select flights from event_settings");
    expect(res.rows).toHaveLength(0);
    setFlag(false);
  });
});

describe("reconcileColumns", () => {
  it("adds only what is missing, and nothing twice", async () => {
    setFlag(false);
    const base = scratch();
    await oldEventSettings(base);

    const first = await reconcileColumns(base);
    expect(first.applied).toEqual(expect.arrayContaining(["event_settings.flights", "event_settings.hide_board"]));

    const second = await reconcileColumns(base);
    expect(second.applied).toEqual([]);
  });

  it("leaves a table that does not exist to the schema push", async () => {
    const base = scratch();
    const result = await reconcileColumns(base);
    expect(result.applied).toEqual([]);
    expect(result.tablesSeen).toBe(false);
  });
});
