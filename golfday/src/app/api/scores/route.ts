import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventHoles, eventPlayers, groups, players, scoreAudit, scores } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, getEventAccess, json, parseJson, route } from "@/lib/http";
import { bumpRevision, getEventById } from "@/lib/events";
import { newId } from "@/lib/ids";
import { stablefordPoints } from "@/lib/scoring";
import { scoreWriteRule } from "@/lib/status";
import { strokesReceived } from "@/lib/handicap";
import { scoreSchema, validate } from "@/lib/validate";
import { isStablefordBoard, teamBoardKind } from "@/lib/eventFormats";

export const dynamic = "force-dynamic";

/**
 * Enter or amend a score for one hole.
 * Authorised by either an admin/scorer session, the player themselves, or the
 * group's secret scoring token (used by the "live scorecard" link handed out on
 * the first tee - no login needed).
 */
export const POST = route(async (request: Request) => {
  const body = validate(scoreSchema, await parseJson(request));
  const user = await getCurrentUser();
  const event = await getEventById(body.eventId);
  if (!event) throw new ApiError(404, "Event not found", "not_found");
  if (event.status === "DRAFT" || event.status === "CANCELLED") {
    throw new ApiError(409, "Scoring is not open for this event", "event_closed");
  }
  // A scramble or a pair card is one card per team, not one per player:
  // accepting individual scores here would silently post numbers the board
  // never shows. (A shamble DOES card everybody - it derives its team board
  // from these scores - so it stays open.)
  const kind = teamBoardKind(event.format);
  if (kind === "SCRAMBLE" || kind === "PAIR") {
    throw new ApiError(409, "This golf day is scored as a team card", "not_individual_format");
  }
  // Which round of a multi-round event this stroke belongs to.
  const round = body.round ?? 1;
  if (round > (event.rounds ?? 1)) {
    throw new ApiError(400, `This event has ${event.rounds ?? 1} round(s)`, "bad_round");
  }

  const [registration] = await db
    .select()
    .from(eventPlayers)
    .where(and(eq(eventPlayers.eventId, body.eventId), eq(eventPlayers.playerId, body.playerId)))
    .limit(1);
  if (!registration || registration.status !== "REGISTERED") {
    throw new ApiError(404, "That player is not registered for this event", "player_not_registered");
  }

  let authorised = false;
  let via = "unknown";
  if (body.token) {
    const [group] = await db.select().from(groups).where(eq(groups.token, body.token)).limit(1);
    if (!group || group.eventId !== body.eventId) {
      throw new ApiError(403, "That scoring link is not valid for this event", "invalid_token");
    }
    if (registration.groupId !== group.id) {
      throw new ApiError(403, "That player is not in this group", "wrong_group");
    }
    authorised = true;
    via = `group:${group.name}`;
  }
  if (!authorised && user) {
    const access = await getEventAccess(body.eventId, user);
    if (access) { authorised = true; via = `admin:${access.role}`; }
    else if (user.playerId === body.playerId) { authorised = true; via = "player"; }
  }
  if (!authorised) throw new ApiError(403, "You cannot update this score", "forbidden");
  // A finished golf day is closed to the field; the organiser may still correct
  // a card, and the change is written to score_audit against their user id.
  const rule = scoreWriteRule(event.status, via.startsWith("admin:"));
  if (!rule.allowed) throw new ApiError(409, rule.message, rule.code);

  const [hole] = await db
    .select()
    .from(eventHoles)
    .where(and(eq(eventHoles.eventId, body.eventId), eq(eventHoles.holeNumber, body.holeNumber)))
    .limit(1);
  if (!hole) throw new ApiError(404, "That hole is not part of this course", "hole_not_found");

  const received = strokesReceived(registration.playingHandicap, hole.strokeIndex);
  const points = isStablefordBoard(event.format) ? stablefordPoints(hole.par, body.strokes, received) : 0;

  const [existing] = await db
    .select()
    .from(scores)
    .where(
      and(
        eq(scores.eventId, body.eventId),
        eq(scores.playerId, body.playerId),
        eq(scores.holeNumber, body.holeNumber),
        eq(scores.round, round),
      ),
    )
    .limit(1);

  if (existing) {
    if (existing.strokes !== body.strokes) {
      await db.insert(scoreAudit).values({
        id: newId(),
        eventId: body.eventId,
        playerId: body.playerId,
        holeNumber: body.holeNumber,
        round,
        oldStrokes: existing.strokes,
        newStrokes: body.strokes,
        changedBy: user?.id ?? via,
      });
    }
    await db
      .update(scores)
      .set({
        strokes: body.strokes,
        points,
        updatedAt: new Date().toISOString(),
        recordedBy: user?.id ?? via,
      })
      .where(eq(scores.id, existing.id));
  } else {
    // Two phones in the same group often enter the same hole at once. Without
    // the upsert the second insert hits score_round_unique and returns a 500.
    await db
      .insert(scores)
      .values({
        id: newId(),
        eventId: body.eventId,
        playerId: body.playerId,
        holeNumber: body.holeNumber,
        round,
        strokes: body.strokes,
        points,
        recordedBy: user?.id ?? via,
      })
      .onConflictDoUpdate({
        target: [scores.eventId, scores.playerId, scores.holeNumber, scores.round],
        set: { strokes: body.strokes, points, updatedAt: new Date().toISOString(), recordedBy: user?.id ?? via },
      });
  }

  const revision = await bumpRevision(body.eventId);
  const [player] = await db.select().from(players).where(eq(players.id, body.playerId)).limit(1);
  return json({
    ok: true,
    revision,
    points,
    shotsReceived: received,
    player: { id: body.playerId, name: player?.name ?? "" },
    via,
  });
});
