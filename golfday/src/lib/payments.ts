/**
 * Entry fees. Organisers set a fee per event (in the games settings); players
 * pay through Stripe Checkout when STRIPE_SECRET_KEY is set, and organisers can
 * always mark someone as paid by hand (cash in the clubhouse is still normal).
 *
 * Stripe is called over its REST API with fetch, so there is no SDK to install.
 * No webhook is needed: Checkout redirects back to /payments/confirm, which
 * re-reads the session from Stripe before marking the entry paid.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPayments } from "@/db/schema";
import { ApiError } from "./http";
import { newId } from "./ids";

const STRIPE_API = "https://api.stripe.com/v1";

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function formatPence(pence: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: pence % 100 === 0 ? 0 : 2,
  }).format(pence / 100);
}

export async function listPayments(eventId: string) {
  return db.select().from(eventPayments).where(eq(eventPayments.eventId, eventId));
}

export async function getPayment(eventId: string, playerId: string) {
  const [row] = await db
    .select()
    .from(eventPayments)
    .where(and(eq(eventPayments.eventId, eventId), eq(eventPayments.playerId, playerId)))
    .limit(1);
  return row ?? null;
}

async function upsertPayment(
  eventId: string,
  playerId: string,
  values: {
    status: "PENDING" | "PAID";
    method: "MANUAL" | "STRIPE";
    amountPence: number;
    stripeSessionId?: string | null;
    paidAt?: string | null;
  },
) {
  const now = new Date().toISOString();
  const set = { ...values, updatedAt: now };
  await db
    .insert(eventPayments)
    .values({ id: newId(), eventId, playerId, ...set })
    .onConflictDoUpdate({ target: [eventPayments.eventId, eventPayments.playerId], set });
}

/** Organiser override: mark paid (cash/bank transfer) or un-mark. */
export async function setPaidManually(eventId: string, playerId: string, paid: boolean, amountPence: number) {
  if (!paid) {
    await db
      .delete(eventPayments)
      .where(and(eq(eventPayments.eventId, eventId), eq(eventPayments.playerId, playerId)));
    return;
  }
  await upsertPayment(eventId, playerId, {
    status: "PAID",
    method: "MANUAL",
    amountPence,
    paidAt: new Date().toISOString(),
  });
}

async function stripe<T>(path: string, init?: { method?: string; form?: Record<string, string> }): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new ApiError(503, "Online payments aren't set up for this site", "payments_disabled");
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${key}`,
      ...(init?.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: init?.form ? new URLSearchParams(init.form).toString() : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    console.error("[stripe]", res.status, data.error?.message);
    throw new ApiError(502, "The payment provider didn't accept that - try again", "stripe_error");
  }
  return data;
}

type CheckoutSession = {
  id: string;
  url: string | null;
  payment_status: string;
  amount_total: number | null;
  metadata: Record<string, string> | null;
};

/** Starts a Stripe Checkout session for one player's entry; returns the hosted page URL. */
export async function createCheckout(input: {
  eventId: string;
  eventName: string;
  eventSlug: string;
  playerId: string;
  playerName: string;
  feePence: number;
  baseUrl: string;
}): Promise<string> {
  if (input.feePence <= 0) throw new ApiError(409, "This event is free to enter", "no_fee");
  const existing = await getPayment(input.eventId, input.playerId);
  if (existing?.status === "PAID") throw new ApiError(409, "Already paid", "already_paid");

  const session = await stripe<CheckoutSession>("/checkout/sessions", {
    method: "POST",
    form: {
      mode: "payment",
      success_url: `${input.baseUrl}/api/events/${input.eventId}/payments/confirm?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${input.baseUrl}/events/${input.eventSlug}?payment=cancelled`,
      client_reference_id: `${input.eventId}:${input.playerId}`,
      "metadata[eventId]": input.eventId,
      "metadata[playerId]": input.playerId,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "gbp",
      "line_items[0][price_data][unit_amount]": String(input.feePence),
      "line_items[0][price_data][product_data][name]": `Entry: ${input.eventName}`.slice(0, 120),
      "line_items[0][price_data][product_data][description]": `Player: ${input.playerName}`.slice(0, 120),
    },
  });
  if (!session.url) throw new ApiError(502, "The payment provider didn't return a checkout page", "stripe_error");
  await upsertPayment(input.eventId, input.playerId, {
    status: "PENDING",
    method: "STRIPE",
    amountPence: input.feePence,
    stripeSessionId: session.id,
  });
  return session.url;
}

/**
 * Called when Checkout redirects back. Re-reads the session from Stripe (the
 * query string alone proves nothing) and marks the entry paid if it really is.
 */
export async function confirmCheckout(eventId: string, sessionId: string): Promise<boolean> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return false;
  const session = await stripe<CheckoutSession>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  const playerId = session.metadata?.playerId;
  if (session.payment_status !== "paid" || session.metadata?.eventId !== eventId || !playerId) return false;
  await upsertPayment(eventId, playerId, {
    status: "PAID",
    method: "STRIPE",
    amountPence: session.amount_total ?? 0,
    stripeSessionId: session.id,
    paidAt: new Date().toISOString(),
  });
  return true;
}

export async function deleteEventPayments(eventId: string) {
  await db.delete(eventPayments).where(eq(eventPayments.eventId, eventId));
}
