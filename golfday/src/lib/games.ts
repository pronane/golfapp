/**
 * Storage for game settings, 4BBB pairs and side-game measurements, plus the
 * glue that turns them into leaderboard-ready results.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eventPairs, eventSettings, sideGameEntries } from "@/db/schema";
import { newId } from "./ids";
import type { Standing } from "./scoring";
import {
  computeSkins,
  rankFourBall,
  sideGameLeaders,
  teamMatchBoard,
  type MatchCard,
  type MatchDefinition,
  type TeamMatchBoard,
  type PairStanding,
  type SideGameEntry,
  type SideGameKind,
  type SideGameLeader,
  type SkinsMode,
  type SkinsResult,
  type TeamFormat,
} from "./sidegames";

export type Sponsor = { name: string; url?: string };
export type SideHole = { kind: SideGameKind; holeNumber: number };

export type GameSettings = {
  skins: SkinsMode;
  skinsCarry: boolean;
  teamFormat: TeamFormat;
  sideHoles: SideHole[];
  sponsors: Sponsor[];
  /** team match play: the two team names */
  teamNames: [string, string];
  /** team match play: who plays whom (1 or 2 players a side) */
  matches: MatchDefinition[];
  /** 0 = free entry */
  entryFeePence: number;
};

export const DEFAULT_SETTINGS: GameSettings = {
  skins: "OFF",
  skinsCarry: true,
  teamFormat: "NONE",
  sideHoles: [],
  sponsors: [],
  teamNames: ["Team A", "Team B"],
  matches: [],
  entryFeePence: 0,
};

const SKINS = new Set(["OFF", "NET", "GROSS"]);
const FORMATS = new Set(["NONE", "FOURBBB", "MATCHPLAY"]);
const KINDS = new Set(["NEAREST_PIN", "LONGEST_DRIVE"]);

