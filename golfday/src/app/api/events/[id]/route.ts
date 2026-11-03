import { sql, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventHoles, events, scores as scoresTable, seasonEvents, societyEvents } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { ApiError, getEventAccess, json, parseJson, requireEventAccess, requireUser, route } from "@/lib/http";
import { bumpRevision, getCourseWithHoles, getEventBundle, recalculateHandicaps } from "@/lib/events";
import { newId } from "@/lib/ids";
import { updateEventSchema, validate } from "@/lib/validate";
import { deleteEventGames } from "@/lib/games";
import { deleteScrambleScoresForEvent } from "@/lib/scrambleScores";
import { deleteEventPayments } from "@/lib/payments";
import { gamesPreset, isGrossFormat, supportsRounds } from "@/lib/eventFormats";
import { getGameSettings, saveGameSettings } from "@/lib/games";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  const access = await getEventAccess(id, user);
  const bundle = await getEventBundle(id);
  if (!bundle) throw new ApiError(404, "Event not found", "not_found");
  if (!bundle.event.isPublic && !access) throw new ApiError(403, "This event is private", "forbidden");

  const isRegistered = Boolean(
    user?.playerId && bundle.registrations.some((r) => r.player.id === user.playerId),
  );
  return json({
    event: bundle.event,
    holes: bundle.holes,
    groups: bundle.groups,
    registrations: bundle.registrations.map((r) => ({
      player: r.player,
      registration: r.registration,
    })),
    admins: access?.isAdmin ? bundle.admins : undefined,
    access: access ? { role: access.role, isAdmin: access.isAdmin } : null,
    isRegistered,
    revision: bundle.revision,
  });
});

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can edit the event", "forbidden");
  const body = validate(updateEventSchema, await parseJson(request));

  const updates: Record<string, unknown> = {};
  for (const key of ["name", "description", "date", "startTime", "format", "rounds", "handicapAllowance", "maxPlayers", "status", "isPublic", "allowCourseClash"] as const) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  // Rounds are part of the score key (score_round_unique): they cannot change
  // once a card exists, and a one-card-per-team format has no second round.
  if (updates.rounds !== undefined || updates.format !== undefined) {
    const finalFormat = String(updates.format ?? access.event.format);
    const storedRounds = access.event.rounds ?? 1;
    const wanted = updates.rounds !== undefined ? Number(updates.rounds) : supportsRounds(finalFormat) ? (updates.format !== undefined && updates.format !== access.event.format ? 1 : storedRounds) : 1;
    if (!supportsRounds(finalFormat) && wanted > 1) {
      throw new ApiError(400, `${finalFormat} is a single-round format`, "bad_rounds");
    }
    const changing = wanted !== storedRounds || (updates.format !== undefined && updates.format !== access.event.format && !supportsRounds(finalFormat) && storedRounds > 1);
    if (changing) {
      const [{ n }] = (
        await db.select({ n: sql<number>`count(*)` }).from(scoresTable).where(eq(scoresTable.eventId, id))
      );
      if (Number(n) > 0) {
        throw new ApiError(400, "Scores are already in - the rounds cannot change now", "scores_exist");
      }
      updates.rounds = wanted;
    } else if (!supportsRounds(finalFormat)) {
      updates.rounds = 1;
    }
  }
  // The format decides the allowance for gross days, not the other way round.
  const finalFormat = (updates.format as string | undefined) ?? access.event.format;
  if (isGrossFormat(finalFormat)) {
    updates.handicapAllowance = 0;
  } else if (updates.format !== undefined && updates.format !== access.event.format && access.event.handicapAllowance === 0 && body.handicapAllowance === undefined) {
    // Switching a gross day back to net: 0 was the gross rule, not a choice.
    updates.handicapAllowance = 95;
  }
  const formatChanged = updates.format !== undefined && updates.format !== access.event.format;
  if (body.courseId !== undefined && body.courseId !== access.event.courseId) {
    updates.courseId = body.courseId;
    if (body.courseId) {
      const course = await getCourseWithHoles(body.courseId);
      if (!course) throw new ApiError(404, "Course not found", "course_not_found");
      updates.courseName = [course.course.name, course.course.club].filter(Boolean).join(", ");
      if (course.holes.length > 0) {
        await db.delete(eventHoles).where(eq(eventHoles.eventId, id));
        await db.insert(eventHoles).values(
          course.holes.map((h) => ({
            id: newId(),
            eventId: id,
            holeNumber: h.holeNumber,
            par: h.par,
            strokeIndex: h.strokeIndex,
          })),
        );
      }
    } else {
      updates.courseName = null;
    }
  }
  if (Object.keys(updates).length > 0) {
    await db.update(events).set(updates).where(eq(events.id, id));
  }
  if (body.handicapAllowance !== undefined) await recalculateHandicaps(id);
  if (formatChanged) {
    // The Games tab follows the format - pairs for 4BBB, the match board for a
    // Ryder Cup, the pot for skins - merged over whatever the organiser has
    // already set up, so side games, sponsors and the entry fee survive.
    const settings = await getGameSettings(id);
    await saveGameSettings(id, { ...settings, ...gamesPreset(String(updates.format)) });
  }
  await bumpRevision(id);
  return json({ ok: true });
});

export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (access.role !== "OWNER" && !user.isSiteAdmin) {
    throw new ApiError(403, "Only the event owner can delete the event", "forbidden");
  }
  await db.delete(events).where(eq(events.id, id));
  await deleteEventGames(id);
  await deleteEventPayments(id);
  // Team cards, society fixture links and season entries must not outlive the day.
  await deleteScrambleScoresForEvent(id);
  await db.delete(societyEvents).where(eq(societyEvents.eventId, id));
  await db.delete(seasonEvents).where(eq(seasonEvents.eventId, id));
  return json({ ok: true });
});
