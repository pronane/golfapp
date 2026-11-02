import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPlayers, groups, players, scores, scrambleScores } from "@/db/schema";
import { ApiError, json, requireEventAccess, requireUser, route } from "@/lib/http";
import { getEventBundle } from "@/lib/events";
import { isScrambleFormat } from "@/lib/scramble";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The master scorecard: every card in the field, on one screen, for the
 * organiser. Fixing a number is a plain POST to /api/scores (or /api/scramble)
 * with the admin session, which also writes the audit row this endpoint's
 * sibling (`/audit`) reads back.
 *
 * Admin-only. Players see their own card on their group link and nothing else.
 */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  const access = await requireEventAccess(id, user);
  if (!access.isAdmin) throw new ApiError(403, "Only event admins can open the master scorecard", "forbidden");

  const bundle = await getEventBundle(id);
  if (!bundle) return json({ error: "Event not found" }, { status: 404 });

  const groupRows = await db.select().from(groups).where(eq(groups.eventId, id));
  const groupName = new Map(groupRows.map((g) => [g.id, g.name]));
  const registered = bundle.registrations.filter((r) => r.registration.status === "REGISTERED");

  if (isScrambleFormat(bundle.event.format)) {
    const teamRows = await db.select().from(scrambleScores).where(eq(scrambleScores.eventId, id));
    return json({
      format: bundle.event.format,
      holes: bundle.holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex })),
      teams: groupRows
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((group) => ({
          groupId: group.id,
          name: group.name,
          teeTime: group.teeTime,
          members: registered
            .filter((r) => r.registration.groupId === group.id)
            .map((r) => ({ playerId: r.player.id, name: r.player.name })),
          scores: teamRows
            .filter((row) => row.groupId === group.id)
            .map((row) => ({ holeNumber: row.holeNumber, strokes: row.strokes, drivePlayerId: row.drivePlayerId })),
        })),
      cards: [],
    });
  }

  const scoreRows = await db.select().from(scores).where(eq(scores.eventId, id));
  return json({
    format: bundle.event.format,
    holes: bundle.holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex })),
    cards: registered.map(({ player, registration }) => ({
      playerId: player.id,
      name: player.name,
      group: registration.groupId ? groupName.get(registration.groupId) ?? null : null,
      playingHandicap: registration.playingHandicap,
      scores: scoreRows
        .filter((row) => row.playerId === player.id)
        .map((row) => ({ holeNumber: row.holeNumber, strokes: row.strokes })),
    })),
    teams: [],
  });
});
