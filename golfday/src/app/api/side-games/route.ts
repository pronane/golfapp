import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { eventPlayers, groups } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, getEventAccess, json, parseJson, route } from "@/lib/http";
import { bumpRevision, getEventById } from "@/lib/events";
import { deleteSideEntry, getGameSettings, upsertSideEntry } from "@/lib/games";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

const schema = z.object({
  eventId: z.string().min(1),
  playerId: z.string().min(1),
  kind: z.enum(["NEAREST_PIN", "LONGEST_DRIVE"]),
  holeNumber: z.coerce.number().int().min(1).max(36),
  /** feet for nearest the pin, yards for longest drive; omit to delete */
  distance: z.coerce.number().positive().optional(),
  token: z.string().max(40).optional(),
});

const LIMITS = { NEAREST_PIN: 200, LONGEST_DRIVE: 450 } as const;

/**
 * Record (or clear) a nearest-the-pin / longest-drive measurement. Authorised
 * exactly like a score: the group's scoring link for its own players, or an
 * event admin/scorer.
 */
export const POST = route(async (request: Request) => {
  const body = validate(schema, await parseJson(request));
  const event = await getEventById(body.eventId);
  if (!event) throw new ApiError(404, "Event not found", "not_found");
  if (event.status !== "IN_PROGRESS" && event.status !== "OPEN") {
    throw new ApiError(409, "Side games can only be recorded while the event is running", "event_closed");
  }

  const settings = await getGameSettings(body.eventId);
  if (!settings.sideHoles.some((h) => h.kind === body.kind && h.holeNumber === body.holeNumber)) {
    throw new ApiError(400, "That hole isn't set up for this side game", "not_a_side_hole");
  }
  if (body.distance !== undefined && body.distance > LIMITS[body.kind]) {
    throw new ApiError(400, body.kind === "NEAREST_PIN" ? "That's more than 200 ft" : "That's more than 450 yards", "out_of_range");
  }

  const [registration] = await db
    .select()
    .from(eventPlayers)
    .where(and(eq(eventPlayers.eventId, body.eventId), eq(eventPlayers.playerId, body.playerId)))
    .limit(1);
  if (!registration || registration.status !== "REGISTERED") {
    throw new ApiError(404, "That player is not registered for this event", "player_not_registered");
  }

  const user = await getCurrentUser();
  let by: string | null = null;
  if (body.token) {
    const [group] = await db.select().from(groups).where(eq(groups.token, body.token)).limit(1);
    if (!group || group.eventId !== body.eventId || registration.groupId !== group.id) {
      throw new ApiError(403, "That scoring link can't record for this player", "invalid_token");
    }
    by = `group:${group.name}`;
  } else if (user && (await getEventAccess(body.eventId, user))) {
    by = user.id;
  }
  if (!by) throw new ApiError(403, "You cannot record this", "forbidden");

  if (body.distance === undefined) {
    await deleteSideEntry(body.eventId, body.kind, body.holeNumber, body.playerId);
  } else {
    await upsertSideEntry({
      eventId: body.eventId,
      kind: body.kind,
      holeNumber: body.holeNumber,
      playerId: body.playerId,
      distance: Math.round(body.distance * 100) / 100,
      recordedBy: user?.id ?? by,
    });
  }
  const revision = await bumpRevision(body.eventId);
  return json({ ok: true, revision });
});
