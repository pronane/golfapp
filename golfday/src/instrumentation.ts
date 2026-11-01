/**
 * Next.js runs this once when the server boots (dev and production), and never
 * during `next build`. Two jobs:
 *
 *  1. Refuse to start a production deployment with a session secret that is
 *     missing, short, or a placeholder copied from .env.example - a
 *     misconfiguration that would otherwise be silent and would let anybody mint
 *     a valid session cookie.
 *  2. Optionally get the database ready (see lib/bootstrap.ts): create the
 *     tables on a fresh database, and - on a demo deployment - load the demo day
 *     the first time, so a new host needs nothing but three env vars.
 */
export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { assertAuthSecret } = await import("./lib/session");
  assertAuthSecret();

  const { ensureDatabase } = await import("./lib/bootstrap");
  const result = await ensureDatabase();
  if (result.error) console.warn(`[bootstrap] ${result.error}`);
  else if (result.action !== "nothing") console.log(`[bootstrap] ${result.action} - ${result.players} players`);
}
