import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "file:./data/golfday.db";
const authToken = process.env.DATABASE_AUTH_TOKEN;

const globalForDb = globalThis as unknown as { _golfdayClient?: Client };

export const client: Client =
  globalForDb._golfdayClient ?? createClient(authToken ? { url, authToken } : { url });

if (process.env.NODE_ENV !== "production") globalForDb._golfdayClient = client;

export const db: LibSQLDatabase<typeof schema> = drizzle(client, { schema });
export { schema };
