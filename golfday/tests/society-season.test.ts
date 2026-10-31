/**
 * Societies and seasons against a real (temporary) database, including a Texas
 * scramble fixture counting towards an order of merit.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "golfday-society-"));
process.env.DATABASE_URL = `file:${path.join(dir, "test.db")}`;

let auth: typeof import("@/lib/auth");
let events: typeof import("@/lib/events");
let societies: typeof import("@/lib/societies");
let seasons: typeof import("@/lib/seasons");
let leaderboard: typeof import("@/lib/leaderboard");
let scrambleScores: typeof import("@/lib/scrambleScores");
let push: typeof import("@/db/push");

async function person(email: string, name: string, handicapIndex = 12) {
  return auth.createUserWithPlayer({ email, name, password: "password123", handicapIndex });
}

const card = Array.from({ length: 18 }, (_, i) => ({ holeNumber: i + 1, par: 4, strokeIndex: i + 1 }));

describe("societies", () => {
  beforeAll(async () => {
    [auth, events, societies, seasons, leaderboard, scrambleScores, push] = await Promise.all([
      import("@/lib/auth"),
      import("@/lib/events"),
      import("@/lib/societies"),
      import("@/lib/seasons"),
      import("@/lib/leaderboard"),
      import("@/lib/scrambleScores"),
      import("@/db/push"),
    ]);
    await push.pushSchema();
  }, 60_000);

  it("makes the founder the owner and lets others join with the code", async () => {
    const founder = await person("founder@test.local", "Fiona Founder");
    const created = await societies.createSociety({
      name: "Harrow Golf Society",
      homeClub: "Harrow Golf Club",
      createdBy: founder.userId,
      foundedByPlayerId: founder.playerId,
    });
    expect(created.joinCode).toHaveLength(6);

    const joiner = await person("joiner@test.local", "Jo Joiner");
    const society = await societies.getSocietyByJoinCode(created.joinCode.toLowerCase());
    expect(society?.id).toBe(created.id);

    await societies.addSocietyMember(created.id, joiner.playerId);
    const members = await societies.listSocietyMembers(created.id);
    expect(members.map((m) => [m.name, m.role])).toEqual([
      ["Fiona Founder", "OWNER"],
      ["Jo Joiner", "MEMBER"],
    ]);

    const asMember = { id: joiner.userId, email: "joiner@test.local", name: "Jo Joiner", isSiteAdmin: false, playerId: joiner.playerId };
    const asOwner = { id: founder.userId, email: "founder@test.local", name: "Fiona Founder", isSiteAdmin: false, playerId: founder.playerId };
    expect(societies.canManageSociety(asMember, "MEMBER")).toBe(false);
    expect(societies.canManageSociety(asOwner, "OWNER")).toBe(true);
    expect(societies.canManageSociety({ ...asMember, isSiteAdmin: true }, "MEMBER")).toBe(true);
    expect(societies.canManageSociety(null, "OWNER")).toBe(false);

    // Secretaries can be appointed; the last owner cannot be removed.
    const secretary = await person("sec@test.local", "Sid Secretary");
    await societies.addSocietyMember(created.id, secretary.playerId, "SECRETARY");
    expect((await societies.listSocietyMembers(created.id)).find((m) => m.playerId === secretary.playerId)?.role).toBe("SECRETARY");
    expect(await societies.isLastOwner(created.id, founder.playerId)).toBe(true);
    expect(await societies.isLastOwner(created.id, secretary.playerId)).toBe(false);
  });

  it("keeps one society per fixture and detaches cleanly", async () => {
    const user = await person("fixtures@test.local", "Fred Fixtures");
    const first = await societies.createSociety({
      name: "First Society",
      createdBy: user.userId,
      foundedByPlayerId: user.playerId,
    });
    const second = await societies.createSociety({
      name: "Second Society",
      createdBy: user.userId,
      foundedByPlayerId: user.playerId,
    });
    const event = await events.createEvent({ name: "Society Day", date: "2027-05-05", createdBy: user.userId });

    await societies.attachEventToSociety(first.id, event.id);
    expect(await societies.getSocietyForEvent(event.id)).toMatchObject({ id: first.id });

    // Moving it is explicit, not a duplicate.
    await societies.attachEventToSociety(second.id, event.id);
    expect(await societies.getSocietyForEvent(event.id)).toMatchObject({ id: second.id });
    expect(await societies.listSocietyEvents(first.id)).toHaveLength(0);

    await societies.detachEventFromSociety(second.id, event.id);
    expect(await societies.getSocietyForEvent(event.id)).toBeNull();
  });

  it("counts a scramble fixture in the order of merit, one row per team", async () => {
    const organiser = await person("organiser@test.local", "Olive Organiser", 10);
    const teamA = [
      { p: await person("a1@test.local", "Alan A", 8), hcp: 8 },
      { p: await person("a2@test.local", "Bea A", 14), hcp: 14 },
      { p: await person("a3@test.local", "Cal A", 20), hcp: 20 },
      { p: await person("a4@test.local", "Dee A", 26), hcp: 26 },
    ];
    const teamB = [
      { p: await person("b1@test.local", "Eve B", 6), hcp: 6 },
      { p: await person("b2@test.local", "Fay B", 18), hcp: 18 },
    ];

    const { id: eventId } = await events.createEvent({
      name: "Scramble Open",
      date: "2027-06-06",
      createdBy: organiser.userId,
      format: "TEXAS_SCRAMBLE",
      status: "OPEN",
      holes: card,
    });

    const groupA = await events.createGroup(eventId, "Team A");
    const groupB = await events.createGroup(eventId, "Team B");
    for (const member of teamA) {
      await events.registerPlayer({ eventId, playerId: member.p.playerId, groupId: groupA.id });
    }
    for (const member of teamB) {
      await events.registerPlayer({ eventId, playerId: member.p.playerId, groupId: groupB.id });
    }

    // Team A shoot a net 4 on every hole (gross 4 for holes 1-13, 5 after).
    for (let hole = 1; hole <= 18; hole += 1) {
      await scrambleScores.saveScrambleScore({
        eventId,
        groupId: groupA.id,
        holeNumber: hole,
        strokes: hole <= 13 ? 4 : 5,
        drivePlayerId: teamA[hole % 4].p.playerId,
        recordedBy: "test",
      });
    }
    // Team B are a two-ball and shoot 5 everywhere.
    for (let hole = 1; hole <= 18; hole += 1) {
      await scrambleScores.saveScrambleScore({
        eventId,
        groupId: groupB.id,
        holeNumber: hole,
        strokes: 5,
        // One player's drive used all day - the other owes nine.
        drivePlayerId: teamB[0].p.playerId,
        recordedBy: "test",
      });
    }

    const board = await leaderboard.buildLeaderboard(eventId);
    expect(board?.teams).toHaveLength(2);
    expect(board?.standings).toEqual([]);
    expect(board?.teams?.[0].groupName).toBe("Team A");
    expect(board?.teams?.[0].position).toBe(1);
    expect(board?.teams?.[1].position).toBe(2);
    expect(board?.stats.leader).toBe("Team A");
    // Two-ball: nine drives each are owed, so B are short.
    expect(board?.teams?.[1].drivesShort.length).toBeGreaterThan(0);

    // The group's own card is the team card, not four individual ones.
    const cardForGroup = await leaderboard.getGroupScoreboard(groupA.token);
    expect(cardForGroup?.scramble?.enabled).toBe(true);
    expect(cardForGroup?.scramble?.totals.thru).toBe(18);
    expect(cardForGroup?.scramble?.holes[0].strokes).toBe(4);

    const season = await seasons.createSeason({
      name: "2027 Scramble Series",
      startsOn: "2027-01-01",
      endsOn: "2027-12-31",
      createdBy: organiser.userId,
    });
    await seasons.attachEventToSeason(season.id, eventId);
    const table = await seasons.getOrderOfMerit((await seasons.getSeasonById(season.id))!);
    expect(table.rows).toHaveLength(6); // four in team A, two in team B
    expect(table.rows[0].points).toBe(100);
    expect(table.rows.slice(0, 4).every((r) => r.points === 100)).toBe(true);
    expect(table.rows[4].points).toBe(90);
    expect(table.rows[0].results[0].team).toBe(true);
  });
});
