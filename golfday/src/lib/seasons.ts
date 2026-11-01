/**
 * Seasons and the order of merit.
 *
 * A season is a set of fixtures (golf days) whose results add up to a table:
 * the club's order of merit. Two scoring schemes are supported:
 *
 *  - `POSITION`  - the classic order of merit: 100 points for a win, 90 for
 *    second, and so on down a published scale, regardless of scores.
 *  - `STABLEFORD` - sum of each player's Stableford points across the fixtures.
 *
 * `bestOf` lets a society count only a player's best N results (a very common
 * rule for a season that runs all year), while still showing everything played.
 *
 * The ranking maths is pure; the loaders at the bottom of the file read the
 * database and reuse the live leaderboard so a season always agrees with the
 * boards the members saw on the day.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { events, seasonEvents, seasons } from "@/db/schema";
import { buildLeaderboard } from "@/lib/leaderboard";
import { newId, uniqueSlug } from "@/lib/ids";
import type { SessionUser } from "@/lib/auth";
import { ApiError } from "@/lib/http";
import { getMembership } from "@/lib/societies";

export type SeasonScheme = "POSITION" | "STABLEFORD";

/** 1st down to 30th; anybody further down still gets a point for turning up. */
export const POSITION_POINTS = [
  100, 90, 80, 75, 70, 65, 60, 55, 50, 45, 40, 36, 32, 28, 25, 22, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2,
];

export function pointsForPosition(position: number): number {
  if (!Number.isFinite(position) || position < 1) return 0;
  return POSITION_POINTS[position - 1] ?? 1;
}

export type SeasonFixtureResult = {
  eventId: string;
  eventName: string;
  eventSlug: string;
  date: string;
  holesInCard: number;
  /** One entry per player (or per member of a scramble team). */
  results: {
    playerId: string;
    playerName: string;
    position: number;
    thru: number;
    stablefordPoints: number;
    /** true when the result came from a scramble team rather than a card. */
    team: boolean;
    teamName?: string;
  }[];
};

export type OrderOfMeritResult = {
  eventId: string;
  eventName: string;
  eventSlug: string;
  date: string;
  position: number;
  thru: number;
  holesInCard: number;
  points: number;
  stablefordPoints: number;
  counted: boolean;
  team: boolean;
  teamName?: string;
};

export type OrderOfMeritRow = {
  playerId: string;
  playerName: string;
  position: number;
  /** Fixtures the player appeared in (finished with at least one hole). */
  played: number;
  /** Fixtures that actually counted towards the total (best-of). */
  counting: number;
  wins: number;
  bestFinish: number | null;
  points: number;
  results: OrderOfMeritResult[];
};

export type OrderOfMerit = {
  scheme: SeasonScheme;
  bestOf: number;
  fixtures: number;
  /** Players who appear in at least one fixture, in order. */
  rows: OrderOfMeritRow[];
};

function awardFor(scheme: SeasonScheme, result: SeasonFixtureResult["results"][number]): number {
  return scheme === "STABLEFORD" ? result.stablefordPoints : pointsForPosition(result.position);
}

/**
 * Turns per-fixture results into the season table. Players with no completed
 * hole in a fixture are ignored, so a season can be shown while the latest
 * fixture is still being played.
 */
