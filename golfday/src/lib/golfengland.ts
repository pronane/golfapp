/**
 * Golf England / WHS handicap lookup.
 *
 * England Golf does not publish an open, unauthenticated API. The two supported
 * routes are:
 *   1. WHS "CDH" (Centralised Handicap Database) API - available to clubs and
 *      iGolf subscribers via England Golf, usually with a partner API key.
 *   2. A CSV export from the club's handicap software (fully supported here).
 *
 * This adapter therefore ships with a realistic mock directory so the feature
 * can be demonstrated end-to-end, and a `cdh` mode that simply points at the
 * configured endpoint without changing any application code.
 */
import { ApiError } from "./http";

export type GolfEnglandPlayer = {
  golfEnglandId: string;
  name: string;
  handicapIndex: number;
  homeClub: string;
  country: string;
  gender?: "M" | "F" | "X";
  source: "GOLF_ENGLAND" | "MOCK";
  updatedAt: string;
};

const MOCK_DIRECTORY: GolfEnglandPlayer[] = [
  { golfEnglandId: "GE100241", name: "Sarah Whitcombe", handicapIndex: 8.4, homeClub: "Sunningdale Golf Club", country: "ENG", gender: "F", source: "MOCK", updatedAt: "2026-09-30" },
  { golfEnglandId: "GE100242", name: "James Ellerton", handicapIndex: 12.1, homeClub: "Wentworth Club", country: "ENG", gender: "M", source: "MOCK", updatedAt: "2026-09-30" },
  { golfEnglandId: "GE100243", name: "Priya Raman", handicapIndex: 5.2, homeClub: "Walton Heath Golf Club", country: "ENG", gender: "F", source: "MOCK", updatedAt: "2026-09-30" },
  { golfEnglandId: "GE100244", name: "Tom Beresford", handicapIndex: 17.8, homeClub: "The Belfry", country: "ENG", gender: "M", source: "MOCK", updatedAt: "2026-09-30" },
  { golfEnglandId: "GE100245", name: "Callum Ó Dálaigh", handicapIndex: 3.6, homeClub: "Celtic Manor Resort", country: "WAL", gender: "M", source: "MOCK", updatedAt: "2026-09-30" },
  { golfEnglandId: "GE100246", name: "Fiona MacLeod", handicapIndex: 14.9, homeClub: "St Andrews Links", country: "SCO", gender: "F", source: "MOCK", updatedAt: "2026-09-30" },
  { golfEnglandId: "GE100247", name: "Daniel Okafor", handicapIndex: 9.7, homeClub: "Sunningdale Golf Club", country: "ENG", gender: "M", source: "MOCK", updatedAt: "2026-09-30" },
  { golfEnglandId: "GE100248", name: "Mei Chen", handicapIndex: 21.3, homeClub: "Wentworth Club", country: "ENG", gender: "F", source: "MOCK", updatedAt: "2026-09-30" },
  { golfEnglandId: "GE100249", name: "Alex Hartley", handicapIndex: 6.1, homeClub: "Walton Heath Golf Club", country: "ENG", gender: "M", source: "MOCK", updatedAt: "2026-09-30" },
  { golfEnglandId: "GE100250", name: "Nina Petrova", handicapIndex: 11.4, homeClub: "The Belfry", country: "ENG", gender: "F", source: "MOCK", updatedAt: "2026-09-30" },
];

export function golfEnglandMode(): "mock" | "cdh" {
  return (process.env.GOLF_ENGLAND_MODE ?? "mock").toLowerCase() === "cdh" ? "cdh" : "mock";
}

export function searchMockDirectory(query: string): GolfEnglandPlayer[] {
  const q = query.trim().toLowerCase();
  return MOCK_DIRECTORY.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.golfEnglandId.toLowerCase().includes(q) ||
      p.homeClub.toLowerCase().includes(q),
  );
}

/** Looks a golfer up by Golf England (CDH) ID. */
export async function lookupByGolfEnglandId(id: string): Promise<GolfEnglandPlayer | null> {
  const trimmed = id.trim().toUpperCase();
  if (!trimmed) return null;
  if (golfEnglandMode() === "cdh") {
    const base = process.env.CDH_API_BASE;
    const key = process.env.CDH_API_KEY;
    if (!base || !key) {
      throw new ApiError(503, "Golf England CDH is selected but CDH_API_BASE / CDH_API_KEY are not configured", "integration_not_configured");
    }
    const res = await fetch(`${base}/golfers/${encodeURIComponent(trimmed)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new ApiError(502, `Golf England lookup failed (${res.status})`, "integration_error");
    const raw: any = await res.json();
    return {
      golfEnglandId: trimmed,
      name: raw.name ?? raw.fullName ?? "",
      handicapIndex: Number(raw.handicapIndex ?? raw.handicap ?? 0),
      homeClub: raw.homeClub ?? raw.club ?? "",
      country: raw.country ?? "ENG",
      gender: raw.gender,
      source: "GOLF_ENGLAND",
      updatedAt: raw.updatedAt ?? new Date().toISOString().slice(0, 10),
    };
  }
  return MOCK_DIRECTORY.find((p) => p.golfEnglandId.toUpperCase() === trimmed) ?? null;
}

export type CsvPlayerRow = {
  name: string;
  email?: string;
  handicapIndex: number;
  golfEnglandId?: string;
  homeClub?: string;
  gender?: string;
};

/** Very small RFC4180-ish CSV parser (handles quotes, CRLF, commas in quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += char;
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field); field = "";
    } else if (char === "\n") {
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else if (char !== "\r") {
      field += char;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, keyof CsvPlayerRow> = {
  name: "name", "player name": "name", golfer: "name", "full name": "name",
  email: "email", "e-mail": "email",
  handicap: "handicapIndex", "handicap index": "handicapIndex", hi: "handicapIndex", hcp: "handicapIndex",
  "golf england id": "golfEnglandId", "golfengland id": "golfEnglandId", cdh: "golfEnglandId", "cdh id": "golfEnglandId", "england golf id": "golfEnglandId",
  club: "homeClub", "home club": "homeClub",
  gender: "gender", sex: "gender",
};

export function parsePlayerCsv(text: string): { rows: CsvPlayerRow[]; errors: string[] } {
  const table = parseCsv(text);
  const errors: string[] = [];
  if (table.length === 0) return { rows: [], errors: ["The file is empty"] };
  const header = table[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? null);
  if (!header.includes("name")) {
    return { rows: [], errors: ["Could not find a 'name' column. Expected headers like: name, email, handicap, golf england id, club"] };
  }
  const rows: CsvPlayerRow[] = [];
  table.slice(1).forEach((cells, index) => {
    const record: Partial<CsvPlayerRow> = {};
    let invalidHandicap = false;
    cells.forEach((cell, i) => {
      const key = header[i];
      if (!key) return;
      const value = cell.trim();
      if (!value) return;
      if (key === "handicapIndex") {
        const parsed = Number(value.replace(",", "."));
        if (Number.isNaN(parsed)) {
          errors.push(`Row ${index + 2}: handicap "${value}" is not a number - row skipped`);
          invalidHandicap = true;
          return;
        }
        record.handicapIndex = parsed;
      } else {
        record[key] = value as never;
      }
    });
    if (invalidHandicap) return;
    if (!record.name) { errors.push(`Row ${index + 2}: missing name - row skipped`); return; }
    rows.push({
      name: record.name,
      email: record.email,
      handicapIndex: record.handicapIndex ?? 0,
      golfEnglandId: record.golfEnglandId,
      homeClub: record.homeClub,
      gender: record.gender,
    });
  });
  return { rows, errors };
}
