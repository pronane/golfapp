/**
 * WHS handicap lookups against national handicap databases.
 *
 * England Golf, Scottish Golf, Wales Golf and Golf Ireland all run the WHS
 * platform operated by DotGolf, which exposes an ISV REST API. It is not a
 * public API: a club (or its software provider) is issued credentials, and every
 * call is made with a short-lived bearer token obtained with a client token.
 *
 *   POST {base}/api/{country}/v1/account/token          -> access token
 *   GET  {base}/api/{country}/v1/club/visitors/{uid}    -> a visitor's handicap
 *   GET  {base}/api/{country}/v1/club/members/{uid}/handicap -> a member's index
 *
 * The client token is a JWT the caller produces: normally the union issues a
 * ready-made one, otherwise it is signed with the club's secret key. Both are
 * supported here, and the exact claims are configurable through the username /
 * audience fields rather than being hard-coded.
 *
 * A society that runs its own proxy can use the `CDH` provider instead, which
 * speaks the simpler contract `GET {base}/golfers/{id}`. Everything the app
 * needs from either provider is a `HandicapLookup`.
 */
import { SignJWT } from "jose";
import { ApiError } from "./http";

export type HandicapLookup = {
  golfEnglandId: string;
  name: string;
  handicapIndex: number;
  homeClub: string;
  country: string;
  gender?: "M" | "F" | "X";
  source: "WHS" | "CDH" | "DIRECTORY" | "MANUAL";
  updatedAt: string;
};

/** The four WHS nations, as they appear in the API path. */
export const WHS_COUNTRIES = {
  eng: { code: "eng", country: "ENG", label: "England Golf" },
  sco: { code: "sco", country: "SCO", label: "Scottish Golf" },
  wal: { code: "wal", country: "WAL", label: "Wales Golf" },
  irl: { code: "irl", country: "IRL", label: "Golf Ireland" },
} as const;

export type WhsCountryCode = keyof typeof WHS_COUNTRIES;

export type WhsConfig = {
  /** e.g. https://isvapi.whsplatform.englandgolf.org - no trailing slash needed. */
  baseUrl: string;
  country: string;
  /** Club login, used to mint the client token when no ready-made one is given. */
  username?: string | null;
  /** Club secret key; only ever held in memory here. */
  secretKey?: string | null;
  /** A pre-signed client token (JWT) straight from the union's onboarding pack. */
  clientToken?: string | null;
};

export const DEFAULT_WHS_BASE = "https://isvapi.whsplatform.englandgolf.org";

const REQUEST_TIMEOUT_MS = 10_000;

/** Tokens are cached per credential set until shortly before they expire. */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearTokenCache(): void {
  tokenCache.clear();
}

function normaliseBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function countryPath(country: string): string {
  const key = (country || "eng").toLowerCase();
  return WHS_COUNTRIES[key as WhsCountryCode] ? key : "eng";
}

function cacheKey(config: WhsConfig): string {
  return [normaliseBase(config.baseUrl), countryPath(config.country), config.username ?? "", config.clientToken ? "token" : "secret"].join("|");
}

async function request(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/abort|timeout/i.test(message)) {
      throw new ApiError(504, "The handicap database did not answer in time", "integration_timeout");
    }
    throw new ApiError(502, `Could not reach the handicap database: ${message}`, "integration_error");
  }
  return response;
}

/**
 * Builds the client token. A JWT supplied by the union is used verbatim; a raw
 * secret is used to sign a short-lived assertion for the club's username.
 */
async function buildClientToken(config: WhsConfig): Promise<string> {
  if (config.clientToken && config.clientToken.split(".").length === 3) return config.clientToken;
  if (!config.username || !config.secretKey) {
    throw new ApiError(
      409,
      "This society has no WHS credentials yet. Add the club username and secret key (or the client token) first.",
      "integration_not_configured",
    );
  }
  if (config.secretKey.split(".").length === 3) return config.secretKey; // the "secret" was a signed token
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sub: config.username, iss: config.username })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("whs-isv-api")
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(new TextEncoder().encode(config.secretKey));
}

/** Exchanges the client token for a bearer token (cached until it expires). */
export async function whsAccessToken(config: WhsConfig): Promise<string> {
  const key = cacheKey(config);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const clientToken = await buildClientToken(config);
  const url = `${normaliseBase(config.baseUrl)}/api/${countryPath(config.country)}/v1/account/token`;
  const response = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ clientToken }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(502, "The handicap database rejected these credentials", "integration_unauthorised");
  }
  if (!response.ok) {
    throw new ApiError(502, `Handicap database sign-in failed (${response.status})`, "integration_error");
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const token = [data.accessToken, data.access_token, data.token, data.access_token].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!token) throw new ApiError(502, "The handicap database returned no access token", "integration_error");
  const seconds = Number(data.expiresIn ?? data.expires_in ?? 900);
  tokenCache.set(key, { token, expiresAt: Date.now() + Math.max(60, Number.isFinite(seconds) ? seconds : 900) * 1000 });
  return token;
}

