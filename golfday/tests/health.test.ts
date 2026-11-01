/**
 * The deploy check.
 *
 * `GET /api/health` is what tells a freshly deployed instance apart from a
 * freshly deployed instance with no schema: the first answer to "I published it
 * and the site is empty" should be a JSON body, not a stack trace. It is also
 * what the Render blueprint watches, so it has to answer without a session.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-health-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

let health: typeof import("@/app/api/health/route");
let push: typeof import("@/db/push");
let client: typeof import("@/db/client").client;

beforeAll(async () => {
  [health, push] = await Promise.all([import("@/app/api/health/route"), import("@/db/push")]);
  client = (await import("@/db/client")).client;
}, 60_000);

describe("GET /api/health", () => {
  it("says the database is reachable but the schema is not applied yet", async () => {
    const res = await health.GET();
    const body = await res.json();
    // Reachable, so the deployment is serving - not a 503 for a platform.
    expect(res.status).toBe(200);
    expect(body.db).toBe("up");
    expect(body.schema).toBe("empty");
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/db:push/);
  });

  it("reports ready once the schema is there and somebody has seeded it", async () => {
    await push.pushSchema();
    await client.execute({
      sql: "insert into players (id, name, handicap_index, claim_code, handicap_source, created_at) values (?, ?, ?, ?, ?, ?)",
      args: ["p-health-1", "Health Check", 12.4, "HEALTH1", "MANUAL", new Date().toISOString()],
    });

    const res = await health.GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, db: "up", schema: "ready", players: 1 });
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Counts only: never a player name, an email or a secret.
    expect(JSON.stringify(body)).not.toMatch(/Health Check|@/);
  });
});
