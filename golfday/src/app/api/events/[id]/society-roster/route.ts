import { ApiError, getEventAccess, json, route, requireUser } from "@/lib/http";
import { getEventById, registerRoster } from "@/lib/events";
import { getSocietyRosterForEvent } from "@/lib/societies";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Enter the society roster on this event, in one request.
 *
 * A society plays the same people every month; this is the "add them all"
 * button. Players already in the field are ignored, and anyone who cannot be
 * added (full field, already playing elsewhere that day) is reported back
 * rather than failing the whole call.
 */
export const POST = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await getEventAccess(id, user);
  if (!access?.isAdmin) throw new ApiError(403, "Only event admins can enter players", "forbidden");
  const event = await getEventById(id);
  if (!event) throw new ApiError(404, "Event not found", "not_found");
  if (event.status === "COMPLETED" || event.status === "CANCELLED") {
    throw new ApiError(409, `This golf day is ${event.status.toLowerCase()} - it cannot take new entries`, "event_closed");
  }

  const roster = await getSocietyRosterForEvent(id);
  if (!roster) throw new ApiError(409, "This golf day is not attached to a society", "no_society");
  if (roster.missing.length === 0) return json({ added: [], skipped: [], roster: roster.society });

  const result = await registerRoster({
    eventId: id,
    playerIds: roster.missing.map((m) => m.playerId),
    force: false,
  });
  return json({ ...result, roster: roster.society });
});
