/**
 * The completed-event lock, and the four-ball edit cutoff.
 *
 * Both rules were only enforced by memory across two route handlers until the
 * full-field end-to-end run found the gaps: a finished golf day locked its own
 * organiser out of correcting a card, and a player could still move themselves
 * into a four-ball after the round had started.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-lock-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

type Mods = {
  events: typeof import("@/lib/events");
  auth: typeof import("@/lib/auth");
  push: typeof import("@/db/push");
  status: typeof import("@/lib/status");
  db: typeof import("@/db/client").db;
  schema: typeof import("@/db/schema");
};
let m: Mods;
let live: { eventId: string; groupId: string; playerId: string };

describe("scoreWriteRule", () => {
  beforeAll(async () => {
    const [events, auth, push, status, client, schema] = await Promise.all([
      import("@/lib/events"),
      import("@/lib/auth"),
      import("@/db/push"),
      import("@/lib/status"),
      import("@/db/client"),
      import("@/db/schema"),
    ]);
    m = { events, auth, push, status, db: client.db, schema };
    await push.pushSchema();
  }, 60_000);

  it("takes scores while a golf day is open or under way", () => {
    expect(m.status.scoreWriteRule("OPEN", false).allowed).toBe(true);
    expect(m.status.scoreWriteRule("IN_PROGRESS", false).allowed).toBe(true);
    expect(m.status.scoreWriteRule("OPEN", true).allowed).toBe(true);
  });

  it("takes no scores on a draft or a cancelled day, from anybody", () => {
    for (const status of ["DRAFT", "CANCELLED"]) {
      for (const isAdmin of [false, true]) {
        const rule = m.status.scoreWriteRule(status, isAdmin);
        expect(rule.allowed).toBe(false);
        if (!rule.allowed) expect(rule.code).toBe("event_closed");
      }
    }
  });

  it("shuts the field out of a completed day but lets the organiser fix a card", () => {
    const player = m.status.scoreWriteRule("COMPLETED", false);
    expect(player.allowed).toBe(false);
    if (!player.allowed) {
      expect(player.code).toBe("event_completed");
      expect(player.message).toMatch(/locked/i);
    }
    expect(m.status.scoreWriteRule("COMPLETED", true).allowed).toBe(true);
  });
});

describe("four-ball edits stop at the tee", () => {
  beforeAll(async () => {
    const organiser = await m.auth.createUserWithPlayer({
      email: "cutoff-org@test.local",
      name: "Cutoff Organiser",
      password: "password123",
    });
    const alice = await m.auth.createUserWithPlayer({
      email: "cutoff-alice@test.local",
      name: "Cutoff Alice",
      password: "password123",
    });
    const { id: eventId } = await m.events.createEvent({
      name: "Cutoff Trophy",
      date: "2027-06-01",
      status: "OPEN",
      createdBy: organiser.userId,
    });
    const group = await m.events.createGroup(eventId, "Group 1", "09:00");
    await m.events.registerPlayer({ eventId, playerId: alice.playerId });
    live = { eventId, groupId: group.id, playerId: alice.playerId };
  }, 60_000);

  const setStatus = async (status: string) => {
    await m.db.update(m.schema.events).set({ status }).where(eq(m.schema.events.id, live.eventId));
  };

  it("lets a player pick a group while entries are open", async () => {
    await setStatus("OPEN");
    await expect(
      m.events.setPlayerGroup({ eventId: live.eventId, playerId: live.playerId, groupId: live.groupId, isAdmin: false }),
    ).resolves.toMatchObject({ groupId: live.groupId });
  });

  it("locks self-service group changes once the round is under way", async () => {
    await setStatus("IN_PROGRESS");
    await expect(
      m.events.setPlayerGroup({ eventId: live.eventId, playerId: live.playerId, groupId: live.groupId, isAdmin: false }),
    ).rejects.toThrow(/locked once the round starts/i);
  });

  it("still lets the organiser move somebody mid-round, and after it", async () => {
    for (const status of ["IN_PROGRESS", "COMPLETED"]) {
      await setStatus(status);
      await expect(
        m.events.setPlayerGroup({ eventId: live.eventId, playerId: live.playerId, groupId: live.groupId, isAdmin: true }),
      ).resolves.toMatchObject({ groupId: live.groupId });
    }
  });

  it("refuses self-service changes on a completed day", async () => {
    await setStatus("COMPLETED");
    await expect(
      m.events.setPlayerGroup({ eventId: live.eventId, playerId: live.playerId, groupId: null, isAdmin: false }),
    ).rejects.toThrow(/locked/i);
  });
});
