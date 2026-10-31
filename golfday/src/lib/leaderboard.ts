import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPlayers, groups, players, scores } from "@/db/schema";
import { getCurrentUser } from "./auth";
import { getEventBundle, getRevision } from "./events";
import { getEventAccess } from "./http";
import { rankStandings, summariseRound, type Standing } from "./scoring";
import { buildGames, getGameSettings, listSideEntries, type GamesPayload, type SideHole } from "./games";

export type PublicEvent = {
  id: string;
  slug: string;
  name: string;
  date: string;
  startTime: string;
  courseName: string | null;
  format: string;
  status: string;
  handicapAllowance: number;
};

export type LeaderboardGroup = {
  id: string;
  name: string;
  teeTime: string | null;
  players: string[];
  points: number;
  holesPlayed: number;
};

export type LeaderboardPayload = {
  event: PublicEvent;
  revision: number;
  updatedAt: string;
  par: number;
  holes: { holeNumber: number; par: number; strokeIndex: number }[];
  standings: Standing[];
  groups: LeaderboardGroup[];
  games: GamesPayload;
  stats: {
    registered: number;
    scoresEntered: number;
    holesInCard: number;
    leader: string | null;
  };
};

export function toPublicEvent(event: {
  id: string;
  slug: string;
  name: string;
  date: string;
  startTime: string;
  courseName: string | null;
  format: string;
  status: string;
  handicapAllowance: number;
}): PublicEvent {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    date: event.date,
    startTime: event.startTime,
    courseName: event.courseName,
    format: event.format,
    status: event.status,
    handicapAllowance: event.handicapAllowance,
  };
}

/**
 * A public golf day's live board is readable by anyone - that is the point of the
 * shareable link. A private one (`events.is_public = 0`) is readable only by the
 * people who run it: its scorecard tokens and entry details should not leak just
 * because somebody guessed a slug.
 */
export async function canViewEventBoard(event: { id: string; isPublic: boolean }): Promise<boolean> {
  if (event.isPublic) return true;
  const user = await getCurrentUser();
  if (!user) return false;
  return Boolean(await getEventAccess(event.id, user));
}

/**
 * Builds the whole leaderboard from the database. Called by the page (server
 * render) and by the SSE stream after each revision bump. Safe to call while a
 * round is in progress - unfinished holes are simply excluded.
 */
export async function buildLeaderboard(eventId: string): Promise<LeaderboardPayload | null> {
  const bundle = await getEventBundle(eventId);
  if (!bundle) return null;
  const { event, holes, registrations, groups: groupRows } = bundle;
  const scoreRows = await db
    .select()
    .from(scores)
    .where(and(eq(scores.eventId, eventId)));

  const groupLookup = new Map(groupRows.map((g) => [g.id, g]));
  const scoresByPlayer = new Map<string, { holeNumber: number; strokes: number }[]>();
  for (const row of scoreRows) {
    const list = scoresByPlayer.get(row.playerId) ?? [];
    list.push({ holeNumber: row.holeNumber, strokes: row.strokes });
    scoresByPlayer.set(row.playerId, list);
  }

  const holeInfo = holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex }));
  const par = holeInfo.reduce((sum, h) => sum + h.par, 0);

  const rows = registrations
    .filter((r) => r.registration.status === "REGISTERED")
    .map(({ registration, player }) => {
      const total = summariseRound(holeInfo, scoresByPlayer.get(player.id) ?? [], registration.playingHandicap);
      const group = registration.groupId ? groupLookup.get(registration.groupId) : undefined;
      return {
        playerId: player.id,
        playerName: player.name,
        groupId: registration.groupId ?? null,
        groupName: group?.name ?? null,
        tee: registration.tee,
        handicapIndex: registration.handicapIndex,
        playingHandicap: registration.playingHandicap,
        thru: total.holesPlayed,
        totalStrokes: total.totalStrokes,
        totalNet: total.totalNet,
        netToPar: total.netToPar,
        points: total.points,
        toPar: total.toPar,
        holeResults: total.results,
      };
    });

  const standings = rankStandings(
    rows,
    event.format === "STROKE_PLAY" ? "STROKE_PLAY" : "STABLEFORD",
    holeInfo.length || 18,
  );

  const groupBoard: LeaderboardGroup[] = groupRows.map((g) => {
    const members = standings.filter((s) => s.groupId === g.id);
    return {
      id: g.id,
      name: g.name,
      teeTime: g.teeTime,
      // NB: never put g.token here. This payload is public (live page, API and
      // SSE stream) and the token is the password for the group's scorecard.
      players: members.map((m) => m.playerName),
      points: members.reduce((sum, m) => sum + m.points, 0),
      holesPlayed: members.reduce((sum, m) => sum + m.thru, 0),
    };
  });

  const leader = standings.find((s) => s.thru > 0)?.playerName ?? null;
  const games = await buildGames(eventId, standings, holeInfo);

  return {
    event: toPublicEvent(event),
    revision: bundle.revision,
    updatedAt: new Date().toISOString(),
    par,
    holes: holeInfo,
    standings,
    groups: groupBoard,
    games,
    stats: {
      registered: standings.length,
      scoresEntered: scoreRows.length,
      holesInCard: holeInfo.length,
      leader,
    },
  };
}

