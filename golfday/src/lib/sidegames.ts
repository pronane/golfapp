/**
 * Side games and team formats, computed from the same hole results the
 * leaderboard uses. Pure functions - no database - so they are easy to test.
 */
import { strokesReceived } from "./handicap";
import type { HoleResult } from "./scoring";

export type SkinsMode = "OFF" | "NET" | "GROSS";
export type TeamFormat = "NONE" | "FOURBBB" | "MATCHPLAY";
export type SideGameKind = "NEAREST_PIN" | "LONGEST_DRIVE";

export type CardForGames = {
  playerId: string;
  playerName: string;
  thru: number;
  holeResults: HoleResult[];
};

/* ——— Skins ——— */

export type SkinHole = {
  holeNumber: number;
  /** null while the hole is still being played, or when it was halved */
  winnerId: string | null;
  winnerName: string | null;
  /** skins this hole is worth (1 + any carried in) */
  value: number;
  status: "won" | "carried" | "open";
  score: number | null;
};

export type SkinsResult = {
  holes: SkinHole[];
  totals: { playerId: string; playerName: string; skins: number }[];
  /** skins still riding on unfinished or halved holes at the end */
  carryingOver: number;
};

/**
 * Classic skins: the lowest score on a hole wins it outright; a tie means
 * nobody wins and (with carry-overs) the skin rolls onto the next hole.
 * A hole is only settled once every player who has started has scored it,
 * so the table never pays out on a half-played hole.
 */
export function computeSkins(
  cards: CardForGames[],
  holeNumbers: number[],
  mode: Exclude<SkinsMode, "OFF">,
  carryOver = true,
): SkinsResult {
  const started = cards.filter((c) => c.thru > 0);
  const byPlayer = new Map(
    started.map((c) => [c.playerId, new Map(c.holeResults.map((h) => [h.holeNumber, h]))]),
  );
  const tally = new Map<string, number>();
  const holes: SkinHole[] = [];
  let pot = 0;

  for (const holeNumber of [...holeNumbers].sort((a, b) => a - b)) {
    const value = pot + 1;
    const scores = started.map((c) => {
      const result = byPlayer.get(c.playerId)?.get(holeNumber);
      return { card: c, score: result ? (mode === "NET" ? result.net : result.strokes) : null };
    });
    const complete = started.length > 0 && scores.every((s) => s.score !== null);
    if (!complete) {
      // Later holes can't be settled before this one is (a carry may still land
      // here), so everything from here on stays open.
      holes.push({ holeNumber, winnerId: null, winnerName: null, value, status: "open", score: null });
      for (const later of holeNumbers.filter((n) => n > holeNumber).sort((a, b) => a - b)) {
        holes.push({ holeNumber: later, winnerId: null, winnerName: null, value: 1, status: "open", score: null });
      }
      return finish(holes, started, tally, pot);
    }
    const best = Math.min(...scores.map((s) => s.score as number));
    const atBest = scores.filter((s) => s.score === best);
    if (atBest.length === 1 && started.length > 1) {
      const winner = atBest[0].card;
      tally.set(winner.playerId, (tally.get(winner.playerId) ?? 0) + value);
      holes.push({ holeNumber, winnerId: winner.playerId, winnerName: winner.playerName, value, status: "won", score: best });
      pot = 0;
    } else {
      holes.push({ holeNumber, winnerId: null, winnerName: null, value, status: "carried", score: best });
      pot = carryOver ? value : 0;
    }
  }
  return finish(holes, started, tally, pot);
}

function finish(
  holes: SkinHole[],
  started: CardForGames[],
  tally: Map<string, number>,
  carryingOver: number,
): SkinsResult {
  const totals = started
    .map((c) => ({ playerId: c.playerId, playerName: c.playerName, skins: tally.get(c.playerId) ?? 0 }))
    .filter((t) => t.skins > 0)
    .sort((a, b) => b.skins - a.skins || a.playerName.localeCompare(b.playerName));
  return { holes, totals, carryingOver };
}

/* ——— 4BBB (four-ball better-ball) Stableford ——— */

export type Pair = { id: string; name: string; playerIds: [string, string] };

export type PairStanding = {
  pairId: string;
  name: string;
  players: string[];
  points: number;
  /** holes on which at least one partner has scored */
  thru: number;
  position: number;
  tied: boolean;
};

