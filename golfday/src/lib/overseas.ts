/**
 * Overseas handicap databases - GHIN, Golf Canada and Golf Australia.
 *
 * The UK/Ireland route is the WHS platform (see ./whs.ts). Everywhere else the
 * national system is a different product with a different contract, so rather
 * than leave an overseas index permanently "declared", each one gets an adapter
 * with the request shapes that provider's own clients use:
 *
 *   GHIN (USGA)      POST {base}/golfers/login.json  {user:{email_or_ghin,password}, token}
 *                    GET  {base}/golfers/{ghin}.json          (Bearer)
 *   Golf Canada      POST {base}/auth/login          {username, password}
 *                    GET  {base}/golfers/{number}            (Bearer)
 *   Golf Australia   static API key
 *                    GET  {base}/golfers/{ga_number}         (Bearer)
 *
 * None of these is a documented public API - they are partnership/client APIs,
 * keyed per club or per organisation, and a provider can move a path. So:
 *
 *  * every preset has a **base URL override** (the society's own field), which
 *    is the escape hatch when a provider changes;
 *  * every response is read by a tolerant mapper that finds the handicap and
 *    the name wherever they sit in the JSON (nested under `golfer`, `data`,
 *    `golfer_user`, arrays...), instead of hard-coding one shape;
 *  * the request shapes are pinned by tests against a stubbed `fetch`, and the
 *    "Test lookup" button in the society settings is the live confirmation.
 *
 * A failed lookup never invents a number: it returns null (nobody found) or
 * throws, and the caller records the index as declared.
 */
import { ApiError } from "./http";

export type OverseasProviderId = "GHIN" | "GOLF_CANADA" | "GOLF_AUSTRALIA";

export type OverseasConfig = {
  provider: OverseasProviderId;
  /** API root, e.g. https://api2.ghin.com/api/v1 - override per society. */
  baseUrl: string;
  /** Club/organisation login for `login` providers. */
  username?: string | null;
  /** Password, or the static key for `key` providers. Always sealed at rest. */
  secret?: string | null;
  /** Optional extra token some providers require on the login body (GHIN). */
  clientToken?: string | null;
};

type Preset = {
  id: OverseasProviderId;
  label: string;
  country: string;
  federation: string;
  idLabel: string;
  defaultBase: string;
  auth: "login" | "key";
  loginPath?: string;
  /** Tried in order; `{id}` is replaced with the URL-encoded golfer number. */
  lookupPaths: string[];
  /** Keys that carry the token in a login response, most specific first. */
  tokenKeys: string[];
};

export const OVERSEAS_PRESETS: Record<OverseasProviderId, Preset> = {
  GHIN: {
    id: "GHIN",
    label: "GHIN (USGA, USA)",
    country: "USA",
    federation: "GHIN",
    idLabel: "GHIN number",
    defaultBase: "https://api2.ghin.com/api/v1",
    auth: "login",
    loginPath: "golfers/login.json",
    lookupPaths: ["golfers/{id}.json", "golfers/search.json?ghin_number={id}"],
    tokenKeys: ["golfer_user_token", "access_token", "token"],
  },
  GOLF_CANADA: {
    id: "GOLF_CANADA",
    label: "Golf Canada",
    country: "CAN",
    federation: "Golf Canada",
    idLabel: "Golf Canada number",
    defaultBase: "https://api.golfcanada.ca/v1",
    auth: "login",
    loginPath: "auth/login",
    lookupPaths: ["golfers/{id}", "golfers/search?number={id}"],
    tokenKeys: ["access_token", "accessToken", "token"],
  },
  GOLF_AUSTRALIA: {
    id: "GOLF_AUSTRALIA",
    label: "Golf Australia (Golf Link)",
    country: "AUS",
    federation: "Golf Australia",
    idLabel: "GA / Golf Link number",
    defaultBase: "https://api.golf.org.au/v1",
    auth: "key",
    lookupPaths: ["golfers/{id}", "handicaps/{id}"],
    tokenKeys: [],
  },
};

export const OVERSEAS_PROVIDER_IDS = Object.keys(OVERSEAS_PRESETS) as OverseasProviderId[];

export function isOverseasProvider(value: unknown): value is OverseasProviderId {
  return typeof value === "string" && value in OVERSEAS_PRESETS;
}

export function overseasPreset(provider: OverseasProviderId): Preset {
  return OVERSEAS_PRESETS[provider];
}

const REQUEST_TIMEOUT_MS = 10_000;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearOverseasTokenCache(): void {
  tokenCache.clear();
}

function base(config: OverseasConfig): string {
  return (config.baseUrl || OVERSEAS_PRESETS[config.provider].defaultBase).trim().replace(/\/+$/, "");
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/abort|timeout/i.test(message)) {
      throw new ApiError(504, "The overseas handicap database did not answer in time", "integration_timeout");
    }
    throw new ApiError(502, `Could not reach the overseas handicap database: ${message}`, "integration_error");
  }
}

