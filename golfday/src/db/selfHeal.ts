import type { Client } from "@libsql/client";
import { isMissingColumnError, reconcileColumns } from "./reconcile";

/**
 * The belt to `bootstrap`'s braces.
 *
 * Even with the boot-time reconciliation, a deployment can meet a database that
 * is behind: a column added while the service was asleep, a rollback, two
 * versions serving at once during a deploy. When that happens the interesting
 * thing is not the stack trace, it is whether the app heals itself.
 *
 * So when `AUTO_PUSH_SCHEMA=1` (or `DEMO_AUTOSEED=1`) is set, the libSQL client
 * is wrapped: a query that fails with `no such column` triggers one reconciliation
 * pass - single-flight, at most every few seconds - and then the query is retried
 * exactly once. Anything else is rethrown untouched, and when the flags are off
 * the client is returned unchanged, so a deployment that manages its own schema
 * is never altered behind its back.
 *
 * Deliberately not wrapped: `transaction()`. Replaying half a transaction is
 * worse than failing it, and every write in this app that touches a new column
 * goes through a single statement.
 */

const enabled = () =>
  process.env.AUTO_PUSH_SCHEMA === "1" ||
  process.env.AUTO_PUSH_SCHEMA?.toLowerCase() === "true" ||
  process.env.DEMO_AUTOSEED === "1" ||
  process.env.DEMO_AUTOSEED?.toLowerCase() === "true";

export type SelfHealState = { attempts: number; healed: string[]; lastError?: string };

export function withSelfHealing(base: Client): Client {
  if (!enabled()) return base;

  const state: SelfHealState = { attempts: 0, healed: [] };
  let inFlight: Promise<boolean> | null = null;
  let lastAttempt = 0;

  async function heal(): Promise<boolean> {
    // Don't hammer a database that is genuinely broken: one attempt per 10s.
    if (Date.now() - lastAttempt < 10_000) return false;
    if (!inFlight) {
      inFlight = (async () => {
        lastAttempt = Date.now();
        state.attempts += 1;
        try {
          const { applied } = await reconcileColumns(base);
          if (applied.length > 0) {
            state.healed.push(...applied);
            console.warn(`[schema] repaired at runtime: ${applied.join(", ")}`);
            return true;
          }
          return false;
        } catch (err) {
          state.lastError = err instanceof Error ? err.message : String(err);
          console.error("[schema] runtime repair failed:", state.lastError);
          return false;
        } finally {
          inFlight = null;
        }
      })();
    }
    return inFlight;
  }

  function wrap<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    return async (...args: A) => {
      try {
        return await fn(...args);
      } catch (err) {
        if (!isMissingColumnError(err)) throw err;
        const repaired = await heal();
        if (!repaired) throw err;
        return await fn(...args);
      }
    };
  }

  return new Proxy(base, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === "execute" || prop === "batch" || prop === "executeMultiple") {
        return wrap(value.bind(target) as (...a: unknown[]) => Promise<unknown>);
      }
      if (typeof value === "function") return value.bind(target);
      return value;
    },
  }) as Client;
}
