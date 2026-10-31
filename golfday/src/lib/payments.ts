/**
 * Entry fees. Organisers set a fee per event (in the games settings); players
 * pay through Stripe Checkout when STRIPE_SECRET_KEY is set, and organisers can
 * always mark someone as paid by hand (cash in the clubhouse is still normal).
 *
 * Stripe is called over its REST API with fetch, so there is no SDK to install.
 * No webhook is needed: Checkout redirects back to /payments/confirm, which
 * re-reads the session from Stripe before marking the entry paid.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPayments, paymentRefunds } from "@/db/schema";
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

export const REFUND_REASONS = ["requested_by_customer", "duplicate", "fraudulent"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** The refund ledger for an event, newest first. */
export async function listRefunds(eventId: string) {
  return db.select().from(paymentRefunds).where(eq(paymentRefunds.eventId, eventId)).orderBy(desc(paymentRefunds.createdAt));
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
    status: "PENDING" | "PAID" | "REFUNDED" | "PARTIALLY_REFUNDED";
    method: "MANUAL" | "STRIPE";
    amountPence: number;
    stripeSessionId?: string | null;
    stripePaymentIntent?: string | null;
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
  payment_intent: string | null;
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
    stripePaymentIntent: session.payment_intent ?? null,
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
    stripePaymentIntent: session.payment_intent ?? null,
    paidAt: new Date().toISOString(),
  });
  return true;
}

type StripeRefund = {
  id: string;
  amount: number;
  status: string;
  payment_intent: string | null;
};

/**
 * Older checkouts were saved without the PaymentIntent id. A refund needs it,
 * so recover it from the Checkout Session the first time it is asked for.
 */
async function paymentIntentForSession(sessionId: string): Promise<string | null> {
  const session = await stripe<CheckoutSession>(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
  return session.payment_intent ?? null;
}

export type RefundOutcome = {
  refundId: string;
  amountPence: number;
  status: string;
  /** What is still refundable afterwards. */
  remainingPence: number;
  paymentStatus: "REFUNDED" | "PARTIALLY_REFUNDED";
};

/**
 * Refund an entry fee, in full or in part, back to the card.
 *
 * Card payments are refunded through Stripe (`POST /v1/refunds` against the
 * entry's PaymentIntent) and the id Stripe returns is kept in the ledger, so a
 * part-refund can be followed by another and the organiser can always see what
 * has gone back. Cash / bank transfers have no card to refund, so those are
 * recorded in the same ledger and marked as returned by hand.
 *
 * The amount is checked against what is left of the payment rather than the
 * entry fee, which makes double-refunds impossible.
 */
export async function refundPayment(input: {
  eventId: string;
  playerId: string;
  /** Omit for a full refund of whatever is left. */
  amountPence?: number | null;
  reason?: RefundReason;
  by: string;
}): Promise<RefundOutcome> {
  const payment = await getPayment(input.eventId, input.playerId);
  if (!payment) throw new ApiError(404, "There is no payment recorded for that player", "no_payment");
  if (payment.status === "REFUNDED") {
    throw new ApiError(409, "That entry fee has already been refunded in full", "already_refunded");
  }
  if (payment.status !== "PAID" && payment.status !== "PARTIALLY_REFUNDED") {
    throw new ApiError(409, "That entry fee has not been paid, so there is nothing to refund", "not_paid");
  }

  const refunded = payment.refundedPence ?? 0;
  const remaining = payment.amountPence - refunded;
  if (remaining <= 0) throw new ApiError(409, "That entry fee has already been refunded in full", "already_refunded");

  const requested = input.amountPence == null ? remaining : Math.round(Number(input.amountPence));
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new ApiError(400, "A refund has to be at least 1p", "bad_amount");
  }
  if (requested > remaining) {
    throw new ApiError(
      400,
      `Only ${formatPence(remaining)} of the ${formatPence(payment.amountPence)} entry fee is left to refund`,
      "refund_too_large",
    );
  }

  const reason: RefundReason = input.reason ?? "requested_by_customer";
  let stripeRefundId: string | null = null;

  if (payment.method === "STRIPE") {
    let paymentIntent = payment.stripePaymentIntent;
    if (!paymentIntent && payment.stripeSessionId) {
      paymentIntent = await paymentIntentForSession(payment.stripeSessionId);
      if (paymentIntent) {
        await db
          .update(eventPayments)
          .set({ stripePaymentIntent: paymentIntent })
          .where(eq(eventPayments.id, payment.id));
      }
    }
    if (!paymentIntent) {
      throw new ApiError(
        409,
        "Stripe has no card payment on file for this entry - refund it in the Stripe dashboard, then mark it refunded here",
        "no_payment_intent",
      );
    }
    const refund = await stripe<StripeRefund>("/refunds", {
      method: "POST",
      form: {
        payment_intent: paymentIntent,
        amount: String(requested),
        reason,
        "metadata[eventId]": input.eventId,
        "metadata[playerId]": input.playerId,
        "metadata[refundedBy]": input.by,
      },
    });
    stripeRefundId = refund.id;
  }

  const now = new Date().toISOString();
  const totalRefunded = refunded + requested;
  const paymentStatus = totalRefunded >= payment.amountPence ? "REFUNDED" : "PARTIALLY_REFUNDED";

  await db.insert(paymentRefunds).values({
    id: newId(),
    paymentId: payment.id,
    eventId: input.eventId,
    playerId: input.playerId,
    amountPence: requested,
    status: "SUCCEEDED",
    stripeRefundId,
    reason,
    createdBy: input.by,
  });

  await db
    .update(eventPayments)
    .set({
      status: paymentStatus,
      refundedPence: totalRefunded,
      refundedAt: now,
      updatedAt: now,
    })
    .where(eq(eventPayments.id, payment.id));

  return {
    refundId: stripeRefundId ?? "manual",
    amountPence: requested,
    status: "SUCCEEDED",
    remainingPence: payment.amountPence - totalRefunded,
    paymentStatus,
  };
}

/** Total refunded across an event, for the organiser's summary. */
export async function refundedTotal(eventId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${paymentRefunds.amountPence}), 0)` })
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.eventId, eventId), eq(paymentRefunds.status, "SUCCEEDED")));
  return Number(row?.total ?? 0);
}

export async function deleteEventPayments(eventId: string) {
  await db.delete(eventPayments).where(eq(eventPayments.eventId, eventId));
  await db.delete(paymentRefunds).where(eq(paymentRefunds.eventId, eventId));
}
