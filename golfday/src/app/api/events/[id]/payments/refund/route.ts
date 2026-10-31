import { z } from "zod";
import { ApiError, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { bumpRevision } from "@/lib/events";
import { REFUND_REASONS, refundPayment, stripeEnabled } from "@/lib/payments";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const refundSchema = z.object({
  playerId: z.string().min(1),
  /** Omit (or null) to refund whatever is left of the entry fee. */
  amountPence: z.coerce.number().int().min(1).max(50_000).nullable().optional(),
  reason: z.enum(REFUND_REASONS).optional(),
});

/**
 * Refund an entry fee - full or partial.
 *
 * Card payments go back through Stripe (`POST /v1/refunds`) and the refund id is
 * recorded against the entry. Cash/transfer entries are recorded in the same
 * ledger as returned by hand, so the organiser's summary always adds up.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can refund entry fees", "forbidden");

  const body = validate(refundSchema, await parseJson(request));
  const outcome = await refundPayment({
    eventId: id,
    playerId: body.playerId,
    amountPence: body.amountPence ?? null,
    reason: body.reason,
    by: user.id,
  });
  await bumpRevision(id);
  return json({ ok: true, refund: outcome, stripeEnabled: stripeEnabled() });
});
