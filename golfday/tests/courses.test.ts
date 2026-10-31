/**
 * Course library rules: who may write, and that writes are idempotent.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-courses-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

let events: typeof import("@/lib/events");
let coursesLib: typeof import("@/lib/courses");
let db: typeof import("@/db/client").db;
let schema: typeof import("@/db/schema");
let auth: typeof import("@/lib/auth");
let push: typeof import("@/db/push");

const card = Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));

describe("course library", () => {
  beforeAll(async () => {
    [events, coursesLib, , schema, auth, push] = [
      await import("@/lib/events"),
      await import("@/lib/courses"),
      null,
      await import("@/db/schema"),
      await import("@/lib/auth"),
      await import("@/db/push"),
    ];
    db = (await import("@/db/client")).db;
    await push.pushSchema();
  }, 60_000);

  it("does not duplicate a hand-typed course with the same name and club", async () => {
    const first = await coursesLib.saveCourse({ name: "Harrow Golf Club", club: "Harrow", holes: card }, "user-1");
    const again = await coursesLib.saveCourse({ name: "harrow golf club", club: "HARROW", holes: card }, "user-2");
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.courseId).toBe(first.courseId);
  });

  it("does not duplicate a provider course by its external id", async () => {
    const first = await coursesLib.saveCourse(
      { name: "Somewhere Links", club: "Somewhere", holes: card, externalId: "ext-1", source: "GOLFCOURSEAPI" },
      "user-1",
    );
    const again = await coursesLib.saveCourse(
      { name: "Somewhere Links", club: "Somewhere", holes: card, externalId: "ext-1", source: "GOLFCOURSEAPI" },
      "user-1",
    );
    expect(again.created).toBe(false);
    expect(again.courseId).toBe(first.courseId);
  });

  it("lets a first-time organiser create a golf day with a course they typed in", async () => {
    const organiser = await auth.createUserWithPlayer({
      email: "first-timer@test.local",
      name: "First Timer",
      password: "password123",
    });
    const { id } = await events.createEvent({
      name: "First Timer Open",
      date: "2027-05-01",
      status: "OPEN",
      createdBy: organiser.userId,
      // exactly what the wizard now sends
      newCourse: {
        name: "Oxhey Lane",
        club: "Harrow Golf Club",
        address: "Oxhey Lane, Harrow",
        holes: card,
        tees: [{ name: "White", colour: "white", slope: 125, rating: 71.5, par: 72 }],
      },
    });

    const event = await events.getEventById(id);
    expect(event?.courseName).toContain("Oxhey Lane");
    expect(event?.courseId).toBeTruthy();
    const holes = await events.getEventHoles(id);
    expect(holes).toHaveLength(18);

    // and it landed in the shared library, authored by the organiser
    const [course] = await db.select().from(schema.courses).where(eq(schema.courses.id, event!.courseId!));
    expect(course.createdBy).toBe(organiser.userId);

    // the creator is now the event's owner, so they count as an organiser
    const [owner] = await db
      .select()
      .from(schema.eventAdmins)
      .where(eq(schema.eventAdmins.eventId, id));
    expect(owner.userId).toBe(organiser.userId);
    expect(owner.role).toBe("OWNER");
  });

  it("reuses an existing library course instead of creating a copy", async () => {
    const organiser = await auth.createUserWithPlayer({
      email: "second@test.local",
      name: "Second Organiser",
      password: "password123",
    });
    const first = await events.createEvent({
      name: "Saturday Roll-Up",
      date: "2027-05-02",
      createdBy: organiser.userId,
      newCourse: { name: "Oxhey Lane", club: "Harrow Golf Club", holes: card },
    });
    const a = await events.getEventById(first.id);
    const organiser2 = await auth.createUserWithPlayer({
      email: "third@test.local",
      name: "Third Organiser",
      password: "password123",
    });
    const second = await events.createEvent({
      name: "Sunday Roll-Up",
      date: "2027-05-03",
      createdBy: organiser2.userId,
      newCourse: { name: "Oxhey Lane", club: "Harrow Golf Club", holes: card },
    });
    const b = await events.getEventById(second.id);
    expect(b?.courseId).toBe(a?.courseId);
  });

  it("treats signed-in players and organisers differently", async () => {
    const { isOrganiser } = await import("@/lib/http");
    const player = await auth.createUserWithPlayer({
      email: "player@test.local",
      name: "Just A Player",
      password: "password123",
    });
    const organiser = await auth.createUserWithPlayer({
      email: "has-event@test.local",
      name: "Has An Event",
      password: "password123",
    });
    await events.createEvent({
      name: "Organiser's Day",
      date: "2027-06-01",
      createdBy: organiser.userId,
    });

    const asPlayer = { id: player.userId, email: "player@test.local", name: "Just A Player", isSiteAdmin: false, playerId: player.playerId };
    const asOrganiser = { id: organiser.userId, email: "has-event@test.local", name: "Has An Event", isSiteAdmin: false, playerId: organiser.playerId };
    const asSiteAdmin = { ...asPlayer, isSiteAdmin: true };

    expect(await isOrganiser(asPlayer)).toBe(false);
    expect(await isOrganiser(asOrganiser)).toBe(true);
    expect(await isOrganiser(asSiteAdmin)).toBe(true);
  });
});
