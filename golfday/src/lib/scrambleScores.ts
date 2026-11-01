/**
 * Database side of Texas scramble: reading a team's card, saving a hole and
 * turning the event's groups into the team leaderboard.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPlayers, groups, players, scrambleAudit, scrambleScores } from "@/db/schema";
import { newId } from "./ids";
import {
  minimumDrives,
  rankScrambleTeams,
  scrambleTeamHandicap,
  summariseScramble,
  teamStrokesReceived,
  type ScrambleHole,
  type ScrambleMember,
  type ScrambleScoreRow,
  type ScrambleStanding,
  type ScrambleTotals,
} from "./scramble";

export async function listScrambleScores(eventId: string) {
  return db.select().from(scrambleScores).where(eq(scrambleScores.eventId, eventId));
}

/**
 * Builds one row per tee group (the team). Withdrawn players are left out, so a
 * three-ball whose fourth dropped out is handicapped as a three-ball.
 */
export async function buildScrambleTeams(
  holes: ScrambleHole[],
  groupRows: { id: string; name: string; teeTime: string | null }[],
  registrations: { playerId: string; name: string; courseHandicap: number; groupId: string | null }[],
  scoreRows: { groupId: string; holeNumber: number; strokes: number; drivePlayerId: string | null }[],
): Promise<ScrambleStanding[]> {
  const byGroup = new Map<string, ScrambleScoreRow[]>();
  for (const row of scoreRows) {
    const list = byGroup.get(row.groupId) ?? [];
    list.push({ holeNumber: row.holeNumber, strokes: row.strokes, drivePlayerId: row.drivePlayerId ?? null });
    byGroup.set(row.groupId, list);
  }
  const teamInput = groupRows.map((group) => ({
    groupId: group.id,
    groupName: group.name,
    teeTime: group.teeTime,
    members: registrations
      .filter((r) => r.groupId === group.id)
      .map((r): ScrambleMember => ({ playerId: r.playerId, name: r.name, courseHandicap: r.courseHandicap })),
    scores: byGroup.get(group.id) ?? [],
  }));
  return rankScrambleTeams(teamInput, holes);
}

/** Loads exactly the rows buildScrambleTeams needs for an event. */
export async function loadScrambleTeams(
  eventId: string,
  holes: ScrambleHole[],
  groupRows: { id: string; name: string; teeTime: string | null }[],
  registrations: { playerId: string; name: string; courseHandicap: number; groupId: string | null }[],
) {
  const rows = await db.select().from(scrambleScores).where(eq(scrambleScores.eventId, eventId));
  return buildScrambleTeams(holes, groupRows, registrations, rows);
}

export type GroupScrambleCard = {
  enabled: true;
  teamHandicap: number;
  minDrives: number;
  members: { id: string; name: string; courseHandicap: number; drives: number; drivesNeeded: number }[];
  holes: {
    holeNumber: number;
    par: number;
    strokeIndex: number;
    strokes: number | null;
    drivePlayerId: string | null;
    shotsReceived: number;
    net: number | null;
    points: number | null;
  }[];
  totals: {
    thru: number;
    gross: number;
    net: number;
    netToPar: number;
    points: number;
    toPar: number;
  };
};

/** The team card for one group, shaped for the scoring screen. */
export async function getGroupScrambleCard(
  eventId: string,
  groupId: string,
  holes: ScrambleHole[],
): Promise<GroupScrambleCard> {
  const memberRows = await db
    .select({ registration: eventPlayers, player: players })
    .from(eventPlayers)
    .innerJoin(players, eq(players.id, eventPlayers.playerId))
    .where(and(eq(eventPlayers.eventId, eventId), eq(eventPlayers.groupId, groupId)));

  const active = memberRows.filter(({ registration }) => registration.status !== "WITHDRAWN");
  const members = active.map(({ registration, player }) => ({
    playerId: player.id,
    name: player.name,
    courseHandicap: registration.courseHandicap,
  }));
  const scoreRows = await db
    .select()
    .from(scrambleScores)
    .where(and(eq(scrambleScores.eventId, eventId), eq(scrambleScores.groupId, groupId)));

  const teamHandicap = scrambleTeamHandicap(members.map((m) => m.courseHandicap));
  const rows: ScrambleScoreRow[] = scoreRows.map((r) => ({
    holeNumber: r.holeNumber,
    strokes: r.strokes,
    drivePlayerId: r.drivePlayerId,
  }));
  const totals: ScrambleTotals = summariseScramble(holes, rows, teamHandicap, members);
  const byHole = new Map(totals.results.map((r) => [r.holeNumber, r]));
  const scored = new Map(scoreRows.map((r) => [r.holeNumber, r]));
  const min = minimumDrives(members.length, holes.length || 18);

  const driveCounts = new Map<string, number>();
  for (const row of scoreRows) {
    if (!row.drivePlayerId) continue;
    driveCounts.set(row.drivePlayerId, (driveCounts.get(row.drivePlayerId) ?? 0) + 1);
  }

  return {
    enabled: true,
    teamHandicap,
    minDrives: min,
    members: members.map((m) => {
      const drives = driveCounts.get(m.playerId) ?? 0;
      return { id: m.playerId, name: m.name, courseHandicap: m.courseHandicap, drives, drivesNeeded: Math.max(0, min - drives) };
    }),
    holes: [...holes]
      .sort((a, b) => a.holeNumber - b.holeNumber)
      .map((hole) => {
        const row = scored.get(hole.holeNumber);
        const result = byHole.get(hole.holeNumber);
        return {
          holeNumber: hole.holeNumber,
          par: hole.par,
          strokeIndex: hole.strokeIndex,
          strokes: row?.strokes ?? null,
          drivePlayerId: row?.drivePlayerId ?? null,
          // Strokes received depend only on the team handicap and the hole, so
          // they are known before the team has carded it (the score pad shows
          // "receives 1 shot" while the hole is still empty).
          shotsReceived: teamStrokesReceived(teamHandicap, hole.strokeIndex),
          net: result?.net ?? null,
          points: result?.points ?? null,
        };
      }),
    totals: {
      thru: totals.holesPlayed,
      gross: totals.gross,
      net: totals.net,
      netToPar: totals.netToPar,
      points: totals.points,
      toPar: totals.toPar,
    },
  };
}

