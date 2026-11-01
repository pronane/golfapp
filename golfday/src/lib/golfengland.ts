/**
 * Handicap lookups, and where a society's numbers come from.
 *
 * Five sources, resolved per society (falling back to the deployment default):
 *
 *   MANUAL     the organiser/player types the index in - always available
 *   DIRECTORY  the built-in demo directory (`mock`) - no credentials needed
 *   WHS        the national WHS platform (DotGolf ISV API, see ./whs.ts)
 *   GHIN / GOLF_CANADA / GOLF_AUSTRALIA
 *              overseas systems, same idea - see ./overseas.ts
 *   CDH        a society's own `GET {base}/golfers/{id}` proxy
 *
 * Nothing downstream cares which one answered: every path returns the same
 * `GolfEnglandPlayer` shape, and a lookup only ever *offers* a number - the
 * organiser can still overwrite it before saving.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { societies } from "@/db/schema";
import { ApiError } from "./http";
import { openSecret } from "./secrets";
import { DEFAULT_WHS_BASE, WHS_COUNTRIES, lookupCdhProxy, lookupWhsHandicap, type WhsConfig } from "./whs";
import {
  OVERSEAS_PRESETS,
  OVERSEAS_PROVIDER_IDS,
  isOverseasProvider,
  lookupOverseasHandicap,
  type OverseasConfig,
  type OverseasProviderId,
} from "./overseas";

export type GolfEnglandPlayer = {
  golfEnglandId: string;
  name: string;
  handicapIndex: number;
  homeClub: string;
  country: string;
  gender?: "M" | "F" | "X";
  source: "GOLF_ENGLAND" | "MOCK" | "WHS" | "CDH" | "DIRECTORY" | "OVERSEAS";
  updatedAt: string;
  /** Which system answered, when it was an overseas one ("GHIN", "Golf Canada"...). */
  provider?: string;
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

export type HandicapSource = "MANUAL" | "DIRECTORY" | "WHS" | "CDH" | OverseasProviderId;

export type ResolvedProvider = {
  source: HandicapSource;
  /** Human-readable description of where the numbers come from. */
  label: string;
  /** True when a lookup can actually be attempted right now. */
  ready: boolean;
  /** Why it is not ready, or a warning worth showing an organiser. */
  detail: string;
  societyId: string | null;
  societyName: string | null;
  country: string;
  whs?: WhsConfig;
  cdh?: { baseUrl: string; apiKey?: string | null; country: string };
  overseas?: OverseasConfig;
};

export const HANDICAP_SOURCES: { value: HandicapSource; label: string; blurb: string }[] = [
  {
    value: "MANUAL",
    label: "Typed in by hand",
    blurb: "No external lookups. Organisers and players enter a handicap index themselves.",
  },
  {
    value: "DIRECTORY",
    label: "GolfDay directory",
    blurb: "Search the players already in GolfDay. No credentials, no outside calls - the default.",
  },
  {
    value: "WHS",
    label: "National WHS database",
    blurb:
      "England Golf, Scottish Golf, Wales Golf or Golf Ireland via the DotGolf ISV API. Needs the club's credentials.",
  },
  ...OVERSEAS_PROVIDER_IDS.map((id) => ({
    value: id as HandicapSource,
    label: OVERSEAS_PRESETS[id].label,
    blurb: `Look up a ${OVERSEAS_PRESETS[id].idLabel} on ${OVERSEAS_PRESETS[id].federation}. Needs that organisation's credentials.`,
  })),
  {
    value: "CDH",
    label: "Our own CDH endpoint",
    blurb: "A REST endpoint you run that answers GET {base}/golfers/{id}. Useful when your club software exports one.",
  },
];

