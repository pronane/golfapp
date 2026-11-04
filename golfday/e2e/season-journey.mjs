/**
 * GolfDay end-to-end: a society season's running totals.
 *
 *   npm run e2e:seasons
 *
 * The promise on the tin is "your results all year, then a prize at the end":
 * every fixture adds to the order of merit as it is played, a team result pays
 * every member of the team, best-N counts only the best, a fixture outside the
 * season's dates cannot score, and once the season is over the top of the
 * table is called the winner - not the leader.
 *
 * This drives the HTTP API exactly as the browser does (sign in, create golf
 * days, card every hole, attach fixtures, read the table) on its own database
 * and its own port, so it never touches your data. The scoring pattern is
 * deliberately deterministic - player i cards par+i on every hole - so every
 * position, and therefore every points total, is known in advance.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.E2E_SEASON_PORT ?? 3213);
const base = `http://127.0.0.1:${port}`;
const dbFile = path.join(root, "data", "e2e-seasons.db");
const env = {
  ...process.env,
  DATABASE_URL: `file:${dbFile}`,
  AUTH_SECRET: process.env.AUTH_SECRET || "e2e-only-secret-0123456789abcdefghijkl",
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
};

let stepNo = 0;
let checks = 0;
const failures = [];
const notes = [];
const colour = (code, text) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);
const say = (m = "") => console.log(m);

async function step(name, fn) {
  stepNo += 1;
  const started = Date.now();
  process.stdout.write(`${colour(36, `  ▸ ${String(stepNo).padStart(2, "0")}`)} ${name} … `);
  try {
    await fn();
    console.log(colour(32, `ok (${Date.now() - started}ms)`));
  } catch (error) {
    console.log(colour(31, "FAILED"));
    failures.push({ name, error });
    say(colour(31, `     ${error.message.split("\n").slice(0, 6).join("\n     ")}`));
  }
}
function must(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}
function check(condition, message) {
  checks += 1;
  if (!condition) {
    failures.push({ name: "check", error: new Error(message) });
    say(colour(31, `     ✗ ${message}`));
  }
}
function note(message) {
  notes.push(message);
  say(colour(90, `     · ${message}`));
}

async function call(method, url, { body, cookie, headers = {}, text = false } = {}) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const raw = text ? await response.text() : await response.json().catch(() => null);
  const setCookie = response.headers.getSetCookie?.() ?? [];
  return { status: response.status, body: raw, setCookie };
}
const cookieFrom = (result) => (result.setCookie.map((c) => c.split(";")[0]).find((c) => c.includes("=")) ?? "");

async function login(email, password) {
  const result = await call("POST", "/api/auth/login", { body: { email, password } });
  must(result.status === 200, `sign in as ${email} failed (${result.status})`);
  return cookieFrom(result);
}

/** The POSITION scale, re-derived here: the e2e must not import the app's. */
const POSITION_POINTS = [
  100, 90, 80, 75, 70, 65, 60, 55, 50, 45, 40, 36, 32, 28, 25, 22, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2,
];
const pointsForPosition = (position) => POSITION_POINTS[position - 1] ?? 1;

