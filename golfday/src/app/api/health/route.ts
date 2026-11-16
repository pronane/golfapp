import { client } from "@/db/client";
import { missingColumns, reconcileColumns } from "@/db/reconcile";

export const dynamic = "force-dynamic";

/**
 * A deployable-instance check, for two audiences:
 *
 *  - a hosting platform's health check (Render's blueprint in render.yaml points
 *    at this, and Vercel can as well), and
 *  - whoever just deployed, who needs to know *which* half is broken: the app
 *    answering but the database unreachable, or the database reachable but still
 *    empty because nobody ran `npm run db:push`.
 *
 * Deliberately public and deliberately boring: no session, no secrets, counts
 * only. It must never be the reason a health check fails a deploy, so a broken
 * database returns 503 with a readable reason rather than throwing.
 */
export async function GET() {
  const started = Date.now();
  let db: "up" | "down" = "up";
  let schema: "ready" | "empty" | "behind" | "unknown" = "unknown";
  let players: number | null = null;
  let reason: string | null = null;
  let missing: string[] = [];

  try {
    await client.execute("select 1");
  } catch (err) {
    db = "down";
    reason = err instanceof Error ? err.message : String(err);
  }

  if (db === "up") {
    try {
      // The demo is only useful if somebody has pushed the schema; an empty
      // database shows "no such table" here and a friendly "run db:push" below.
      // (`AUTO_PUSH_SCHEMA=1` / `DEMO_AUTOSEED=1` make the app do that itself at
      // boot - see src/lib/bootstrap.ts.)
      const res = await client.execute("select count(*) as n from players");
      players = Number(res.rows[0]?.n ?? 0);
      schema = players > 0 ? "ready" : "empty";

      // A database can be reachable, seeded and still missing a column this
      // build needs - that is what made a fresh deployment throw `no such
      // column: "flights"` on every page. Checking is a few PRAGMA reads, and
      // AUTO_PUSH_SCHEMA repairs it here rather than leaving it for a 500.
      missing = await missingColumns(client);
      if (missing.length > 0 && (process.env.AUTO_PUSH_SCHEMA === "1" || process.env.DEMO_AUTOSEED === "1")) {
        const { applied } = await reconcileColumns(client);
        if (applied.length > 0) console.warn(`[health] repaired schema drift: ${applied.join(", ")}`);
        missing = await missingColumns(client);
      }
      if (missing.length > 0) {
        schema = "behind";
        reason = `schema is behind this build - missing ${missing.join(", ")}; run \`npm run db:push\` against this database`;
      }
    } catch {
      schema = "empty";
      reason = "schema not applied - run `npm run db:push` against this database";
    }
  }

  // `ok` is what a human wants to read; the status code is what a platform's
  // health check wants. The app *is* serving when the database is reachable but
  // empty - that is a "run db:push" problem, not a dead deployment - so only an
  // unreachable database is a 503.
  const ok = db === "up" && schema === "ready";
  return Response.json(
    {
      ok,
      db,
      schema,
      players,
      reason,
      // Empty is the good case. Named columns make a stale deployment obvious.
      missingColumns: missing,
      ms: Date.now() - started,
      // Which build answered: handy when a platform shows an old deployment.
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? null,
      time: new Date().toISOString(),
    },
    { status: db === "up" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
