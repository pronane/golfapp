import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-event-handicaps-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;
process.env.AUTH_SECRET = "test-secret-for-event-handicaps-0123456789";

let auth: typeof import("@/lib/auth");
let courses: typeof import("@/lib/courses");
let events: typeof import("@/lib/events");
let leaderboard: typeof import("@/lib/leaderboard");
let scrambleScores: typeof import("@/lib/scrambleScores");
let push: typeof import("@/db/push");
let db: typeof import("@/db/client")["db"];
let schema: typeof import("@/db/schema");

const card = Array.from({ length: 18 }, (_, index) => ({
  holeNumber: index + 1,
  par: 4,
  strokeIndex: index + 1,
}));

async function player(name: string, handicapIndex: number) {
  return auth.createUserWithPlayer({
    email: `${name.toLowerCase().replace(/\s/g, "-")}@test.local`,
    name,
    password: "password123",
    handicapIndex,
  });
}

describe("event handicaps end to end", () => {
  beforeAll(async () => {
    [auth, courses, events, leaderboard, scrambleScores, push, db, schema] = await Promise.all([
      import("@/lib/auth"),
      import("@/lib/courses"),
      import("@/lib/events"),
      import("@/lib/leaderboard"),
      import("@/lib/scrambleScores"),
      import("@/db/push"),
      import("@/db/client").then((m) => m.db),
      import("@/db/schema"),
    ]);
    await push.pushSchema();
  }, 60_000);

  it("uses handicaps for Stableford, Stroke Play, a copied day, and Texas Scramble", async () => {
    const organiser = await player("Holly Organiser", 0);
    const golfer = await player("Indy Index", 12.4);
    const scramblePlayers = [
      golfer,
      await player("Ari Scramble", 8),
      await player("Bea Scramble", 18.2),
      await player("Cy Scramble", 0),
    ];
    const course = await courses.saveCourse({
      name: "Handicap Test Course",
      club: "Integration Club",
      source: "MANUAL",
      tees: [{ name: "White", slope: 132, rating: 73.5, par: 72 }],
      holes: card,
    }, organiser.userId);

    const stableford = await events.createEvent({
      name: "Stableford Handicap Test",
      date: "2027-06-01",
      createdBy: organiser.userId,
      courseId: course.courseId,
      format: "STABLEFORD",
      handicapAllowance: 95,
      status: "IN_PROGRESS",
      holes: card,
    });
    const stableRegistration = await events.registerPlayer({ eventId: stableford.id, playerId: golfer.playerId });
    expect(stableRegistration).toMatchObject({ courseHandicap: 16, playingHandicap: 15 });

    const { scores } = schema;
    await db.insert(scores).values(card.map((hole) => ({
      id: `${stableford.id}-score-${hole.holeNumber}`,
      eventId: stableford.id,
      playerId: golfer.playerId,
      holeNumber: hole.holeNumber,
      strokes: 4,
      points: 0,
      recordedBy: organiser.userId,
    })));
    const stableBoard = await leaderboard.buildLeaderboard(stableford.id);
    expect(stableBoard?.standings[0]).toMatchObject({
      handicapIndex: 12.4,
      playingHandicap: 15,
      points: 51,
      holeResults: expect.arrayContaining([
        expect.objectContaining({ holeNumber: 1, shotsReceived: 1, points: 3 }),
        expect.objectContaining({ holeNumber: 16, shotsReceived: 0, points: 2 }),
      ]),
    });
    await events.autoAllocateGroups(stableford.id);

    await db.update(schema.players).set({ handicapIndex: 8.6 }).where(eq(schema.players.id, golfer.playerId));
    const copied = await events.copyEvent({
      eventId: stableford.id,
      createdBy: organiser.userId,
      name: "Copied Stroke Play Test",
      date: "2027-06-02",
    });
    expect(copied.copiedPlayers).toBe(1);
    const copiedBundle = await events.getEventBundle(copied.id);
    expect(copiedBundle?.groups).toHaveLength(0);
    expect(copiedBundle?.registrations[0].registration).toMatchObject({
      handicapIndex: 12.4,
      courseHandicap: 16,
      playingHandicap: 15,
    });
    expect(copiedBundle?.registrations[0].player.handicapIndex).toBe(8.6);
    expect(await events.getEventScores(copied.id)).toHaveLength(0);
    expect(copiedBundle?.holes.map(({ holeNumber, par, strokeIndex }) => ({ holeNumber, par, strokeIndex }))).toEqual(card);
    const sameDayCopy = await events.copyEvent({
      eventId: stableford.id,
      createdBy: organiser.userId,
      name: "Same Day Copy",
      date: "2027-06-01",
    });
    expect(sameDayCopy.copiedPlayers).toBe(0);
    expect(sameDayCopy.skipped).toEqual([
      expect.objectContaining({ name: "Indy Index", reason: expect.stringContaining("already playing") }),
    ]);

    await db.update(schema.events).set({ format: "STROKE_PLAY", handicapAllowance: 100 }).where(eq(schema.events.id, copied.id));
    await events.recalculateHandicaps(copied.id);
    const copiedRegistration = (await events.getEventBundle(copied.id))!.registrations[0].registration;
    expect(copiedRegistration).toMatchObject({ handicapIndex: 8.6, courseHandicap: 12, playingHandicap: 12 });
    await db.insert(scores).values(card.map((hole) => ({
      id: `${copied.id}-score-${hole.holeNumber}`,
      eventId: copied.id,
      playerId: golfer.playerId,
      holeNumber: hole.holeNumber,
      strokes: 4,
      points: 0,
      recordedBy: organiser.userId,
    })));
    const strokeBoard = await leaderboard.buildLeaderboard(copied.id);
    expect(strokeBoard?.standings[0]).toMatchObject({
      handicapIndex: 8.6,
      playingHandicap: 12,
      totalNet: 60,
      netToPar: -12,
    });

    await db.update(schema.players).set({ handicapIndex: 12.4 }).where(eq(schema.players.id, golfer.playerId));
    const scramble = await events.createEvent({
      name: "Texas Scramble Handicap Test",
      date: "2027-06-03",
      createdBy: organiser.userId,
      courseId: course.courseId,
      format: "TEXAS_SCRAMBLE",
      handicapAllowance: 95,
      status: "IN_PROGRESS",
      holes: card,
    });
    for (const entry of scramblePlayers) {
      await events.registerPlayer({ eventId: scramble.id, playerId: entry.playerId });
    }
    const groups = await events.autoAllocateGroups(scramble.id, 4);
    const group = groups[0];
    for (const hole of card) {
      await scrambleScores.saveScrambleScore({
        eventId: scramble.id,
        groupId: group.id,
        holeNumber: hole.holeNumber,
        strokes: 4,
        drivePlayerId: scramblePlayers[(hole.holeNumber - 1) % scramblePlayers.length].playerId,
        recordedBy: organiser.userId,
      });
    }
    const scrambleBoard = await leaderboard.buildLeaderboard(scramble.id);
    expect(scrambleBoard?.teams?.[0]).toMatchObject({ teamHandicap: 7, points: 43, thru: 18 });
  });
});
