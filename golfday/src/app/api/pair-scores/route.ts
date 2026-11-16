import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { eventPairs, eventPlayers, groups } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, getEventAccess, json, parseJson, route } from "@/lib/http";
import { bumpRevision, getEventById, getEventHoles } from "@/lib/events";
import { teamBoardKind } from "@/lib/eventFormats";
import { scoreWriteRule } from "@/lib/status";
import { pairMemberIds, savePairScore } from "@/lib/scrambleScores";
import { validate } from "@/lib/validate";

export const dynamic = "force-dynamic";

const pairScoreSchema = z.object({
  eventId: z.string().min(1),
  pairId: z.string().min(1),
  holeNumber: z.coerce.number().int().min(1).max(36),
  strokes: z.coerce.number().int().min(1).max(20),
  /** The pair's own scoring link, or the four-ball's group link. */
  token: z.string().max(40).optional(),
});

/**
 * Enter or amend one hole of a foursomes / greensomes pair card.
 *
 * Authorised like a team card: the pair's scoring token, the group's scoring
 * token (the pair plays out of that four-ball, so the invite link works), an
 * event admin, or either partner signed in.
 */
export const POST = route(async (request: Request) => {
  const body = validate(pairScoreSchema, await parseJson(request));
  const user = await getCurrentUser();
  const event = await getEventById(body.eventId);
  if (!event) throw new ApiError(404, "Event not found", "not_found");
  if (teamBoardKind(event.format) !== "PAIR") {
    throw new ApiError(409, "This event does not play pair cards", "not_pair_card");
  }
  if (event.status === "DRAFT" || event.status === "CANCELLED") {
    throw new ApiError(409, "Scoring is not open for this event", "event_closed");
  }

  const memberIds = await pairMemberIds(body.eventId, body.pairId);
  if (memberIds.size !== 2) throw new ApiError(404, "That pair is not part of this event", "pair_not_found");

  let authorised = false;
  let via = "unknown";
  if (body.token) {
    const [pair] = await db.select().from(eventPairs).where(eq(eventPairs.id, body.pairId)).limit(1);
    const pairOwns = pair?.token === body.token;
    let groupOwns = false;
    if (!pairOwns) {
      const [group] = await db.select().from(groups).where(eq(groups.token, body.token)).limit(1);
      if (group && group.eventId === body.eventId) {
        const inGroup = await db.select().from(eventPlayers).where(eq(eventPlayers.groupId, group.id));
        const ids = new Set(inGroup.map((r) => r.playerId));
        groupOwns = [...memberIds].every((id) => ids.has(id));
      }
    }
    if (!pairOwns && !groupOwns) {
      throw new ApiError(403, "That scoring link is not valid for this pair", "invalid_token");
    }
    authorised = true;
    via = pairOwns ? "pair" : "group";
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
  const rule = scoreWriteRule(event.status, via.startsWith("admin:"));
  if (!rule.allowed) throw new ApiError(409, rule.message, rule.code);

  const holes = await getEventHoles(body.eventId);
  if (!holes.find((h) => h.holeNumber === body.holeNumber)) {
    throw new ApiError(404, "That hole is not part of this course", "hole_not_found");
  }

  await savePairScore({
    eventId: body.eventId,
    pairId: body.pairId,
    holeNumber: body.holeNumber,
    strokes: body.strokes,
    recordedBy: user?.id ?? via,
  });

  const revision = await bumpRevision(body.eventId);
  return json({ ok: true, revision, via });
});
