import { ApiError, json, parseJson, requireUser, route } from "@/lib/http";
import { getEventByJoinCode, registerPlayer } from "@/lib/events";
import { z } from "zod";
import { validate } from "@/lib/validate";

const schema = z.object({ code: z.string().min(4).max(12) });

/** A player enters themselves using the join code the organiser shared. */
export const POST = route(async (request: Request) => {
  const user = await requireUser();
  if (!user.playerId) throw new ApiError(409, "Your account has no player profile", "no_player");
  const { code } = validate(schema, await parseJson(request));
  const event = await getEventByJoinCode(code.trim());
  if (!event) throw new ApiError(404, "No golf day uses that code", "not_found");
  if (!event.isPublic) throw new ApiError(403, "That event is private", "forbidden");
  if (!["OPEN", "IN_PROGRESS"].includes(event.status)) {
    throw new ApiError(409, "That event is not taking entries", "event_closed");
  }
  await registerPlayer({ eventId: event.id, playerId: user.playerId });
  return json({ slug: event.slug, name: event.name });
});
