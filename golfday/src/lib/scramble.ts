/**
 * Texas scramble.
 *
 * A scramble is played by a team (a tee group) off one ball: everybody tees off,
 * the team picks the best drive, and everybody plays the next shot from there.
 * The card therefore belongs to the *team*, not to a player - one gross score per
 * hole - so it cannot live in the per-player `scores` table.
 *
 * The team handicap is the usual England Golf scramble allowance: each player's
 * course handicap scaled by a percentage that steps down from the lowest
 * handicap, then added together and rounded.
 *
 * All the maths is pure so it can be unit tested without a database.
 */

export type ScrambleHole = { holeNumber: number; par: number; strokeIndex: number };

export type ScrambleScoreRow = {
  holeNumber: number;
  strokes: number;
  /** Whose tee shot the team used on this hole (null while nobody has said). */
  drivePlayerId?: string | null;
};

export type ScrambleMember = {
  playerId: string;
  name: string;
  /** Course handicap (before the event's allowance) - scramble %s apply to this. */
  courseHandicap: number;
};

export type ScrambleHoleResult = {
  holeNumber: number;
  par: number;
  strokeIndex: number;
  strokes: number;
  shotsReceived: number;
  net: number;
  points: number;
  toPar: number;
  drivePlayerId: string | null;
  drivePlayerName: string | null;
};

export type ScrambleTotals = {
  holesPlayed: number;
  gross: number;
  net: number;
  netToPar: number;
  points: number;
  toPar: number;
  frontNine: number;
  backNine: number;
  results: ScrambleHoleResult[];
};

export type ScrambleTeamMember = {
  playerId: string;
  name: string;
  courseHandicap: number;
  drives: number;
  /** Drives this player still owes to satisfy the minimum-drives rule. */
  drivesNeeded: number;
};

export type ScrambleStanding = {
  groupId: string;
  groupName: string;
  teeTime: string | null;
  members: ScrambleTeamMember[];
  teamHandicap: number;
  thru: number;
  gross: number;
  net: number;
  netToPar: number;
  points: number;
  toPar: number;
  position: number;
  tied: boolean;
  /** Team-mates who have not yet had enough drives used (empty = all good). */
  drivesShort: string[];
  holeResults: ScrambleHoleResult[];
};

/**
 * Percentage of each player's course handicap that counts, lowest handicap
 * first. These are the allowances England Golf publishes for scramble teams.
 */
export function scrambleAllowances(teamSize: number): number[] {
  if (teamSize <= 1) return [1];
  if (teamSize === 2) return [0.35, 0.15];
  if (teamSize === 3) return [0.3, 0.2, 0.1];
  return [0.25, 0.2, 0.15, 0.1];
}

/** Team handicap: allowances applied low-to-high, summed, then rounded. */
export function scrambleTeamHandicap(courseHandicaps: number[]): number {
  const sorted = [...courseHandicaps].sort((a, b) => a - b);
  const allowances = scrambleAllowances(sorted.length);
  const total = sorted.reduce((sum, hcp, index) => sum + hcp * (allowances[index] ?? 0), 0);
  return Math.round(total);
}

/** Strokes a team receives on a hole, by stroke index (supports > 18). */
export function teamStrokesReceived(teamHandicap: number, strokeIndex: number): number {
  if (teamHandicap <= 0) return 0;
  const base = Math.floor(teamHandicap / 18);
  const extra = strokeIndex <= teamHandicap % 18 ? 1 : 0;
  return base + extra;
}

/**
 * Minimum number of holes a player's drive must be used. With 18 holes and a
 * four-ball that is four each; three players six each; two players nine each.
 */
export function minimumDrives(teamSize: number, holesInCard: number): number {
  if (teamSize <= 1 || holesInCard <= 0) return 0;
  return Math.max(1, Math.floor(holesInCard / teamSize));
}

