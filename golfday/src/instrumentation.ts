/**
 * Next.js runs this once when the server boots (dev and production), and never
 * during `next build`. We use it to refuse to start a production deployment with
 * a session secret that is missing, short, or a placeholder copied from
 * .env.example - a misconfiguration that would otherwise be silent and would let
 * anybody mint a valid session cookie.
 */
export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { assertAuthSecret } = await import("./lib/session");
  assertAuthSecret();
}
