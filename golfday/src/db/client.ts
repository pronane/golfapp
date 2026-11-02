import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { withSelfHealing } from "./selfHeal";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./data/golfday.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

/**
 * A `file:` URL needs its directory to exist before libSQL will open it, and a
 * fresh clone has no `data/` (the file itself is gitignored). Creating it here
 * keeps "clone, npm ci, npm run db:reset" working without a setup step.
 */
if (url.startsWith("file:")) {
  const file = url.slice("file:".length).replace(/^\/\//, "");
  const dir = path.dirname(file);
  if (dir && dir !== "." && dir !== "/") mkdirSync(dir, { recursive: true });
}

const globalForDb = globalThis as unknown as { _golfdayClient?: Client };

/**
 * `withSelfHealing` is a no-op unless AUTO_PUSH_SCHEMA / DEMO_AUTOSEED is on. When
 * it is on, a query that names a column the database has not got yet repairs the
 * schema and retries once, instead of taking the page down - see ./selfHeal.ts.
 */
export const client: Client =
  globalForDb._golfdayClient ??
  withSelfHealing(createClient(authToken ? { url, authToken } : { url }));

if (process.env.NODE_ENV !== "production") globalForDb._golfdayClient = client;

export const db: LibSQLDatabase<typeof schema> = drizzle(client, { schema });
export { schema };
