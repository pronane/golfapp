import { z } from "zod";
import { ApiError, getEventAccess, json, parseJson, requireUser, route } from "@/lib/http";
import { getEventBundle } from "@/lib/events";
import { getGameSettings } from "@/lib/games";
import { createCheckout } from "@/lib/payments";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ playerId: z.string().min(1).optional() });

/** Starts Stripe Checkout for the signed-in player's entry (admins may pay for anyone). */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const body = validate(schema, await parseJson(request));
  const playerId = body.playerId ?? user.playerId;
  if (!playerId) throw new ApiError(400, "Your account has no player profile yet", "no_player");
  if (playerId !== user.playerId && !(await getEventAccess(id, user))?.isAdmin) {
    throw new ApiError(403, "You can only pay your own entry", "forbidden");
  }
  const [bundle, settings] = await Promise.all([getEventBundle(id), getGameSettings(id)]);
  if (!bundle) throw new ApiError(404, "Event not found", "not_found");
  const entry = bundle.registrations.find((r) => r.player.id === playerId && r.registration.status === "REGISTERED");
  if (!entry) throw new ApiError(409, "Enter the event first, then pay", "player_not_registered");

  const baseUrl = process.env.APP_URL ?? new URL(request.url).origin;
  const url = await createCheckout({
    eventId: id,
    eventName: bundle.event.name,
    eventSlug: bundle.event.slug,
    playerId,
    playerName: entry.player.name,
    feePence: settings.entryFeePence,
    baseUrl,
  });
  return json({ url });
});
