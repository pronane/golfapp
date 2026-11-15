/**
 * GolfDay end-to-end click-through.
 *
 *   npm run e2e              # headless, fresh database, screenshots in e2e/artifacts
 *   npm run e2e -- --headed   # watch it happen
 *
 * It is deliberately self-contained: it creates its own database file, applies
 * the schema, seeds the demo, starts the app on a spare port, drives a real
 * browser through a whole golf day, and cleans up. Nothing here talks to the
 * internet, so it works on a laptop with no credentials configured.
 *
 * The journey is the one the getting-started guide describes:
 *
 *   landing -> register with no handicap -> sign in as organiser -> create a
 *   society -> put two members on the roster -> create a golf day in the wizard
 *   -> enter the field from the roster -> auto-allocate tee groups -> open the
 *   day -> one group enters scores on its own scorecard -> the live board shows
 *   them.
 *
 * Browser resolution, in order:
 *   1. GOLFDAY_E2E_BROWSER   (path to a Chromium/Chrome executable)
 *   2. Playwright's own Chromium  (npx playwright-core install chromium)
 *   3. an installed Google Chrome or Microsoft Edge (channel)
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const headed = args.has("--headed");
const keepDb = args.has("--keep-db");
const port = Number(process.env.E2E_PORT ?? 3210);
const base = `http://127.0.0.1:${port}`;
const runId = `${process.pid}-${Date.now()}`;
const dbFile = path.join(root, "data", `e2e-run-${runId}.db`);
const artifacts = path.join(root, "e2e", "artifacts", `run-${runId}`);
const env = {
  ...process.env,
  DATABASE_URL: `file:${dbFile}`,
  AUTH_SECRET: process.env.AUTH_SECRET || "e2e-only-secret-0123456789abcdefghijkl",
  NODE_ENV: process.env.NODE_ENV ?? "development",
  NEXT_TELEMETRY_DISABLED: "1",
};

const state = { server: null, browser: null, page: null };
let failures = 0;
let stepNo = 0;

const colour = (code, text) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);

function say(message) {
  console.log(message);
}

async function step(name, fn) {
  stepNo += 1;
  const started = Date.now();
  process.stdout.write(`${colour(36, `▸ ${String(stepNo).padStart(2, "0")}`)} ${name} … `);
  try {
    await fn();
    console.log(colour(32, `ok (${Date.now() - started}ms)`));
  } catch (error) {
    console.log(colour(31, "FAILED"));
    failures += 1;
    if (state.page) {
      try {
        await state.page.screenshot({
          path: path.join(artifacts, `failure-${String(stepNo).padStart(2, "0")}.png`),
          fullPage: true,
        });
      } catch {
        /* the page may already be gone */
      }
    }
    throw error;
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

