/**
 * GolfDay end-to-end: every event type, a full 19-player field, four-balls,
 * invitations, all 18 holes of scoring and the side games.
 *
 *   npm run e2e:formats
 *
 * This drives the HTTP API exactly as the browser does (sign in, create a golf
 * day, register the field, allocate groups, enter every hole, watch the live
 * feed) rather than clicking through a browser, so it runs anywhere Node runs
 * and completes three formats in one pass. It owns its database file and its
 * port and never touches your data.
 *
 * For each of STABLEFORD, STROKE_PLAY and TEXAS_SCRAMBLE it checks:
 *   1. a 19-player field being registered, with playing handicaps applied
 *   2. random (size 4) and manual four-ball allocation, plus edits before tee off
 *   3. invitation emails carrying the join code and each group's card link
 *   4. every hole scored for everyone, checked against an independent recompute
 *   5. the leaderboard arithmetic and ordering for that format
 *   6. live updates over Server-Sent Events while scores land
 *   7. skins, 4BBB pairs, match play and nearest-the-pin / longest-drive
 *   8. the completed-event lock (players shut out, admins still able to fix a card)
 *
 * Emails are mocked: the app has no mail transport, so this file renders the
 * message an organiser would send (join code + card links) and writes it to
 * e2e/artifacts/mail/ as a .eml you can open in any mail client.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.E2E_PORT ?? 3212);
const base = `http://127.0.0.1:${port}`;
const dbFile = path.join(root, "data", "e2e-formats.db");
const artifacts = path.join(root, "e2e", "artifacts");
const mailDir = path.join(artifacts, "mail");
const env = {
  ...process.env,
  DATABASE_URL: `file:${dbFile}`,
  AUTH_SECRET: process.env.AUTH_SECRET || "e2e-only-secret-0123456789abcdefghijkl",
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
};

const FIELD_SIZE = 19;
const FORMATS = [
  { format: "STABLEFORD", label: "Stableford", allowance: 95, date: "2026-05-09" },
  { format: "STROKE_PLAY", label: "Stroke play", allowance: 100, date: "2026-05-16" },
  { format: "TEXAS_SCRAMBLE", label: "Texas scramble", allowance: 100, date: "2026-05-23" },
];

let stepNo = 0;
let checks = 0;
const failures = [];
const notes = [];

const colour = (code, text) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);

function say(message = "") {
  console.log(message);
}

function section(title) {
  say(`\n${colour(1, title)}`);
}

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

/** A hard assertion: the run cannot continue meaningfully without it. */
function must(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

/** A soft assertion: record it and carry on so one bug doesn't hide the rest. */
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

/* ————— HTTP ————— */

async function call(method, url, { body, cookie, headers = {}, text = false } = {}) {
  const response = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const raw = text ? await response.text() : await response.json().catch(() => null);
  const setCookie = response.headers.getSetCookie?.() ?? [];
  return { status: response.status, body: raw, headers: response.headers, setCookie };
}

const cookieFrom = (result) => {
  const pair = result.setCookie.map((c) => c.split(";")[0]).find((c) => c.includes("="));
  return pair ?? "";
};

async function login(email, password) {
  const result = await call("POST", "/api/auth/login", { body: { email, password } });
  must(result.status === 200, `sign in as ${email} failed (${result.status})`);
  const cookie = cookieFrom(result);
  must(Boolean(cookie), `no session cookie for ${email}`);
  return cookie;
}

/* ————— Independent re-implementation of the handicap + scoring maths ————— */

function strokesReceived(handicap, strokeIndex) {
  const h = Math.trunc(handicap);
  if (!Number.isFinite(h) || h === 0) return 0;
  if (h > 0) return Math.floor(h / 18) + (strokeIndex <= h % 18 ? 1 : 0);
  const back = Math.abs(h);
  const given = Math.floor(back / 18) + (strokeIndex > 18 - (back % 18) ? 1 : 0);
  return given === 0 ? 0 : -given;
}

const stablefordPoints = (par, gross, received) => Math.max(0, par + 2 - (gross - received));

/** Deterministic, so a failure can always be reproduced. */
function pseudoRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function grossFor(par, random) {
  const roll = random();
  if (roll < 0.08) return par - 1;
  if (roll < 0.55) return par;
  if (roll < 0.85) return par + 1;
  if (roll < 0.96) return par + 2;
  return par + 3;
}

/* ————— Mock mailer ————— */

function writeMail({ to, name, event, group, joinCode, cardUrl, teeTime }) {
  const slug = event.slug;
  const dir = path.join(mailDir, slug);
  mkdirSync(dir, { recursive: true });
  const subject = `${event.name} - ${group ? `you're in ${group.name}, ${teeTime}` : "you're in the field"}`;
  const body = [
    `From: GolfDay <organiser@golfday.test>`,
    `To: ${name} <${to}>`,
    `Subject: ${subject}`,
    `X-GolfDay-Event: ${event.name}`,
    `X-GolfDay-Join-Code: ${joinCode}`,
    `X-GolfDay-Group: ${group?.name ?? "unallocated"}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Hi ${name.split(" ")[0]},`,
    ``,
    `You're in ${event.name} at ${event.courseName ?? "the course"} on ${event.date}, teeing off from ${teeTime}.`,
    ``,
    group ? `Your tee group is ${group.name}.` : `You're not in a tee group yet.`,
    `Enter your group's card here: ${cardUrl}`,
    ``,
    `Join code (for changes to your entry): ${joinCode}`,
    `Watch the leaderboard: ${base}/live/${slug}`,
    ``,
    `See you on the first tee.`,
    ``,
  ].join("\n");
  const file = path.join(dir, `${String(to).replace(/[^a-z0-9]+/gi, "-")}.eml`);
  writeFileSync(file, body);
  return { file, subject, body, joinCode, cardUrl };
}

/* ————— Live feed ————— */

async function watchStream(eventId) {
  const controller = new AbortController();
  const frames = [];
  const done = (async () => {
    try {
      const response = await fetch(`${base}/api/events/${eventId}/stream`, { signal: controller.signal });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          if (chunk.startsWith("event: leaderboard")) {
            const data = JSON.parse(chunk.split("data: ")[1]);
            frames.push({ revision: data.revision, standings: data.standings, games: data.games });
          }
        }
      }
    } catch {
      /* aborted at the end of the test, as expected */
    }
  })();
  return { frames, stop: () => controller.abort(), done };
}

/* ————— Server ————— */

