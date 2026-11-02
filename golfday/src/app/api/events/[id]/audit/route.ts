import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { players, scoreAudit, scrambleAudit } from "@/db/schema";
import { json, requireEventAccess, requireUser, route } from "@/lib/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Every score that was changed after it was first entered, newest first.
 *
 * Kept for the organiser and, when a card is disputed, shown to whoever asks -
 * "why is my 4 a 6?" should have an answer with a timestamp and a name on it.
 */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  await requireEventAccess(id, user);

  const [individual, team] = await Promise.all([
    db
      .select({
        id: scoreAudit.id,
        playerId: scoreAudit.playerId,
        playerName: players.name,
        holeNumber: scoreAudit.holeNumber,
        oldStrokes: scoreAudit.oldStrokes,
        newStrokes: scoreAudit.newStrokes,
        changedBy: scoreAudit.changedBy,
        changedAt: scoreAudit.changedAt,
      })
      .from(scoreAudit)
      .leftJoin(players, eq(players.id, scoreAudit.playerId))
      .where(eq(scoreAudit.eventId, id))
      .orderBy(desc(scoreAudit.changedAt))
      .limit(200),
    db.select().from(scrambleAudit).where(eq(scrambleAudit.eventId, id)).orderBy(desc(scrambleAudit.changedAt)).limit(100),
  ]);

  return json({
    amendments: individual.map((row) => ({ ...row, kind: "PLAYER" as const })),
    teamAmendments: team.map((row) => ({ ...row, kind: "TEAM" as const })),
  });
});
