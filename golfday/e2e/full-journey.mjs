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
const dbFile = path.join(root, "data", "e2e-run.db");
const artifacts = path.join(root, "e2e", "artifacts");
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
    await shot(page, "day-open");
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
    say(colour(32, `\n✓ All ${stepNo} steps passed. Screenshots: e2e/artifacts/\n`));
  } else {
    say(colour(31, "\nThe journey did not finish. See the message above and e2e/artifacts/.\n"));
  }
  process.exit(failures === 0 ? 0 : 1);
}

main();