/**
 * Saves (or corrects) one hole of a team card. Corrections are audited, because
 * a scramble card is the one score four people all believe they remember.
 */
export async function saveScrambleScore(input: {
  eventId: string;
  groupId: string;
  holeNumber: number;
  strokes: number;
  drivePlayerId?: string | null;
  recordedBy: string;
}) {
  const [existing] = await db
    .select()
    .from(scrambleScores)
    .where(
      and(
        eq(scrambleScores.eventId, input.eventId),
        eq(scrambleScores.groupId, input.groupId),
        eq(scrambleScores.holeNumber, input.holeNumber),
      ),
    )
    .limit(1);

  const now = new Date().toISOString();
  const drivePlayerId = input.drivePlayerId ?? null;

  if (existing) {
    if (existing.strokes !== input.strokes || existing.drivePlayerId !== (drivePlayerId ?? existing.drivePlayerId)) {
      await db.insert(scrambleAudit).values({
        id: newId(),
        eventId: input.eventId,
        groupId: input.groupId,
        holeNumber: input.holeNumber,
        oldStrokes: existing.strokes,
        newStrokes: input.strokes,
        changedBy: input.recordedBy,
      });
    }
    await db
      .update(scrambleScores)
      .set({
        strokes: input.strokes,
        // Only overwrite the drive when one was supplied: a score correction
        // must not wipe who won the hole.
        drivePlayerId: drivePlayerId ?? existing.drivePlayerId,
        recordedBy: input.recordedBy,
        updatedAt: now,
      })
      .where(eq(scrambleScores.id, existing.id));
    return { created: false };
  }

  await db
    .insert(scrambleScores)
    .values({
      id: newId(),
      eventId: input.eventId,
      groupId: input.groupId,
      holeNumber: input.holeNumber,
      strokes: input.strokes,
      drivePlayerId,
      recordedBy: input.recordedBy,
    })
    .onConflictDoUpdate({
      target: [scrambleScores.eventId, scrambleScores.groupId, scrambleScores.holeNumber],
      set: { strokes: input.strokes, drivePlayerId, recordedBy: input.recordedBy, updatedAt: now },
    });
  return { created: true };
}

export async function deleteScrambleScoresForEvent(eventId: string) {
  await db.delete(scrambleScores).where(eq(scrambleScores.eventId, eventId));
  await db.delete(scrambleAudit).where(eq(scrambleAudit.eventId, eventId));
}

export async function deleteScrambleScoresForGroup(eventId: string, groupId: string) {
  await db.delete(scrambleScores).where(and(eq(scrambleScores.eventId, eventId), eq(scrambleScores.groupId, groupId)));
}

/** Everyone in the group, used to validate the "drive used by" picker. */
export async function groupMemberIds(eventId: string, groupId: string): Promise<Set<string>> {
  const rows = await db
    .select({ playerId: eventPlayers.playerId })
    .from(eventPlayers)
    .where(and(eq(eventPlayers.eventId, eventId), eq(eventPlayers.groupId, groupId)));
  return new Set(rows.map((r) => r.playerId));
}

export async function groupBelongsToEvent(groupId: string, eventId: string): Promise<boolean> {
  const [row] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  return row?.eventId === eventId;
}
