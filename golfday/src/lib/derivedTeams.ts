/**
 * Team boards derived from individual cards: the shamble and best-two-of-four.
 *
 * Unlike a scramble or foursomes these have no team card of their own - every
 * player cards their own scores through the normal scoring screen, and the
 * team result is computed from them:
 *
 *   - **Shamble** - each hole counts the team member's *best net* (they all
 *     play their own ball in from the best drive);
 *   - **Best two of four** - each hole counts the *sum of the two best nets*.
 *
 * A hole only settles once every active member of the team has scored it, the
 * same rule skins and scrambles use, so a half-played hole can never decide a
 * team result. The rows are shaped exactly like scramble standings, which is
 * what lets the live board, the export and the season loader treat every team
 * format the same way.
 */
import type { HoleResult } from "./scoring";
import {
  countbackKey,
  type ScrambleHole,
  type ScrambleHoleResult,
  type ScrambleStanding,
} from "./scramble";

export type DerivedTeamKind = "SHAMBLE" | "BEST_2_OF_4";

export type DerivedMember = {
  playerId: string;
  name: string;
  courseHandicap: number;
  groupId: string | null;
  /** The player's own card, exactly as the leaderboard built it. */
  holeResults: HoleResult[];
  thru: number;
};

/**
 * Builds the team board from the individual standings.
 *
 * Ranking mirrors the scramble board: Stableford points first (the team's
 * points are what a society's STABLEFORD season reads), then net to par, then
 * countback over the last 9 / 6 / 3 / 1 settled holes.
 */
export function rankDerivedTeams(
  kind: DerivedTeamKind,
  holes: ScrambleHole[],
  groups: { id: string; name: string; teeTime: string | null }[],
  members: DerivedMember[],
): ScrambleStanding[] {
  const sortedHoles = [...holes].sort((a, b) => a.holeNumber - b.holeNumber);

  const rows = groups
    .map((group) => {
      const team = members.filter((m) => m.groupId === group.id);
      if (team.length === 0) return null;

      const results: ScrambleHoleResult[] = [];
      for (const hole of sortedHoles) {
        const cards = team
          .map((m) => ({ member: m, result: m.holeResults.find((h) => h.holeNumber === hole.holeNumber) }))
          .filter((x): x is { member: DerivedMember; result: HoleResult } => Boolean(x.result));
        // A hole settles only when EVERY active member has scored it - a
        // half-played card can never decide a team result (same rule as
        // skins and the scramble card).
        if (cards.length < team.length) continue;

        const byNet = [...cards].sort((a, b) => a.result.net - b.result.net);
        const counted = kind === "BEST_2_OF_4" ? byNet.slice(0, 2) : byNet.slice(0, 1);
        const teamNet = counted.reduce((sum, c) => sum + c.result.net, 0);
        const teamGross = counted.reduce((sum, c) => sum + c.result.strokes, 0);
        const teamPoints = counted.reduce((sum, c) => sum + c.result.points, 0);
        results.push({
          holeNumber: hole.holeNumber,
          par: hole.par,
          strokeIndex: hole.strokeIndex,
          strokes: teamGross,
          shotsReceived: 0,
          net: teamNet,
          points: teamPoints,
          toPar: teamGross - hole.par,
          drivePlayerId: null,
          drivePlayerName: null,
        });
      }

      const gross = results.reduce((sum, r) => sum + r.strokes, 0);
      const net = results.reduce((sum, r) => sum + r.net, 0);
      const points = results.reduce((sum, r) => sum + r.points, 0);
      const netToPar = results.reduce((sum, r) => sum + r.net - r.par, 0);
      const toPar = results.reduce((sum, r) => sum + r.toPar, 0);
      return {
        groupId: group.id,
        groupName: group.name,
        teeTime: group.teeTime,
        teamHandicap: 0,
        members: team.map((m) => ({
          playerId: m.playerId,
          name: m.name,
          courseHandicap: m.courseHandicap,
          drives: 0,
          drivesNeeded: 0,
        })),
        thru: results.length,
        gross,
        net,
        netToPar,
        points,
        toPar,
        holeResults: results,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const holesInCard = holes.length || 18;
  const sorted = [...rows].sort((a, b) => {
    if (a.thru === 0 && b.thru > 0) return 1;
    if (b.thru === 0 && a.thru > 0) return -1;
    if (a.points !== b.points) return b.points - a.points;
    if (a.netToPar !== b.netToPar) return a.netToPar - b.netToPar;
    const ca = countbackKey({ ...a, position: 0, tied: false, drivesShort: [] }, holesInCard);
    const cb = countbackKey({ ...b, position: 0, tied: false, drivesShort: [] }, holesInCard);
    for (let i = 0; i < ca.length; i += 1) {
      if (ca[i] !== cb[i]) return ca[i] - cb[i];
    }
    return a.groupName.localeCompare(b.groupName);
  });

  const out: ScrambleStanding[] = [];
  sorted.forEach((row, index) => {
    const prev = index > 0 ? sorted[index - 1] : null;
    const sameAsPrev =
      prev !== null &&
      (prev.thru === 0) === (row.thru === 0) &&
      prev.points === row.points &&
      prev.netToPar === row.netToPar;
    out.push({ ...row, position: sameAsPrev ? out[index - 1].position : index + 1, tied: false, drivesShort: [] });
  });
  const counts = new Map<number, number>();
  out.forEach((row) => counts.set(row.position, (counts.get(row.position) ?? 0) + 1));
  return out.map((row) => ({ ...row, tied: (counts.get(row.position) ?? 0) > 1 }));
}
