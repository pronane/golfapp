/**
 * Overseas handicap lookups (GHIN, Golf Canada, Golf Australia).
 *
 * These providers are partnership/client APIs, not documented public ones, so
 * the contract is pinned here instead: the exact login body, the bearer header,
 * a response shape nested three levels deep, token reuse, and the difference
 * between "nobody by that number" (null) and "this cannot run" (an error the
 * organiser sees) - because a lookup that silently reports "not found" when it
 * was never configured is the one failure mode that would quietly mark a real
 * WHS/official index as declared.
 */
import { beforeAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-overseas-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.AUTH_SECRET = "test-secret-for-overseas-tests-0123456789";

// Imported dynamically so the temporary DATABASE_URL above is in place first.
type Overseas = typeof import("@/lib/overseas");
let ApiError: typeof import("@/lib/http").ApiError;
let OVERSEAS_PRESETS: Overseas["OVERSEAS_PRESETS"];
let clearOverseasTokenCache: Overseas["clearOverseasTokenCache"];
let lookupOverseasHandicap: Overseas["lookupOverseasHandicap"];
let mapOverseasResponse: Overseas["mapOverseasResponse"];
let resolveHandicapProvider: typeof import("@/lib/golfengland").resolveHandicapProvider;
let lookupByGolfEnglandId: typeof import("@/lib/golfengland").lookupByGolfEnglandId;

type Call = { url: string; init: RequestInit };

const calls: Call[] = [];
const realFetch = globalThis.fetch;

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeAll(async () => {
  const [http, overseas] = await Promise.all([import("@/lib/http"), import("@/lib/overseas")]);
  ApiError = http.ApiError;
  ({ OVERSEAS_PRESETS, clearOverseasTokenCache, lookupOverseasHandicap, mapOverseasResponse } = overseas);
  const golfengland = await import("@/lib/golfengland");
  resolveHandicapProvider = golfengland.resolveHandicapProvider;
  lookupByGolfEnglandId = golfengland.lookupByGolfEnglandId;
});

beforeEach(() => {
  calls.length = 0;
  clearOverseasTokenCache();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GOLF_ENGLAND_MODE;
  delete process.env.OVERSEAS_GHIN_USERNAME;
  delete process.env.OVERSEAS_GHIN_SECRET;
});

const GHIN = { provider: "GHIN" as const, baseUrl: "https://ghin.example/api/v1", username: "club@example.com", secret: "hunter2", clientToken: "club-token" };

describe("overseas handicap lookups", () => {
  it("signs in to GHIN with the documented body, then reads a deeply nested golfer", async () => {
    stubFetch((call) => {
      if (call.url.endsWith("/golfers/login.json")) {
        return json({ golfer_user: { golfer_user_token: "tok-123" } });
      }
      if (call.url.endsWith("/golfers/1234567.json")) {
        return json({
          data: {
            golfer_user: {
              golfer: {
                ghin: "1234567",
                first_name: "Casey",
                last_name: "Nguyen",
                handicap_index: "6.4",
                club_name: "Pebble Creek CC",
              },
            },
          },
        });
      }
      return json({ error: "unexpected" }, 500);
    });

    const found = await lookupOverseasHandicap(GHIN, "1234567");

    expect(found).not.toBeNull();
    expect(found).toMatchObject({
      handicapId: "1234567",
      name: "Casey Nguyen",
      handicapIndex: 6.4,
      homeClub: "Pebble Creek CC",
      country: "USA",
      federation: "GHIN",
    });

    const [login, lookup] = calls;
    expect(login.url).toBe("https://ghin.example/api/v1/golfers/login.json");
    expect(login.init.method).toBe("POST");
    expect(JSON.parse(String(login.init.body))).toEqual({
      user: { email_or_ghin: "club@example.com", password: "hunter2" },
      token: "club-token",
    });
    const headers = lookup.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-123");
  });

  it("reuses the bearer token instead of signing in for every lookup", async () => {
    stubFetch((call) => {
      if (call.url.endsWith("/golfers/login.json")) return json({ access_token: "tok-abc" });
      return json({ golfer: { ghin: "42", handicap_index: "3.1" } });
    });

    await lookupOverseasHandicap(GHIN, "42");
    await lookupOverseasHandicap(GHIN, "43");

    expect(calls.filter((c) => c.url.endsWith("/golfers/login.json"))).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it("returns null when every candidate path is a 404, without inventing an index", async () => {
    stubFetch((call) => {
      if (call.url.endsWith("/golfers/login.json")) return json({ token: "tok" });
      return json({ message: "not found" }, 404);
    });

    const found = await lookupOverseasHandicap(GHIN, "9999999");
    expect(found).toBeNull();
    // Every lookup path in the preset was tried before giving up.
    expect(calls).toHaveLength(1 + OVERSEAS_PRESETS.GHIN.lookupPaths.length);
  });

  it("treats a rejected login as a visible 502, not an empty result", async () => {
    stubFetch(() => json({ message: "bad credentials" }, 401));

    await expect(lookupOverseasHandicap(GHIN, "1234567")).rejects.toMatchObject({
      status: 502,
      code: "integration_unauthorised",
    });
  });

  it("treats a rejected lookup as a visible 502 and forgets the stale token", async () => {
    stubFetch((call) => {
      if (call.url.endsWith("/golfers/login.json")) return json({ token: "stale" });
      return json({ message: "forbidden" }, 403);
    });

    await expect(lookupOverseasHandicap(GHIN, "1234567")).rejects.toMatchObject({ status: 502 });

    // Second attempt must sign in again rather than reuse the rejected token.
    stubFetch((call) =>
      call.url.endsWith("/golfers/login.json")
        ? json({ token: "fresh" })
        : json({ golfer: { handicap_index: 8.2, name: "Fresh Token" } }),
    );
    await expect(lookupOverseasHandicap(GHIN, "1234567")).resolves.toMatchObject({ handicapIndex: 8.2 });
    expect(calls.some((c) => c.url.endsWith("/golfers/login.json"))).toBe(true);
  });

  it("refuses to run without credentials, so nothing silently reads as declared", async () => {
    stubFetch(() => json({ should: "not be called" }));
    await expect(
      lookupOverseasHandicap({ provider: "GHIN", baseUrl: GHIN.baseUrl, username: null, secret: null }, "1234567"),
    ).rejects.toMatchObject({ status: 409, code: "integration_not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("uses a static API key for Golf Australia without a login round-trip", async () => {
    stubFetch((call) => json({ player: { ga_number: "2011223344", name: "Mia Kelly", handicap: 11.7 } }));

    const found = await lookupOverseasHandicap(
      { provider: "GOLF_AUSTRALIA", baseUrl: "https://au.example/v1", secret: "au-key" },
      "2011223344",
    );

    expect(calls).toHaveLength(1);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer au-key");
    expect(found).toMatchObject({ handicapIndex: 11.7, name: "Mia Kelly", federation: "Golf Australia" });
  });

  it("signs in to Golf Canada with a plain username/password body", async () => {
    stubFetch((call) => {
      if (call.url.endsWith("/auth/login")) return json({ accessToken: "ca-token" });
      return json({ golfer: { golf_canada_number: "770011", first_name: "Luc", last_name: "Tremblay", current_handicap_index: "9.5" } });
    });

    const found = await lookupOverseasHandicap(
      { provider: "GOLF_CANADA", baseUrl: "https://ca.example/v1", username: "pro", secret: "pw" },
      "770011",
    );

    expect(JSON.parse(String(calls[0].init.body))).toEqual({ username: "pro", password: "pw" });
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer ca-token");
    expect(found).toMatchObject({ name: "Luc Tremblay", handicapIndex: 9.5, country: "CAN" });
  });

  it("reports a timeout as 504 rather than as a missing golfer", async () => {
    stubFetch(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });

    await expect(lookupOverseasHandicap(GHIN, "1234567")).rejects.toBeInstanceOf(ApiError);
    await expect(
      lookupOverseasHandicap({ ...GHIN, username: "someone-else" }, "1234567"),
    ).rejects.toMatchObject({ status: 504, code: "integration_timeout" });
  });

  it("maps a bare payload and reads an empty body as nothing found", () => {
    const mapped = mapOverseasResponse("GHIN", "88", { handicap_index: 4.2, full_name: "Ada Lovelace", club: "Bletchley" });
    expect(mapped).toMatchObject({ handicapIndex: 4.2, name: "Ada Lovelace", homeClub: "Bletchley", handicapId: "88" });
    expect(mapOverseasResponse("GHIN", "88", null)).toBeNull();
    expect(mapOverseasResponse("GHIN", "88", {})).toBeNull();
  });

  it("plugs into the same resolver as WHS, from the deployment environment", async () => {
    process.env.GOLF_ENGLAND_MODE = "ghin";
    const provider = await resolveHandicapProvider({});
    expect(provider.source).toBe("GHIN");
    expect(provider.country).toBe("USA");
    expect(provider.ready).toBe(false);
    expect(provider.overseas?.baseUrl).toBe(OVERSEAS_PRESETS.GHIN.defaultBase);
    expect(provider.detail).toMatch(/OVERSEAS_GHIN/);

    // Unconfigured is a visible failure, never an empty result that would let
    // the caller record a real index as merely "declared".
    await expect(lookupByGolfEnglandId("1234567")).rejects.toMatchObject({
      status: 409,
      code: "integration_not_configured",
    });

    process.env.OVERSEAS_GHIN_USERNAME = "club@example.com";
    process.env.OVERSEAS_GHIN_SECRET = "pw";
    await expect(resolveHandicapProvider({})).resolves.toMatchObject({ source: "GHIN", ready: true });
  });
});
