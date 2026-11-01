/**
 * A golfer does not need a club, or a national database, to have a handicap -
 * and having neither must never block them entering a golf day.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-provenance-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.AUTH_SECRET = "test-secret-for-provenance-tests-0123456789";

let auth: typeof import("@/lib/auth");
let events: typeof import("@/lib/events");
let provenance: typeof import("@/lib/handicapProvenance");
let validate: typeof import("@/lib/validate");
let push: typeof import("@/db/push");

const card = Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));

beforeAll(async () => {
  [auth, events, provenance, validate, push] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/events"),
    import("@/lib/handicapProvenance"),
    import("@/lib/validate"),
    import("@/db/push"),
  ]);
  await push.pushSchema();
}, 60_000);

describe("handicap provenance", () => {
  it("treats WHS, iGolf and overseas as authority-issued, and society/manual/none as not", () => {
    expect(provenance.isOfficialHandicap("WHS")).toBe(true);
    expect(provenance.isOfficialHandicap("GOLF_ENGLAND")).toBe(true);
    expect(provenance.isOfficialHandicap("IGOLF")).toBe(true);
    expect(provenance.isOfficialHandicap("OVERSEAS")).toBe(true);
    expect(provenance.isOfficialHandicap("SOCIETY")).toBe(false);
    expect(provenance.isOfficialHandicap("MANUAL")).toBe(false);
    expect(provenance.isOfficialHandicap("NONE")).toBe(false);
  });

  it("only a lookup verifies an index, and only for lookupable sources", () => {
    expect(provenance.verifiedFor("WHS", true)).toBe(true);
    expect(provenance.verifiedFor("WHS", false)).toBe(false);
    // iGolf is official but there is nothing to look up from here.
    expect(provenance.verifiedFor("IGOLF", true)).toBe(false);
    // Overseas is lookupable when the society holds GHIN / Golf Canada /
    // Golf Australia credentials, so a real answer does verify it.
    expect(provenance.verifiedFor("OVERSEAS", true)).toBe(true);
    expect(provenance.verifiedFor("OVERSEAS", false)).toBe(false);
    expect(provenance.isLookupable("WHS")).toBe(true);
    expect(provenance.isLookupable("OVERSEAS")).toBe(true);
    expect(provenance.isLookupable("IGOLF")).toBe(false);
  });

  it("falls back to MANUAL for anything unknown rather than throwing", () => {
    expect(provenance.provenanceMeta(undefined).value).toBe("MANUAL");
    expect(provenance.provenanceMeta("SOMETHING_ELSE").value).toBe("MANUAL");
    expect(provenance.isHandicapProvenance("IGOLF")).toBe(true);
    expect(provenance.isHandicapProvenance("igolf")).toBe(false);
  });

  it("describes each case in one honest line", () => {
    expect(provenance.describeHandicap({ handicapIndex: 0, handicapSource: "NONE" })).toBe("No handicap yet · plays off 0");
    expect(provenance.describeHandicap({ handicapIndex: 4.2, handicapSource: "WHS", handicapVerified: true })).toBe(
      "National WHS database · 4.2 · verified",
    );
    expect(provenance.describeHandicap({ handicapIndex: 9.8, handicapSource: "IGOLF" })).toBe("iGolf (no club needed) · 9.8 · declared");
    expect(provenance.describeHandicap({ handicapIndex: 12, handicapSource: "SOCIETY", handicapNote: "Committee, March" })).toBe(
      "Society or committee handicap · 12.0 · unofficial · Committee, March",
    );
  });

  it("accepts every provenance on registration, and rejects a made-up one", () => {
    const base = { name: "No Club", email: "noclub@test.local", password: "password123" };
    for (const option of provenance.SELECTABLE_PROVENANCES) {
      expect(validate.registerSchema.parse({ ...base, handicapSource: option.value }).handicapSource).toBe(option.value);
    }
    expect(() => validate.registerSchema.parse({ ...base, handicapSource: "TOUR" })).toThrow();
    // Omitting it entirely still works - the field is optional.
    expect(validate.registerSchema.parse(base).handicapSource).toBeUndefined();
  });
});

describe("players without a club or a national handicap", () => {
  it("registers with no handicap at all, and can be entered and scored", async () => {
    const organiser = await auth.createUserWithPlayer({ email: "organiser@test.local", name: "Ola Organiser", password: "password123" });
    const player = await auth.createUserWithPlayer({
      email: "nocub@test.local",
      name: "Nia No Club",
      password: "password123",
      handicapIndex: 0,
      handicapSource: "NONE",
      handicapNote: "First season, joining a society",
    });

    const [row] = await (
      await import("@/db/client")
    ).db
      .select()
      .from((await import("@/db/schema")).players)
      .where((await import("drizzle-orm")).eq((await import("@/db/schema")).players.id, player.playerId))
      .limit(1);

    expect(row).toMatchObject({ handicapSource: "NONE", handicapVerified: false, handicapIndex: 0 });
    expect(row.handicapNote).toBe("First season, joining a society");

    const { id: eventId } = await events.createEvent({
      name: "Open Day",
      date: "2027-08-08",
      createdBy: organiser.userId,
      status: "OPEN",
      holes: card,
      handicapAllowance: 95,
    });
    const registration = await events.registerPlayer({ eventId, playerId: player.playerId });
    // Scratch, but a full member of the field: no lookup, no club, no block.
    expect(registration).toMatchObject({ ok: true, playingHandicap: 0 });

    const bundle = await events.getEventBundle(eventId);
    expect(bundle?.registrations.map((r) => r.player.name)).toContain("Nia No Club");
  });

  it("keeps a self-declared society handicap, and treats it as unverified", async () => {
    const player = await auth.createUserWithPlayer({
      email: "society-hcp@test.local",
      name: "Sol Society",
      password: "password123",
      handicapIndex: 18.2,
      handicapSource: "SOCIETY",
      handicapNote: "Harrow committee handicap",
    });
    const { db } = await import("@/db/client");
    const { players } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const [row] = await db.select().from(players).where(eq(players.id, player.playerId)).limit(1);
    expect(row.handicapSource).toBe("SOCIETY");
    expect(row.handicapVerified).toBe(false);
    expect(row.handicapNote).toBe("Harrow committee handicap");
  });

  it("records a real lookup as verified, and the demo directory as not", () => {
    expect(provenance.provenanceFromLookup("WHS")).toEqual({ source: "WHS", verified: true });
    expect(provenance.provenanceFromLookup("GOLF_ENGLAND")).toEqual({ source: "WHS", verified: true });
    expect(provenance.provenanceFromLookup("CDH")).toEqual({ source: "WHS", verified: true });
    // A real overseas database did the lookup, so it is verified - not declared.
    expect(provenance.provenanceFromLookup("OVERSEAS")).toEqual({ source: "OVERSEAS", verified: true });
    // Demo/directory data is not an authority, so it must never show a tick.
    expect(provenance.provenanceFromLookup("MOCK")).toEqual({ source: "MANUAL", verified: false });
    expect(provenance.provenanceFromLookup("DIRECTORY")).toEqual({ source: "MANUAL", verified: false });
  });
});