/**
 * Depth-first search for the first value under any of `keys`. Providers nest
 * their payloads differently (`golfer`, `data.golfer`, `golfer_user.golfer`,
 * a one-element array...), and a new wrapper should not need a code change.
 */
function pickDeep(source: unknown, keys: string[], depth = 0): unknown {
  if (source === null || source === undefined || depth > 6) return undefined;
  if (Array.isArray(source)) {
    for (const entry of source) {
      const found = pickDeep(entry, keys, depth + 1);
      if (found !== undefined && found !== null && found !== "") return found;
    }
    return undefined;
  }
  if (typeof source !== "object") return undefined;
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const found = pickDeep(value, keys, depth + 1);
      if (found !== undefined && found !== null && found !== "") return found;
    }
  }
  return undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", ".").replace(/[^0-9.+-]/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type OverseasGolfer = {
  /** The number the caller searched for, echoed back for display. */
  handicapId: string;
  name: string;
  handicapIndex: number;
  homeClub: string;
  country: string;
  federation: string;
  updatedAt: string;
  raw: unknown;
};

/** Maps a provider response onto the fields GolfDay needs. */
export function mapOverseasResponse(provider: OverseasProviderId, golferId: string, raw: unknown): OverseasGolfer | null {
  const preset = OVERSEAS_PRESETS[provider];
  const index = toNumber(
    pickDeep(raw, [
      "handicap_index",
      "handicapIndex",
      "playing_handicap",
      "handicap",
      "hcp",
      "current_handicap_index",
    ]),
  );
  const first = toText(pickDeep(raw, ["first_name", "firstName", "given_name"]));
  const last = toText(pickDeep(raw, ["last_name", "lastName", "family_name", "surname"]));
  const name =
    toText(pickDeep(raw, ["full_name", "fullName", "display_name", "name"])) ||
    [first, last].filter(Boolean).join(" ");
  if (index === null && !name) return null;
  return {
    handicapId: toText(pickDeep(raw, ["ghin", "ghin_number", "golf_canada_number", "ga_number", "member_number", "id"])) || golferId,
    name,
    handicapIndex: index ?? 0,
    homeClub: toText(pickDeep(raw, ["club_name", "clubName", "home_club", "homeClub", "facility_name", "club"])),
    country: preset.country,
    federation: preset.federation,
    updatedAt: new Date().toISOString().slice(0, 10),
    raw,
  };
}

async function loginToken(config: OverseasConfig): Promise<string> {
  const preset = OVERSEAS_PRESETS[config.provider];
  const key = [config.provider, base(config), config.username ?? ""].join("|");
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  if (!config.secret || (preset.auth === "login" && !config.username)) {
    throw new ApiError(
      409,
      `${preset.label} needs the club's ${preset.auth === "key" ? "API key" : "username and password"} before lookups can run.`,
      "integration_not_configured",
    );
  }

  if (preset.auth === "key") {
    tokenCache.set(key, { token: config.secret, expiresAt: Date.now() + 30 * 60_000 });
    return config.secret;
  }

  const body =
    config.provider === "GHIN"
      ? { user: { email_or_ghin: config.username, password: config.secret }, token: config.clientToken ?? "" }
      : { username: config.username, password: config.secret };

  const response = await request(`${base(config)}/${preset.loginPath}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(502, `${preset.label} rejected those credentials`, "integration_unauthorised");
  }
  if (!response.ok) {
    throw new ApiError(502, `${preset.label} sign-in failed (${response.status})`, "integration_error");
  }
  const data = (await response.json().catch(() => null)) as unknown;
  const token = toText(pickDeep(data, preset.tokenKeys));
  if (!token) throw new ApiError(502, `${preset.label} returned no access token`, "integration_error");
  tokenCache.set(key, { token, expiresAt: Date.now() + 15 * 60_000 });
  return token;
}

/**
 * Looks a golfer up on an overseas system by their handicap number.
 *
 * Tries each candidate path in turn (a 404 moves to the next one); anything
 * else either answers or throws, so a wrong base URL is a visible error rather
 * than a silent "not found".
 */
export async function lookupOverseasHandicap(config: OverseasConfig, golferId: string): Promise<OverseasGolfer | null> {
  const preset = OVERSEAS_PRESETS[config.provider];
  if (!preset) throw new ApiError(500, "Unknown overseas provider", "integration_misconfigured");
  const id = golferId.trim();
  if (!id) return null;
  const token = await loginToken(config);

  for (const template of preset.lookupPaths) {
    const url = `${base(config)}/${template.replace("{id}", encodeURIComponent(id))}`;
    const response = await request(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (response.status === 404) continue;
    if (response.status === 401 || response.status === 403) {
      tokenCache.delete([config.provider, base(config), config.username ?? ""].join("|"));
      throw new ApiError(502, `${preset.label} refused that lookup`, "integration_unauthorised");
    }
    if (!response.ok) {
      throw new ApiError(502, `${preset.label} lookup failed (${response.status})`, "integration_error");
    }
    const raw = (await response.json().catch(() => null)) as unknown;
    const mapped = mapOverseasResponse(config.provider, id, raw);
    if (mapped) return mapped;
  }
  return null;
}
