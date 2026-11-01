/**
 * Turns a seeded database into `seed/demo.sql`, or loads that file into a
 * database (a local file or a free Turso one).
 *
 *   npm run seed:dump                       # regenerate seed/demo.sql from DATABASE_URL
 *   npm run seed:import                     # load seed/demo.sql into DATABASE_URL
 *   npm run seed:import -- --file=other.sql
 *
 * The point is a demo database you can hand to Turso without needing Node on
 * the target or a `.db` file in the repository:
 *
 *   turso db shell golfday-demo < seed/demo.sql
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { client } from "../src/db/client";
import { applySql, buildDemoDump } from "../src/lib/demoSql";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const mode = process.argv[2]?.startsWith("--") ? "dump" : process.argv[2] ?? "dump";
const file = path.resolve(args.file ?? "seed/demo.sql");
const target = process.env.DATABASE_URL ?? "file:./data/golfday.db";

async function dump() {
  const { sql, counts } = await buildDemoDump(client);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, sql);
  const rows = Object.values(counts).reduce((n, c) => n + c, 0);
  const kb = (Buffer.byteLength(sql) / 1024).toFixed(0);
  console.log(`✅ ${path.relative(process.cwd(), file)} - ${rows} rows across ${Object.keys(counts).length} tables (${kb} kB)`);
  console.log(`   apply it with: turso db shell <database> < ${path.relative(process.cwd(), file)}`);
  console.log(`   or locally:    npm run seed:import`);
}

async function load() {
  const sql = readFileSync(file, "utf8");
  console.log(`→ loading ${path.relative(process.cwd(), file)} into ${target} …`);
  await applySql(client, sql);
  const players = await client.execute("select count(*) as n from players");
  const users = await client.execute("select count(*) as n from users");
  console.log(`✅ done - ${users.rows[0]?.n} accounts, ${players.rows[0]?.n} players`);
  console.log("   sign in as admin@golfday.app / sam@golfday.app / priya@golfday.app (password golfday123)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  if (mode === "import" || mode === "load") {
    await load();
  } else if (mode === "dump") {
    await dump();
  } else {
    console.error(`unknown mode "${mode}" - use dump or import`);
    process.exit(1);
  }
  await client.close();
}