function parseJsonArray(raw: string | null | undefined): unknown[] {
  try {
    const value = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** Validates settings from the API or the database; drops anything malformed. */
export function cleanSettings(raw: Partial<Record<keyof GameSettings, unknown>>, holeCount = 18): GameSettings {
  const sideHoles: SideHole[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.sideHoles) ? raw.sideHoles : []) {
    const h = (item ?? {}) as { kind?: unknown; holeNumber?: unknown };
    const holeNumber = Number(h.holeNumber);
    if (typeof h.kind !== "string" || !KINDS.has(h.kind)) continue;
    if (!Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > holeCount) continue;
    const key = `${h.kind}:${holeNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sideHoles.push({ kind: h.kind as SideGameKind, holeNumber });
  }
  const sponsors: Sponsor[] = [];
  for (const item of Array.isArray(raw.sponsors) ? raw.sponsors : []) {
    const sp = (item ?? {}) as { name?: unknown; url?: unknown };
    const name = typeof sp.name === "string" ? sp.name.trim().slice(0, 60) : "";
    if (!name) continue;
    const url = typeof sp.url === "string" ? sp.url.trim() : "";
    // Only plain web links - no javascript: or data: URLs on a public page.
    sponsors.push(/^https?:\/\/[^\s]+$/i.test(url) ? { name, url: url.slice(0, 300) } : { name });
    if (sponsors.length >= 8) break;
  }
  const names = Array.isArray(raw.teamNames) ? raw.teamNames : [];
  const teamName = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 30) : fallback;
  const teamNames: [string, string] = [teamName(names[0], "Team A"), teamName(names[1], "Team B")];

  // Match definitions: 1 or 2 players a side, nobody on both sides or in two
  // matches. Whether the players are actually registered is checked by the API.
  const matches: MatchDefinition[] = [];
  const inAMatch = new Set<string>();
  const ids = (v: unknown) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))] : [];
  for (const item of Array.isArray(raw.matches) ? raw.matches : []) {
    const m = (item ?? {}) as { id?: unknown; name?: unknown; sideA?: unknown; sideB?: unknown };
    const sideA = ids(m.sideA).slice(0, 2);
    const sideB = ids(m.sideB).slice(0, 2);
    if (sideA.length === 0 || sideB.length === 0) continue;
    if ([...sideA, ...sideB].some((id) => inAMatch.has(id))) continue;
    [...sideA, ...sideB].forEach((id) => inAMatch.add(id));
    const n = matches.length + 1;
    matches.push({
      id: typeof m.id === "string" && m.id ? m.id.slice(0, 40) : `m${n}`,
      name: typeof m.name === "string" && m.name.trim() ? m.name.trim().slice(0, 40) : `Match ${n}`,
      sideA,
      sideB,
    });
    if (matches.length >= 40) break;
  }

  const fee = Math.round(Number(raw.entryFeePence));
  const entryFeePence = Number.isFinite(fee) ? Math.max(0, Math.min(50_000, fee)) : 0;

  return {
    teamNames,
    matches,
    entryFeePence,
    skins: typeof raw.skins === "string" && SKINS.has(raw.skins) ? (raw.skins as SkinsMode) : "OFF",
    skinsCarry: raw.skinsCarry === undefined ? true : Boolean(raw.skinsCarry),
    teamFormat:
      typeof raw.teamFormat === "string" && FORMATS.has(raw.teamFormat) ? (raw.teamFormat as TeamFormat) : "NONE",
    sideHoles: sideHoles.sort((a, b) => a.holeNumber - b.holeNumber || a.kind.localeCompare(b.kind)),
    sponsors,
  };
}

export async function getGameSettings(eventId: string): Promise<GameSettings> {
  const [row] = await db.select().from(eventSettings).where(eq(eventSettings.eventId, eventId)).limit(1);
  if (!row) return DEFAULT_SETTINGS;
  return cleanSettings({
    skins: row.skins,
    skinsCarry: row.skinsCarry,
    teamFormat: row.teamFormat,
    sideHoles: parseJsonArray(row.sideHoles),
    sponsors: parseJsonArray(row.sponsors),
    teamNames: parseJsonArray(row.teamNames),
    matches: parseJsonArray(row.matches),
    entryFeePence: row.entryFeePence,
  }, 36);
}

export async function saveGameSettings(eventId: string, settings: GameSettings): Promise<void> {
  const values = {
    skins: settings.skins,
    skinsCarry: settings.skinsCarry,
    teamFormat: settings.teamFormat,
    sideHoles: JSON.stringify(settings.sideHoles),
    sponsors: JSON.stringify(settings.sponsors),
    teamNames: JSON.stringify(settings.teamNames),
    matches: JSON.stringify(settings.matches),
    entryFeePence: settings.entryFeePence,
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(eventSettings)
    .values({ eventId, ...values })
    .onConflictDoUpdate({ target: eventSettings.eventId, set: values });
}

export async function listPairs(eventId: string) {
  return db.select().from(eventPairs).where(eq(eventPairs.eventId, eventId)).orderBy(asc(eventPairs.sortOrder));
}

export async function replacePairs(
  eventId: string,
  pairs: { name: string; playerIds: [string, string] }[],
): Promise<void> {
  await db.delete(eventPairs).where(eq(eventPairs.eventId, eventId));
  if (pairs.length === 0) return;
  await db.insert(eventPairs).values(
    pairs.map((p, i) => ({
      id: newId(),
      eventId,
      name: p.name.slice(0, 80),
      playerA: p.playerIds[0],
      playerB: p.playerIds[1],
      sortOrder: i,
    })),
  );
}

export async function listSideEntries(eventId: string) {
  return db.select().from(sideGameEntries).where(eq(sideGameEntries.eventId, eventId));
}

export async function upsertSideEntry(input: {
  eventId: string;
  kind: SideGameKind;
  holeNumber: number;
  playerId: string;
  distance: number;
  recordedBy: string;
}): Promise<void> {
  const now = new Date().toISOString();
  await db
    .insert(sideGameEntries)
    .values({ id: newId(), ...input, updatedAt: now })
    .onConflictDoUpdate({
      target: [sideGameEntries.eventId, sideGameEntries.kind, sideGameEntries.holeNumber, sideGameEntries.playerId],
      set: { distance: input.distance, recordedBy: input.recordedBy, updatedAt: now },
    });
}

export async function deleteSideEntry(eventId: string, kind: SideGameKind, holeNumber: number, playerId: string) {
  await db
    .delete(sideGameEntries)
    .where(
      and(
        eq(sideGameEntries.eventId, eventId),
        eq(sideGameEntries.kind, kind),
        eq(sideGameEntries.holeNumber, holeNumber),
        eq(sideGameEntries.playerId, playerId),
      ),
    );
}

export async function deleteEventGames(eventId: string) {
  await db.delete(sideGameEntries).where(eq(sideGameEntries.eventId, eventId));
  await db.delete(eventPairs).where(eq(eventPairs.eventId, eventId));
  await db.delete(eventSettings).where(eq(eventSettings.eventId, eventId));
}

export type GamesPayload = {
  /** public subset: the match list and fee are summarised below instead */
  settings: Pick<GameSettings, "skins" | "skinsCarry" | "teamFormat" | "sideHoles" | "sponsors" | "teamNames">;
  matchPlay: TeamMatchBoard | null;
  skins: SkinsResult | null;
  pairs: PairStanding[] | null;
  sideGames: (SideGameLeader & { label: string })[];
};

/** Everything the leaderboard shows besides the main table. */
export async function buildGames(
  eventId: string,
  standings: Standing[],
  holes: { holeNumber: number; strokeIndex: number }[],
): Promise<GamesPayload> {
  const holeNumbers = holes.map((h) => h.holeNumber);
  const [settings, pairRows, entryRows] = await Promise.all([
    getGameSettings(eventId),
    listPairs(eventId),
    listSideEntries(eventId),
  ]);
  const cards = standings.map((s) => ({
    playerId: s.playerId,
    playerName: s.playerName,
    thru: s.thru,
    holeResults: s.holeResults,
  }));
  const names = new Map(standings.map((s) => [s.playerId, s.playerName]));

  const matchCards = new Map<string, MatchCard>(
    standings.map((s) => [
      s.playerId,
      {
        playerId: s.playerId,
        playerName: s.playerName,
        playingHandicap: s.playingHandicap,
        strokes: new Map(s.holeResults.map((h) => [h.holeNumber, h.strokes])),
      },
    ]),
  );
  const matchPlay =
    settings.teamFormat === "MATCHPLAY" && settings.matches.length > 0
      ? teamMatchBoard(settings.teamNames, settings.matches, matchCards, holes)
      : null;

  const skins = settings.skins === "OFF" ? null : computeSkins(cards, holeNumbers, settings.skins, settings.skinsCarry);
  const pairs =
    settings.teamFormat === "FOURBBB"
      ? rankFourBall(
          pairRows.map((p) => ({ id: p.id, name: p.name, playerIds: [p.playerA, p.playerB] as [string, string] })),
          cards,
        )
      : null;
  const entries: SideGameEntry[] = entryRows
    // Withdrawn players' measurements no longer count.
    .filter((e) => names.has(e.playerId))
    .map((e) => ({
      kind: e.kind as SideGameKind,
      holeNumber: e.holeNumber,
      playerId: e.playerId,
      playerName: names.get(e.playerId) ?? "",
      distance: e.distance,
    }));
  const sideGames = sideGameLeaders(settings.sideHoles, entries).map((g) => ({
    ...g,
    label: `${g.kind === "NEAREST_PIN" ? "Nearest the pin" : "Longest drive"} · hole ${g.holeNumber}`,
  }));
  const { skins: skinsMode, skinsCarry, teamFormat, sideHoles, sponsors, teamNames } = settings;
  return {
    settings: { skins: skinsMode, skinsCarry, teamFormat, sideHoles, sponsors, teamNames },
    matchPlay,
    skins,
    pairs,
    sideGames,
  };
}