function envProvider(): ResolvedProvider {
  const mode = (process.env.GOLF_ENGLAND_MODE ?? "mock").toLowerCase();
  const country = (process.env.WHS_COUNTRY ?? "eng").toLowerCase();
  if (mode === "whs") {
    const baseUrl = process.env.WHS_API_BASE || DEFAULT_WHS_BASE;
    const clientToken = process.env.WHS_CLIENT_TOKEN || null;
    const username = process.env.WHS_API_USERNAME || null;
    const secretKey = process.env.WHS_API_SECRET || null;
    const ready = Boolean(clientToken || (username && secretKey));
    return {
      source: "WHS",
      label: `National WHS database (${WHS_COUNTRIES[(country as keyof typeof WHS_COUNTRIES)]?.label ?? "WHS"})`,
      ready,
      detail: ready ? "Configured from the deployment environment." : "WHS_API_USERNAME / WHS_API_SECRET are not set.",
      societyId: null,
      societyName: null,
      country,
      whs: { baseUrl, country, username, secretKey, clientToken },
    };
  }
  if (mode === "ghin" || mode === "golfcanada" || mode === "golfaustralia") {
    const provider: OverseasProviderId =
      mode === "ghin" ? "GHIN" : mode === "golfcanada" ? "GOLF_CANADA" : "GOLF_AUSTRALIA";
    const preset = OVERSEAS_PRESETS[provider];
    const envPrefix = `OVERSEAS_${provider}`;
    const baseUrl = process.env[`${envPrefix}_API_BASE`] || preset.defaultBase;
    const username = process.env[`${envPrefix}_USERNAME`] || null;
    const secret = process.env[`${envPrefix}_SECRET`] || null;
    const clientToken = process.env[`${envPrefix}_CLIENT_TOKEN`] || null;
    const ready = Boolean(secret && (preset.auth === "key" || username));
    return {
      source: provider,
      label: `Overseas database - ${preset.label}`,
      ready,
      detail: ready
        ? "Configured from the deployment environment."
        : `${envPrefix}_${preset.auth === "key" ? "SECRET" : "USERNAME / SECRET"} are not set.`,
      societyId: null,
      societyName: null,
      country: preset.country,
      overseas: { provider, baseUrl, username, secret, clientToken },
    };
  }
  if (mode === "cdh") {
    const baseUrl = process.env.CDH_API_BASE ?? "";
    const apiKey = process.env.CDH_API_KEY ?? null;
    return {
      source: "CDH",
      label: "CDH endpoint (deployment default)",
      ready: Boolean(baseUrl),
      detail: baseUrl ? "Configured from the deployment environment." : "CDH_API_BASE is not set.",
      societyId: null,
      societyName: null,
      country,
      cdh: { baseUrl, apiKey, country },
    };
  }
  return {
    source: "DIRECTORY",
    label: "GolfDay directory",
    ready: true,
    detail: "No external handicap database is configured.",
    societyId: null,
    societyName: null,
    country,
  };
}

/**
 * Works out where a society's handicaps come from. A society that has never
 * been configured inherits the deployment default, so existing installs keep
 * working exactly as before.
 */
export async function resolveHandicapProvider(options?: { societyId?: string | null }): Promise<ResolvedProvider> {
  const societyId = options?.societyId ?? null;
  if (!societyId) return envProvider();
  const [society] = await db.select().from(societies).where(eq(societies.id, societyId)).limit(1);
  if (!society) return envProvider();

  const source = (society.handicapSource as HandicapSource) ?? "DIRECTORY";
  const country = (society.handicapCountry ?? "eng").toLowerCase();
  const base = {
    societyId: society.id,
    societyName: society.name,
    country,
  };

  if (source === "MANUAL") {
    return { ...base, source, label: "Typed in by hand", ready: true, detail: `${society.name} does not use an external database.` };
  }
  if (source === "WHS") {
    const clientToken = openSecret(society.handicapClientToken);
    const secretKey = openSecret(society.handicapApiSecret);
    const username = society.handicapApiUsername ?? null;
    const ready = Boolean(clientToken || (username && secretKey));
    return {
      ...base,
      source,
      label: `National WHS database (${WHS_COUNTRIES[(country as keyof typeof WHS_COUNTRIES)]?.label ?? "WHS"})`,
      ready,
      detail: ready
        ? "Lookups go to the national WHS platform with this society's credentials."
        : "Add the club username and secret key (or a client token) to turn lookups on.",
      whs: { baseUrl: society.handicapApiBase || DEFAULT_WHS_BASE, country, username, secretKey, clientToken },
    };
  }
  if (isOverseasProvider(source)) {
    const preset = OVERSEAS_PRESETS[source];
    const apiBase = society.handicapApiBase || preset.defaultBase;
    const username = society.handicapApiUsername ?? null;
    const secret = openSecret(society.handicapApiSecret);
    const ready = Boolean(secret && (preset.auth === "key" || username));
    return {
      ...base,
      source,
      label: `Overseas database - ${preset.label}`,
      ready,
      detail: ready
        ? `Lookups go to ${preset.label} with this society's credentials.`
        : `Add the ${preset.auth === "key" ? "API key" : "organisation username and password"} to turn lookups on.`,
      country: preset.country,
      overseas: { provider: source, baseUrl: apiBase, username, secret, clientToken: openSecret(society.handicapClientToken) },
    };
  }
  if (source === "CDH") {
    const baseUrl = society.handicapApiBase ?? "";
    return {
      ...base,
      source,
      label: "Society CDH endpoint",
      ready: Boolean(baseUrl),
      detail: baseUrl ? `Lookups go to ${baseUrl}.` : "Add the endpoint URL to turn lookups on.",
      cdh: { baseUrl, apiKey: openSecret(society.handicapApiSecret), country },
    };
  }
  return { ...base, source: "DIRECTORY", label: "GolfDay directory", ready: true, detail: "Searching players already in GolfDay." };
}