type RawGolfer = Record<string, unknown>;

function asText(...values: unknown[]): string {
  for (const value of values) if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function asNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function mapGolfer(raw: RawGolfer, id: string, country: string, source: HandicapLookup["source"]): HandicapLookup | null {
  const name =
    asText(raw.name, raw.fullName, raw.displayName) ||
    [asText(raw.firstName), asText(raw.lastName)].filter(Boolean).join(" ");
  const handicapIndex = asNumber(
    raw.handicapIndex,
    raw.handicap_index,
    raw.exactHandicap,
    (raw.handicap as RawGolfer | undefined)?.handicapIndex,
    (raw.handicap as RawGolfer | undefined)?.value,
    typeof raw.handicap === "number" ? raw.handicap : undefined,
  );
  if (!name && handicapIndex === null) return null;
  const genderRaw = asText(raw.gender, raw.sex).toUpperCase();
  const gender = genderRaw.startsWith("M") ? "M" : genderRaw.startsWith("F") ? "F" : genderRaw ? "X" : undefined;
  return {
    golfEnglandId: asText(raw.memberUID, raw.memberUid, raw.memberId, raw.id, raw.golfEnglandId) || id,
    name,
    handicapIndex: handicapIndex ?? 0,
    homeClub: asText(raw.homeClub, (raw.club as RawGolfer | undefined)?.name, raw.clubName, raw.club),
    country: asText(raw.country, raw.countryCode).toUpperCase() || WHS_COUNTRIES[country as WhsCountryCode]?.country || "ENG",
    gender,
    source,
    updatedAt: asText(raw.updatedAt, raw.handicapUpdatedAt, raw.modifiedAt) || new Date().toISOString().slice(0, 10),
  };
}

async function whsGet(config: WhsConfig, path: string): Promise<{ status: number; data: RawGolfer | null }> {
  const token = await whsAccessToken(config);
  const url = `${normaliseBase(config.baseUrl)}/api/${countryPath(config.country)}/v1/${path.replace(/^\/+/, "")}`;
  const response = await request(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (response.status === 404) return { status: 404, data: null };
  if (response.status === 401 || response.status === 403) {
    tokenCache.delete(cacheKey(config));
    throw new ApiError(502, "The handicap database refused that lookup", "integration_unauthorised");
  }
  if (!response.ok) {
    throw new ApiError(502, `Handicap database lookup failed (${response.status})`, "integration_error");
  }
  const data = (await response.json().catch(() => null)) as RawGolfer | null;
  return { status: response.status, data };
}

/**
 * Looks a golfer up on the WHS platform.
 *
 * A visitor lookup is tried first: a society day is usually played by people who
 * are away from their home club, and that is the endpoint that answers for them.
 * Members fall back to the club handicap endpoint.
 */
export async function lookupWhsHandicap(config: WhsConfig, golferId: string): Promise<HandicapLookup | null> {
  const id = golferId.trim();
  if (!id) return null;
  const countryKey = countryPath(config.country) as WhsCountryCode;
  const country = WHS_COUNTRIES[countryKey].country;

  const visitor = await whsGet(config, `club/visitors/${encodeURIComponent(id)}`);
  if (visitor.data) {
    const mapped = mapGolfer(visitor.data, id, countryKey, "WHS");
    if (mapped) return { ...mapped, country: mapped.country || country };
  }

  const member = await whsGet(config, `club/members/${encodeURIComponent(id)}/handicap`);
  if (member.data) {
    const mapped = mapGolfer(member.data, id, countryKey, "WHS");
    if (mapped) return { ...mapped, country: mapped.country || country };
  }
  return null;
}

/**
 * A society running its own small proxy can keep the simpler contract
 * `GET {base}/golfers/{id}` -> `{ name, handicapIndex, homeClub, ... }`.
 */
export async function lookupCdhProxy(
  config: { baseUrl: string; apiKey?: string | null; country?: string },
  golferId: string,
): Promise<HandicapLookup | null> {
  const id = golferId.trim();
  if (!id) return null;
  if (!config.baseUrl) {
    throw new ApiError(409, "No CDH endpoint is configured for this society", "integration_not_configured");
  }
  const url = `${normaliseBase(config.baseUrl)}/golfers/${encodeURIComponent(id)}`;
  const response = await request(url, {
    headers: {
      Accept: "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
  });
  if (response.status === 404) return null;
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(502, "The CDH endpoint rejected these credentials", "integration_unauthorised");
  }
  if (!response.ok) {
    throw new ApiError(502, `CDH lookup failed (${response.status})`, "integration_error");
  }
  const raw = (await response.json().catch(() => null)) as RawGolfer | null;
  if (!raw) return null;
  return mapGolfer(raw, id, (config.country ?? "eng").toLowerCase(), "CDH");
}
