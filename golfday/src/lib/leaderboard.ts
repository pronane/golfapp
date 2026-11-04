import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPlayers, groups, players, scores } from "@/db/schema";
import { getCurrentUser } from "./auth";
import { getEventBundle, getRevision, groupTokenEventId, isRegisteredPlayer } from "./events";
import { getEventAccess } from "./http";
import { rankStandings, summariseRound, type Standing } from "./scoring";
import { isScrambleFormat, type ScrambleStanding } from "./scramble";
import {
  getGroupScrambleCard,
  getPairCard,
  loadPairTeams,
  loadScrambleTeams,
  type GroupScrambleCard,
  type PairCard,
} from "./scrambleScores";
import { rankDerivedTeams } from "./derivedTeams";
import { buildGames, getGameSettings, listSideEntries, type GamesPayload, type SideHole } from "./games";
import { bandPlayers, splitIntoFlights } from "./flights";
import { boardFormat, teamBoardKind } from "./eventFormats";
import { listPairs } from "./games";

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
  /** How many times the card is played (1 = a normal day). */
  rounds: number;
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
  /** Flights/divisions, when the organiser split the field by handicap. */
  flights: { name: string; index: number; standings: Standing[] }[] | null;
  /** Texas scramble: one row per team (tee group) instead of per player. */
  teams: ScrambleStanding[] | null;
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
  rounds?: number;
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
    rounds: event.rounds ?? 1,
  };
}

/**
 * A public golf day's live board is readable by anyone - that is the point of the
 * shareable link. A private one (`events.is_public = 0`) is readable by the
 * people who run it, the players entered in it, and whoever holds one of its
 * group scoring links - not by somebody who guessed a slug.
 */