/** Each hole counts the better of the two partners' Stableford points. */
export function rankFourBall(pairs: Pair[], cards: CardForGames[]): PairStanding[] {
  const byId = new Map(cards.map((c) => [c.playerId, c]));
  const rows = pairs.map((pair) => {
    const partners = pair.playerIds.map((id) => byId.get(id)).filter((c): c is CardForGames => Boolean(c));
    const best = new Map<number, number>();
    for (const card of partners) {
      for (const h of card.holeResults) {
        best.set(h.holeNumber, Math.max(best.get(h.holeNumber) ?? 0, h.points));
      }
    }
    let points = 0;
    for (const p of best.values()) points += p;
    return {
      pairId: pair.id,
      name: pair.name,
      players: partners.map((c) => c.playerName),
      points,
      thru: best.size,
    };
  });
  rows.sort((a, b) => {
    if ((a.thru === 0) !== (b.thru === 0)) return a.thru === 0 ? 1 : -1;
    return b.points - a.points || a.name.localeCompare(b.name);
  });
  const out: PairStanding[] = [];
  rows.forEach((row, i) => {
    const prev = out[i - 1];
    const same = prev && prev.points === row.points && (prev.thru === 0) === (row.thru === 0);
    out.push({ ...row, position: same ? prev.position : i + 1, tied: false });
  });
  const counts = new Map<number, number>();
  out.forEach((r) => counts.set(r.position, (counts.get(r.position) ?? 0) + 1));
  return out.map((r) => ({ ...r, tied: (counts.get(r.position) ?? 0) > 1 }));
}

/** Pairs the players in each tee group in order (1+2, 3+4). An odd player out is left unpaired. */
export function autoPairs(
  groups: { id: string; name: string; playerIds: string[] }[],
): { name: string; playerIds: [string, string] }[] {
  const pairs: { name: string; playerIds: [string, string] }[] = [];
  for (const group of groups) {
    for (let i = 0; i + 1 < group.playerIds.length; i += 2) {
      const n = i / 2 + 1;
      pairs.push({
        name: group.playerIds.length > 2 ? `${group.name} · pair ${n}` : group.name,
        playerIds: [group.playerIds.at(i) as string, group.playerIds.at(i + 1) as string],
      });
    }
  }
  return pairs;
}

/* ——— Nearest the pin / longest drive ——— */

export type SideGameEntry = {
  kind: SideGameKind;
  holeNumber: number;
  playerId: string;
  playerName: string;
  /** feet from the hole (nearest the pin) or yards (longest drive) */
  distance: number;
};

export type SideGameLeader = {
  kind: SideGameKind;
  holeNumber: number;
  leader: SideGameEntry | null;
  entries: number;
};

/** Leader per side-game hole: smallest distance wins NTP, largest wins LD. */
export function sideGameLeaders(
  holes: { kind: SideGameKind; holeNumber: number }[],
  entries: SideGameEntry[],
): SideGameLeader[] {
  return holes.map(({ kind, holeNumber }) => {
    const mine = entries.filter((e) => e.kind === kind && e.holeNumber === holeNumber);
    const sorted = [...mine].sort((a, b) =>
      kind === "NEAREST_PIN" ? a.distance - b.distance : b.distance - a.distance,
    );
    return { kind, holeNumber, leader: sorted.at(0) ?? null, entries: mine.length };
  });
}

export function formatDistance(kind: SideGameKind, distance: number): string {
  if (kind === "LONGEST_DRIVE") return `${Math.round(distance)} yd`;
  const feet = Math.floor(distance);
  const inches = Math.round((distance - feet) * 12);
  if (inches === 12) return `${feet + 1}ft`;
  return inches ? `${feet}ft ${inches}in` : `${feet}ft`;
}

/* ——— Ryder Cup-style team match play ——— */

export type MatchSide = "A" | "B";

export type MatchCard = {
  playerId: string;
  playerName: string;
  playingHandicap: number;
  /** hole number -> gross strokes */
  strokes: Map<number, number>;
};

export type MatchDefinition = { id: string; name: string; sideA: string[]; sideB: string[] };

export type MatchResult = {
  id: string;
  name: string;
  sideA: string[];
  sideB: string[];
  /** holes both sides have completed, in order from the first hole */
  holesPlayed: number;
  /** positive = side A ahead */
  up: number;
  finished: boolean;
  winner: MatchSide | "HALVED" | null;
  /** "2 UP", "AS", "3&2", "1 UP" (final), "Halved", "Not started" */
  status: string;
  /** points each side has banked (1 / ½ / 0) — only once the match is over */
  points: { A: number; B: number };
  /** the side ahead right now, for projected totals */
  leading: MatchSide | null;
};

