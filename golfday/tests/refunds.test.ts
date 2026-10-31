/**
 * Stripe refunds. The Stripe API is stubbed with `fetch`, so these tests check
 * the exact request we send (refund against the PaymentIntent, for the right
 * amount, with the right reason) as well as the bookkeeping on our side.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-refunds-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.STRIPE_SECRET_KEY = "sk_test_123";

let payments: typeof import("@/lib/payments");
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let push: typeof import("@/db/push");

const calls: { url: string; body: URLSearchParams }[] = [];
const realFetch = global.fetch;

function stubStripe(response: Record<string, unknown> = { id: "re_1", amount: 2500, status: "succeeded", payment_intent: "pi_1" }) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: new URLSearchParams(String(init?.body ?? "")),
    });
    return new Response(JSON.stringify(response), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

async function seedPayment(values: {
  playerId: string;
  status?: "PENDING" | "PAID";
  method?: "MANUAL" | "STRIPE";
  amountPence?: number;
  stripePaymentIntent?: string | null;
  stripeSessionId?: string | null;
}) {
  const eventId = "evt_test";
  await db.insert(schema.eventPayments).values({
    id: `pay_${values.playerId}`,
    eventId,
    playerId: values.playerId,
    status: values.status ?? "PAID",
    method: values.method ?? "STRIPE",
    amountPence: values.amountPence ?? 2500,
    stripePaymentIntent: values.stripePaymentIntent === undefined ? "pi_1" : values.stripePaymentIntent,
    stripeSessionId: values.stripeSessionId ?? null,
    paidAt: "2027-01-01T00:00:00.000Z",
  });
  return { eventId, playerId: values.playerId };
}

describe("Stripe refunds", () => {
  beforeAll(async () => {
    payments = await import("@/lib/payments");
    db = (await import("@/db/client")).db;
    schema = await import("@/db/schema");
    push = await import("@/db/push");
    await push.pushSchema();
  }, 60_000);

  beforeEach(() => {
    calls.length = 0;
    stubStripe();
  });

  afterAll(() => {
    global.fetch = realFetch;
  });

  it("refunds the whole entry fee against the PaymentIntent", async () => {
    const { eventId, playerId } = await seedPayment({ playerId: "p_full" });
    const outcome = await payments.refundPayment({ eventId, playerId, by: "user_admin" });

    expect(outcome.amountPence).toBe(2500);
    expect(outcome.paymentStatus).toBe("REFUNDED");
    expect(outcome.remainingPence).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.stripe.com/v1/refunds");
    expect(calls[0].body.get("payment_intent")).toBe("pi_1");
    expect(calls[0].body.get("amount")).toBe("2500");
    expect(calls[0].body.get("reason")).toBe("requested_by_customer");
    expect(calls[0].body.get("metadata[eventId]")).toBe(eventId);

    const [row] = await db.select().from(schema.eventPayments).where(eq(schema.eventPayments.playerId, playerId));
    expect(row.status).toBe("REFUNDED");
    expect(row.refundedPence).toBe(2500);
    expect(row.refundedAt).toBeTruthy();

    const ledger = await payments.listRefunds(eventId);
    expect(ledger.some((r) => r.playerId === playerId && r.stripeRefundId === "re_1")).toBe(true);
  });

  it("part-refunds, then refunds the rest, and refuses to over-refund", async () => {
    const { eventId, playerId } = await seedPayment({ playerId: "p_part", amountPence: 3000 });

    const first = await payments.refundPayment({ eventId, playerId, amountPence: 1000, by: "user_admin" });
    expect(first.paymentStatus).toBe("PARTIALLY_REFUNDED");
    expect(first.remainingPence).toBe(2000);
    expect(calls[0].body.get("amount")).toBe("1000");

    await expect(
      payments.refundPayment({ eventId, playerId, amountPence: 2500, by: "user_admin" }),
    ).rejects.toThrow(/Only £20/);
    expect(calls).toHaveLength(1); // nothing was sent to Stripe

    const second = await payments.refundPayment({ eventId, playerId, amountPence: 2000, by: "user_admin" });
    expect(second.paymentStatus).toBe("REFUNDED");
    expect(second.remainingPence).toBe(0);

    await expect(payments.refundPayment({ eventId, playerId, by: "user_admin" })).rejects.toThrow(/already been refunded/);
    const [row] = await db.select().from(schema.eventPayments).where(eq(schema.eventPayments.playerId, playerId));
    expect(row.refundedPence).toBe(3000);
  });

  it("passes the chosen Stripe reason through", async () => {
    const { eventId, playerId } = await seedPayment({ playerId: "p_reason" });
    await payments.refundPayment({ eventId, playerId, reason: "duplicate", by: "user_admin" });
    expect(calls[0].body.get("reason")).toBe("duplicate");
  });

  it("records a cash refund without calling Stripe", async () => {
    const { eventId, playerId } = await seedPayment({ playerId: "p_cash", method: "MANUAL", stripePaymentIntent: null });
    const outcome = await payments.refundPayment({ eventId, playerId, by: "user_admin" });
    expect(calls).toHaveLength(0);
    expect(outcome.amountPence).toBe(2500);
    expect(outcome.refundId).toBe("manual");
    expect(outcome.paymentStatus).toBe("REFUNDED");
  });

  it("recovers a missing PaymentIntent from the Checkout Session", async () => {
    const { eventId, playerId } = await seedPayment({
      playerId: "p_legacy",
      stripePaymentIntent: null,
      stripeSessionId: "cs_test_abc",
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: new URLSearchParams(String(init?.body ?? "")) });
      const payload = url.includes("/checkout/sessions/")
        ? { id: "cs_test_abc", payment_intent: "pi_recovered", payment_status: "paid", amount_total: 2500, metadata: {}, url: null }
        : { id: "re_2", amount: 2500, status: "succeeded", payment_intent: "pi_recovered" };
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    await payments.refundPayment({ eventId, playerId, by: "user_admin" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.stripe.com/v1/checkout/sessions/cs_test_abc",
      "https://api.stripe.com/v1/refunds",
    ]);
    expect(calls[1].body.get("payment_intent")).toBe("pi_recovered");
    const [row] = await db.select().from(schema.eventPayments).where(eq(schema.eventPayments.playerId, playerId));
    expect(row.stripePaymentIntent).toBe("pi_recovered");
  });

  it("will not refund an entry fee that was never paid", async () => {
    const { eventId, playerId } = await seedPayment({ playerId: "p_unpaid", status: "PENDING" });
    await expect(payments.refundPayment({ eventId, playerId, by: "user_admin" })).rejects.toThrow(/not been paid/);
    expect(calls).toHaveLength(0);
  });

  it("reports the total refunded for an event", async () => {
    const { eventId, playerId } = await seedPayment({ playerId: "p_total", amountPence: 4000 });
    const before = await payments.refundedTotal(eventId);
    await payments.refundPayment({ eventId, playerId, amountPence: 500, by: "user_admin" });
    expect((await payments.refundedTotal(eventId)) - before).toBe(500);
  });

  it("turns a Stripe failure into a friendly 502 and leaves the payment alone", async () => {
    const { eventId, playerId } = await seedPayment({ playerId: "p_fail" });
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "charge already refunded" } }), { status: 400 }),
    ) as unknown as typeof fetch;
    await expect(payments.refundPayment({ eventId, playerId, by: "user_admin" })).rejects.toMatchObject({
      status: 502,
    });
    const [row] = await db.select().from(schema.eventPayments).where(eq(schema.eventPayments.playerId, playerId));
    expect(row.status).toBe("PAID");
    expect(row.refundedPence).toBe(0);
  });
});
