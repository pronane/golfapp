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
  /** Net score relative to par for the holes played - the live stroke-play number. */
  netToPar: number;
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
  let netToPar = 0;
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
    netToPar += net - hole.par;
    if (hole.holeNumber <= 9) frontNine += strokes;
    else backNine += strokes;
  }

  return {
    holesPlayed: results.length,
    totalStrokes,
    totalNet,
    netToPar,
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
  /** Net to par over the holes played (falls back to totalNet for legacy rows). */
  netToPar: number;
  points: number;
  toPar: number;
  position: number;
  tied: boolean;
  holeResults: HoleResult[];
};

type RankInput = Omit<Standing, "position" | "tied" | "netToPar"> & { netToPar?: number };

function netToParOf(row: RankInput): number {
  if (row.netToPar != null) return row.netToPar;
  if (row.holeResults.length > 0) return row.holeResults.reduce((sum, h) => sum + h.net - h.par, 0);
  return row.totalNet;
}

/**
 * Standard (CONGU-style) card countback for completed rounds: compare the last
 * 9, 6, 3 and 1 holes. Stableford compares points (higher wins); net stroke
 * play compares gross minus 1/2, 1/3, 1/6 and 1/18 of the playing handicap
 * (lower wins). Returned as a list of numbers where *lower is better*.
 */
export function countback(
  row: Pick<Standing, "holeResults" | "playingHandicap">,
  format: "STABLEFORD" | "STROKE_PLAY",
  holesInCard: number,
): number[] {
  const byHole = new Map(row.holeResults.map((h) => [h.holeNumber, h]));
  const segments = holesInCard >= 18 ? [9, 6, 3, 1] : [Math.ceil(holesInCard / 2), 3, 1];
  return segments.map((n) => {
    let points = 0;
    let gross = 0;
    for (let hole = holesInCard - n + 1; hole <= holesInCard; hole += 1) {
      const result = byHole.get(hole);
      points += result?.points ?? 0;
      gross += result?.strokes ?? 0;
    }
    return format === "STABLEFORD" ? -points : gross - (row.playingHandicap * n) / holesInCard;
  });
}

/**
 * Sort per format and assign competition positions.
 *
 * Live rounds share positions on equal scores. Once both players have
 * completed the card, ties are split on countback so the organiser has a
 * winner without doing it by hand.
 *
 * Stroke play ranks by **net to par over the holes played**, not raw net
 * strokes - otherwise a player through 3 holes (net 12) "led" a player who had
 * finished on net 70.
 */
export function rankStandings(
  rows: RankInput[],
  format: "STABLEFORD" | "STROKE_PLAY",
  holesInCard = 18,
): Standing[] {
  const enriched = rows.map((row) => ({ ...row, netToPar: netToParOf(row) }));
  const complete = (r: { thru: number }) => r.thru > 0 && r.thru >= holesInCard;
  const primary = (r: (typeof enriched)[number]) =>
    format === "STROKE_PLAY" ? r.netToPar : -r.points;

  const compareCountback = (a: (typeof enriched)[number], b: (typeof enriched)[number]) => {
    if (!complete(a) || !complete(b)) return 0;
    const ca = countback(a, format, holesInCard);
    const cb = countback(b, format, holesInCard);
    for (let i = 0; i < ca.length; i += 1) {
      if (ca[i] !== cb[i]) return ca[i] - cb[i];
    }
    return 0;
  };

  const sorted = [...enriched].sort((a, b) => {
    // Players with no score yet always sit at the bottom.
    if (a.thru === 0 && b.thru > 0) return 1;
    if (b.thru === 0 && a.thru > 0) return -1;
    if (primary(a) !== primary(b)) return primary(a) - primary(b);
    const cb = compareCountback(a, b);
    if (cb !== 0) return cb;
    return a.playerName.localeCompare(b.playerName);
  });

  const out: Standing[] = [];
  sorted.forEach((row, index) => {
    const prev = index > 0 ? sorted[index - 1] : null;
    const sameAsPrev =
      prev !== null &&
      (prev.thru === 0) === (row.thru === 0) &&
      primary(prev) === primary(row) &&
      compareCountback(prev, row) === 0;
    const position = sameAsPrev ? out[index - 1].position : index + 1;
    out.push({ ...row, position, tied: false });
  });
  const counts = new Map<number, number>();
  out.forEach((r) => counts.set(r.position, (counts.get(r.position) ?? 0) + 1));
  return out.map((r) => ({ ...r, tied: (counts.get(r.position) ?? 0) > 1 }));
}

export const FORMAT_LABEL: Record<string, string> = {
  STABLEFORD: "Stableford",
  STROKE_PLAY: "Stroke play (net)",
};
