import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { groups } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, getEventAccess, json, parseJson, route } from "@/lib/http";
import { bumpRevision, getEventById, getEventHoles } from "@/lib/events";
import { isScrambleFormat } from "@/lib/scramble";
import { groupMemberIds, saveScrambleScore } from "@/lib/scrambleScores";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

const scrambleSchema = z.object({
  eventId: z.string().min(1),
  groupId: z.string().min(1),
  holeNumber: z.coerce.number().int().min(1).max(36),
  strokes: z.coerce.number().int().min(1).max(20),
  /** Optional: which player's tee shot the team used. */
  drivePlayerId: z.string().min(1).nullable().optional(),
  /** The group's scoring link, for the four-ball on the course. */
  token: z.string().max(40).optional(),
});

/**
 * Enter or amend one hole of a Texas scramble team card.
 *
 * Authorised like a player score: the group's scoring token (no login needed on
 * the course), an event admin/scorer, or - since the card belongs to the team -
 * any registered member of that group who is signed in.
 */
export const POST = route(async (request: Request) => {
  const body = validate(scrambleSchema, await parseJson(request));
  const user = await getCurrentUser();
  const event = await getEventById(body.eventId);
  if (!event) throw new ApiError(404, "Event not found", "not_found");
  if (!isScrambleFormat(event.format)) {
    throw new ApiError(409, "This event is not a Texas scramble", "not_scramble");
  }
  if (event.status === "COMPLETED") throw new ApiError(409, "This event is complete - scores are locked", "event_completed");
  if (event.status === "DRAFT" || event.status === "CANCELLED") {
    throw new ApiError(409, "Scoring is not open for this event", "event_closed");
  }

  const [group] = await db.select().from(groups).where(eq(groups.id, body.groupId)).limit(1);
  if (!group || group.eventId !== body.eventId) throw new ApiError(404, "That team is not part of this event", "group_not_found");

  const memberIds = await groupMemberIds(body.eventId, body.groupId);
  if (memberIds.size === 0) throw new ApiError(409, "That team has no players yet", "empty_team");

  let authorised = false;
  let via = "unknown";
  if (body.token) {
    if (group.token !== body.token) {
      throw new ApiError(403, "That scoring link is not valid for this team", "invalid_token");
    }
    authorised = true;
    via = `group:${group.name}`;
  }
  if (!authorised && user) {
    const access = await getEventAccess(body.eventId, user);
    if (access) {
      authorised = true;
      via = `admin:${access.role}`;
    } else if (user.playerId && memberIds.has(user.playerId)) {
      authorised = true;
      via = "player";
    }
  }
  if (!authorised) throw new ApiError(403, "You cannot update this card", "forbidden");

  const holes = await getEventHoles(body.eventId);
  const hole = holes.find((h) => h.holeNumber === body.holeNumber);
  if (!hole) throw new ApiError(404, "That hole is not part of this course", "hole_not_found");

  if (body.drivePlayerId && !memberIds.has(body.drivePlayerId)) {
    throw new ApiError(400, "The drive has to be credited to a player in this team", "invalid_drive");
  }

  await saveScrambleScore({
    eventId: body.eventId,
    groupId: body.groupId,
    holeNumber: body.holeNumber,
    strokes: body.strokes,
    drivePlayerId: body.drivePlayerId ?? null,
    recordedBy: user?.id ?? via,
  });

  const revision = await bumpRevision(body.eventId);
  return json({ ok: true, revision, via });
});