/** Runs one of the project's TypeScript scripts with the same node that runs this file. */
function runScript(script, extraArgs = []) {
  const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(process.execPath, [tsx, script, ...extraArgs], { cwd: root, env, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${script} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result;
}

/** Fresh schema + seed, so the run is repeatable and never touches your data. */
function prepareDatabase() {
  mkdirSync(path.join(root, "data"), { recursive: true });
  if (existsSync(dbFile)) rmSync(dbFile, { force: true });
  runScript("scripts/db-push.ts");
  runScript("scripts/seed.ts");
}

function startServer() {
  const built = existsSync(path.join(root, ".next", "BUILD_ID"));
  const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const nextArgs = built
    ? [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)]
    : [nextBin, "dev", "-H", "127.0.0.1", "-p", String(port)];
  say(colour(90, `   starting ${built ? "production" : "development"} server on ${base}`));
  const child = spawn(process.execPath, nextArgs, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  state.server = child;
  child.stdout.on("data", (chunk) => {
    if (process.env.E2E_VERBOSE) process.stdout.write(colour(90, String(chunk)));
  });
  child.stderr.on("data", (chunk) => {
    if (process.env.E2E_VERBOSE) process.stderr.write(colour(90, String(chunk)));
  });
  child.on("exit", (code) => {
    if (code && code !== 0 && !state.finished) {
      console.error(colour(31, `\nThe app exited unexpectedly (code ${code}). Re-run with E2E_VERBOSE=1.`));
    }
  });
}

async function waitForServer(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + "/", { signal: AbortSignal.timeout(5000) });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the app did not answer on ${base} within ${Math.round(timeoutMs / 1000)}s`);
}

async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new Error(
      "playwright-core is not installed. Run `npm install` (the installer does this for you).",
    );
  }

  const executable = process.env.GOLFDAY_E2E_BROWSER;
  const common = { headless: !headed, args: ["--no-sandbox", "--disable-dev-shm-usage"] };

  if (executable) {
    say(colour(90, `   using the browser at ${executable}`));
    return chromium.launch({ ...common, executablePath: executable });
  }

  for (const options of [
    { ...common },
    { ...common, channel: "chrome" },
    { ...common, channel: "msedge" },
  ]) {
    try {
      const browser = await chromium.launch(options);
      say(colour(90, `   using ${options.channel ?? "playwright chromium"}`));
      return browser;
    } catch {
      /* try the next one */
    }
  }

  throw new Error(
    "No browser found. Run `npx playwright-core install chromium`, install Chrome/Edge, " +
      "or set GOLFDAY_E2E_BROWSER to a browser executable.",
  );
}

/**
 * Fills a field and makes sure the value sticks.
 *
 * The development server compiles a route on first visit and React hydrates
 * just after the HTML arrives; anything typed into a controlled input in that
 * window is wiped when hydration renders the component's initial state. Rather
 * than sleeping for an arbitrary time, type it again until it stays - which is
 * also exactly what a human would do if their first keystroke vanished.
 */
async function open(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Wait for React to hydrate before touching anything (see HydrationMarker).
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 60_000 });
}

async function fillStable(page, selector, value) {
  const field = page.locator(selector);
  await field.waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await field.fill(value);
    await page.waitForTimeout(250);
    if ((await field.inputValue().catch(() => null)) === value) return;
  }
  throw new Error(`could not type into ${selector}`);
}

async function selectStable(page, selector, value) {
  const field = page.locator(selector);
  await field.waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await field.selectOption(value);
    await page.waitForTimeout(250);
    if ((await field.inputValue().catch(() => null)) === value) return;
  }
  throw new Error(`could not choose ${value} in ${selector}`);
}

const shot = (page, name) => page.screenshot({ path: path.join(artifacts, `${String(stepNo).padStart(2, "0")}-${name}.png`), fullPage: true });

/** Waits for visible text, with a screenshot of the failure for the bug report. */
async function seesText(page, text, name) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    await shot(page, `${name}-missing-text`);
    throw new Error(`expected to see “${text}” on ${page.url()}`);
  }
}

async function journey() {
  mkdirSync(artifacts, { recursive: true });
  const browser = state.browser;
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  state.page = page;
  page.setDefaultTimeout(20_000);

  const stamp = Date.now();
  const playerEmail = `e2e-${stamp}@example.com`;
  const societyName = `E2E Society ${stamp}`;
  const eventName = `E2E Autumn Trophy ${stamp}`;

  await step("the landing page loads", async () => {
    await open(page, base + "/");
    await seesText(page, "GolfDay", "landing");
    await shot(page, "landing");
  });

  await step("a player registers with no handicap at all", async () => {
    await open(page, base + "/register");
    await fillStable(page, "#name", "E2E Testplayer");
    await fillStable(page, "#email", playerEmail);
    await fillStable(page, "#password", "golfday123");
    await selectStable(page, "#handicap-source", "NONE");
    const chosen = await page.locator("#handicap-source").inputValue();
    check(chosen === "NONE", `the handicap source did not stay on "No handicap yet" (got ${chosen})`);
    await seesText(page, "Play off scratch", "register-none");
    await shot(page, "register-no-handicap");
    await page.locator("form").getByRole("button", { name: /create account/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await seesText(page, "No h’cap", "dashboard-scratch").catch(() => seesText(page, "No h'cap", "dashboard-scratch"));
    await shot(page, "dashboard-scratch-player");
  });

  await step("the organiser signs in", async () => {
    // A different person on a different device: drop the new player's session
    // (a signed-in visitor is redirected away from /login).
    await page.context().clearCookies();
    await open(page, base + "/login");
    await fillStable(page, "#email", "admin@golfday.app");
    await fillStable(page, "#password", "golfday123");
    await page.locator("form").getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await shot(page, "dashboard-organiser");
  });

  let societyUrl;
  await step("they start a society", async () => {
    await open(page, base + "/societies");
    await fillStable(page, "#society-name", societyName);
    await fillStable(page, "#society-club", "Harrow Golf Club");
    await page.getByRole("button", { name: /create society/i }).click();
    await page.waitForURL(/\/societies\/[a-z0-9-]+/, { timeout: 30_000 });
    societyUrl = page.url();
    await seesText(page, societyName, "society");
    await shot(page, "society");
  });

  await step("two players go on the roster", async () => {
    for (const name of ["Sam Whitcombe", "Priya Raman"]) {
      await page.waitForTimeout(500);
      const search = page.getByPlaceholder(/search players by name/i);
      await search.click();
      await search.fill("");
      await search.type(name.split(" ")[0], { delay: 40 });
      const row = page.locator("li", { hasText: name }).first();
      await row.waitFor({ state: "visible", timeout: 15_000 });
      await row.getByRole("button", { name: /^add$/i }).click();
      await page.waitForTimeout(600);
    }
    await seesText(page, "Sam Whitcombe", "roster");
    await shot(page, "roster");
  });

  let eventUrl;
  await step("they create a golf day in the wizard", async () => {
    await page.getByRole("link", { name: /new golf day/i }).first().click();
    await page.waitForURL(/\/admin\/events\/new/, { timeout: 30_000 });
    await fillStable(page, "#name", eventName);
    await seesText(page, "The golf day", "wizard-step-1");
    await page.getByRole("button", { name: /next: choose the course/i }).click();
    await page.waitForSelector("text=Search courses", { timeout: 20_000 });
    const course = page.locator("button", { hasText: /par \d+/ }).first();
    await course.waitFor({ state: "visible", timeout: 20_000 });
    await course.click();
    await seesText(page, "Selected:", "wizard-course");
    await shot(page, "wizard-course");
    await page.getByRole("button", { name: /next: review/i }).click();
    await seesText(page, "Ready to create", "wizard-review");
    await page.getByRole("button", { name: /create golf day/i }).click();
    // The wizard's own URL is /admin/events/new, so wait for the console itself.
    await page.getByRole("heading", { name: /run the day/i }).waitFor({ state: "visible", timeout: 45_000 });
    eventUrl = page.url();
    check(!eventUrl.endsWith("/new"), "the wizard did not hand over to the event console");
    await seesText(page, eventName, "event-created");
    await shot(page, "event-console");
  });

  await step("the field fills from the society roster", async () => {
    await page.getByRole("button", { name: /^field$/i }).click();
    const rosterButton = page.getByRole("button", { name: /enter \d+ from the roster/i });
    await rosterButton.first().click();
    await seesText(page, "entered from the roster", "field");
    await page.waitForTimeout(1000);
    await shot(page, "field");
  });

  const importedPlayerName = "E2E Imported Golfer";
  await step("a competitor CSV imports a player with a handicap", async () => {
    await fillStable(
      page,
      '[aria-label="Player CSV"]',
      "Player,HI,Club,CDH Number,Email Address\nE2E Imported Golfer,12.4,Harrow GC,CDH-E2E-1,e2e-imported@example.com",
    );
    await page.getByRole("button", { name: /import and enter players/i }).click();
    await seesText(page, importedPlayerName, "csv-player-import");
    await seesText(page, "12.4", "csv-player-handicap");
    await shot(page, "csv-player-import");
  });

  await step("tee groups are allocated", async () => {
    await page.getByRole("button", { name: /^groups$/i }).click();
    await page.getByRole("button", { name: /auto-allocate/i }).click();
    await seesText(page, "Open scorecard", "groups");
    await shot(page, "tee-groups");
  });

  let liveUrl;
  await step("the day is opened for play", async () => {
    await page.getByRole("button", { name: /^overview$/i }).click();
    await page.getByRole("button", { name: /^in progress$/i }).click();
    await page.waitForTimeout(1200);
    const href = await page.locator('a[href^="/live/"]').first().getAttribute("href");
    check(Boolean(href), "the console is not showing the live board link");
    liveUrl = `${base}${href}`;
    const sourceId = new URL(eventUrl).pathname.split("/").pop();
    const handicap = await page.evaluate(async ({ eventId, playerName }) => {
      const eventResponse = await fetch(`/api/events/${eventId}`, { cache: "no-store" });
      const eventData = await eventResponse.json();
      const registration = eventData.registrations.find((row) => row.player.name === playerName);
      if (!registration) throw new Error("the imported player is missing from the event");
      const courseResponse = await fetch(`/api/courses/${eventData.event.courseId}`);
      const courseData = await courseResponse.json();
      const tees = JSON.parse(courseData.course.tees);
      const tee = tees.find((row) => row.name === registration.registration.tee) ?? tees[0];
      const courseHandicap = Math.round(
        registration.player.handicapIndex * (tee.slope / 113) + (tee.rating - tee.par),
      );
      const playingHandicap = Math.round(courseHandicap * (eventData.event.handicapAllowance / 100));
      const result = [];
      for (const holeNumber of [1, 18]) {
        const hole = eventData.holes.find((row) => row.holeNumber === holeNumber);
        const response = await fetch("/api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, playerId: registration.player.id, holeNumber, strokes: 4 }),
        });
        const score = await response.json();
        if (!response.ok) throw new Error(score.error ?? "Could not score the imported player");
        const shotsReceived = Math.floor(playingHandicap / 18) + (hole.strokeIndex <= playingHandicap % 18 ? 1 : 0);
        const points = Math.max(0, hole.par + 2 - (4 - shotsReceived));
        result.push({ holeNumber, shotsReceived: score.shotsReceived, points: score.points, expectedShots: shotsReceived, expectedPoints: points });
      }
      return {
        index: registration.player.handicapIndex,
        courseHandicap: registration.registration.courseHandicap,
        calculatedCourseHandicap: courseHandicap,
        playingHandicap: registration.registration.playingHandicap,
        calculatedPlayingHandicap: playingHandicap,
        scores: result,
      };
    }, { eventId: sourceId, playerName: importedPlayerName });
    check(handicap.index === 12.4, `imported handicap index was not preserved (${handicap.index})`);
    check(handicap.courseHandicap === handicap.calculatedCourseHandicap, "the event course handicap does not match the tee's WHS calculation");
    check(handicap.playingHandicap === handicap.calculatedPlayingHandicap, "the event playing handicap does not match the allowance");
    for (const score of handicap.scores) {
      check(score.shotsReceived === score.expectedShots, `hole ${score.holeNumber} received the wrong number of strokes`);
      check(score.points === score.expectedPoints, `hole ${score.holeNumber} Stableford points did not use the handicap`);
    }
    await shot(page, "day-open");
  });

  await step("the copied event carries handicaps into net stroke play", async () => {
    await open(page, eventUrl);
    const sourceEventId = new URL(eventUrl).pathname.split("/").pop();
    const sourceHandicap = await page.evaluate(async ({ eventId, playerName }) => {
      const response = await fetch(`/api/events/${eventId}`, { cache: "no-store" });
      const eventData = await response.json();
      const registration = eventData.registrations.find((row) => row.player.name === playerName);
      if (!registration) throw new Error("the source event did not include the imported player");
      return {
        index: registration.registration.handicapIndex,
        course: registration.registration.courseHandicap,
        playing: registration.registration.playingHandicap,
      };
    }, { eventId: sourceEventId, playerName: importedPlayerName });
    await page.getByRole("button", { name: /^overview$/i }).click();
    await page.getByRole("button", { name: /copy to another day/i }).click();
    await fillStable(page, "#copy-name", `E2E Handicap Copy ${stamp}`);
    const sourceDate = await page.locator("#ev-date").inputValue();
    const copyDate = new Date(`${sourceDate}T00:00:00Z`);
    copyDate.setUTCDate(copyDate.getUTCDate() + 1);
    await fillStable(page, "#copy-date", copyDate.toISOString().slice(0, 10));
    await page.getByRole("button", { name: /^copy event$/i }).click();
    await page.waitForURL(
      (url) => url.pathname.startsWith("/admin/events/") && url.pathname.split("/").pop() !== sourceEventId,
      { timeout: 30_000 },
    );
    const copiedUrl = page.url();
    await seesText(page, `E2E Handicap Copy ${stamp}`, "event-copy");
    const copiedSnapshot = await page.evaluate(async ({ eventId, playerName }) => {
      const response = await fetch(`/api/events/${eventId}`, { cache: "no-store" });
      const eventData = await response.json();
      const registration = eventData.registrations.find((row) => row.player.name === playerName);
      if (!registration) throw new Error("the copied event did not include the imported player");
      return {
        index: registration.registration.handicapIndex,
        course: registration.registration.courseHandicap,
        playing: registration.registration.playingHandicap,
      };
    }, { eventId: new URL(copiedUrl).pathname.split("/").pop(), playerName: importedPlayerName });
    check(
      copiedSnapshot.index === sourceHandicap.index &&
        copiedSnapshot.course === sourceHandicap.course &&
        copiedSnapshot.playing === sourceHandicap.playing,
      "the copied event recalculated the source event's handicap snapshot",
    );

    await selectStable(page, "#ev-format", "STROKE_PLAY");
    await fillStable(page, "#ev-allowance", "100");
    await page.getByRole("button", { name: /save changes/i }).click();
    await seesText(page, "Event updated", "copied-event-edited");
    await page.getByRole("button", { name: /^in progress$/i }).click();
    await page.waitForTimeout(500);

    const copiedId = new URL(copiedUrl).pathname.split("/").pop();
    const copiedScore = await page.evaluate(async ({ eventId, playerName }) => {
      const eventResponse = await fetch(`/api/events/${eventId}`, { cache: "no-store" });
      const eventData = await eventResponse.json();
      const registration = eventData.registrations.find((row) => row.player.name === playerName);
      if (!registration) throw new Error("the copied event did not include the imported player");
      for (const hole of eventData.holes) {
        const response = await fetch("/api/scores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, playerId: registration.player.id, holeNumber: hole.holeNumber, strokes: 4 }),
        });
        if (!response.ok) throw new Error((await response.json()).error ?? "Could not score the copied event");
      }
      const boardResponse = await fetch(`/api/events/${eventId}/leaderboard`);
      const board = await boardResponse.json();
      const standing = board.standings.find((row) => row.playerId === registration.player.id);
      const expectedNetToPar = eventData.holes.reduce((total, hole) => {
        const handicap = registration.registration.playingHandicap;
        const magnitude = Math.abs(handicap);
        const received = handicap > 0
          ? Math.floor(magnitude / 18) + (hole.strokeIndex <= magnitude % 18 ? 1 : 0)
          : handicap < 0
            ? -(Math.floor(magnitude / 18) + (hole.strokeIndex > 18 - magnitude % 18 ? 1 : 0))
            : 0;
        return total + 4 - hole.par - received;
      }, 0);
      return {
        index: registration.registration.handicapIndex,
        courseHandicap: registration.registration.courseHandicap,
        playingHandicap: registration.registration.playingHandicap,
        format: eventData.event.format,
        allowance: eventData.event.handicapAllowance,
        thru: standing?.thru,
        totalNet: standing?.totalNet,
        netToPar: standing?.netToPar,
        expectedNetToPar,
      };
    }, { eventId: copiedId, playerName: importedPlayerName });
    check(copiedScore.index === 12.4, "the copied registration lost the player's handicap index");
    check(
      copiedScore.playingHandicap === copiedScore.courseHandicap,
      `stroke-play allowance was not recalculated on the copy (playing ${copiedScore.playingHandicap}, course ${copiedScore.courseHandicap}, allowance ${copiedScore.allowance})`,
    );
    check(copiedScore.format === "STROKE_PLAY" && copiedScore.allowance === 100, "the copied event did not retain the edited format and allowance");
    check(copiedScore.thru === 18, "the copied player did not complete the stroke-play round");
    check(
      copiedScore.netToPar === copiedScore.expectedNetToPar,
      `net stroke play did not apply the copied handicap (net to par ${copiedScore.netToPar}, expected ${copiedScore.expectedNetToPar})`,
    );
    await shot(page, "copied-stroke-play");
  });

  await step("course and event CSV imports are available to organisers", async () => {
    await open(page, base + "/admin/import");
    await selectStable(page, "#import-kind", "courses");
    await page.getByRole("button", { name: /load example/i }).click();
    await page.getByRole("button", { name: /^import courses$/i }).click();
    await seesText(page, "courses created", "csv-course-import");
    await selectStable(page, "#import-kind", "events");
    await page.getByRole("button", { name: /load example/i }).click();
    await page.getByRole("button", { name: /^import events$/i }).click();
    await seesText(page, "2 events imported as drafts", "csv-event-import");
    await seesText(page, "Monthly Medal", "csv-event-link");
    await seesText(page, "Summer Scramble", "csv-scramble-link");
    await shot(page, "csv-event-import");
  });

  await step("an imported Texas Scramble applies the team handicap to its card", async () => {
    await page.getByRole("link", { name: /^Summer Scramble/i }).click();
    await page.getByRole("heading", { name: /run the day/i }).waitFor({ state: "visible", timeout: 30_000 });
    const scrambleUrl = page.url();
    const scrambleId = new URL(scrambleUrl).pathname.split("/").pop();
    await page.getByRole("button", { name: /^field$/i }).click();
    const scrambleCsv = [
      "Player,HI,Club,CDH Number,Email Address",
      ...[4, 8, 12, 16].map((handicap, index) =>
        `E2E Scramble ${stamp} Player ${index + 1},${handicap},Harrow GC,CDH-SCR-${stamp}-${index},e2e-scr-${stamp}-${index}@example.com`,
      ),
    ].join("\n");
    await fillStable(page, '[aria-label="Player CSV"]', scrambleCsv);
    await page.getByRole("button", { name: /import and enter players/i }).click();
    await seesText(page, `E2E Scramble ${stamp} Player 1`, "scramble-field-import");
    await page.getByRole("button", { name: /^groups$/i }).click();
    await page.getByRole("button", { name: /auto-allocate/i }).click();
    await seesText(page, "Open scorecard", "scramble-groups");
    await page.getByRole("button", { name: /^overview$/i }).click();
    await page.getByRole("button", { name: /^in progress$/i }).click();
    await page.waitForTimeout(500);

    const scrambleResult = await page.evaluate(async (eventId) => {
      const eventResponse = await fetch(`/api/events/${eventId}`);
      const eventData = await eventResponse.json();
      const group = eventData.groups[0];
      if (!group || eventData.registrations.length !== 4) throw new Error("the imported scramble field or group is incomplete");
      const members = eventData.registrations.map((row) => row.registration);
      const sorted = members.map((row) => row.courseHandicap).sort((a, b) => a - b);
      const expectedTeamHandicap = Math.round(sorted.reduce(
        (sum, handicap, index) => sum + handicap * [0.25, 0.2, 0.15, 0.1][index],
        0,
      ));
      for (const hole of eventData.holes) {
        const drive = eventData.registrations[(hole.holeNumber - 1) % eventData.registrations.length];
        const response = await fetch("/api/scramble", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId,
            groupId: group.id,
            holeNumber: hole.holeNumber,
            strokes: hole.par,
            drivePlayerId: drive.player.id,
          }),
        });
        if (!response.ok) throw new Error((await response.json()).error ?? "Could not score the scramble team");
      }
      const boardResponse = await fetch(`/api/events/${eventId}/leaderboard`);
      const board = await boardResponse.json();
      const team = board.teams.find((row) => row.groupId === group.id);
      return {
        format: eventData.event.format,
        teamHandicap: team?.teamHandicap,
        points: team?.points,
        thru: team?.thru,
        expectedTeamHandicap,
        expectedPoints: 36 + expectedTeamHandicap,
      };
    }, scrambleId);
    check(scrambleResult.format === "TEXAS_SCRAMBLE", "the imported format was not retained");
    check(scrambleResult.teamHandicap === scrambleResult.expectedTeamHandicap, "the team handicap did not use each entrant's course handicap");
    check(scrambleResult.points === scrambleResult.expectedPoints, "scramble points did not apply the team handicap");
    check(scrambleResult.thru === 18, "the imported scramble card did not reach 18 holes");
    await shot(page, "csv-scramble-handicap");
    await open(page, eventUrl);
  });
  await step("a group enters scores on its own scorecard", async () => {
    await page.getByRole("button", { name: /^groups$/i }).click();
    await page.getByRole("link", { name: /open scorecard/i }).first().click();
    await page.waitForURL(/\/score\//, { timeout: 30_000 });
    await seesText(page, "Live scorecard", "scorecard");
    for (const [hole, strokes] of [
      [1, 4],
      [2, 5],
      [3, 3],
      [4, 4],
    ]) {
      const button = page.getByLabel(`Score ${strokes} on hole ${hole}`);
      await button.click();
      await page.waitForTimeout(700);
    }
    await seesText(page, "holes in", "scorecard-progress");
    await shot(page, "scorecard");
  });

  await step("the live board shows the round", async () => {
    await open(page, liveUrl);
    await seesText(page, eventName, "live-board");
    await page.waitForTimeout(2500); // the board streams over SSE
    const board = await page.locator("body").innerText();
    check(/pts|points/i.test(board), "the live board is not showing points yet");
    await shot(page, "live-board");
  });

  await step("the organiser sees the score on the console", async () => {
    await open(page, eventUrl);
    await page.getByRole("button", { name: /^field$/i }).click();
    await seesText(page, "The field", "console-field");
    const body = await page.locator("body").innerText();
    check(/Sam|Priya/.test(body), "the field does not show the roster players");
    await shot(page, "console-after-scoring");
  });

  await page.close();
}

async function main() {
  say(colour(1, "\nGolfDay end-to-end check\n"));
  say(colour(90, `  database: ${dbFile}`));
  say(colour(90, `  app:      ${base}${headed ? "  (headed)" : ""}\n`));

  try {
    await step("prepare a throwaway database", async () => prepareDatabase());
    await step("start the app", async () => {
      startServer();
      await waitForServer();
    });
    await step("launch a browser", async () => {
      state.browser = await launchBrowser();
    });
    await journey();
  } catch (error) {
    state.failed = true;
    console.error(colour(31, `\n✗ ${error instanceof Error ? error.message : error}`));
    failures = Math.max(failures, 1);
  } finally {
    state.finished = true;
    if (state.browser) await state.browser.close().catch(() => {});
    if (state.server) {
      state.server.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!state.server.killed) state.server.kill("SIGKILL");
    }
    if (!keepDb && existsSync(dbFile)) {
      rmSync(dbFile, { force: true });
      rmSync(`${dbFile}-wal`, { force: true });
      rmSync(`${dbFile}-shm`, { force: true });
    }
  }

  if (failures === 0) {
    say(colour(32, `\n✓ All ${stepNo} steps passed. Screenshots: ${path.relative(root, artifacts)}\n`));
  } else {
    say(colour(31, `\nThe journey did not finish. See the message above and ${path.relative(root, artifacts)}.\n`));
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