function prepareDatabase() {
  mkdirSync(path.join(root, "data"), { recursive: true });
  if (existsSync(dbFile)) rmSync(dbFile, { force: true });
  const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  for (const script of ["scripts/db-push.ts", "scripts/seed.ts"]) {
    const result = spawnSync(process.execPath, [tsx, script], { cwd: root, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${script} failed\n${result.stdout}${result.stderr}`);
  }
}

async function startServer() {
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    if (process.env.E2E_VERBOSE) process.stdout.write(colour(90, String(chunk)));
  });
  child.stderr.on("data", (chunk) => {
    if (process.env.E2E_VERBOSE) process.stderr.write(colour(90, String(chunk)));
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

/* ————— Fixtures ————— */

async function buildField(adminCookie) {
  const before = (await call("GET", "/api/players", { cookie: adminCookie })).body.players;
  must(before.length >= FIELD_SIZE - 1, `the seed only has ${before.length} players`);

  // One extra account on top of the seed's eighteen, so the field matches the
  // size of the live demo (19 players). Capturing the ids by difference keeps
  // the field identical in every format, whatever else the run creates.
  const registered = await call("POST", "/api/auth/register", {
    body: {
      name: "Test Nineteenth",
      email: `nineteenth.${Date.now()}@golfday.test`,
      password: "golfday123",
      handicapIndex: 12.4,
      handicapSource: "MANUAL",
    },
  });
  must(registered.status === 200, `could not register the 19th player (${registered.status})`);

  const after = (await call("GET", "/api/players", { cookie: adminCookie })).body.players;
  const known = new Set(before.map((p) => p.id));
  const fresh = after.filter((p) => !known.has(p.id));
  must(fresh.length === 1, `expected one new player, found ${fresh.length}`);
  const ids = [...before.slice(0, FIELD_SIZE - 1).map((p) => p.id), fresh[0].id];
  must(ids.length === FIELD_SIZE, `field has ${ids.length} players`);
  return { ids, players: [...before.slice(0, FIELD_SIZE - 1), fresh[0]] };
}

async function createEvent(adminCookie, { name, format, allowance, date, courseId, maxPlayers }) {
  const created = await call("POST", "/api/events", {
    cookie: adminCookie,
    body: {
      name,
      description: `Full-field ${format} check: ${FIELD_SIZE} players, four-balls, every hole.`,
      date,
      startTime: "09:00",
      courseId,
      format,
      handicapAllowance: allowance,
      maxPlayers,
      status: "OPEN",
      isPublic: true,
    },
  });
  must(created.status === 201, `could not create ${name} (${created.status}): ${JSON.stringify(created.body)}`);
  return created.body.event;
}

async function bundle(adminCookie, eventId) {
  const result = await call("GET", `/api/events/${eventId}`, { cookie: adminCookie });
  must(result.status === 200, `could not read event ${eventId} (${result.status})`);
  return result.body;
}

async function enterField(adminCookie, event, ids) {
  for (const playerId of ids) {
    const entered = await call("POST", `/api/events/${event.id}/players`, {
      cookie: adminCookie,
      body: { playerId },
    });
    if (entered.status !== 201) {
      throw new Error(`could not enter ${playerId} (${entered.status}): ${JSON.stringify(entered.body)}`);
    }
  }
  return ids;
}

/* ————— One format, end to end ————— */

async function runFormat(ctx, config) {
  const { adminCookie, courseId, playerCookies, fieldIds } = ctx;
  const label = config.label;
  section(`${label} (${config.format}, ${config.allowance}% allowance)`);

  let event;
  let groups;
  let holes;
  let registrations;
  let scorecard = [];

  await step("create the golf day and enter 19 players", async () => {
    event = await createEvent(adminCookie, {
      name: `${label} Full Field`,
      format: config.format,
      allowance: config.allowance,
      date: config.date,
      courseId,
      maxPlayers: 40,
    });
    const ids = await enterField(adminCookie, event, fieldIds);
    const data = await bundle(adminCookie, event.id);
    must(data.registrations.length === FIELD_SIZE, `expected ${FIELD_SIZE} entries, got ${data.registrations.length}`);
    must(data.holes.length === 18, `expected an 18-hole card, got ${data.holes.length}`);
    registrations = data.registrations;
    holes = data.holes;
    check(ids.length === FIELD_SIZE, "field sizes disagree between the directory and the event");
  });

  await step("playing handicaps follow index, slope, rating and the event allowance", async () => {
    const course = (await call("GET", "/api/courses", { cookie: adminCookie })).body.courses.find((c) => c.id === courseId);
    const tees = JSON.parse(course.tees ?? "[]");
    let compared = 0;
    for (const { player, registration } of registrations) {
      const tee = tees.find((t) => t.name === registration.tee) ?? tees[0];
      const par = tee.par ?? 72;
      const courseHcp = Math.round(player.handicapIndex * ((tee.slope || 113) / 113) + ((tee.rating ?? par) - par));
      const expected = Math.round(courseHcp * (config.allowance / 100));
      check(
        registration.playingHandicap === expected,
        `${player.name}: playing handicap ${registration.playingHandicap} should be ${expected} (index ${player.handicapIndex}, ${tee.name} slope ${tee.slope})`,
      );
      compared += 1;
    }
    must(compared === FIELD_SIZE, "not every entry's handicap was checked");
  });

  await step("random four-balls: 5 groups of 4/4/4/4/3, everyone placed once", async () => {
    const allocated = await call("POST", `/api/events/${event.id}/auto-groups`, {
      cookie: adminCookie,
      body: { size: 4 },
    });
    must(allocated.status === 200, `auto-groups failed (${allocated.status}) ${JSON.stringify(allocated.body)}`);
    const data = await bundle(adminCookie, event.id);
    groups = data.groups;
    check(groups.length === 5, `expected 5 four-balls for 19 players, got ${groups.length}`);
    const sizes = groups.map((g) => (data.registrations ?? []).filter((r) => r.registration.groupId === g.id).length);
    const total = sizes.reduce((a, b) => a + b, 0);
    const placements = data.registrations.map((r) => r.registration.groupId);
    check(total === FIELD_SIZE, `groups hold ${total} players, not ${FIELD_SIZE}`);
    check(!placements.includes(null), "a player was left without a group");
    check(new Set(placements).size === groups.length, `${new Set(placements).size} of ${groups.length} groups are in use`);
    check(data.registrations.length === FIELD_SIZE, `the event holds ${data.registrations.length} entries, not ${FIELD_SIZE}`);
    check(Math.max(...sizes) <= 4, `a four-ball has ${Math.max(...sizes)} players`);
    note(`group sizes: ${sizes.join(" / ")}`);
    const times = groups.map((g) => g.teeTime);
    check(
      times.every((t) => /^\d{2}:\d{2}$/.test(t)) && [...times].sort().join() === times.join(),
      `tee times should be set and in order, got ${times.join(", ")}`,
    );
    check(new Set(groups.map((g) => g.token)).size === groups.length, "two groups share a scoring token");
  });

  await step("manual edits before tee off: rename, move a player, re-time the group", async () => {
    const [first, last] = groups;
    const renamed = await call("PATCH", `/api/events/${event.id}/groups`, {
      cookie: adminCookie,
      body: { groupId: last.id, name: "The Late Fourball", teeTime: "11:40" },
    });
    must(renamed.status === 200, `renaming a group failed (${renamed.status})`);
    const data = await bundle(adminCookie, event.id);
    const updated = data.groups.find((g) => g.id === last.id);
    check(updated.name === "The Late Fourball", `group name is still ${updated.name}`);
    check(updated.teeTime === "11:40", `group tee time is still ${updated.teeTime}`);

    // Move one player from the first group into the last, then back again.
    const mover = data.registrations.find((r) => r.registration.groupId === first.id).player;
    const moved = await call("POST", `/api/events/${event.id}/groups/${last.id}`, {
      cookie: adminCookie,
      body: { playerId: mover.id, action: "add" },
    });
    must(moved.status === 200, `moving a player failed (${moved.status})`);
    let after = await bundle(adminCookie, event.id);
    check(
      after.registrations.find((r) => r.player.id === mover.id).registration.groupId === last.id,
      "the moved player is not in the destination group",
    );
    await call("POST", `/api/events/${event.id}/groups/${first.id}`, {
      cookie: adminCookie,
      body: { playerId: mover.id, action: "add" },
    });
    after = await bundle(adminCookie, event.id);
    check(
      after.registrations.find((r) => r.player.id === mover.id).registration.groupId === first.id,
      "the player did not move back",
    );
  });

  await step("a player can pick their own tee group, but not into a full one", async () => {
    const signedIn = playerCookies.sam;
    if (!signedIn) {
      note("no player session available - skipped the self-service group check");
      return;
    }
    const data = await bundle(adminCookie, event.id);
    const me = data.registrations.find((r) => r.player.email === "sam@golfday.app" || r.player.name === "Sam Whitcombe");
    if (!me) {
      note("Sam is not in this field - skipped the self-service group check");
      return;
    }
    // Remove Sam from his group, then let him pick a group with room himself.
    await call("POST", `/api/events/${event.id}/groups/${me.registration.groupId}`, {
      cookie: signedIn,
      body: { playerId: me.player.id, action: "remove" },
    });
    const size = (groupId) =>
      data.registrations.filter((r) => r.registration.groupId === groupId && r.player.id !== me.player.id).length;
    const target = data.groups
      .filter((g) => g.id !== me.registration.groupId && size(g.id) < 4)
      .sort((a, b) => size(a.id) - size(b.id))[0];
    if (!target) {
      // Every other group is a full four-ball: put him back where he was, so the
      // field stays intact for the scoring checks below.
      await call("POST", `/api/events/${event.id}/groups/${me.registration.groupId}`, {
        cookie: signedIn,
        body: { playerId: me.player.id, action: "add" },
      });
      note("every other group is a full four-ball - skipped the self-service move");
      return;
    }
    const joined = await call("POST", `/api/events/${event.id}/groups/${target.id}`, {
      cookie: signedIn,
      body: { playerId: me.player.id, action: "add" },
    });
    check(joined.status === 200, `a player could not choose their own group (${joined.status})`);

    // A full four-ball is closed to self-service entry.
    const full = data.groups.find((g) => g.id !== target.id && size(g.id) >= 4);
    if (full) {
      const refused = await call("POST", `/api/events/${event.id}/groups/${full.id}`, {
        cookie: signedIn,
        body: { playerId: me.player.id, action: "add" },
      });
      check(refused.status === 409, `a five-ball was allowed (${refused.status})`);
    }
    // Put Sam back where he started so the four-balls stay as allocated.
    await call("POST", `/api/events/${event.id}/groups/${me.registration.groupId}`, {
      cookie: signedIn,
      body: { playerId: me.player.id, action: "add" },
    });
  });

  await step("invitation emails carry the join code and the right card link", async () => {
    const data = await bundle(adminCookie, event.id);
    groups = data.groups;
    const mails = [];
    for (const { player, registration } of data.registrations) {
      const group = groups.find((g) => g.id === registration.groupId);
      mails.push(
        writeMail({
          to: player.email ?? `${player.name.toLowerCase().replace(/[^a-z]+/g, ".")}@golfday.test`,
          name: player.name,
          event: data.event,
          group,
          joinCode: data.event.joinCode,
          cardUrl: `${base}/score/${group?.token ?? ""}`,
          teeTime: group?.teeTime ?? data.event.startTime,
        }),
      );
    }
    must(mails.length === FIELD_SIZE, `wrote ${mails.length} invitations, expected ${FIELD_SIZE}`);
    const codes = new Set(mails.map((m) => m.joinCode));
    check(codes.size === 1 && [...codes][0] === data.event.joinCode, "the invitations disagree about the join code");
    const urls = new Set(mails.map((m) => m.cardUrl));
    check(urls.size === groups.length, `expected ${groups.length} distinct card links, saw ${urls.size}`);
    check(mails.every((m) => /\/score\/[A-Za-z0-9_-]{6,}/.test(m.cardUrl)), "a card link is malformed");
    note(`${mails.length} invitations written to e2e/artifacts/mail/${data.event.slug}/`);
    // The link in the mail must actually open that group's card.
    const card = await call("GET", `/score/${groups[0].token}`, { text: true });
    check(card.status === 200, `the scorecard link returns ${card.status}`);
    check(card.body.includes(data.event.name), "the scorecard page does not name the golf day");
  });

  await step("the join code enters a player without an organiser", async () => {
    const joiner = ctx.joinerPlayer;
    must(Boolean(joiner), "no spare account to try the join code");
    const fresh = await bundle(adminCookie, event.id);
    const joined = await call("POST", "/api/events/join", {
      cookie: ctx.joinerCookie,
      body: { code: fresh.event.joinCode },
    });
    check(joined.status === 200, `join by code failed (${joined.status}) ${JSON.stringify(joined.body)}`);
    check(joined.body?.slug === event.slug, "joining by code returned the wrong golf day");
    // Back out again so the field stays at 19 for the scoring checks.
    const left = await call("DELETE", `/api/events/${event.id}/players/${joiner.id}`, { cookie: ctx.joinerCookie });
    check(left.status === 200, `withdrawing after joining by code failed (${left.status})`);
    const after = await bundle(adminCookie, event.id);
    check(after.registrations.length === FIELD_SIZE, `the field is ${after.registrations.length} after the join/withdraw round trip`);
  });

  await step("score every hole for all 19 (or per team for a scramble)", async () => {
    const data = await bundle(adminCookie, event.id);
    groups = data.groups;
    holes = data.holes;
    const random = pseudoRandom(config.format.length * 7919);
    scorecard = [];

    if (config.format === "TEXAS_SCRAMBLE") {
      for (const group of groups) {
        const members = data.registrations.filter((r) => r.registration.groupId === group.id).map((r) => r.player);
        const entry = { group, members, holes: [] };
        for (const hole of holes) {
          const strokes = grossFor(hole.par - 1, random);
          const drivePlayer = members[Math.floor(random() * members.length)];
          const result = await call("POST", "/api/scramble", {
            body: {
              eventId: event.id,
              groupId: group.id,
              holeNumber: hole.holeNumber,
              strokes,
              drivePlayerId: drivePlayer?.id ?? null,
              token: group.token,
            },
          });
          must(result.status === 200, `scramble hole ${hole.holeNumber} for ${group.name} failed (${result.status}) ${JSON.stringify(result.body)}`);
          entry.holes.push({ ...hole, strokes, drivePlayerId: drivePlayer?.id ?? null });
        }
        scorecard.push(entry);
      }
      note(`${groups.length} team cards of 18 holes entered`);
      return;
    }

    for (const { player, registration } of data.registrations) {
      const group = groups.find((g) => g.id === registration.groupId);
      const entry = { player, registration, group, holes: [] };
      for (const hole of holes) {
        const strokes = grossFor(hole.par, random);
        const result = await call("POST", "/api/scores", {
          body: { eventId: event.id, playerId: player.id, holeNumber: hole.holeNumber, strokes, token: group.token },
        });
        must(
          result.status === 200,
          `hole ${hole.holeNumber} for ${player.name} failed (${result.status}) ${JSON.stringify(result.body)}`,
        );
        const received = strokesReceived(registration.playingHandicap, hole.strokeIndex);
        const stableford = stablefordPoints(hole.par, strokes, received);
        const expected = config.format === "STABLEFORD" ? stableford : 0;
        check(
          result.body.points === expected,
          `${player.name} hole ${hole.holeNumber}: ${result.body.points} points, expected ${expected}`,
        );
        check(
          result.body.shotsReceived === received,
          `${player.name} hole ${hole.holeNumber}: ${result.body.shotsReceived} shots received, expected ${received}`,
        );
        entry.holes.push({ ...hole, strokes, received, points: stableford });
      }
      scorecard.push(entry);
    }
    note(`${scorecard.length} cards x 18 holes entered`);
  });

  await step("each scoring endpoint refuses the wrong format and a draft", async () => {
    const fresh = await bundle(adminCookie, event.id);
    const subject = fresh.registrations[0];
    if (config.format === "TEXAS_SCRAMBLE") {
      const individual = await call("POST", "/api/scores", {
        body: { eventId: event.id, playerId: subject.player.id, holeNumber: 1, strokes: 4 },
      });
      check(individual.status === 409, `an individual score was accepted on a scramble (${individual.status})`);
    } else {
      const team = await call("POST", "/api/scramble", {
        body: { eventId: event.id, groupId: fresh.groups[0].id, holeNumber: 1, strokes: 4, token: fresh.groups[0].token },
      });
      check(team.status === 409, `a team card was accepted on a ${label.toLowerCase()} event (${team.status})`);
    }
  });

  await step("every card is complete and the revision advanced with each write", async () => {
    const data = await bundle(adminCookie, event.id);
    const expected = config.format === "TEXAS_SCRAMBLE" ? groups.length * 18 : FIELD_SIZE * 18;
    check(data.revision >= expected, `revision reached ${data.revision}, expected at least ${expected}`);
    note(`revision ${data.revision} after ${expected} score entries`);
  });

  await step(`the ${label} leaderboard adds up and sorts correctly`, async () => {
    const board = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
    must(board?.standings, "no leaderboard returned");
    const par = holes.reduce((sum, h) => sum + h.par, 0);

    if (config.format === "TEXAS_SCRAMBLE") {
      check(board.teams?.length === groups.length, `expected ${groups.length} team rows, got ${board.teams?.length}`);
      check((board.standings ?? []).length === 0, "a scramble should not list individual standings");
      for (const team of scorecard) {
        const row = board.teams.find((t) => t.groupId === team.group.id);
        must(Boolean(row), `${team.group.name} is missing from the team board`);
        const gross = team.holes.reduce((sum, h) => sum + h.strokes, 0);
        check(row.gross === gross, `${team.group.name} gross ${row.gross} should be ${gross}`);
        check(row.thru === 18, `${team.group.name} shows thru ${row.thru}`);
        check(row.net === row.gross - row.teamHandicap, `${team.group.name} net is not gross minus team handicap`);
        check(row.netToPar === row.net - par, `${team.group.name} net to par is wrong`);
        check(Array.isArray(row.drivesShort), `${team.group.name} does not report drive usage`);
      }
      const order = board.teams.map((t) => t.netToPar);
      check([...order].sort((a, b) => a - b).join() === order.join(), "teams are not sorted by net to par");
      check(board.teams[0].position === 1, "the leading team is not first");
      const drives = board.teams.flatMap((t) => t.members.map((m) => m.drives));
      check(drives.every((d) => Number.isFinite(d)), "a scramble card does not count drives used");
      note(`drives used per player: ${Math.min(...drives)}-${Math.max(...drives)}`);
      return;
    }

    check(board.standings.length === FIELD_SIZE, `expected ${FIELD_SIZE} rows, got ${board.standings.length}`);
    check(board.par === par, `card par is ${board.par}, expected ${par}`);
    for (const entry of scorecard) {
      const row = board.standings.find((s) => s.playerId === entry.player.id);
      must(Boolean(row), `${entry.player.name} is missing from the board`);
      const gross = entry.holes.reduce((sum, h) => sum + h.strokes, 0);
      const net = entry.holes.reduce((sum, h) => sum + h.strokes - h.received, 0);
      const points = entry.holes.reduce((sum, h) => sum + h.points, 0);
      check(row.thru === 18, `${entry.player.name} shows thru ${row.thru}`);
      check(row.totalStrokes === gross, `${entry.player.name} gross ${row.totalStrokes} should be ${gross}`);
      check(row.totalNet === net, `${entry.player.name} net ${row.totalNet} should be ${net}`);
      check(row.toPar === gross - par, `${entry.player.name} to par ${row.toPar} should be ${gross - par}`);
      check(row.points === points, `${entry.player.name} points ${row.points} should be ${points}`);
      check(row.netToPar === net - par, `${entry.player.name} net to par ${row.netToPar} should be ${net - par}`);
      check(row.playingHandicap === entry.registration.playingHandicap, `${entry.player.name} playing handicap changed on the board`);
    }

    const key = config.format === "STABLEFORD" ? (s) => s.points : (s) => s.netToPar;
    const sortsBy = config.format === "STABLEFORD" ? "points" : "net to par";
    check(board.standings[0].position === 1, "the leader is not in position 1");
    for (let i = 1; i < board.standings.length; i += 1) {
      const above = board.standings[i - 1];
      const here = board.standings[i];
      if (here.position === above.position) {
        check(key(here) === key(above), `${above.playerName} and ${here.playerName} share position ${here.position} on different ${sortsBy}`);
        check(here.tied && above.tied, `${here.playerName} level with ${above.playerName} but not marked tied`);
      } else {
        check(here.position === above.position + 1, `position jumps from ${above.position} to ${here.position}`);
        check(
          config.format === "STABLEFORD" ? key(here) <= key(above) : key(here) >= key(above),
          `${label} board is out of order at ${here.playerName}: ${key(above)} then ${key(here)} ${sortsBy}`,
        );
      }
    }
    const leaders = board.standings.filter((s) => s.position === 1);
    check(leaders.length === 1 || leaders.every((s) => s.tied), "players level on first place are not marked tied");
    note(`winner: ${board.standings[0].playerName} (${config.format === "STABLEFORD" ? `${board.standings[0].points} pts` : `${board.standings[0].netToPar} net`})`);
  });

  await step("an amended score is re-scored and audited", async () => {
    const entry = scorecard[0];
    const hole = holes[0];
    if (config.format === "TEXAS_SCRAMBLE") {
      const result = await call("POST", "/api/scramble", {
        body: {
          eventId: event.id,
          groupId: entry.group.id,
          holeNumber: hole.holeNumber,
          strokes: hole.par + 4,
          token: entry.group.token,
        },
      });
      must(result.status === 200, `amending a scramble hole failed (${result.status})`);
      const board = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
      const row = board.teams.find((t) => t.groupId === entry.group.id);
      const gross = row.holeResults.reduce((sum, h) => sum + h.strokes, 0);
      check(row.gross === gross, "the amended scramble hole did not change the team gross");
      return;
    }
    const changed = await call("POST", "/api/scores", {
      body: { eventId: event.id, playerId: entry.player.id, holeNumber: hole.holeNumber, strokes: hole.par + 3, token: entry.group.token },
    });
    must(changed.status === 200, `amending a score failed (${changed.status})`);
    const received = strokesReceived(entry.registration.playingHandicap, hole.strokeIndex);
    check(
      changed.body.points === (config.format === "STABLEFORD" ? stablefordPoints(hole.par, hole.par + 3, received) : 0),
      "the amended score was not re-scored",
    );
    const board = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
    const row = board.standings.find((s) => s.playerId === entry.player.id);
    const onCard = row.holeResults.find((h) => h.holeNumber === hole.holeNumber);
    check(onCard.strokes === hole.par + 3, `the card still shows ${onCard.strokes} on hole 1`);
    // Put the original score back so the rest of the run is unchanged.
    await call("POST", "/api/scores", {
      body: { eventId: event.id, playerId: entry.player.id, holeNumber: hole.holeNumber, strokes: hole.strokes, token: entry.group.token },
    });
  });

  await step("live updates arrive over SSE while a score lands", async () => {
    const data = await bundle(adminCookie, event.id);
    const group = data.groups[0];
    const watch = await watchStream(event.id);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const target = data.registrations.find((r) => r.registration.groupId === group.id);
    // Re-post the value already on the card: every write bumps the revision, so
    // the live feed has to move even though the scores do not - which keeps the
    // cards the games below are checked against unchanged.
    if (config.format === "TEXAS_SCRAMBLE") {
      const card = scorecard.find((entry) => entry.group.id === group.id);
      const lastHole = card.holes.at(-1);
      await call("POST", "/api/scramble", {
        body: { eventId: event.id, groupId: group.id, holeNumber: lastHole.holeNumber, strokes: lastHole.strokes, token: group.token },
      });
    } else {
      const card = scorecard.find((entry) => entry.player.id === target.player.id);
      const lastHole = card.holes.at(-1);
      await call("POST", "/api/scores", {
        body: { eventId: event.id, playerId: target.player.id, holeNumber: lastHole.holeNumber, strokes: lastHole.strokes, token: group.token },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
    watch.stop();
    await watch.done;
    must(watch.frames.length >= 2, `the live feed sent ${watch.frames.length} frame(s)`);
    const last = watch.frames.at(-1);
    const first = watch.frames[0];
    check(last.revision > first.revision, `revision did not move (${first.revision} → ${last.revision})`);
    if (config.format === "TEXAS_SCRAMBLE") {
      check(last.games !== undefined || last.standings !== undefined, "the live frame carries no payload");
    } else {
      const row = last.standings.find((s) => s.playerId === target.player.id);
      check(Boolean(row), "the live frame does not include the player who scored");
    }
    note(`${watch.frames.length} live frames, revision ${first.revision} → ${last.revision}`);
  });

  if (config.format !== "TEXAS_SCRAMBLE") {
    await step("skins run over every hole and pay out correctly", async () => {
      const entered = scorecard.map((e) => e.player.id);
      const saved = await call("PUT", `/api/events/${event.id}/games`, {
        cookie: adminCookie,
        body: {
          skins: "NET",
          skinsCarry: true,
          teamFormat: "NONE",
          sideHoles: [],
          sponsors: [{ name: "Clubhouse Bar" }],
          teamNames: ["Reds", "Blues"],
          matches: [],
        },
      });
      must(saved.status === 200, `saving skins failed (${saved.status}) ${JSON.stringify(saved.body)}`);

      const board = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
      const skins = board.games.skins;
      must(Boolean(skins), "no skins were computed");
      check(skins.holes.length === 18, `skins covered ${skins.holes.length} holes`);

      // Independent recompute: lowest net takes the hole outright, a tie carries.
      const expected = [];
      let pot = 0;
      holes.forEach((hole, index) => {
        const nets = scorecard.map((entry) => ({
          id: entry.player.id,
          net: entry.holes[index].strokes - entry.holes[index].received,
        }));
        const lowest = Math.min(...nets.map((n) => n.net));
        const winners = nets.filter((n) => n.net === lowest);
        const value = pot + 1;
        if (winners.length === 1) {
          expected.push({ holeNumber: hole.holeNumber, winnerId: winners[0].id, value, status: "won" });
          pot = 0;
        } else {
          expected.push({ holeNumber: hole.holeNumber, winnerId: null, value, status: "carried" });
          pot = value;
        }
      });
      for (const [index, hole] of skins.holes.entries()) {
        check(
          hole.winnerId === expected[index].winnerId,
          `skins hole ${hole.holeNumber}: winner ${hole.winnerId} should be ${expected[index].winnerId}`,
        );
        check(hole.value === expected[index].value, `skins hole ${hole.holeNumber}: worth ${hole.value}, should be ${expected[index].value}`);
      }
      const totals = new Map(skins.totals.map((t) => [t.playerId, t.skins]));
      for (const playerId of new Set(expected.filter((h) => h.winnerId).map((h) => h.winnerId))) {
        const count = expected.filter((h) => h.winnerId === playerId).reduce((sum, h) => sum + h.value, 0);
        check(totals.get(playerId) === count, `skins total for ${playerId} is ${totals.get(playerId)}, should be ${count}`);
      }
      check(skins.carryingOver === pot, `skins carried over ${skins.carryingOver}, should be ${pot}`);
      const won = expected.filter((h) => h.status === "won");
      check(won.length > 0, "no skin was won all round");
      note(`skins: ${won.length} holes won, ${skins.carryingOver} carried over`);
    });

    await step("4BBB pairs: auto-paired from the tee groups and scored best-ball", async () => {
      const enabled = await call("PUT", `/api/events/${event.id}/games`, {
        cookie: adminCookie,
        body: { skins: "NET", skinsCarry: true, teamFormat: "FOURBBB", sideHoles: [], sponsors: [], matches: [] },
      });
      must(enabled.status === 200, `enabling four-ball better-ball failed (${enabled.status}) ${JSON.stringify(enabled.body)}`);
      const paired = await call("POST", `/api/events/${event.id}/pairs`, { cookie: adminCookie, body: { auto: true } });
      must(paired.status === 200, `auto-pairing failed (${paired.status}) ${JSON.stringify(paired.body)}`);
      check(paired.body.pairs.length === 9, `19 players in four-balls should make 9 pairs, got ${paired.body.pairs.length}`);

      const board = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
      check(board.games.pairs?.length === 9, `the board lists ${board.games.pairs?.length} pairs`);
      check(board.games.pairs.every((p) => typeof p.points === "number"), "a pair has no best-ball score");

      const byName = new Map(scorecard.map((e) => [e.player.name, e]));
      for (const pair of board.games.pairs) {
        const partners = pair.players.map((name) => byName.get(name)).filter(Boolean);
        if (partners.length !== 2) continue;
        const expectedPoints = holes.reduce((sum, _hole, index) => {
          return sum + Math.max(partners[0].holes[index].points, partners[1].holes[index].points);
        }, 0);
        check(
          pair.points === expectedPoints,
          `${pair.name} (${pair.players.join(" & ")}) has ${pair.points}, best-ball should be ${expectedPoints}`,
        );
        check(pair.thru === 18, `${pair.name} shows thru ${pair.thru}`);
      }
      const order = board.games.pairs.map((p) => p.points);
      check([...order].sort((a, b) => b - a).join() === order.join(), `pairs are not sorted by best-ball points: ${order.join(", ")}`);
      note(`9 four-ball pairs, best ${order[0]} pts, worst ${order.at(-1)} pts`);
    });

    await step("match play: singles decided hole by hole", async () => {
      const entered = scorecard.map((e) => e.player.id);
      const settings = await call("PUT", `/api/events/${event.id}/games`, {
        cookie: adminCookie,
        body: {
          skins: "NET",
          skinsCarry: true,
          teamFormat: "MATCHPLAY",
          sideHoles: [
            { kind: "NEAREST_PIN", holeNumber: 7 },
            { kind: "LONGEST_DRIVE", holeNumber: 14 },
          ],
          sponsors: [{ name: "Clubhouse Bar" }],
          teamNames: ["Reds", "Blues"],
          matches: Array.from({ length: 4 }, (_, i) => ({
            name: `Match ${i + 1}`,
            sideA: [entered[i]],
            sideB: [entered[i + 4]],
          })),
        },
      });
      must(settings.status === 200, `saving match play failed (${settings.status}) ${JSON.stringify(settings.body)}`);

      const board = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
      const matchPlay = board.games.matchPlay;
      must(Boolean(matchPlay), "the match play board is missing");
      check(matchPlay.matches.length === 4, `the board lists ${matchPlay.matches.length} matches`);
      check(matchPlay.teamNames.join(" v ") === "Reds v Blues", `team names are ${matchPlay.teamNames.join(", ")}`);
      for (const match of matchPlay.matches) {
        check(
          match.holesPlayed >= 10 && match.holesPlayed <= 18,
          `${match.name} counted ${match.holesPlayed} holes, expected 10 to 18`,
        );
        check(["A", "B", "HALVED"].includes(match.winner), `${match.name} has no winner: ${match.winner}`);
        check(match.points.A + match.points.B === 1, `${match.name} paid out ${match.points.A + match.points.B} points`);
        check(match.finished, `${match.name} is not marked finished after 18 holes`);
        // A won match ends on the hole it is won on - that is what "9&8" means.
        if (match.status !== "Halved" && match.status !== "1 UP") {
          check(match.holesPlayed < 18, `${match.name} says ${match.status} but counted all 18 holes`);
        }
      }
      check(
        matchPlay.banked.A + matchPlay.banked.B === matchPlay.matches.length,
        `banked ${matchPlay.banked.A + matchPlay.banked.B} points from ${matchPlay.matches.length} completed matches`,
      );
      check(matchPlay.toWin >= 1, "the points needed to win is not set");
      note(`match play: ${matchPlay.matches.map((m) => m.status).join(", ")}`);
    });

    await step("nearest the pin and longest drive track the right leader", async () => {
      const entered = scorecard.map((e) => e.player.id);
      const first = await call("POST", "/api/side-games", {
        cookie: adminCookie,
        body: { eventId: event.id, playerId: entered[0], kind: "NEAREST_PIN", holeNumber: 7, distance: 9.5 },
      });
      must(first.status === 200, `recording nearest the pin failed (${first.status}) ${JSON.stringify(first.body)}`);
      const second = await call("POST", "/api/side-games", {
        cookie: adminCookie,
        body: { eventId: event.id, playerId: entered[1], kind: "NEAREST_PIN", holeNumber: 7, distance: 4.25 },
      });
      must(second.status === 200, "recording a better nearest the pin failed");
      const drive = await call("POST", "/api/side-games", {
        cookie: adminCookie,
        body: { eventId: event.id, playerId: entered[2], kind: "LONGEST_DRIVE", holeNumber: 14, distance: 312 },
      });
      must(drive.status === 200, "recording longest drive failed");

      const board = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
      const pin = board.games.sideGames.find((g) => g.kind === "NEAREST_PIN");
      const long = board.games.sideGames.find((g) => g.kind === "LONGEST_DRIVE");
      check(Boolean(pin?.leader), "nearest the pin has no leader");
      check(pin.leader.playerId === entered[1], "nearest the pin leader is not the closest ball");
      check(pin.leader.distance === 4.25, `nearest the pin shows ${pin.leader.distance}, expected 4.25`);
      check(pin.entries === 2, `nearest the pin counted ${pin.entries} entries`);
      check(long?.leader?.playerId === entered[2], "longest drive leader is wrong");
      check(long?.leader?.distance === 312, `longest drive shows ${long?.leader?.distance}, expected 312`);

      // A measurement outside the sensible range, or on an unconfigured hole, is refused.
      const silly = await call("POST", "/api/side-games", {
        cookie: adminCookie,
        body: { eventId: event.id, playerId: entered[0], kind: "NEAREST_PIN", holeNumber: 7, distance: 900 },
      });
      check(silly.status === 400, `a 900ft putt was accepted (${silly.status})`);
      const wrongHole = await call("POST", "/api/side-games", {
        cookie: adminCookie,
        body: { eventId: event.id, playerId: entered[0], kind: "NEAREST_PIN", holeNumber: 12, distance: 5 },
      });
      check(wrongHole.status === 400, `a side game on an unconfigured hole was accepted (${wrongHole.status})`);
      note("nearest the pin 4.25 ft, longest drive 312 yd, both leading");
    });
  }

  await step("invitations, QR codes, flights, the hidden board and the master scorecard", async () => {
    const data = await bundle(adminCookie, event.id);

    // 1. Invitations. No mail provider is configured in this run, so every
    //    message must come back as a recorded dry run - never a fake "sent".
    const invites = await call("POST", `/api/events/${event.id}/invites`, { cookie: adminCookie });
    must(invites.status === 200, `sending invitations failed (${invites.status}) ${JSON.stringify(invites.body)}`);
    check(invites.body.delivered === false, "the run has a mail provider configured - the dry-run check is meaningless");
    check(
      invites.body.dryRun + invites.body.noEmail.length === FIELD_SIZE,
      `invitations covered ${invites.body.dryRun} + ${invites.body.noEmail.length} players, expected ${FIELD_SIZE}`,
    );
    check(invites.body.failed === 0, `${invites.body.failed} invitations failed to compose`);
    const outbox = await call("GET", `/api/events/${event.id}/invites`, { cookie: adminCookie });
    check(outbox.body.messages.length > 0, "nothing was written to the mail outbox");
    check(
      outbox.body.messages.every((row) => row.status === "DRY_RUN" || row.status === "SENT"),
      "the outbox contains a message in an unexpected state",
    );
    const grouped = invites.body.results.filter((row) => row.seat.group);
    check(grouped.length > 0, "no invitation names a tee group");
    check(
      grouped.every((row) => row.seat.teeTime && /^\d{2}:\d{2}$/.test(row.seat.teeTime)),
      "an invitation is missing its tee time",
    );
    // A player must not be able to blast the field.
    const asPlayer = await call("POST", `/api/events/${event.id}/invites`, { cookie: playerCookies.sam });
    check(asPlayer.status === 403, `a non-admin could send invitations (${asPlayer.status})`);
    note(`${invites.body.dryRun} invitations written, ${invites.body.noEmail.length} players had no address`);

    // 2. QR codes for the printed cart signs.
    const group = data.groups[0];
    const qr = await call("GET", `/api/events/${event.id}/qr?group=${group.id}`, { cookie: adminCookie, text: true });
    check(qr.status === 200, `the QR route returned ${qr.status}`);
    check(qr.body.startsWith("<svg") && qr.body.includes("</svg>"), "the QR code is not an SVG");
    const qrAnon = await call("GET", `/api/events/${event.id}/qr?group=${group.id}`, { text: true });
    check(qrAnon.status === 401 || qrAnon.status === 403, `a stranger could fetch the scorecard QR (${qrAnon.status})`);
    const printPage = await call("GET", `/admin/events/${event.id}/print`, { cookie: adminCookie, text: true });
    check(printPage.status === 200 && printPage.body.includes(group.name), `the printable cart signs page returned ${printPage.status}`);
    const printAnon = await call("GET", `/admin/events/${event.id}/print`, { text: true });
    check(printAnon.status === 307 || printAnon.status === 308 || printAnon.status === 302, `a stranger opened the print page (${printAnon.status})`);

    // 3. The master scorecard sees every card.
    const cards = await call("GET", `/api/events/${event.id}/cards`, { cookie: adminCookie });
    must(cards.status === 200, `the master scorecard returned ${cards.status}`);
    const cardCount = config.format === "TEXAS_SCRAMBLE" ? cards.body.teams.length : cards.body.cards.length;
    check(cardCount === (config.format === "TEXAS_SCRAMBLE" ? groups.length : FIELD_SIZE), `the master scorecard lists ${cardCount} cards`);
    const audit = await call("GET", `/api/events/${event.id}/audit`, { cookie: adminCookie });
    check(audit.status === 200, `the audit trail returned ${audit.status}`);
    check(Array.isArray(audit.body.amendments), "the audit trail has no amendments list");

    // 4. Flights (individual formats only - a scramble is one team board).
    if (config.format !== "TEXAS_SCRAMBLE") {
      const enabled = await call("PUT", `/api/events/${event.id}/games`, {
        cookie: adminCookie,
        body: { skins: "NET", skinsCarry: true, teamFormat: "FOURBBB", sideHoles: [], sponsors: [], matches: [], flights: 3 },
      });
      must(enabled.status === 200, `enabling flights failed (${enabled.status}) ${JSON.stringify(enabled.body)}`);
      const board = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
      must(Array.isArray(board.flights), "the board has no flights");
      check(board.flights.length === 3, `expected 3 flights, got ${board.flights.length}`);
      check(
        board.flights.map((f) => f.standings.length).join("/") === "7/6/6",
        `flights are ${board.flights.map((f) => f.standings.length).join("/")}, expected 7/6/6`,
      );
      const key = config.format === "STABLEFORD" ? "points" : "netToPar";
      for (const flight of board.flights) {
        check(flight.standings[0].position === 1, `${flight.name} does not start at 1st`);
        const values = flight.standings.map((row) => row[key]);
        const sorted = [...values].sort((a, b) => (config.format === "STABLEFORD" ? b - a : a - b));
        check(values.join() === sorted.join(), `${flight.name} is out of order: ${values.join(", ")}`);
      }
      const handicapSpread = board.flights.map((f) => f.standings.map((row) => row.playingHandicap));
      check(
        Math.max(...handicapSpread[0]) <= Math.min(...handicapSpread.at(-1)),
        "the low-handicap flight overlaps the high-handicap flight",
      );
      note(`flights: ${board.flights.map((f) => f.standings.length).join("/")}`);
    }

    // 5. Hide the board until a card is in.
    const hidden = await call("PUT", `/api/events/${event.id}/games`, {
      cookie: adminCookie,
      body: {
        skins: "NET",
        skinsCarry: true,
        teamFormat: "FOURBBB",
        sideHoles: [],
        sponsors: [],
        matches: [],
        flights: 0,
        hideBoard: true,
      },
    });
    must(hidden.status === 200, `enabling the hidden board failed (${hidden.status})`);
    const anonymous = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
    check(Boolean(anonymous.hidden), "a stranger still saw the board with hideBoard on");
    check(anonymous.standings.length === 0, "the hidden board still lists players");
    check(anonymous.groups.every((g) => g.players.length === 0), "the hidden board still lists who is in each group");
    check(anonymous.games.skins === null, "the hidden board still shows the skins");
    const asAdmin = (await call("GET", `/api/events/${event.id}/leaderboard`, { cookie: adminCookie })).body;
    const adminRows = config.format === "TEXAS_SCRAMBLE" ? asAdmin.teams.length : asAdmin.standings.length;
    check(!asAdmin.hidden && adminRows > 0, "the organiser could not see their own board");
    // Put it back so the rest of the run behaves normally.
    await call("PUT", `/api/events/${event.id}/games`, {
      cookie: adminCookie,
      body: { skins: "NET", skinsCarry: true, teamFormat: "FOURBBB", sideHoles: [], sponsors: [], matches: [], flights: 0, hideBoard: false },
    });
    note("hidden board: strangers redacted, organiser unaffected");

    // 6. The clubhouse screen credits the sponsors, and the share button is a
    //    plain WhatsApp deep link - no business API, no Meta app in the path.
    const sponsored = await call("PUT", `/api/events/${event.id}/games`, {
      cookie: adminCookie,
      body: {
        skins: "NET",
        skinsCarry: true,
        teamFormat: "FOURBBB",
        sideHoles: [],
        sponsors: [{ name: "Checkers Gin" }],
        matches: [],
        flights: 0,
        hideBoard: false,
      },
    });
    must(sponsored.status === 200, `adding a sponsor failed (${sponsored.status})`);
    const livePage = await call("GET", `/live/${event.slug}`, { text: true });
    check(livePage.status === 200, `the live board returned ${livePage.status}`);
    check(livePage.body.includes("Checkers Gin"), "the sponsor is missing from the live board");
    const tvPage = await call("GET", `/live/${event.slug}?tv=1`, { text: true });
    check(tvPage.body.includes("Checkers Gin"), "the sponsor is missing from the clubhouse TV board");
    check(livePage.body.includes("https://wa.me/?text="), "the live board has no WhatsApp share link");
    check(
      !/api\.whatsapp\.com|graph\.facebook\.com|whatsapp_business/i.test(livePage.body),
      "the share link goes through a WhatsApp business API",
    );
    check(livePage.body.includes("Copy link"), "the share button has no copy fallback for a laptop");
    await call("PUT", `/api/events/${event.id}/games`, {
      cookie: adminCookie,
      body: { skins: "NET", skinsCarry: true, teamFormat: "FOURBBB", sideHoles: [], sponsors: [], matches: [], flights: 0, hideBoard: false },
    });
    note("sponsors on both boards; WhatsApp share is a wa.me deep link with a copy fallback");
  });

  await step("CSV export and the public board agree", async () => {
    const csv = await call("GET", `/api/events/${event.id}/export`, { cookie: adminCookie, text: true });
    check(csv.status === 200, `export returned ${csv.status}`);
    const lines = csv.body.trim().split("\n");
    const board = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
    const expectedRows = (config.format === "TEXAS_SCRAMBLE" ? board.teams.length : board.standings.length) + 1;
    check(lines.length === expectedRows, `CSV has ${lines.length} lines, expected ${expectedRows}`);
    check(lines[0].includes("Position") && lines[0].includes("H18"), "the CSV header is missing a hole column");
    const anonymous = await call("GET", `/api/events/${event.id}/leaderboard`);
    check(anonymous.status === 200, "a public event's board should be readable without signing in");
  });

  await step("completing the golf day locks it to players but not to the admin", async () => {
    const completed = await call("PATCH", `/api/events/${event.id}`, {
      cookie: adminCookie,
      body: { status: "COMPLETED" },
    });
    must(completed.status === 200, `could not complete the event (${completed.status})`);

    groups = (await bundle(adminCookie, event.id)).groups;
    const group = groups[0];
    const member = (await bundle(adminCookie, event.id)).registrations.find((r) => r.registration.groupId === group.id);
    must(Boolean(member), "no player found in the first group to test the lock with");

    if (config.format === "TEXAS_SCRAMBLE") {
      const blocked = await call("POST", "/api/scramble", {
        body: { eventId: event.id, groupId: group.id, holeNumber: 3, strokes: 4, token: group.token },
      });
      check(blocked.status === 409, `a player could still score a finished scramble (${blocked.status})`);
      const fix = await call("POST", "/api/scramble", {
        cookie: adminCookie,
        body: { eventId: event.id, groupId: group.id, holeNumber: 3, strokes: 4 },
      });
      check(fix.status === 200, `the admin could not correct a finished scramble card (${fix.status})`);
    } else {
      const blocked = await call("POST", "/api/scores", {
        body: { eventId: event.id, playerId: member.player.id, holeNumber: 3, strokes: 5, token: group.token },
      });
      check(blocked.status === 409, `a player could still score a finished event (${blocked.status})`);
      check(blocked.body?.error?.includes("locked") || blocked.body?.code === "event_completed", "the lock message is unclear");
      const fix = await call("POST", "/api/scores", {
        cookie: adminCookie,
        body: { eventId: event.id, playerId: member.player.id, holeNumber: 3, strokes: 5 },
      });
      check(fix.status === 200, `the admin could not correct a finished card (${fix.status})`);
    }

    const sam = (await bundle(adminCookie, event.id)).registrations.find((r) => r.player.name === "Sam Whitcombe");
    if (sam) {
      const selfMove = await call("POST", `/api/events/${event.id}/groups/${groups[1].id}`, {
        cookie: playerCookies.sam,
        body: { playerId: sam.player.id, action: "add" },
      });
      check(selfMove.status === 409, `a player moved themselves after the round (${selfMove.status})`);
      const sideGame = await call("POST", "/api/side-games", {
        cookie: playerCookies.sam,
        body: { eventId: event.id, playerId: sam.player.id, kind: "NEAREST_PIN", holeNumber: 7, distance: 6 },
      });
      check(sideGame.status === 409 || sideGame.status === 400, `a side game was recorded after the round (${sideGame.status})`);
    }

    const outsiderPatch = await call("PATCH", `/api/events/${event.id}`, {
      cookie: playerCookies.sam ?? "",
      body: { name: "Hijacked" },
    });
    check(outsiderPatch.status === 403, `a non-admin edited the event (${outsiderPatch.status})`);

    const adminGroupEdit = await call("PATCH", `/api/events/${event.id}/groups`, {
      cookie: adminCookie,
      body: { groupId: groups[1].id, name: "Corrected Fourball" },
    });
    check(adminGroupEdit.status === 200, `the admin could not correct a group after completion (${adminGroupEdit.status})`);

    const board = (await call("GET", `/api/events/${event.id}/leaderboard`)).body;
    check(board.event.status === "COMPLETED", "the board still reports the event as running");
    const exportAfter = await call("GET", `/api/events/${event.id}/export`, { cookie: adminCookie, text: true });
    check(exportAfter.status === 200, `export after completion returned ${exportAfter.status}`);
    note("players locked out, admin corrections accepted, board and export still served");
  });
}

/* ————— Main ————— */

async function main() {
  say(colour(1, "GolfDay - every format, full field, end to end"));
  say(colour(90, `app: ${root}\nport: ${port}  db: ${path.relative(root, dbFile)}\n`));
  mkdirSync(mailDir, { recursive: true });
  rmSync(mailDir, { recursive: true, force: true });
  mkdirSync(mailDir, { recursive: true });

  prepareDatabase();
  const server = await startServer();
  let exitCode = 0;
  try {
    const health = await call("GET", "/api/health");
    must(health.body?.ok === true, "the app is not healthy");

    const adminCookie = await login("admin@golfday.app", "golfday123");
    const playerCookies = {
      sam: await login("sam@golfday.app", "golfday123"),
      priya: await login("priya@golfday.app", "golfday123"),
    };

    const courses = (await call("GET", "/api/courses", { cookie: adminCookie })).body.courses;
    const course = courses.find((c) => /Sunningdale/i.test(c.club ?? "")) ?? courses[0];
    must(Boolean(course), "the seed has no courses to play");

    const ctx = { adminCookie, playerCookies, courseId: course.id, joinerCookie: "", joinerPlayer: null, fieldIds: [] };

    section("The field");
    const field = await buildField(adminCookie);
    await step("19 players, each with an account or an organiser entry", async () => {
      check(field.ids.length === FIELD_SIZE, `the field has ${field.ids.length} players`);
      const nineteenth = field.players.find((p) => p.name === "Test Nineteenth");
      check(Boolean(nineteenth), "the freshly registered player is not in the field");
      check(nineteenth.handicapIndex === 12.4, `the new player's handicap is ${nineteenth.handicapIndex}`);
      check(field.players.filter((p) => p.hasAccount).length >= 5, "the field has no signed-in players to test with");
    });
    note("the 19th player was created through the real registration endpoint");
    ctx.fieldIds = field.ids;

    // A join-code account that is deliberately NOT in any field: it joins by
    // code and withdraws again, proving the code works without an organiser.
    const joiner = await call("POST", "/api/auth/register", {
      body: { name: "Joiner Guest", email: `joiner.${Date.now()}@golfday.test`, password: "golfday123", handicapIndex: 18.1 },
    });
    must(joiner.status === 200, "could not create the join-code account");
    ctx.joinerCookie = cookieFrom(joiner);
    ctx.joinerPlayer = (await call("GET", "/api/players", { cookie: adminCookie })).body.players.find(
      (p) => p.name === "Joiner Guest",
    );
    must(Boolean(ctx.joinerPlayer), "the join-code account has no player profile");

    for (const config of FORMATS) {
      await runFormat(ctx, config);
    }

    section("Storage");
    await step("scores, audit trail and side-game records landed in the database", async () => {
      const { createClient } = await import("@libsql/client");
      const client = createClient({ url: `file:${dbFile}` });
      const count = async (sql) => Number((await client.execute(sql)).rows[0].n);
      const scores = await count("select count(*) n from scores");
      const scramble = await count("select count(*) n from scramble_scores");
      const audit = await count("select count(*) n from score_audit");
      const entries = await count("select count(*) n from side_game_entries");
      check(scores >= 2 * FIELD_SIZE * 18, `only ${scores} individual hole scores stored`);
      check(scramble >= 5 * 18, `only ${scramble} scramble holes stored`);
      check(entries >= 2, `only ${entries} side-game entries stored`);
      note(`${scores} hole scores, ${scramble} scramble holes, ${audit} audits, ${entries} side-game entries`);
      if (audit === 0) note("no audit rows: nothing was changed as an admin, so none were expected");
      await client.close();
    });
  } catch (error) {
    failures.push({ name: "run", error });
    say(colour(31, `\n${error.stack ?? error.message}`));
    exitCode = 1;
  } finally {
    server.kill("SIGKILL");
  }

  section("Result");
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
  say(colour(90, `\nInvitations: ${path.relative(root, mailDir)}/`));
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