export function summariseScramble(
  holes: ScrambleHole[],
  scores: ScrambleScoreRow[],
  teamHandicap: number,
  members: Pick<ScrambleMember, "playerId" | "name">[] = [],
): ScrambleTotals {
  const byHole = new Map(scores.map((s) => [s.holeNumber, s]));
  const nameOf = new Map(members.map((m) => [m.playerId, m.name]));
  const results: ScrambleHoleResult[] = [];
  let gross = 0;
  let net = 0;
  let points = 0;
  let toPar = 0;
  let netToPar = 0;
  let frontNine = 0;
  let backNine = 0;

  for (const hole of [...holes].sort((a, b) => a.holeNumber - b.holeNumber)) {
    const row = byHole.get(hole.holeNumber);
    if (!row || row.strokes <= 0) continue;
    const received = teamStrokesReceived(teamHandicap, hole.strokeIndex);
    const netStrokes = row.strokes - received;
    const pts = Math.max(0, hole.par + 2 - netStrokes);
    const drivePlayerId = row.drivePlayerId ?? null;
    results.push({
      holeNumber: hole.holeNumber,
      par: hole.par,
      strokeIndex: hole.strokeIndex,
      strokes: row.strokes,
      shotsReceived: received,
      net: netStrokes,
      points: pts,
      toPar: row.strokes - hole.par,
      drivePlayerId,
      drivePlayerName: drivePlayerId ? nameOf.get(drivePlayerId) ?? null : null,
    });
    gross += row.strokes;
    net += netStrokes;
    points += pts;
    toPar += row.strokes - hole.par;
    netToPar += netStrokes - hole.par;
    if (hole.holeNumber <= 9) frontNine += row.strokes;
    else backNine += row.strokes;
  }

  return {
    holesPlayed: results.length,
    gross,
    net,
    netToPar,
    points,
    toPar,
    frontNine,
    backNine,
    results,
  };
}

export function countDrives(scores: ScrambleScoreRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of scores) {
    if (!row.drivePlayerId) continue;
    counts.set(row.drivePlayerId, (counts.get(row.drivePlayerId) ?? 0) + 1);
  }
  return counts;
}

type RankInput = {
  groupId: string;
  groupName: string;
  teeTime: string | null;
  members: ScrambleMember[];
  scores: ScrambleScoreRow[];
};

/** Countback on the last 9 / 6 / 3 / 1 holes; higher points is better. */
function countbackKey(row: ScrambleStanding, holesInCard: number): number[] {
  const byHole = new Map(row.holeResults.map((h) => [h.holeNumber, h]));
  const segments = holesInCard >= 18 ? [9, 6, 3, 1] : [Math.max(1, Math.ceil(holesInCard / 2)), 3, 1];
  return segments.map((n) => {
    let points = 0;
    for (let hole = holesInCard - n + 1; hole <= holesInCard; hole += 1) {
      points += byHole.get(hole)?.points ?? 0;
    }
    return -points;
  });
}

/**
 * Builds the team leaderboard: one row per tee group, ranked on Stableford
 * points (scrambles are normally played as a Stableford or against par).
 */
export function rankScrambleTeams(input: RankInput[], holes: ScrambleHole[]): ScrambleStanding[] {
  const holesInCard = holes.length || 18;
  const rows: Omit<ScrambleStanding, "position" | "tied" | "drivesShort">[] = input
    .filter((team) => team.members.length > 0)
    .map((team) => {
      const teamHandicap = scrambleTeamHandicap(team.members.map((m) => m.courseHandicap));
      const totals = summariseScramble(holes, team.scores, teamHandicap, team.members);
      const drives = countDrives(team.scores);
      const min = minimumDrives(team.members.length, holesInCard);
      return {
        groupId: team.groupId,
        groupName: team.groupName,
        teeTime: team.teeTime,
        teamHandicap,
        members: team.members.map((m) => {
          const count = drives.get(m.playerId) ?? 0;
          return {
            playerId: m.playerId,
            name: m.name,
            courseHandicap: m.courseHandicap,
            drives: count,
            drivesNeeded: Math.max(0, min - count),
          };
        }),
        thru: totals.holesPlayed,
        gross: totals.gross,
        net: totals.net,
        netToPar: totals.netToPar,
        points: totals.points,
        toPar: totals.toPar,
        holeResults: totals.results,
      };
    });

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
    const position = sameAsPrev ? out[index - 1].position : index + 1;
    out.push({
      ...row,
      position,
      tied: false,
      drivesShort: row.members.filter((m) => m.drivesNeeded > 0).map((m) => m.name),
    });
  });

  const counts = new Map<number, number>();
  out.forEach((row) => counts.set(row.position, (counts.get(row.position) ?? 0) + 1));
  return out.map((row) => ({ ...row, tied: (counts.get(row.position) ?? 0) > 1 }));
}

export const SCRAMBLE_FORMAT = "TEXAS_SCRAMBLE";

export function isScrambleFormat(format: string | null | undefined): boolean {
  return format === SCRAMBLE_FORMAT;
}