export type GroupScoreboard = {
  event: {
    id: string;
    slug: string;
    name: string;
    date: string;
    startTime: string;
    courseName: string | null;
    format: string;
    status: string;
    handicapAllowance: number;
  };
  group: { id: string; name: string; teeTime: string | null; token: string };
  holes: { holeNumber: number; par: number; strokeIndex: number }[];
  /** nearest-the-pin / longest-drive holes, and this group's measurements on them */
  sideHoles: SideHole[];
  sideEntries: { kind: string; holeNumber: number; playerId: string; distance: number }[];
  players: {
    id: string;
    name: string;
    handicapIndex: number;
    playingHandicap: number;
    tee: string;
    scores: Record<number, number>;
    points: number;
    thru: number;
    totalStrokes: number;
    toPar: number;
  }[];
  revision: number;
};

/** Data for the group score-entry screen (and its live mini leaderboard). */
export async function getGroupScoreboard(token: string): Promise<GroupScoreboard | null> {
  const [group] = await db.select().from(groups).where(eq(groups.token, token)).limit(1);
  if (!group) return null;
  const bundle = await getEventBundle(group.eventId);
  if (!bundle) return null;
  const scoreRows = await db.select().from(scores).where(eq(scores.eventId, group.eventId));

  const members = bundle.registrations.filter(
    (r) => r.registration.groupId === group.id && r.registration.status !== "WITHDRAWN",
  );
  const holeInfo = bundle.holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex }));

  const playersPayload = members.map(({ registration, player }) => {
    const own = scoreRows.filter((s) => s.playerId === player.id);
    const record: Record<number, number> = {};
    for (const s of own) record[s.holeNumber] = s.strokes;
    const total = summariseRound(holeInfo, own, registration.playingHandicap);
    return {
      id: player.id,
      name: player.name,
      handicapIndex: registration.handicapIndex,
      playingHandicap: registration.playingHandicap,
      tee: registration.tee,
      scores: record,
      points: total.points,
      thru: total.holesPlayed,
      totalStrokes: total.totalStrokes,
      toPar: total.toPar,
    };
  });

  const [settings, entryRows] = await Promise.all([getGameSettings(group.eventId), listSideEntries(group.eventId)]);
  const memberIds = new Set(members.map((m) => m.player.id));

  return {
    event: toPublicEvent(bundle.event),
    group: { id: group.id, name: group.name, teeTime: group.teeTime, token: group.token },
    holes: holeInfo,
    sideHoles: settings.sideHoles,
    sideEntries: entryRows
      .filter((e) => memberIds.has(e.playerId))
      .map((e) => ({ kind: e.kind, holeNumber: e.holeNumber, playerId: e.playerId, distance: e.distance })),
    players: playersPayload,
    revision: bundle.revision,
  };
}

export async function getTopStandings(eventId: string, limit = 5) {
  const board = await buildLeaderboard(eventId);
  if (!board) return { standings: [], revision: 0, event: null };
  return {
    standings: board.standings.filter((s) => s.thru > 0).slice(0, limit),
    revision: board.revision,
    event: board.event,
  };
}

export async function getRevisionForEvent(eventId: string) {
  return getRevision(eventId);
}

export async function findPlayerByUser(userId: string) {
  const [row] = await db.select().from(players).where(eq(players.userId, userId)).limit(1);
  return row ?? null;
}

export async function getRegistration(eventId: string, playerId: string) {
  const [row] = await db
    .select()
    .from(eventPlayers)
    .where(and(eq(eventPlayers.eventId, eventId), eq(eventPlayers.playerId, playerId)))
    .limit(1);
  return row ?? null;
}
