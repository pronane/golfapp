/**
 * Handicap integrations and social sign-in.
 *
 * The WHS client is exercised against a stubbed `fetch`, so the real request
 * shapes (token exchange, visitor lookup, member fallback) are pinned without
 * talking to anybody's production database.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-integrations-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.AUTH_SECRET = "test-secret-for-integration-credentials-0123456789";
process.env.GOLF_ENGLAND_MODE = "mock";

let auth: typeof import("@/lib/auth");
let societies: typeof import("@/lib/societies");
let golfengland: typeof import("@/lib/golfengland");
let secrets: typeof import("@/lib/secrets");
let whs: typeof import("@/lib/whs");
let oauth: typeof import("@/lib/oauth");
let push: typeof import("@/db/push");

async function person(email: string, name: string) {
  return auth.createUserWithPlayer({ email, name, password: "password123", handicapIndex: 12 });
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeAll(async () => {
  [auth, societies, golfengland, secrets, whs, oauth, push] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/societies"),
    import("@/lib/golfengland"),
    import("@/lib/secrets"),
    import("@/lib/whs"),
    import("@/lib/oauth"),
    import("@/db/push"),
  ]);
  await push.pushSchema();
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
  whs.clearTokenCache();
});

describe("sealed credentials", () => {
  it("round-trips, rejects tampering, and survives nothing else", () => {
    const sealed = secrets.sealSecret("super-secret-key");
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("super-secret-key");
    expect(secrets.openSecret(sealed)).toBe("super-secret-key");

    const [prefix, iv, tag, ciphertext] = sealed.split(".");
    const flipped = Buffer.from(ciphertext, "base64url");
    flipped[0] ^= 0xff;
    expect(secrets.openSecret([prefix, iv, tag, flipped.toString("base64url")].join("."))).toBeNull();

    // A value sealed under a different key is "not configured", not a crash.
    const previous = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "a-completely-different-secret-value-0123456789";
    expect(secrets.openSecret(sealed)).toBeNull();
    process.env.AUTH_SECRET = previous;
  });

  it("masks a stored secret for display", () => {
    expect(secrets.maskSecret(secrets.sealSecret("abcdef123456"))).toBe("ab••••56 (12 chars)");
    expect(secrets.maskSecret(null)).toBeNull();
  });
});

describe("WHS platform client", () => {
  const config = {
    baseUrl: "https://whs.example.test",
    country: "eng",
    username: "harrow",
    secretKey: "club-secret",
  };

  it("exchanges the client token once, then looks a visitor up", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/api/eng/v1/account/token")) {
          return jsonResponse({ accessToken: "bearer-123", expiresIn: 900 });
        }
        return jsonResponse({ memberUID: "U-1", firstName: "Sam", lastName: "Whitcombe", handicapIndex: 8.4, homeClub: "Sunningdale", gender: "M" });
      }),
    );

    const first = await whs.lookupWhsHandicap(config, "U-1");
    const second = await whs.lookupWhsHandicap(config, "U-1");

    expect(first).toMatchObject({ golfEnglandId: "U-1", name: "Sam Whitcombe", handicapIndex: 8.4, homeClub: "Sunningdale", source: "WHS" });
    expect(second?.handicapIndex).toBe(8.4);

    const tokenCalls = calls.filter((c) => c.url.endsWith("/account/token"));
    expect(tokenCalls).toHaveLength(1); // cached between lookups
    expect(JSON.parse(String(tokenCalls[0].init?.body))).toMatchObject({ clientToken: expect.stringMatching(/\./) });
    const visitorCall = calls.find((c) => c.url.includes("/club/visitors/U-1"));
    expect(visitorCall?.url).toBe("https://whs.example.test/api/eng/v1/club/visitors/U-1");
    expect((visitorCall?.init?.headers as Record<string, string>).Authorization).toBe("Bearer bearer-123");
  });

  it("falls back to the member handicap endpoint when the golfer is not a visitor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/account/token")) return jsonResponse({ access_token: "t", expires_in: 600 });
        if (url.includes("/club/visitors/")) return jsonResponse({ error: "not found" }, 404);
        if (url.includes("/club/members/M-9/handicap")) {
          return jsonResponse({ memberUID: "M-9", name: "Mei Chen", handicapIndex: "21.3", club: { name: "Wentworth" } });
        }
        return jsonResponse({}, 404);
      }),
    );

    const found = await whs.lookupWhsHandicap(config, "M-9");
    expect(found).toMatchObject({ name: "Mei Chen", handicapIndex: 21.3, homeClub: "Wentworth", source: "WHS" });
  });

  it("reports bad credentials as an integration error, not a 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unauthorised" }, 401)));
    await expect(whs.lookupWhsHandicap(config, "U-1")).rejects.toMatchObject({ code: "integration_unauthorised", status: 502 });
  });

  it("turns a provider timeout into 504", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );
    await expect(whs.lookupWhsHandicap(config, "U-1")).rejects.toMatchObject({ code: "integration_timeout", status: 504 });
  });

  it("uses a pre-signed client token verbatim", async () => {
    let posted: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/account/token")) {
          posted = JSON.parse(String(init?.body));
          return jsonResponse({ accessToken: "x" });
        }
        return jsonResponse({ memberUID: "U-2", name: "Pre Signed", handicapIndex: 4 });
      }),
    );
    await whs.lookupWhsHandicap({ ...config, clientToken: "aaa.bbb.ccc" }, "U-2");
    expect(posted).toEqual({ clientToken: "aaa.bbb.ccc" });
  });

  it("refuses to call out with no credentials at all", async () => {
    await expect(
      whs.lookupWhsHandicap({ baseUrl: "https://whs.example.test", country: "eng" }, "U-1"),
    ).rejects.toMatchObject({ code: "integration_not_configured" });
  });
});

describe("per-society handicap source", () => {
  it("defaults to the directory, and a manual club never calls out", async () => {
    const owner = await person("dir-owner@test.local", "Dora Directory");
    const club = await societies.createSociety({ name: "Directory Society", createdBy: owner.userId, foundedByPlayerId: owner.playerId });

    const byDefault = await golfengland.resolveHandicapProvider({ societyId: club.id });
    expect(byDefault).toMatchObject({ source: "DIRECTORY", ready: true });
    // Same data the mock directory ships, without touching the network.
    expect(await golfengland.lookupByGolfEnglandId("ge100241", { societyId: club.id })).toMatchObject({ name: "Sarah Whitcombe" });

    await societies.updateSocietyIntegration(club.id, { source: "MANUAL" });
    expect(await golfengland.lookupByGolfEnglandId("GE100241", { societyId: club.id })).toBeNull();
  });

  it("stores a club's WHS credentials sealed, never returns them, and uses them", async () => {
    const secretary = await person("whs-sec@test.local", "Wes Secretary");
    const club = await societies.createSociety({ name: "WHS Society", createdBy: secretary.userId, foundedByPlayerId: secretary.playerId });

    await societies.updateSocietyIntegration(club.id, {
      source: "WHS",
      country: "sco",
      username: "scottish-club",
      secret: "very-secret",
    });
    const stored = await societies.getSocietyIntegration(club.id);
    expect(stored).toMatchObject({ source: "WHS", country: "sco", username: "scottish-club", hasSecret: true });
    expect(JSON.stringify(stored)).not.toContain("very-secret");
    expect(stored?.secretMask).toBe("ve••••et (11 chars)");

    const provider = await golfengland.resolveHandicapProvider({ societyId: club.id });
    expect(provider).toMatchObject({ source: "WHS", ready: true, country: "sco" });
    expect(provider.whs?.secretKey).toBe("very-secret");
    expect(provider.whs?.baseUrl).toBe(whs.DEFAULT_WHS_BASE);

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.endsWith("/account/token")) return jsonResponse({ accessToken: "t" });
        return jsonResponse({ memberUID: "S-1", name: "Fiona MacLeod", handicapIndex: 14.9 });
      }),
    );
    const found = await golfengland.lookupByGolfEnglandId("S-1", { societyId: club.id });
    expect(found).toMatchObject({ name: "Fiona MacLeod", handicapIndex: 14.9, source: "WHS" });
    // Scottish Golf, not England: the country travels in the path.
    expect(calls[0]).toContain("/api/sco/v1/account/token");
  });

  it("reports an unconfigured WHS club instead of silently using demo data", async () => {
    const owner = await person("unconfigured@test.local", "Una Unconfigured");
    const club = await societies.createSociety({ name: "Unconfigured Society", createdBy: owner.userId, foundedByPlayerId: owner.playerId });
    await societies.updateSocietyIntegration(club.id, { source: "WHS" });

    const provider = await golfengland.resolveHandicapProvider({ societyId: club.id });
    expect(provider.ready).toBe(false);
    await expect(golfengland.lookupByGolfEnglandId("GE100241", { societyId: club.id })).rejects.toMatchObject({
      code: "integration_not_configured",
    });
  });

  it("clears a saved credential when asked, and keeps it when the field is blank", async () => {
    const owner = await person("clear@test.local", "Cleo Clear");
    const club = await societies.createSociety({ name: "Clear Society", createdBy: owner.userId, foundedByPlayerId: owner.playerId });
    await societies.updateSocietyIntegration(club.id, { source: "CDH", apiBase: "https://cdh.example.test/v1", secret: "key-1" });
    expect((await societies.getSocietyIntegration(club.id))?.hasSecret).toBe(true);

    // A blank field in the UI means "leave it alone" - the route only forwards
    // credentials that were typed, so an unrelated save keeps the key.
    await societies.updateSocietyIntegration(club.id, { username: "someone" });
    expect((await societies.getSocietyIntegration(club.id))?.hasSecret).toBe(true);

    await societies.updateSocietyIntegration(club.id, { secret: "" });
    expect((await societies.getSocietyIntegration(club.id))?.hasSecret).toBe(false);
  });
});

describe("social sign-in", () => {
  it("builds an RFC 7636 PKCE challenge", () => {
    // The worked example from RFC 7636 appendix B.
    const { createHash } = require("node:crypto") as typeof import("node:crypto");
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const pair = oauth.createPkcePair();
    expect(pair.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pair.challenge).not.toContain("=");
    expect(pair.verifier).not.toBe(pair.challenge);
  });

  it("only redirects to same-site paths after sign-in", () => {
    expect(oauth.safeNext("/events/abc")).toBe("/events/abc");
    expect(oauth.safeNext("//evil.example")).toBe("/dashboard");
    expect(oauth.safeNext("https://evil.example")).toBe("/dashboard");
    expect(oauth.safeNext(null)).toBe("/dashboard");
  });

  it("creates an account once, then signs the same person back in", async () => {
    const first = await auth.signInWithOAuthIdentity({
      provider: "google",
      subject: "google-sub-1",
      email: "New.Golfer@test.local",
      emailVerified: true,
      name: "Nina Newgolfer",
    });
    expect(first).toMatchObject({ created: true, linked: false });

    const again = await auth.signInWithOAuthIdentity({
      provider: "google",
      subject: "google-sub-1",
      email: "new.golfer@test.local",
      emailVerified: true,
      name: "Nina Newgolfer",
    });
    expect(again.userId).toBe(first.userId);
    expect(again.created).toBe(false);
  });

  it("links an existing password account by verified email, and refuses an unverified one", async () => {
    const existing = await person("link-me@test.local", "Lena Link");

    await expect(
      auth.signInWithOAuthIdentity({
        provider: "apple",
        subject: "apple-sub-1",
        email: "link-me@test.local",
        emailVerified: false,
        name: "Lena Link",
      }),
    ).rejects.toMatchObject({ code: "oauth_unverified_email" });

    const linked = await auth.signInWithOAuthIdentity({
      provider: "apple",
      subject: "apple-sub-1",
      email: "link-me@test.local",
      emailVerified: true,
      name: "Lena Link",
    });
    expect(linked).toMatchObject({ userId: existing.userId, playerId: existing.playerId, linked: true, created: false });

    // A second provider cannot quietly take over an already-linked account.
    await expect(
      auth.signInWithOAuthIdentity({
        provider: "facebook",
        subject: "fb-sub-1",
        email: "link-me@test.local",
        emailVerified: true,
        name: "Lena Link",
      }),
    ).rejects.toMatchObject({ code: "oauth_provider_conflict" });
  });

  it("leaves social sign-in switched off until credentials exist", () => {
    const previous = { ...process.env };
    for (const key of ["OAUTH_GOOGLE_ID", "OAUTH_GOOGLE_SECRET", "OAUTH_APPLE_ID", "OAUTH_APPLE_SECRET"]) delete process.env[key];
    expect(oauth.configuredProviders()).toEqual([]);
    expect(() => oauth.requireProvider("google")).toThrowError(/not enabled/);

    process.env.OAUTH_GOOGLE_ID = "client-id";
    process.env.OAUTH_GOOGLE_SECRET = "client-secret";
    expect(oauth.configuredProviders()).toEqual([{ id: "google", label: "Google" }]);
    const url = oauth.authorizationUrl(oauth.requireProvider("google"), {
      redirectUri: "https://golfday.test/api/auth/oauth/google/callback",
      state: "state-1",
      challenge: "challenge-1",
      nonce: "nonce-1",
    });
    expect(url).toContain("code_challenge=challenge-1");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("response_type=code");
    expect(url).toContain("accounts.google.com");
    process.env = previous;
  });
});