export async function canViewEventBoard(
  event: { id: string; isPublic: boolean },
  scoringToken?: string | null,
): Promise<boolean> {
  if (event.isPublic) return true;
  // A group's scoring link is already the key to that card, so whoever holds it
  // can follow the board it feeds (the scorecard's live top five).
  if (scoringToken && (await groupTokenEventId(scoringToken)) === event.id) return true;
  const user = await getCurrentUser();
  if (!user) return false;
  if (await getEventAccess(event.id, user)) return true;
  // Players entered in a private golf day can watch their own leaderboard.
  return user.playerId ? isRegisteredPlayer(event.id, user.playerId) : false;
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
  const scoresByPlayer = new Map<string, { holeNumber: number; strokes: number; round?: number }[]>();
  for (const row of scoreRows) {
    const list = scoresByPlayer.get(row.playerId) ?? [];
    list.push({ holeNumber: row.holeNumber, strokes: row.strokes, round: row.round ?? 1 });
    scoresByPlayer.set(row.playerId, list);
  }

  const rounds = event.rounds ?? 1;
  const holesInCard = (holes.length || 18) * rounds;
  const holeInfo = holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex }));
  const par = holeInfo.reduce((sum, h) => sum + h.par, 0) * rounds;

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

  const teamKind = teamBoardKind(event.format);
  const scramble = teamKind === "SCRAMBLE";
  const activeRegistrations = registrations
    .filter((r) => r.registration.status === "REGISTERED")
    .map(({ registration, player }) => ({
      playerId: player.id,
      name: player.name,
      courseHandicap: registration.courseHandicap,
      playingHandicap: registration.playingHandicap,
      groupId: registration.groupId ?? null,
    }));
  const groupList = groupRows.map((g) => ({ id: g.id, name: g.name, teeTime: g.teeTime }));
  const teams =
    teamKind === "SCRAMBLE"
      ? await loadScrambleTeams(eventId, holeInfo, groupList, activeRegistrations)
      : teamKind === "PAIR"
        ? await loadPairTeams(
            eventId,
            holeInfo,
            (await listPairs(eventId)).map((p) => ({ id: p.id, name: p.name, playerA: p.playerA, playerB: p.playerB })),
            activeRegistrations,
          )
        : teamKind === "DERIVED"
          ? rankDerivedTeams(
              event.format === "BEST_2_OF_4" ? "BEST_2_OF_4" : "SHAMBLE",
              holeInfo,
              groupList,
              rows.map((row) => {
                const reg = activeRegistrations.find((r) => r.playerId === row.playerId);
                return {
                  playerId: row.playerId,
                  name: row.playerName,
                  courseHandicap: reg?.courseHandicap ?? 0,
                  groupId: row.groupId,
                  holeResults: row.holeResults,
                  thru: row.thru,
                };
              }),
            )
          : null;

  // A scramble or a pair card has no individual card: the team is the
  // competitor. A shamble cards everybody AND computes a team board.
  const standings =
    teamKind === null || teamKind === "DERIVED"
      ? rankStandings(rows, boardFormat(event.format), holesInCard)
      : [];

  const groupBoard: LeaderboardGroup[] = groupRows.map((g) => {
    const members = standings.filter((s) => s.groupId === g.id);
    const team = teams?.find((t) => t.groupId === g.id);
    return {
      id: g.id,
      name: g.name,
      teeTime: g.teeTime,
      // NB: never put g.token here. This payload is public (live page, API and
      // SSE stream) and the token is the password for the group's scorecard.
      // A pair-card format has no individual standings and pairs are not
      // groups - fall back to the registrations so the tee sheet still names
      // who is playing before anybody has carded a hole.
      players: team
        ? team.members.map((m) => m.name)
        : members.length > 0
          ? members.map((m) => m.playerName)
          : registrations
              .filter((r) => r.registration.status === "REGISTERED" && r.registration.groupId === g.id)
              .map((r) => r.player.name),
      points: team ? team.points : members.reduce((sum, m) => sum + m.points, 0),
      holesPlayed: team ? team.thru : members.reduce((sum, m) => sum + m.thru, 0),
    };
  });

  const leader = teams
    ? (teams.find((t) => t.thru > 0)?.groupName ?? standings.find((s) => s.thru > 0)?.playerName ?? null)
    : standings.find((s) => s.thru > 0)?.playerName ?? null;
  const games = await buildGames(
    eventId,
    standings,
    holeInfo,
    rows.map((r) => ({ playerId: r.playerId, playerName: r.playerName })),
  );

  // Flights are derived, never stored per player: band the field by the playing
  // handicap it was given, then re-rank inside each band so a flight member sees
  // "1st" in their own division. A scramble is flighted by team, which this
  // does not do - the organiser gets one team board.
  const rankMode = boardFormat(event.format);
  const flights =
    !scramble && games.settings.flights >= 2
      ? splitIntoFlights(rows, bandPlayers(rows, games.settings.flights)).map((flight) => ({
          name: flight.name,
          index: flight.index,
          // Re-rank inside the flight: a flight member is 1st in their division,
          // not 14th overall.
          standings: rankStandings(flight.rows, rankMode, holesInCard),
        }))
      : null;

  return {
    event: toPublicEvent(event),
    revision: bundle.revision,
    updatedAt: new Date().toISOString(),
    par,
    holes: holeInfo,
    standings,
    flights,
    teams,
    groups: groupBoard,
    games,
    stats: {
      registered: teamKind ? rows.length : standings.length,
      scoresEntered: teams && teamKind !== "DERIVED" ? teams.reduce((sum, t) => sum + t.thru, 0) : scoreRows.length,
      holesInCard,
      leader,
    },
  };
}

/**
 * The "hide the board until your card is in" rule.
 *
 * Some organisers do not want the field watching each other's scores while the
 * money holes are still being played - seeing the number you need invites a
 * nudge. With `hide_board` on, the board is withheld from players (and from
 * spectators, who would happily tell them) until their own card is complete.
 * The organiser always sees it, and it opens up the moment the day is completed.
 */
export type BoardVisibility =
  | { visible: true }
  | { visible: false; reason: string; played: number; needed: number };

export type LeaderboardPayloadWithHidden = LeaderboardPayload & { hidden?: { reason: string; played: number; needed: number } };