function prepareDatabase() {
  mkdirSync(path.dirname(dbFile), { recursive: true });
  if (existsSync(dbFile)) rmSync(dbFile);
  for (const script of ["scripts/db-push.ts", "scripts/seed.ts"]) {
    const result = spawnSync("npx", ["tsx", script], { cwd: root, env, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`${script} failed`);
  }
}

async function startServer() {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 120; i += 1) {
    try {
      const health = await call("GET", "/api/health");
      if (health.body?.ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  child.kill("SIGKILL");
  throw new Error("the app did not become healthy in 60s");
}

/** CONGU strokes received on a hole (same shape as the app, re-derived). */
function strokesReceived(handicap, strokeIndex) {
  if (!Number.isFinite(handicap) || handicap === 0) return 0;
  const h = Math.trunc(handicap);
  if (h > 0) {
    const full = Math.floor(h / 18);
    const extra = h % 18;
    return full + (strokeIndex <= extra ? 1 : 0);
  }
  return 0;
}

/** Eight players with strictly increasing NET scores: player i's net is par+i. */
async function fieldOfEight(adminCookie) {
  const before = new Set((await call("GET", "/api/players", { cookie: adminCookie })).body.players.map((p) => p.id));
  const ids = [];
  for (let i = 0; i < 8; i += 1) {
    const created = await call("POST", "/api/auth/register", {
      body: {
        name: `Season Golfer ${i + 1}`,
        email: `season.${i}.${Date.now()}@golfday.test`,
        password: "golfday123",
        handicapIndex: i * 2,
        handicapSource: "MANUAL",
      },
    });
    must(created.status === 200, `could not create golfer ${i + 1} (${created.status})`);
  }
  const after = (await call("GET", "/api/players", { cookie: adminCookie })).body.players;
  for (const p of after) if (!before.has(p.id)) ids.push(p.id);
  must(ids.length === 8, `expected 8 new golfers, got ${ids.length}`);
  return ids;
}

async function createEvent(adminCookie, { name, date, format, allowance = 95 }) {
  const created = await call("POST", "/api/events", {
    cookie: adminCookie,
    body: { name, date, startTime: "09:00", format, handicapAllowance: allowance, status: "OPEN", isPublic: true, maxPlayers: 20 },
  });
  must(created.status === 201, `could not create ${name} (${created.status}): ${JSON.stringify(created.body)}`);
  return created.body.event;
}

async function enterAndGroup(adminCookie, event, ids) {
  for (const playerId of ids) {
    const entered = await call("POST", `/api/events/${event.id}/players`, { cookie: adminCookie, body: { playerId } });
    must(entered.status === 201, `could not enter ${playerId} (${entered.status})`);
  }
  const allocated = await call("POST", `/api/events/${event.id}/auto-groups`, { cookie: adminCookie, body: { size: 4 } });
  must(allocated.status === 200, `auto-groups failed (${allocated.status})`);
  const bundle = (await call("GET", `/api/events/${event.id}`, { cookie: adminCookie })).body;
  must(bundle.groups.length === 2, `expected 2 four-balls, got ${bundle.groups.length}`);
  return bundle;
}

/**
 * Player i's NET is par+i on every hole: card gross = par + i + the shots
 * their playing handicap receives, so the board order is known exactly and no
 * two golfers can tie - whatever their handicap happens to be.
 */
async function cardIndividual(adminCookie, event, bundle, playerIndex) {
  const { player, registration } = bundle.registrations[playerIndex];
  const group = bundle.groups.find((g) => g.id === registration.groupId);
  for (const hole of bundle.holes) {
    const received = strokesReceived(registration.playingHandicap, hole.strokeIndex);
    const result = await call("POST", "/api/scores", {
      body: {
        eventId: event.id,
        playerId: player.id,
        holeNumber: hole.holeNumber,
        strokes: hole.par + playerIndex + received,
        token: group.token,
      },
    });
    must(result.status === 200, `${player.name} hole ${hole.holeNumber} failed (${result.status})`);
  }
}

/** One team card: the four-ball scores par+1 a hole (mid-field). */
async function cardScrambleTeam(adminCookie, event, bundle, groupIndex) {
  const group = bundle.groups[groupIndex];
  for (const hole of bundle.holes) {
    const result = await call("POST", "/api/scramble", {
      body: { eventId: event.id, groupId: group.id, holeNumber: hole.holeNumber, strokes: hole.par + 1, token: group.token },
    });
    must(result.status === 200, `scramble hole ${hole.holeNumber} failed (${result.status})`);
  }
}

async function main() {
  say("\nGolfDay - a season's running totals, end to end\n");
  say(`app: ${root}\nport: ${port}  db: ${path.relative(root, dbFile)}`);
  prepareDatabase();
  const server = await startServer();
  let adminCookie;
  let exitCode = 0;

  try {
    adminCookie = await login("admin@golfday.app", "golfday123");
    const ids = await fieldOfEight(adminCookie);

    let season;
    let fixtureIds = [];
    /** Each player's table points after fixture 1, for the increments below. */
    let afterDay1 = new Map();

    await step("start a season that runs May to June", async () => {
      const created = await call("POST", "/api/seasons", {
        cookie: adminCookie,
        body: { name: "Campaign Cup", startsOn: "2026-05-01", endsOn: "2026-06-30", scheme: "POSITION", bestOf: 0 },
      });
      must(created.status === 201, `could not start the season (${created.status})`);
      season = created.body.season;
      must(Boolean(season.slug), "the season has no slug for the noticeboard page");
      note(`season ${season.id} starts ${"2026-05-01"}, ends ${"2026-06-30"}`);
    });

    await step("fixture 1: a medal, and the table fills in exact position points", async () => {
      const event = await createEvent(adminCookie, { name: "Season Opener", date: "2026-05-10", format: "STROKE_PLAY", allowance: 95 });
      const bundle = await enterAndGroup(adminCookie, event, ids);
      for (let i = 0; i < ids.length; i += 1) await cardIndividual(adminCookie, event, bundle, i);
      const attached = await call("POST", `/api/seasons/${season.id}/events`, { cookie: adminCookie, body: { eventId: event.id } });
      must(attached.status === 200, `could not attach the fixture (${attached.status})`);
      fixtureIds.push(event.id);

      const { table } = (await call("GET", `/api/seasons/${season.id}`)).body;
      must(table.rows.length === 8, `expected 8 rows, got ${table.rows.length}`);
      // Player i's net is par+i, so position i+1 is known: the points must be
      // the published scale, not "something sensible".
      table.rows.forEach((row, i) => {
        const expected = pointsForPosition(i + 1);
        check(row.position === i + 1, `row ${i} is in position ${row.position}`);
        check(row.points === expected, `${row.playerName} has ${row.points} pts, expected ${expected} for position ${i + 1}`);
        check(row.played === 1 && row.counting === 1, `${row.playerName} played ${row.played}, counting ${row.counting}`);
        check(row.wins === (i === 0 ? 1 : 0), `${row.playerName} shows ${row.wins} wins`);
      });
      afterDay1 = new Map(table.rows.map((row) => [row.playerId, row.points]));
      note(`after fixture 1: ${table.rows[0].playerName} leads with ${table.rows[0].points} pts`);
    });

    await step("fixture 2: a shamble adds to the running total, not restarts it", async () => {
      const event = await createEvent(adminCookie, { name: "Shamble Sunday", date: "2026-05-17", format: "SHAMBLE" });
      const bundle = await enterAndGroup(adminCookie, event, ids);
      for (let i = 0; i < ids.length; i += 1) await cardIndividual(adminCookie, event, bundle, i);
      const attached = await call("POST", `/api/seasons/${season.id}/events`, { cookie: adminCookie, body: { eventId: event.id } });
      must(attached.status === 200, `could not attach the shamble (${attached.status})`);
      fixtureIds.push(event.id);

      const { table, fixtures } = (await call("GET", `/api/seasons/${season.id}`)).body;
      must(fixtures.length === 2, `expected 2 fixtures, got ${fixtures.length}`);
      // The shamble pays TEAM positions: golfer 1's net is the best of the
      // field, so their team wins (100 pts each) and the other team is second
      // (90 each). Every member of a team gets the SAME increment on top of
      // their day-one total - that is what "the team's result is each
      // member's result" means in numbers.
      const bestGolfer = table.rows.find((row) => row.playerId === ids[0]);
      must(Boolean(bestGolfer), "golfer 1 is missing from the table");
      const day2 = bestGolfer.results[1];
      check(day2.team === true, "the shamble did not count as a team result");
      check(day2.position === 1, `golfer 1's team finished ${day2.position}, expected the win`);
      const winnerTeam = day2.teamName;
      must(Boolean(winnerTeam), "the winning shamble result has no team name");
      table.rows.forEach((row) => {
        check(row.played === 2 && row.counting === 2, `${row.playerName} played ${row.played} of 2`);
        check(row.results.length === 2, `${row.playerName} shows ${row.results.length} results`);
        check(row.results[0].team === false, `${row.playerName}'s medal counted as a team result`);
        check(row.results[1].team === true, `${row.playerName}'s shamble did not count as a team result`);
        const onWinningTeam = row.results[1].teamName === winnerTeam;
        const increment = onWinningTeam ? 100 : pointsForPosition(2);
        const expected = (afterDay1.get(row.playerId) ?? 0) + increment;
        check(row.points === expected, `${row.playerName} total ${row.points}, expected ${expected} (day one ${afterDay1.get(row.playerId)} + ${increment})`);
      });
      const winners = table.rows.filter((row) => row.results[1].teamName === winnerTeam);
      check(winners.length === 4, `the winning team has ${winners.length} members, expected 4`);
      note(`after fixture 2: ${table.rows[0].playerName} on ${table.rows[0].points} pts over 2 days (team "${winnerTeam}" won the shamble)`);
    });

    await step("fixture 3: a Texas scramble pays every member of the team", async () => {
      const event = await createEvent(adminCookie, { name: "Scramble Finale", date: "2026-05-24", format: "TEXAS_SCRAMBLE", allowance: 100 });
      const bundle = await enterAndGroup(adminCookie, event, ids);
      await cardScrambleTeam(adminCookie, event, bundle, 0); // group 0: par+1
      await cardScrambleTeam(adminCookie, event, bundle, 1); // group 1: par+1 (level)
      const attached = await call("POST", `/api/seasons/${season.id}/events`, { cookie: adminCookie, body: { eventId: event.id } });
      must(attached.status === 200, `could not attach the scramble (${attached.status})`);
      fixtureIds.push(event.id);

      const { table } = (await call("GET", `/api/seasons/${season.id}`)).body;
      for (const row of table.rows) {
        const teamResult = row.results.find((r) => r.eventName === "Scramble Finale");
        must(Boolean(teamResult), `${row.playerName} has no result from the scramble`);
        check(teamResult.team === true, `${row.playerName}'s scramble result is not marked as a team result`);
        check(Boolean(teamResult.teamName), `${row.playerName}'s scramble result has no team name`);
        check(row.played === 3, `${row.playerName} played ${row.played} of 3`);
      }
      note(`after fixture 3: every member earned their team's result (team: ${table.rows[0].results[2].teamName ?? "tied"})`);
    });

    await step("a fixture outside the season's dates is listed but cannot score", async () => {
      const event = await createEvent(adminCookie, { name: "Next Season Opener", date: "2026-07-15", format: "STABLEFORD" });
      const bundle = await enterAndGroup(adminCookie, event, ids);
      for (let i = 0; i < ids.length; i += 1) await cardIndividual(adminCookie, event, bundle, i);
      const attached = await call("POST", `/api/seasons/${season.id}/events`, { cookie: adminCookie, body: { eventId: event.id } });
      must(attached.status === 200, `could not attach the out-of-window fixture (${attached.status})`);

      const { table, fixtures } = (await call("GET", `/api/seasons/${season.id}`)).body;
      check(fixtures.length === 4, `expected 4 listed fixtures, got ${fixtures.length}`);
      const leader = table.rows[0];
      check(leader.played === 3, `the July fixture scored in the table (played ${leader.played})`);
      check(table.fixtures === 3, `the table counted ${table.fixtures} scoring fixtures, expected 3`);
      note("July fixture listed, but the table still counts three scoring days");
    });

    await step("best-1 season: only each golfer's best day counts", async () => {
      const created = await call("POST", "/api/seasons", {
        cookie: adminCookie,
        body: { name: "One To Count", startsOn: "2026-05-01", endsOn: "2026-06-30", scheme: "STABLEFORD", bestOf: 1 },
      });
      must(created.status === 201, `could not start the best-of season (${created.status})`);
      const best = created.body.season;
      // A golf day counts in exactly ONE season (season_events is unique on
      // the event), so this season plays its own two medals rather than
      // borrowing the Campaign Cup's - which also proves the first season's
      // table is still intact afterwards.
      for (const [name, date] of [
        ["Best Of One - Spring", "2026-06-07"],
        ["Best Of One - Summer", "2026-06-14"],
      ]) {
        const event = await createEvent(adminCookie, { name, date, format: "STROKE_PLAY", allowance: 95 });
        const bundle = await enterAndGroup(adminCookie, event, ids);
        for (let i = 0; i < ids.length; i += 1) await cardIndividual(adminCookie, event, bundle, i);
        const attached = await call("POST", `/api/seasons/${best.id}/events`, { cookie: adminCookie, body: { eventId: event.id } });
        must(attached.status === 200, `could not attach ${name} (${attached.status})`);
      }
      const { table } = (await call("GET", `/api/seasons/${best.id}`)).body;
      // STABLEFORD scheme: the award is the round's points, best one only.
      for (const row of table.rows) {
        check(row.played === 2, `${row.playerName} played ${row.played} of its own two fixtures`);
        check(row.counting === 1, `${row.playerName} counts ${row.counting} results, expected 1`);
        const all = row.results.map((r) => r.stablefordPoints);
        const expected = Math.max(...all);
        check(row.points === expected, `${row.playerName} total ${row.points}, expected best ${expected}`);
      }
      note(`best-of-1: totals are each golfer's highest single round (leader ${table.rows[0].playerName}: ${table.rows[0].points})`);

      // The Campaign Cup must be untouched by any of that.
      const campaign = (await call("GET", `/api/seasons/${season.id}`)).body;
      check(campaign.table.fixtures === 3, `Campaign Cup counts ${campaign.table.fixtures} scoring fixtures, expected 3`);
      check(campaign.table.rows.every((r) => r.played === 3), "a Campaign Cup row changed while another season scored");
    });

    await step("once the season is over the noticeboard calls it a winner", async () => {
      // endsOn 30 June 2026 - before today - so the table has decided.
      const html = await (await fetch(`${base}/seasons/${season.slug}`)).text();
      check(html.includes("Season winner"), "the season page does not say Season winner");
      check(html.includes("Campaign Cup"), "the season page does not name the season");
      const { table } = (await call("GET", `/api/seasons/${season.id}`)).body;
      must(table.rows.length > 0, "the finished season has an empty table");
      check(html.includes(table.rows[0].playerName), "the winner's name is not on the page");
      note(`winner: ${table.rows[0].playerName} (${table.rows[0].points} pts)`);
    });
  } catch (error) {
    failures.push({ name: "run", error });
    say(colour(31, `\n${error.stack ?? error.message}`));
    exitCode = 1;
  } finally {
    server.kill("SIGKILL");
  }

  say("\nResult");
  if (failures.length === 0) {
    say(colour(32, `All ${checks} checks passed.`));
  } else {
    exitCode = 1;
    say(colour(31, `${failures.length} of ${checks} checks failed:`));
    for (const failure of failures) say(colour(31, `  - ${failure.name}: ${failure.error.message}`));
  }
  if (notes.length > 0) {
    say(colour(90, "\nNotes"));
    for (const line of notes) say(colour(90, `  · ${line}`));
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
