import { strokesReceived } from "./handicap";

export type HoleInfo = { holeNumber: number; par: number; strokeIndex: number };
export type HoleScore = { holeNumber: number; strokes: number };

export type HoleResult = {
  holeNumber: number;
  par: number;
  strokeIndex: number;
  strokes: number;
  shotsReceived: number;
  net: number;
  points: number;
  toPar: number;
};

export type RoundTotals = {
  holesPlayed: number;
  totalStrokes: number;
  totalNet: number;
  points: number;
  toPar: number;
  frontNine: number;
  backNine: number;
  results: HoleResult[];
};

/** Stableford points: 2 for a net par, one better/worse for each shot. */
export function stablefordPoints(par: number, grossStrokes: number, shotsReceived: number): number {
  const net = grossStrokes - shotsReceived;
  return Math.max(0, par + 2 - net);
}

export function netStrokes(grossStrokes: number, shotsReceived: number): number {
  return grossStrokes - shotsReceived;
}

/**
 * Aggregates a player's card. Missing holes are simply not counted, so a
 * leaderboard can be built while a round is in progress ("thru").
 */
export function summariseRound(
  holes: HoleInfo[],
  scores: HoleScore[],
  playingHcp: number,
): RoundTotals {
  const byHole = new Map(scores.map((s) => [s.holeNumber, s.strokes]));
  const results: HoleResult[] = [];
  let totalStrokes = 0;
  let totalNet = 0;
  let points = 0;
  let toPar = 0;
  let frontNine = 0;
  let backNine = 0;

  for (const hole of [...holes].sort((a, b) => a.holeNumber - b.holeNumber)) {
    const strokes = byHole.get(hole.holeNumber);
    if (strokes == null || strokes <= 0) continue;
    const received = strokesReceived(playingHcp, hole.strokeIndex);
    const net = strokes - received;
    const pts = stablefordPoints(hole.par, strokes, received);
    results.push({
      holeNumber: hole.holeNumber,
      par: hole.par,
      strokeIndex: hole.strokeIndex,
      strokes,
      shotsReceived: received,
      net,
      points: pts,
      toPar: strokes - hole.par,
    });
    totalStrokes += strokes;
    totalNet += net;
    points += pts;
    toPar += strokes - hole.par;
    if (hole.holeNumber <= 9) frontNine += strokes;
    else backNine += strokes;
  }

  return {
    holesPlayed: results.length,
    totalStrokes,
    totalNet,
    points,
    toPar,
    frontNine,
    backNine,
    results,
  };
}

export type Standing = {
  playerId: string;
  playerName: string;
  groupId: string | null;
  groupName: string | null;
  tee: string;
  handicapIndex: number;
  playingHandicap: number;
  thru: number;
  totalStrokes: number;
  totalNet: number;
  points: number;
  toPar: number;
  position: number;
  tied: boolean;
  holeResults: HoleResult[];
};

/** Sort per format and assign competition positions (shared for ties). */
export function rankStandings(
  rows: Omit<Standing, "position" | "tied">[],
  format: "STABLEFORD" | "STROKE_PLAY",
): Standing[] {
  const sorted = [...rows].sort((a, b) => {
    if (format === "STROKE_PLAY") {
      if (a.thru === 0 && b.thru > 0) return 1;
      if (b.thru === 0 && a.thru > 0) return -1;
      if (a.totalNet !== b.totalNet) return a.totalNet - b.totalNet;
      if (a.totalStrokes !== b.totalStrokes) return a.totalStrokes - b.totalStrokes;
      return a.playerName.localeCompare(b.playerName);
    }
    if (a.points !== b.points) return b.points - a.points;
    if (a.thru === 0 && b.thru > 0) return 1;
    if (b.thru === 0 && a.thru > 0) return -1;
    if (a.totalStrokes !== b.totalStrokes) return a.totalStrokes - b.totalStrokes;
    return a.playerName.localeCompare(b.playerName);
  });

  const out: Standing[] = [];
  let lastKey = "";
  let lastPosition = 0;
  sorted.forEach((row, index) => {
    const key =
      format === "STROKE_PLAY"
        ? `${row.totalNet}:${row.thru === 0 ? "x" : "y"}`
        : `${row.points}:${row.thru === 0 ? "x" : "y"}`;
    const position = key === lastKey ? lastPosition : index + 1;
    lastKey = key;
    lastPosition = position;
    out.push({ ...row, position, tied: false });
  });
  // mark ties
  const counts = new Map<number, number>();
  out.forEach((r) => counts.set(r.position, (counts.get(r.position) ?? 0) + 1));
  return out.map((r) => ({ ...r, tied: (counts.get(r.position) ?? 0) > 1 }));
}

export const FORMAT_LABEL: Record<string, string> = {
  STABLEFORD: "Stableford",
  STROKE_PLAY: "Stroke play (net)",
};