export function golfEnglandMode(): "mock" | "whs" | "cdh" | "ghin" | "golfcanada" | "golfaustralia" {
  const mode = (process.env.GOLF_ENGLAND_MODE ?? "mock").toLowerCase();
  return ["whs", "cdh", "ghin", "golfcanada", "golfaustralia"].includes(mode)
    ? (mode as "whs" | "cdh" | "ghin" | "golfcanada" | "golfaustralia")
    : "mock";
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

export function directoryGolfer(id: string): GolfEnglandPlayer | null {
  const trimmed = id.trim().toUpperCase();
  if (!trimmed) return null;
  return MOCK_DIRECTORY.find((p) => p.golfEnglandId.toUpperCase() === trimmed) ?? null;
}

/**
 * Looks a golfer up by their handicap number (CDH / WHS member UID, or an
 * overseas GHIN / Golf Canada / Golf Australia number).
 *
 * Returns null when the golfer is genuinely not found - or when the society has
 * lookups switched off, which is not an error, just nothing to offer. Throws
 * `ApiError` only when a lookup was attempted and could not be completed, so a
 * misconfigured credential is visible instead of looking like "no such golfer".
 */
export async function lookupByGolfEnglandId(
  id: string,
  options?: { societyId?: string | null },
): Promise<GolfEnglandPlayer | null> {
  const trimmed = id.trim().toUpperCase();
  if (!trimmed) return null;
  const provider = await resolveHandicapProvider(options);

  if (provider.source === "MANUAL") return null;
  if (provider.source === "DIRECTORY") return directoryGolfer(trimmed);

  if (provider.source === "WHS") {
    if (!provider.whs) throw new ApiError(500, "WHS provider is missing its configuration", "integration_not_configured");
    if (!provider.ready) throw new ApiError(409, provider.detail, "integration_not_configured");
    const found = await lookupWhsHandicap(provider.whs, trimmed);
    return found ? { ...found, source: "WHS" } : null;
  }

  if (isOverseasProvider(provider.source)) {
    if (!provider.overseas) throw new ApiError(500, "Overseas provider is missing its configuration", "integration_not_configured");
    if (!provider.ready) throw new ApiError(409, provider.detail, "integration_not_configured");
    const found = await lookupOverseasHandicap(provider.overseas, id.trim());
    if (!found) return null;
    return {
      golfEnglandId: found.handicapId,
      name: found.name,
      handicapIndex: found.handicapIndex,
      homeClub: found.homeClub,
      country: found.country,
      source: "OVERSEAS",
      updatedAt: found.updatedAt,
      provider: found.federation,
    };
  }

  if (!provider.cdh) throw new ApiError(500, "CDH provider is missing its configuration", "integration_not_configured");
  if (!provider.ready) throw new ApiError(409, provider.detail, "integration_not_configured");
  const found = await lookupCdhProxy(provider.cdh, id.trim());
  return found ? { ...found, source: "CDH" } : null;
}

/** Back-compat alias: the old name is used by the profile refresh endpoint. */
export const lookupHandicap = lookupByGolfEnglandId;

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
