/**
 * The production-shaped check: an app that is newer than its database.
 *
 *   npm run e2e:upgrade
 *
 * On 2 November the live demo booted, printed "Available at your primary URL",
 * and then threw `no such column: "flights"` on every page, because the schema
 * push only ran on an *empty* database. Every other test starts from a fresh
 * database, so none of them could see it.
 *
 * This one starts from a database that looks like that demo's: the demo day is
 * in it, `event_settings` has no `flights` / `hide_board`, and `mail_outbox` does
 * not exist. Then it does what a deploy does - boots the built app with
 * AUTO_PUSH_SCHEMA=1 - and asserts:
 *
 *   1. the boot adds the missing columns instead of reporting success and 500ing
 *   2. the pages that were failing (/events, the board, the CSV export) answer 200
 *   3. /api/health reports the repair rather than claiming everything is fine
 *   4. a database that drifts *while the app is running* is repaired on the first
 *      query that needs the column, not on the next restart
 *
 * Like the other harnesses it owns its database file and its port, and needs a
 * `npm run build` first.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.E2E_UPGRADE_PORT ?? 3213);
const base = `http://127.0.0.1:${port}`;
const dbFile = path.join(root, "data", "e2e-upgrade.db");
const env = {
  ...process.env,
  DATABASE_URL: `file:${dbFile}`,
  // The whole point: a demo deployment with the switch on, which is what
  // render.yaml ships.
  AUTO_PUSH_SCHEMA: "1",
  DEMO_AUTOSEED: "0",
  AUTH_SECRET: process.env.AUTH_SECRET || "e2e-only-secret-0123456789abcdefghijkl",
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
};

let checks = 0;
const failures = [];
const check = (ok, message) => {
  checks += 1;
  if (ok) console.log(`  ✓ ${message}`);
  else {
    failures.push(message);
    console.log(`  ✗ ${message}`);
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, url, { cookie, text = false } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });
  const body = text ? await res.text() : await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

/** The demo day, in a database from before `flights` and `hide_board` existed. */
async function buildStaleDatabase() {
  mkdirSync(path.join(root, "data"), { recursive: true });
  rmSync(dbFile, { force: true });
  const client = createClient({ url: `file:${dbFile}` });
  await client.executeMultiple(readFileSync(path.join(root, "seed", "demo.sql"), "utf8"));
  await client.execute("alter table event_settings drop column flights");
  await client.execute("alter table event_settings drop column hide_board");
  await client.execute("drop table if exists mail_outbox");
  const columns = (await client.execute("pragma table_info(event_settings)")).rows.map((row) => String(row.name));
  check(!columns.includes("flights") && !columns.includes("hide_board"), "prepared a database that predates the new columns");
  await client.close();
}

async function startServer() {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (chunk) => {
    log += String(chunk);
    if (process.env.E2E_VERBOSE) process.stdout.write(`  · ${chunk}`);
  });
  child.stderr.on("data", (chunk) => {
    log += String(chunk);
    if (process.env.E2E_VERBOSE) process.stderr.write(`  · ${chunk}`);
  });
  for (let i = 0; i < 120; i += 1) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return { child, log: () => log };
    } catch {
      /* not up yet */
    }
    await wait(500);
  }
  child.kill("SIGKILL");
  throw new Error("the app did not come up in 60s");
}

async function signIn() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "admin@golfday.app", password: "golfday123" }),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error(`sign-in failed (${res.status})`);
  return cookie;
}

async function main() {
  if (!existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.error("✗ no build found - run `npm run build` first");
    process.exit(1);
  }

  console.log("\nStale database");
  await buildStaleDatabase();

  console.log("\nBooting the built app against it");
  const server = await startServer();
  let exitCode = 0;
  try {
    const health = await call("GET", "/api/health");
    check(health.status === 200, `health answered ${health.status}`);
    check(health.body?.schema === "ready", `health says the schema is ${health.body?.schema}, expected ready`);
    check(Array.isArray(health.body?.missingColumns) && health.body.missingColumns.length === 0, "health lists no missing columns");
    check(health.body?.ok === true, "health says ok");
    check(/upgraded an existing database/.test(server.log()), "the boot log says it upgraded the database");

    // The pages from the stack trace.
    const events = await call("GET", "/events", { text: true });
    check(events.status === 200, `/events answered ${events.status}`);
    check(!/no such column/i.test(events.body), "the events page did not mention a missing column");

    const cookie = await signIn();
    const list = await call("GET", "/api/events?scope=admin", { cookie });
    const eventId = list.body?.events?.[0]?.event?.id;
    check(Boolean(eventId), "signed in and found a golf day");

    const leaderboard = await call("GET", `/api/events/${eventId}/leaderboard`);
    check(leaderboard.status === 200, `the leaderboard answered ${leaderboard.status}`);
    const exported = await call("GET", `/api/events/${eventId}/export`, { cookie, text: true });
    check(exported.status === 200, `the CSV export answered ${exported.status}`);

    const client = createClient({ url: `file:${dbFile}` });
    const columns = (await client.execute("pragma table_info(event_settings)")).rows.map((row) => String(row.name));
    check(columns.includes("flights") && columns.includes("hide_board"), "the columns are in the database now");
    const outbox = await client.execute("select count(*) as n from sqlite_master where type = 'table' and name = 'mail_outbox'");
    check(Number(outbox.rows[0].n) === 1, "the mail_outbox table was created too");
    const rows = await client.execute("select count(*) as n from players");
    check(Number(rows.rows[0].n) > 0, "the demo data is still there - the repair did not rebuild anything");

    console.log("\nA database that drifts while the app is running");
    await client.execute("alter table event_settings drop column flights");
    await client.execute("alter table event_settings drop column hide_board");
    // The board and the export both read the game settings row, which is the
    // query that threw `no such column: "flights"` in production.
    const board = await call("GET", `/api/events/${eventId}/leaderboard`);
    check(board.status === 200, `the leaderboard answered ${board.status} after the drift`);
    const afterDrift = await call("GET", "/events", { text: true });
    check(afterDrift.status === 200, `/events answered ${afterDrift.status} after the drift`);
    await wait(500);
    check(/repaired at runtime/.test(server.log()), "the app repaired the schema on the request that needed it");
    const healed = (await client.execute("pragma table_info(event_settings)")).rows.map((row) => String(row.name));
    check(healed.includes("flights"), "the column is back");
    await client.close();
  } catch (err) {
    exitCode = 1;
    console.error("✗", err instanceof Error ? err.message : err);
  } finally {
    server.child.kill("SIGKILL");
  }

  console.log("");
  if (failures.length > 0) {
    console.error(`${failures.length} of ${checks} checks failed:`);
    for (const failure of failures) console.error(`  · ${failure}`);
    process.exit(1);
  }
  console.log(`All ${checks} checks passed.`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