export function buildOrderOfMerit(
  fixtures: SeasonFixtureResult[],
  scheme: SeasonScheme = "POSITION",
  bestOf = 0,
): OrderOfMerit {
  const perPlayer = new Map<string, OrderOfMeritRow>();
  let playedFixtures = 0;

  const ordered = [...fixtures].sort((a, b) => a.date.localeCompare(b.date));
  for (const fixture of ordered) {
    const scored = fixture.results.filter((r) => r.thru > 0);
    if (scored.length === 0) continue;
    playedFixtures += 1;
    for (const result of scored) {
      const award = awardFor(scheme, result);
      const row =
        perPlayer.get(result.playerId) ??
        ({
          playerId: result.playerId,
          playerName: result.playerName,
          position: 0,
          played: 0,
          counting: 0,
          wins: 0,
          bestFinish: null,
          points: 0,
          results: [],
        } satisfies OrderOfMeritRow);
      row.played += 1;
      row.bestFinish = row.bestFinish === null ? result.position : Math.min(row.bestFinish, result.position);
      if (result.position === 1) row.wins += 1;
      row.results.push({
        eventId: fixture.eventId,
        eventName: fixture.eventName,
        eventSlug: fixture.eventSlug,
        date: fixture.date,
        position: result.position,
        thru: result.thru,
        holesInCard: fixture.holesInCard,
        points: award,
        stablefordPoints: result.stablefordPoints,
        counted: true,
        team: result.team,
        teamName: result.teamName,
      });
      perPlayer.set(result.playerId, row);
    }
  }

  // Best-of: only the highest-scoring N results count towards the total.
  for (const row of perPlayer.values()) {
    row.results.sort((a, b) => b.points - a.points || a.date.localeCompare(b.date));
    const limit = bestOf > 0 ? bestOf : row.results.length;
    row.results.forEach((result, index) => {
      result.counted = index < limit;
    });
    row.counting = row.results.filter((r) => r.counted).length;
    row.points = row.results.filter((r) => r.counted).reduce((sum, r) => sum + r.points, 0);
    // Show the counting results first, then the rest in date order.
    row.results.sort((a, b) => Number(b.counted) - Number(a.counted) || a.date.localeCompare(b.date));
  }

  const rows = [...perPlayer.values()].sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      (a.bestFinish ?? 999) - (b.bestFinish ?? 999) ||
      b.played - a.played ||
      a.playerName.localeCompare(b.playerName),
  );

  let position = 0;
  let previous: OrderOfMeritRow | null = null;
  rows.forEach((row, index) => {
    if (!previous || previous.points !== row.points) position = index + 1;
    row.position = position;
    previous = row;
  });

  return { scheme, bestOf, fixtures: playedFixtures, rows };
}

export type SeasonRecord = typeof seasons.$inferSelect;

export async function listSeasonsForSociety(societyId: string) {
  return db
    .select()
    .from(seasons)
    .where(eq(seasons.societyId, societyId))
    .orderBy(desc(seasons.startsOn));
}

export async function listAllSeasons(limit = 50) {
  return db.select().from(seasons).orderBy(desc(seasons.startsOn)).limit(limit);
}

export async function getSeasonById(id: string) {
  const [row] = await db.select().from(seasons).where(eq(seasons.id, id)).limit(1);
  return row ?? null;
}

export async function getSeasonBySlug(slug: string) {
  const [row] = await db.select().from(seasons).where(eq(seasons.slug, slug)).limit(1);
  return row ?? null;
}

export async function listSeasonFixtures(seasonId: string) {
  const links = await db.select().from(seasonEvents).where(eq(seasonEvents.seasonId, seasonId));
  if (links.length === 0) return [];
  return db
    .select()
    .from(events)
    .where(inArray(events.id, links.map((l) => l.eventId)))
    .orderBy(asc(events.date));
}

export async function createSeason(input: {
  name: string;
  societyId?: string | null;
  startsOn: string;
  endsOn: string;
  scheme?: SeasonScheme;
  bestOf?: number;
  createdBy: string;
}) {
  const id = newId();
  const slug = uniqueSlug(input.name);
  await db.insert(seasons).values({
    id,
    slug,
    societyId: input.societyId ?? null,
    name: input.name.trim(),
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    scheme: input.scheme ?? "POSITION",
    bestOf: Math.max(0, Math.min(40, Math.round(input.bestOf ?? 0))),
    createdBy: input.createdBy,
  });
  return { id, slug };
}

export async function updateSeason(
  id: string,
  values: Partial<Pick<SeasonRecord, "name" | "startsOn" | "endsOn" | "scheme" | "bestOf">>,
) {
  const set: Record<string, unknown> = {};
  if (values.name !== undefined) set.name = values.name.trim();
  if (values.startsOn !== undefined) set.startsOn = values.startsOn;
  if (values.endsOn !== undefined) set.endsOn = values.endsOn;
  if (values.scheme !== undefined) set.scheme = values.scheme;
  if (values.bestOf !== undefined) set.bestOf = Math.max(0, Math.min(40, Math.round(values.bestOf)));
  if (Object.keys(set).length === 0) return;
  await db.update(seasons).set(set).where(eq(seasons.id, id));
}

export async function deleteSeason(id: string) {
  await db.delete(seasonEvents).where(eq(seasonEvents.seasonId, id));
  await db.delete(seasons).where(eq(seasons.id, id));
}

