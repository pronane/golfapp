import { readFileSync } from "node:fs";
import path from "node:path";
import { client } from "./client";

/** Splits the DDL file into statements and runs them one by one (idempotent). */
export async function pushSchema() {
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
  return statements.length;
}

if (process.argv[1]?.endsWith("push.ts") || process.argv[1]?.endsWith("db-push.ts")) {
  pushSchema()
    .then((n) => console.log(`✅ schema applied (${n} statements) to ${process.env.DATABASE_URL ?? "file:./data/golfday.db"}`))
    .catch((err) => {
      console.error("❌ schema push failed", err);
      process.exit(1);
    });
}
