/**
 * Seeds a realistic demo: courses, accounts, players, groups and three events
 * (a finished day, a day in progress and one open for entries).
 *
 *   npm run db:seed          # only seeds when the database is empty
 *   npm run db:reset         # wipes and re-seeds
 */
import { mkdirSync } from "node:fs";
import { client, db } from "../src/db/client";
import {
  courseHoles,
  courses,
  eventAdmins,
  eventHoles,
  eventPlayers,
  eventState,
  events,
  groups,
  players,
  scoreAudit,
  scores,
  users,
} from "../src/db/schema";
import { pushSchema } from "../src/db/push";
import { CATALOGUE } from "../src/lib/catalogue";
import { hashPassword } from "../src/lib/auth";
import { courseHandicap, parseTees, playingHandicap } from "../src/lib/handicap";
import { stablefordPoints } from "../src/lib/scoring";
import { newClaimCode, newId, newJoinCode, newToken, slugify } from "../src/lib/ids";
import { sql } from "drizzle-orm";

const reset = process.argv.includes("--reset");
const today = new Date();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => {
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function wipe() {
  console.log("🧹  wiping demo data…");
  const tables = [
    "score_audit", "scores", "event_players", "groups", "event_admins",
    "event_holes", "event_state", "events", "course_holes", "courses", "players", "users",
  ];
  for (const table of tables) await client.execute(`DELETE FROM ${table}`);
}

async function main() {
  mkdirSync("data", { recursive: true });
  await pushSchema();
  const existing = await db.select({ n: sql<number>`count(*)` }).from(users);
  if (Number(existing[0]?.n ?? 0) > 0 && !reset) {
    console.log("ℹ️  Database already has users - use `npm run db:reset` to reseed.");
    return;
  }
  if (reset) await wipe();

  const password = "golfday123";
  const passwordHash = await hashPassword(password);

  // ---------- courses from the catalogue ----------
  const courseIds: Record<string, string> = {};
  for (const c of CATALOGUE) {
    const id = newId();
    const key = `${c.club} ${c.name}`;
    courseIds[key] = id;
    await db.insert(courses).values({
      id,
      name: c.name,
      club: c.club,
      address: c.address,
      city: c.city,
      country: c.country,
      latitude: c.latitude,
      longitude: c.longitude,
      holesCount: 18,
      parTotal: c.par,
      tees: JSON.stringify(c.tees),
      source: "CATALOGUE",
      externalId: `catalogue-${CATALOGUE.indexOf(c)}`,
    });
    await db.insert(courseHoles).values(
      c.pars.map((par, i) => ({
        id: newId(),
        courseId: id,
        holeNumber: i + 1,
        par,
        strokeIndex: c.strokeIndexes[i],
        yardages: JSON.stringify(c.tees.map((t) => ({ tee: t.name, yards: 0 }))),
      })),
    );
  }
  console.log(`⛳  ${CATALOGUE.length} courses added`);

  // ---------- accounts ----------
  const accountSeeds = [
    { name: "Alex Morgan", email: "admin@golfday.app", isSiteAdmin: true, handicap: 11.2, club: "Sunningdale Golf Club", ge: "GE100247", gender: "F" },
    { name: "Sam Whitcombe", email: "sam@golfday.app", isSiteAdmin: false, handicap: 8.4, club: "Sunningdale Golf Club", ge: "GE100241", gender: "F" },
    { name: "Priya Raman", email: "priya@golfday.app", isSiteAdmin: false, handicap: 5.2, club: "Walton Heath Golf Club", ge: "GE100243", gender: "F" },
    { name: "James Ellerton", email: "james@golfday.app", isSiteAdmin: false, handicap: 12.1, club: "Wentworth Club", ge: "GE100242", gender: "M" },
  ];

  const playerByEmail: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  for (const a of accountSeeds) {
    const userId = newId();
    const playerId = newId();
    userIds[a.email] = userId;
    playerByEmail[a.email] = playerId;
    await db.insert(users).values({
      id: userId,
      email: a.email,
      name: a.name,
      passwordHash,
      isSiteAdmin: a.isSiteAdmin,
    });
    await db.insert(players).values({
      id: playerId,
      userId,
      name: a.name,
      email: a.email,
      handicapIndex: a.handicap,
      golfEnglandId: a.ge,
      homeClub: a.club,
      gender: a.gender,
      claimCode: newClaimCode(),
      handicapSource: "GOLF_ENGLAND",
      handicapUpdatedAt: new Date().toISOString(),
    });
  }

  // ---------- guest players (no login yet) ----------
  const guests = [
    { name: "Tom Beresford", hcp: 17.8, club: "The Belfry", ge: "GE100244", gender: "M" },
    { name: "Callum Ó Dálaigh", hcp: 3.6, club: "Celtic Manor Resort", ge: "GE100245", gender: "M" },
    { name: "Fiona MacLeod", hcp: 14.9, club: "St Andrews Links", ge: "GE100246", gender: "F" },
    { name: "Daniel Okafor", hcp: 9.7, club: "Sunningdale Golf Club", ge: "GE100247b", gender: "M" },
    { name: "Mei Chen", hcp: 21.3, club: "Wentworth Club", ge: "GE100248", gender: "F" },
    { name: "Alex Hartley", hcp: 6.1, club: "Walton Heath Golf Club", ge: "GE100249", gender: "M" },
    { name: "Nina Petrova", hcp: 11.4, club: "The Belfry", ge: "GE100250", gender: "F" },
    { name: "Gareth Bowen", hcp: 19.2, club: "Celtic Manor Resort", ge: "GE100251", gender: "M" },
    { name: "Lucy Fielding", hcp: 7.8, club: "Sunningdale Golf Club", ge: "GE100252", gender: "F" },
    { name: "Ravi Shah", hcp: 15.4, club: "Wentworth Club", ge: "GE100253", gender: "M" },
    { name: "Ella Fitzpatrick", hcp: 24.1, club: "St Andrews Links", ge: "GE100254", gender: "F" },
    { name: "Owen Pryce", hcp: 2.9, club: "Walton Heath Golf Club", ge: "GE100255", gender: "M" },
    { name: "Hannah Vince", hcp: 13.3, club: "The Belfry", ge: "GE100256", gender: "F" },
    { name: "Marcus Adeyemi", hcp: 10.6, club: "Sunningdale Golf Club", ge: "GE100257", gender: "M" },
  ];
  const guestIds: Record<string, string> = {};
  for (const g of guests) {
    const id = newId();
    guestIds[g.name] = id;
    await db.insert(players).values({
      id,
      name: g.name,
      handicapIndex: g.hcp,
      homeClub: g.club,
      golfEnglandId: g.ge,
      gender: g.gender,
      claimCode: newClaimCode(),
      handicapSource: "GOLF_ENGLAND",
      handicapUpdatedAt: new Date().toISOString(),
    });
  }

  const playerIdByName: Record<string, string> = { ...guestIds };
  for (const a of accountSeeds) playerIdByName[a.name] = playerByEmail[a.email];

  // ---------- events ----------
  type EventSeed = {
    name: string;
    description: string;
    date: string;
    startTime: string;
    courseKey: string;
    status: "OPEN" | "IN_PROGRESS" | "COMPLETED" | "DRAFT";
    format: "STABLEFORD" | "STROKE_PLAY";
    allowance: number;
    roster: { groups: string[][]; holesPlayed: number[] };
  };

  const sunningdale = "Sunningdale Golf Club Old Course";
  const wentworth = "Wentworth Club West Course";
  const standrews = "St Andrews Links Old Course";

  const eventSeeds: EventSeed[] = [
    {
      name: "Captains' Charity Day",
      description: "Our October charity stableford. Stableford, 95% allowance, best two from four counting for the team prize.",
      date: daysFromNow(-13),
      startTime: "08:30",
      courseKey: wentworth,
      status: "COMPLETED",
      format: "STABLEFORD",
      allowance: 95,
      roster: {
        groups: [
          ["James Ellerton", "Tom Beresford", "Mei Chen", "Owen Pryce"],
          ["Priya Raman", "Alex Hartley", "Nina Petrova", "Hannah Vince"],
        ],
        holesPlayed: [18, 18],
      },
    },
    {
      name: "Autumn Invitational",
      description: "Three-ball better-ball with a shotgun start at 09:10. Live leaderboard updates after every hole.",
      date: daysFromNow(0),
      startTime: "09:10",
      courseKey: sunningdale,
      status: "IN_PROGRESS",
      format: "STABLEFORD",
      allowance: 95,
      roster: {
        groups: [
          ["Sam Whitcombe", "Alex Hartley", "Gareth Bowen", "Mei Chen"],
          ["Priya Raman", "James Ellerton", "Lucy Fielding", "Tom Beresford"],
          ["Callum Ó Dálaigh", "Nina Petrova", "Ravi Shah", "Ella Fitzpatrick"],
        ],
        holesPlayed: [16, 14, 11],
      },
    },
    {
      name: "Winter Open",
      description: "Open sweep - enter online, groups published on the Friday. Full 100% course handicap, stroke play.",
      date: daysFromNow(21),
      startTime: "10:00",
      courseKey: standrews,
      status: "OPEN",
      format: "STROKE_PLAY",
      allowance: 100,
      roster: {
        groups: [
          ["Alex Morgan", "Marcus Adeyemi", "Fiona MacLeod", "Daniel Okafor"],
        ],
        holesPlayed: [0],
      },
    },
  ];

  let seedOffset = 1;
  for (const seed of eventSeeds) {
    const eventId = newId();
    const courseId = courseIds[seed.courseKey];
    const catalogueCourse = CATALOGUE.find((c) => `${c.club} ${c.name}` === seed.courseKey)!;
    const slug = `${slugify(seed.name)}-${newToken().slice(0, 4)}`;
    const par = catalogueCourse.pars.reduce((a, b) => a + b, 0);

    await db.insert(events).values({
      id: eventId,
      slug,
      name: seed.name,
      description: seed.description,
      date: seed.date,
      startTime: seed.startTime,
      courseId,
      courseName: `${catalogueCourse.name}, ${catalogueCourse.club}`,
      format: seed.format,
      handicapAllowance: seed.allowance,
      status: seed.status,
      maxPlayers: 48,
      joinCode: newJoinCode(),
      isPublic: true,
      createdBy: userIds["admin@golfday.app"],
    });
    await db.insert(eventHoles).values(
      catalogueCourse.pars.map((p, i) => ({
        id: newId(),
        eventId,
        holeNumber: i + 1,
        par: p,
        strokeIndex: catalogueCourse.strokeIndexes[i],
      })),
    );
    await db.insert(eventAdmins).values({
      id: newId(),
      eventId,
      userId: userIds["admin@golfday.app"],
      role: "OWNER",
    });
    await db.insert(eventAdmins).values({
      id: newId(),
      eventId,
      userId: userIds["sam@golfday.app"],
      role: "ADMIN",
    });
    await db.insert(eventState).values({ eventId, revision: 1 });

    const tees = parseTees(JSON.stringify(catalogueCourse.tees));
    const tee = tees[0];

    const random = mulberry32(0x9e3779b9 + seedOffset * 7919);
    seedOffset++;

    for (let gi = 0; gi < seed.roster.groups.length; gi++) {
      const groupPlayers = seed.roster.groups[gi];
      const groupId = newId();
      const [hh, mm] = seed.startTime.split(":").map(Number);
      const startMinutes = hh * 60 + mm + gi * 10;
      await db.insert(groups).values({
        id: groupId,
        eventId,
        name: `Group ${gi + 1}`,
        teeTime: `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`,
        sortOrder: gi,
        token: newToken(),
      });

      for (const name of groupPlayers) {
        const playerId = playerIdByName[name];
        if (!playerId) continue;
        const guest = guests.find((g) => g.name === name);
        const index = guest?.hcp ?? accountSeeds.find((a) => a.name === name)?.handicap ?? 10;
        const ch = courseHandicap(index, tee);
        const ph = playingHandicap(ch, seed.allowance);
        await db.insert(eventPlayers).values({
          id: newId(),
          eventId,
          playerId,
          groupId,
          status: "REGISTERED",
          handicapIndex: index,
          courseHandicap: ch,
          playingHandicap: ph,
          tee: tee.name,
        });

        const holesToPlay = seed.roster.holesPlayed[gi] ?? 0;
        for (let hole = 1; hole <= holesToPlay; hole++) {
          const holePar = catalogueCourse.pars[hole - 1];
          const holeSi = catalogueCourse.strokeIndexes[hole - 1];
          const skill = index / 54;
          const roll = random();
          let delta = 0;
          if (roll < 0.18 + skill * 0.08) delta = -1;
          else if (roll < 0.55) delta = 0;
          else if (roll < 0.82) delta = 1;
          else if (roll < 0.94) delta = 2;
          else delta = 3;
          const strokes = Math.max(1, holePar + delta + (holePar === 3 && random() < 0.1 ? 1 : 0));
          const received = Math.floor(ph / 18) + (holeSi <= ph % 18 ? 1 : 0);
          await db.insert(scores).values({
            id: newId(),
            eventId,
            playerId,
            holeNumber: hole,
            strokes,
            points: seed.format === "STABLEFORD" ? stablefordPoints(holePar, strokes, received) : 0,
            recordedBy: "seed",
          });
        }
      }
    }
    console.log(`🏌️  ${seed.name} (${seed.status}) - ${seed.roster.groups.flat().length} players, par ${par}`);
  }

  // clear audit rows created by seeding (nothing to audit)
  await db.delete(scoreAudit);

  console.log("\n✅  Demo data ready");
  console.log("    Sign in as  admin@golfday.app / golfday123   (event admin, site admin)");
  console.log("    Sign in as  sam@golfday.app   / golfday123   (player)");
  console.log("    Sign in as  priya@golfday.app / golfday123   (player)");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