/**
 * Adds a fixture to a season. An event belongs to at most one season, so the
 * unique index on `season_events.event_id` does the duplicate check.
 */
export async function attachEventToSeason(seasonId: string, eventId: string) {
  const [existing] = await db.select().from(seasonEvents).where(eq(seasonEvents.eventId, eventId)).limit(1);
  if (existing && existing.seasonId === seasonId) return { added: false };
  if (existing) {
    await db.delete(seasonEvents).where(and(eq(seasonEvents.seasonId, existing.seasonId), eq(seasonEvents.eventId, eventId)));
  }
  await db.insert(seasonEvents).values({ id: newId(), seasonId, eventId });
  return { added: true };
}

export async function detachEventFromSeason(seasonId: string, eventId: string) {
  await db.delete(seasonEvents).where(and(eq(seasonEvents.seasonId, seasonId), eq(seasonEvents.eventId, eventId)));
}

/**
 * Loads every fixture's result for a season. Scramble fixtures are expanded to
 * the members of each team, so a society that plays a Texas scramble still gets
 * an order of merit (each team member earns the team's position).
 */
export async function loadSeasonFixtures(seasonId: string): Promise<SeasonFixtureResult[]> {
  const season = await getSeasonById(seasonId);
  const fixtures = await listSeasonFixtures(seasonId);
  const out: SeasonFixtureResult[] = [];
  for (const event of fixtures) {
    if (event.status === "DRAFT" || event.status === "CANCELLED") continue;
    // The season's dates are a real rule, not decoration: a golf day played
    // outside the window is on the fixture list but cannot score in the table.
    if (season && (event.date < season.startsOn || event.date > season.endsOn)) continue;
    const board = await buildLeaderboard(event.id);
    if (!board) continue;
    const holesInCard = board.holes.length || 18;
    if (board.teams && board.teams.length > 0) {
      const results: SeasonFixtureResult["results"] = [];
      for (const team of board.teams) {
        if (team.thru === 0) continue;
        for (const member of team.members) {
          results.push({
            playerId: member.playerId,
            playerName: member.name,
            position: team.position,
            thru: team.thru,
            stablefordPoints: team.points,
            team: true,
            teamName: team.groupName,
          });
        }
      }
      out.push({
        eventId: event.id,
        eventName: event.name,
        eventSlug: event.slug,
        date: event.date,
        holesInCard,
        results,
      });
      continue;
    }
    out.push({
      eventId: event.id,
      eventName: event.name,
      eventSlug: event.slug,
      date: event.date,
      holesInCard,
      results: board.standings.map((s) => ({
        playerId: s.playerId,
        playerName: s.playerName,
        position: s.position,
        thru: s.thru,
        stablefordPoints: s.points,
        team: false,
      })),
    });
  }
  return out;
}

/** True when a fixture falls outside the season's dates (listed, but not scored). */
export function isOutsideSeason(season: Pick<SeasonRecord, "startsOn" | "endsOn">, date: string): boolean {
  return date < season.startsOn || date > season.endsOn;
}

export async function getOrderOfMerit(season: SeasonRecord): Promise<OrderOfMerit> {
  const fixtures = await loadSeasonFixtures(season.id);
  return buildOrderOfMerit(fixtures, season.scheme === "STABLEFORD" ? "STABLEFORD" : "POSITION", season.bestOf);
}

/** Full season payload for the public page. */
export async function getSeasonPage(slug: string) {
  const season = await getSeasonBySlug(slug);
  if (!season) return null;
  const [fixtures, table] = await Promise.all([listSeasonFixtures(season.id), getOrderOfMerit(season)]);
  return { season, fixtures, table };
}

/**
 * Who may change a season: the person who created it, the society's owner or
 * secretary, or a site admin.
 */
export async function canManageSeason(user: SessionUser | null, season: SeasonRecord): Promise<boolean> {
  if (!user) return false;
  if (user.isSiteAdmin) return true;
  if (season.createdBy === user.id) return true;
  if (!season.societyId) return false;
  const membership = await getMembership(season.societyId, user);
  return membership?.role === "OWNER" || membership?.role === "SECRETARY";
}

export async function requireSeasonManager(user: SessionUser, season: SeasonRecord): Promise<void> {
  if (!(await canManageSeason(user, season))) {
    throw new ApiError(403, "Only the society's owner, its secretary, or whoever created the season can change it", "forbidden");
  }
}
