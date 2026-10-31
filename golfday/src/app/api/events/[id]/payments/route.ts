import { z } from "zod";
import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { bumpRevision, getEventBundle } from "@/lib/events";
import { getGameSettings } from "@/lib/games";
import { listPayments, listRefunds, refundedTotal, setPaidManually, stripeEnabled } from "@/lib/payments";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function adminOnly(id: string) {
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can see payments", "forbidden");
}

/** Who has paid, for the organiser console. */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await adminOnly(id);
  const [bundle, settings, payments, refunds, refunded] = await Promise.all([
    getEventBundle(id),
    getGameSettings(id),
    listPayments(id),
    listRefunds(id),
    refundedTotal(id),
  ]);
  if (!bundle) throw new ApiError(404, "Event not found", "not_found");
  const byPlayer = new Map(payments.map((p) => [p.playerId, p]));
  const rows = bundle.registrations
    .filter((r) => r.registration.status === "REGISTERED")
    .map(({ player }) => {
      const p = byPlayer.get(player.id);
      return {
        playerId: player.id,
        name: player.name,
        status: p?.status ?? "UNPAID",
        method: p?.method ?? null,
        amountPence: p?.amountPence ?? 0,
        refundedPence: p?.refundedPence ?? 0,
        refundedAt: p?.refundedAt ?? null,
        // The PaymentIntent id stays server-side; the console only needs to know
        // whether a card refund is possible.
        refundableByCard: Boolean(p?.stripePaymentIntent && p?.method === "STRIPE"),
        paidAt: p?.paidAt ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  // Money actually in the bank: what was taken, less everything refunded.
  const collected = rows
    .filter((r) => r.status === "PAID" || r.status === "PARTIALLY_REFUNDED" || r.status === "REFUNDED")
    .reduce((sum, r) => sum + r.amountPence - r.refundedPence, 0);
  return json({
    feePence: settings.entryFeePence,
    stripeEnabled: stripeEnabled(),
    collectedPence: collected,
    refundedPence: refunded,
    rows,
    refunds,
  });
});

const markSchema = z.object({ playerId: z.string().min(1), paid: z.boolean() });

/** Organiser marks a player paid (cash, bank transfer) or unpaid. */
export const PUT = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  await adminOnly(id);
  const body = validate(markSchema, await parseJson(request));
  const [bundle, settings] = await Promise.all([getEventBundle(id), getGameSettings(id)]);
  if (!bundle?.registrations.some((r) => r.player.id === body.playerId)) {
    throw new ApiError(404, "That player isn't entered in this event", "player_not_registered");
  }
  await setPaidManually(id, body.playerId, body.paid, settings.entryFeePence);
  await bumpRevision(id);
  return json({ ok: true });
});
