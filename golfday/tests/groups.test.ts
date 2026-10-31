/**
 * Requirement 4 (players mark their own tee group, no admin needed) exercised
 * against a real SQLite database rather than a mock, because the bug this
 * guards against was entirely in the authorisation wiring between the route and
 * the group rules.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-groups-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

type Mods = {
  events: typeof import("@/lib/events");
  db: typeof import("@/db/client").db;
  schema: typeof import("@/db/schema");
  auth: typeof import("@/lib/auth");
  push: typeof import("@/db/push");
};
let m: Mods;
async function groupOf(playerId: string) {
  const [row] = await m.db
    .select({ groupId: m.schema.eventPlayers.groupId })
    .from(m.schema.eventPlayers)
    .where(eq(m.schema.eventPlayers.playerId, playerId))
    .limit(1);
  return row?.groupId ?? null;
}

let live: { eventId: string; groupA: string; groupB: string; playerId: string; otherId: string };

describe("setPlayerGroup (requirement 4)", () => {
  beforeAll(async () => {
    const [events, client, schema, auth, push] = await Promise.all([
      import("@/lib/events"),
      import("@/db/client"),
      import("@/db/schema"),
      import("@/lib/auth"),
      import("@/db/push"),
    ]);
    m = { events, db: client.db, schema, auth, push };
    await push.pushSchema();

    // Two players with accounts, plus an event owned by somebody else.
    const organiser = await auth.createUserWithPlayer({ email: "org@test.local", name: "Olive Organiser", password: "password123" });
    const alice = await auth.createUserWithPlayer({ email: "alice@test.local", name: "Alice Player", password: "password123" });
    const bob = await auth.createUserWithPlayer({ email: "bob@test.local", name: "Bob Player", password: "password123" });

    const { id: eventId } = await events.createEvent({
      name: "Group Test Open",
      date: "2027-04-01",
      status: "OPEN",
      createdBy: organiser.userId,
    });
    const groupA = await events.createGroup(eventId, "Group A", "08:00");
    const groupB = await events.createGroup(eventId, "Group B", "08:10");
    await events.registerPlayer({ eventId, playerId: alice.playerId });
    await events.registerPlayer({ eventId, playerId: bob.playerId });

    live = { eventId, groupA: groupA.id, groupB: groupB.id, playerId: alice.playerId, otherId: bob.playerId };
  }, 60_000);

  it("lets a plain player put themselves into a group", async () => {
    const result = await m.events.setPlayerGroup({
      eventId: live.eventId,
      playerId: live.playerId,
      groupId: live.groupA,
      isAdmin: false,
    });
    expect(result.groupId).toBe(live.groupA);

    expect(await groupOf(live.playerId)).toBe(live.groupA);
  });

  it("lets a plain player move themselves to another group, then leave", async () => {
    await m.events.setPlayerGroup({ eventId: live.eventId, playerId: live.playerId, groupId: live.groupB, isAdmin: false });
    expect(await groupOf(live.playerId)).toBe(live.groupB);

    await m.events.setPlayerGroup({ eventId: live.eventId, playerId: live.playerId, groupId: null, isAdmin: false });
    expect(await groupOf(live.playerId)).toBeNull();
  });

  it("refuses a group from a different event", async () => {
    const { id: otherEvent } = await m.events.createEvent({
      name: "Elsewhere",
      date: "2027-04-02",
      status: "OPEN",
      createdBy: (await m.db.select().from(m.schema.users).limit(1))[0].id,
    });
    const foreign = await m.events.createGroup(otherEvent, "Not Yours", "09:00");
    await expect(
      m.events.setPlayerGroup({ eventId: live.eventId, playerId: live.playerId, groupId: foreign.id, isAdmin: false }),
    ).rejects.toThrow(/Group not found/);
  });

  it("caps a self-entry group at four players but lets an admin overflow it", async () => {
    const capGroup = await m.events.createGroup(live.eventId, "Cap Test Group", "10:00");
    const created = [];
    for (let i = 0; i < 5; i += 1) {
      const p = await m.auth.createUserWithPlayer({
        email: `extra${i}@test.local`,
        name: `Extra Player ${i}`,
        password: "password123",
      });
      await m.events.registerPlayer({ eventId: live.eventId, playerId: p.playerId });
      created.push(p.playerId);
    }
    for (const playerId of created.slice(0, 3)) {
      await m.events.setPlayerGroup({ eventId: live.eventId, playerId, groupId: capGroup.id, isAdmin: false });
    }
    // the group now holds three others; the fourth self-entry fits, the fifth does not.
    await expect(
      m.events.setPlayerGroup({ eventId: live.eventId, playerId: created[3], groupId: capGroup.id, isAdmin: false }),
    ).resolves.toMatchObject({ groupId: capGroup.id });
    await expect(
      m.events.setPlayerGroup({ eventId: live.eventId, playerId: created[4], groupId: capGroup.id, isAdmin: false }),
    ).rejects.toThrow(/full/);

    // An admin can still place them.
    await expect(
      m.events.setPlayerGroup({ eventId: live.eventId, playerId: created[4], groupId: capGroup.id, isAdmin: true }),
    ).resolves.toMatchObject({ groupId: capGroup.id });
  });

  it("counts the field correctly on the public event list", async () => {
    const rows = await m.events.listPublicEvents(50);
    const row = rows.find((r) => r.event.id === live.eventId);
    expect(row).toBeTruthy();
    // five extras + alice + bob, all REGISTERED
    expect(Number(row!.playerCount)).toBe(7);
  });

  it("refuses a player who is not in the field", async () => {
    const stranger = await m.auth.createUserWithPlayer({
      email: "stranger@test.local",
      name: "Stranger Danger",
      password: "password123",
    });
    await expect(
      m.events.setPlayerGroup({ eventId: live.eventId, playerId: stranger.playerId, groupId: live.groupA, isAdmin: false }),
    ).rejects.toThrow(/not registered/);
  });
});