/**
 * Match play off the low handicap: in each match every player's playing
 * handicap is reduced by the lowest one in the match, and those strokes are
 * taken on the hardest holes (stroke index). Singles compare net scores;
 * with two a side it's fourball — the better net ball on each side counts.
 *
 * A hole counts once every player in the match has scored it, and holes are
 * taken in order, so a match can't run ahead of a missing score. The match is
 * over when the lead is bigger than the holes left ("3&2"), or after the last
 * hole ("1 UP", "Halved").
 */
export function computeMatch(
  match: MatchDefinition,
  cards: Map<string, MatchCard>,
  holes: { holeNumber: number; strokeIndex: number }[],
): MatchResult {
  const a = match.sideA.map((id) => cards.get(id)).filter((c): c is MatchCard => Boolean(c));
  const b = match.sideB.map((id) => cards.get(id)).filter((c): c is MatchCard => Boolean(c));
  const ordered = [...holes].sort((x, y) => x.holeNumber - y.holeNumber);
  const base: MatchResult = {
    id: match.id,
    name: match.name,
    sideA: a.map((c) => c.playerName),
    sideB: b.map((c) => c.playerName),
    holesPlayed: 0,
    up: 0,
    finished: false,
    winner: null,
    status: "Not started",
    points: { A: 0, B: 0 },
    leading: null,
  };
  if (a.length === 0 || b.length === 0 || ordered.length === 0) return base;

  const low = Math.min(...[...a, ...b].map((c) => c.playingHandicap));
  const net = (card: MatchCard, hole: { holeNumber: number; strokeIndex: number }) => {
    const gross = card.strokes.get(hole.holeNumber);
    if (gross == null) return null;
    return gross - strokesReceived(card.playingHandicap - low, hole.strokeIndex);
  };

  let up = 0;
  let played = 0;
  for (const hole of ordered) {
    const aNet = a.map((c) => net(c, hole));
    const bNet = b.map((c) => net(c, hole));
    if ([...aNet, ...bNet].some((v) => v === null)) break;
    const bestA = Math.min(...(aNet as number[]));
    const bestB = Math.min(...(bNet as number[]));
    if (bestA < bestB) up += 1;
    else if (bestB < bestA) up -= 1;
    played += 1;
    const left = ordered.length - played;
    if (Math.abs(up) > left) {
      const winner: MatchSide = up > 0 ? "A" : "B";
      return {
        ...base,
        holesPlayed: played,
        up,
        finished: true,
        winner,
        status: left === 0 ? `${Math.abs(up)} UP` : `${Math.abs(up)}&${left}`,
        points: winner === "A" ? { A: 1, B: 0 } : { A: 0, B: 1 },
        leading: winner,
      };
    }
  }

  if (played === ordered.length) {
    // Level after the last hole (anything else returned above).
    return { ...base, holesPlayed: played, up: 0, finished: true, winner: "HALVED", status: "Halved", points: { A: 0.5, B: 0.5 } };
  }
  return {
    ...base,
    holesPlayed: played,
    up,
    status: played === 0 ? "Not started" : up === 0 ? `AS thru ${played}` : `${Math.abs(up)} UP thru ${played}`,
    leading: up > 0 ? "A" : up < 0 ? "B" : null,
  };
}

export type TeamMatchBoard = {
  teamNames: [string, string];
  matches: MatchResult[];
  /** points banked from finished matches */
  banked: { A: number; B: number };
  /** banked plus every live match counted for whoever leads it (½ each if level) */
  projected: { A: number; B: number };
  /** points needed to win outright (more than half of all matches) */
  toWin: number;
};

export function teamMatchBoard(
  teamNames: [string, string],
  defs: MatchDefinition[],
  cards: Map<string, MatchCard>,
  holes: { holeNumber: number; strokeIndex: number }[],
): TeamMatchBoard {
  const matches = defs.map((d) => computeMatch(d, cards, holes));
  const banked = { A: 0, B: 0 };
  const projected = { A: 0, B: 0 };
  for (const m of matches) {
    banked.A += m.points.A;
    banked.B += m.points.B;
    if (m.finished) {
      projected.A += m.points.A;
      projected.B += m.points.B;
    } else if (m.holesPlayed > 0) {
      if (m.leading === "A") projected.A += 1;
      else if (m.leading === "B") projected.B += 1;
      else {
        projected.A += 0.5;
        projected.B += 0.5;
      }
    }
  }
  return { teamNames, matches, banked, projected, toWin: matches.length / 2 + 0.5 };
}