/** Everything except the names and scores: safe to render to the field. */
export function redactBoard(
  board: LeaderboardPayload,
  visibility: { reason: string; played: number; needed: number },
): LeaderboardPayloadWithHidden {
  const hidden = { reason: visibility.reason, played: visibility.played, needed: visibility.needed };
  return {
    ...board,
    standings: [],
    teams: null,
    flights: null,
    groups: board.groups.map((group) => ({ ...group, players: [], points: 0, holesPlayed: 0 })),
    games: { ...board.games, skins: null, pairs: null, matchPlay: null, sideGames: [] },
    stats: { ...board.stats, leader: null, scoresEntered: board.stats.scoresEntered },
    hidden,
  };
}

export async function boardVisibility(board: LeaderboardPayload, eventId: string): Promise<BoardVisibility> {
  if (!board.games.settings.hideBoard) return { visible: true };
  if (board.event.status === "COMPLETED" || board.event.status === "CANCELLED") return { visible: true };

  const user = await getCurrentUser();
  if (user && (await getEventAccess(eventId, user))) return { visible: true };

  const needed = board.stats.holesInCard;
  const thru = user?.playerId
    ? board.teams
      ? board.teams.find((team) => team.members.some((member) => member.playerId === user.playerId))?.thru ?? 0
      : board.standings.find((row) => row.playerId === user.playerId)?.thru ?? 0
    : 0;

  if (thru >= needed && needed > 0) return { visible: true };
  return {
    visible: false,
    reason: "This organiser is keeping the board hidden until every card is in.",
    played: thru,
    needed,
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
    /** How many times the card is played (1 = a normal day). */
    rounds: number;
  };
  group: { id: string; name: string; teeTime: string | null; token: string };
  holes: { holeNumber: number; par: number; strokeIndex: number }[];
  /** Texas scramble team card, when the event is played as a scramble */
  scramble: GroupScrambleCard | null;
  /** Foursomes / greensomes: the pair cards this four-ball contains. */
  pairCards: PairCard[] | null;
  /** Which round the per-hole `scores` records below belong to (1 if single). */
  round: number;
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
export async function getGroupScoreboard(token: string, round = 1): Promise<GroupScoreboard | null> {
  const [group] = await db.select().from(groups).where(eq(groups.token, token)).limit(1);
  if (!group) return null;
  const bundle = await getEventBundle(group.eventId);
  if (!bundle) return null;
  const allScoreRows = await db.select().from(scores).where(eq(scores.eventId, group.eventId));
  // The per-hole record shows ONE round (the tab the scorer picked); totals
  // below always aggregate every round played so far.
  const scoreRows = (bundle.event.rounds ?? 1) > 1 ? allScoreRows.filter((r) => (r.round ?? 1) === round) : allScoreRows;

  const members = bundle.registrations.filter(
    (r) => r.registration.groupId === group.id && r.registration.status !== "WITHDRAWN",
  );
  const holeInfo = bundle.holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, strokeIndex: h.strokeIndex }));

  const playersPayload = members.map(({ registration, player }) => {
    // Totals aggregate every round; the per-hole record shows this round only.
    const own = allScoreRows.filter((s) => s.playerId === player.id);
    const record: Record<number, number> = {};
    for (const s of scoreRows.filter((row) => row.playerId === player.id)) record[s.holeNumber] = s.strokes;
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
  const scrambleCard = isScrambleFormat(bundle.event.format)
    ? await getGroupScrambleCard(group.eventId, group.id, holeInfo)
    : null;
  // Foursomes / greensomes: every pair drawn out of this four-ball gets its
  // own card here, so one group link carries both pair cards.
  let pairCards: PairCard[] | null = null;
  if (teamBoardKind(bundle.event.format) === "PAIR") {
    const memberIds = new Set(members.map((m) => m.player.id));
    const pairs = (await listPairs(group.eventId)).filter(
      (p) => memberIds.has(p.playerA) && memberIds.has(p.playerB),
    );
    const cards = await Promise.all(pairs.map((p) => getPairCard(group.eventId, p.id, holeInfo)));
    pairCards = cards.filter((c): c is PairCard => c !== null);
  }

  return {
    event: toPublicEvent(bundle.event),
    group: { id: group.id, name: group.name, teeTime: group.teeTime, token: group.token },
    holes: holeInfo,
    scramble: scrambleCard,
    pairCards,
    round,
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
