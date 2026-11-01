/**
 * The "just my friends and me" path, end to end - no society, no club, cash only.
 *
 *   npm run e2e:friends
 *
 * Same harness as full-journey.mjs (own database, own port, real browser), but
 * it deliberately avoids every club-shaped feature: the organiser never makes a
 * society, never uses a roster, picks the course by typing the card in because
 * it is not in any list, and the entry fee is cash collected on the day.
 *
 * That is the case a solo organiser actually has, so it gets its own test rather
 * than being assumed to work.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const headed = args.has("--headed");
const port = Number(process.env.E2E_PORT ?? 3211);
const base = `http://127.0.0.1:${port}`;
const dbFile = path.join(root, "data", "e2e-friends.db");
const artifacts = path.join(root, "e2e", "artifacts", "friends");
const env = {
  ...process.env,
  DATABASE_URL: `file:${dbFile}`,
  AUTH_SECRET: process.env.AUTH_SECRET || "e2e-only-secret-0123456789abcdefghijkl",
  NODE_ENV: process.env.NODE_ENV ?? "development",
  NEXT_TELEMETRY_DISABLED: "1",
  // Deliberately no Stripe keys: a friends' day must work without any payment
  // provider configured at all.
  STRIPE_SECRET_KEY: "",
};

const state = { server: null, browser: null, page: null, finished: false };
let stepNo = 0;
let failures = 0;

const colour = (code, text) => (process.stdout.isTTY ? `\u001b[${code}m${text}\u001b[0m` : text);

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
        await state.page.screenshot({ path: path.join(artifacts, `failure-${String(stepNo).padStart(2, "0")}.png`), fullPage: true });
      } catch {
        /* gone */
      }
    }
    throw error;
  }
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

const shot = (page, name) => page.screenshot({ path: path.join(artifacts, `${String(stepNo).padStart(2, "0")}-${name}.png`), fullPage: true });

async function seesText(page, text, name) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    await shot(page, `${name}-missing`);
    throw new Error(`expected to see “${text}” on ${page.url()}`);
  }
}

async function open(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
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

function runScript(script) {
  const tsx = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(process.execPath, [tsx, script], { cwd: root, env, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${script} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`);
}

async function waitForServer(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(base + "/", { signal: AbortSignal.timeout(5000) })).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the app did not answer on ${base}`);
}

async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new Error("playwright-core is not installed. Run `npm install`.");
  }
  const common = { headless: !headed, args: ["--no-sandbox", "--disable-dev-shm-usage"] };
  if (process.env.GOLFDAY_E2E_BROWSER) {
    return chromium.launch({ ...common, executablePath: process.env.GOLFDAY_E2E_BROWSER });
  }
  for (const options of [{ ...common }, { ...common, channel: "chrome" }, { ...common, channel: "msedge" }]) {
    try {
      return await chromium.launch(options);
    } catch {
      /* next */
    }
  }
  throw new Error("No browser found. Run `npx playwright-core install chromium`, or set GOLFDAY_E2E_BROWSER.");
}

async function journey() {
  mkdirSync(artifacts, { recursive: true });
  const page = await state.browser.newPage({ viewport: { width: 1400, height: 1000 } });
  state.page = page;
  page.setDefaultTimeout(20_000);

  const stamp = Date.now();
  const email = `friends-${stamp}@example.com`;
  const eventName = `Sunday Fourball ${stamp}`;

  await step("the home page offers the friends path, not just the club one", async () => {
    await open(page, base + "/");
    await seesText(page, "One day, a few friends", "home");
    await seesText(page, "Cash on the day", "home-cash");
    await shot(page, "home");
  });

  await step("one person signs up - no club, no society, no handicap", async () => {
    await open(page, base + "/register");
    await fillStable(page, "#name", "Jo Fourball");
    await fillStable(page, "#email", email);
    await fillStable(page, "#password", "golfday123");
    await page.locator("#handicap-source").selectOption("NONE");
    await shot(page, "register");
    await page.locator("form").getByRole("button", { name: /create account/i }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await seesText(page, "don't need a society", "dashboard");
    await shot(page, "dashboard");
  });

  let eventUrl;
  await step("they set up a day for friends, with no society", async () => {
    await page.getByRole("link", { name: /set up a day for friends/i }).click();
    await page.waitForURL(/\/admin\/events\/new/, { timeout: 30_000 });
    await seesText(page, "Me and my friends", "wizard");
    check((await page.locator('input[name="hosted-by"]').first().isChecked()), "friends is not the default choice");
    await fillStable(page, "#name", eventName);
    await page.getByRole("button", { name: /next: choose the course/i }).click();
    await page.waitForSelector("text=Search courses");
    await shot(page, "wizard-step-1");
  });

  await step("the course is not in any list, so the card is typed in", async () => {
    await page.getByRole("button", { name: /type a new course/i }).click();
    await seesText(page, "Type it in once and it is saved", "manual");
    await fillStable(page, "#cname", "Oxhey Lane Pitch & Putt");
    await fillStable(page, "#cclub", "Harrow");
    await shot(page, "manual-card");
    await page.getByRole("button", { name: /next: review/i }).click();
    await seesText(page, "Ready to create", "review");
    await page.getByRole("button", { name: /create golf day/i }).click();
    await page.getByRole("heading", { name: /run the day/i }).waitFor({ state: "visible", timeout: 45_000 });
    eventUrl = page.url();
    await seesText(page, eventName, "console");
    await shot(page, "console");
  });

  await step("the field is just the friends, added by hand", async () => {
    await page.getByRole("button", { name: /^field$/i }).click();
    await seesText(page, "New guest player", "field");
    for (const name of ["Danny", "Rav", "Chris"]) {
      await fillStable(page, 'input[placeholder="Full name"]', `${name} Friend`);
      await page.locator('select[aria-label="Where their handicap comes from"]').selectOption("NONE");
      await page.getByRole("button", { name: /create and enter/i }).click();
      await page.waitForTimeout(1000);
    }
    // The organiser themselves, so the four-ball is complete.
    const search = page.getByPlaceholder(/search existing players/i);
    await search.click();
    await search.type("Jo", { delay: 40 });
    await page.waitForTimeout(1200);
    const addSelf = page.locator("li", { hasText: "Jo Fourball" }).getByRole("button", { name: /^add$/i }).first();
    if (await addSelf.count()) await addSelf.click();
    await page.waitForTimeout(800);
    await shot(page, "field");
  });

  await step("an entry fee is set, payable in cash", async () => {
    await page.getByRole("button", { name: /^games$/i }).click();
    await seesText(page, "Entry fee", "games");
    await seesText(page, "Cash or bank transfer", "games-cash");
    const fee = page.locator("#g-fee");
    await fee.waitFor({ state: "visible" });
    await fee.fill("15");
    await page.getByRole("button", { name: /save fee/i }).click();
    await page.waitForTimeout(1200);
    await shot(page, "fee");
  });

  await step("marking someone paid is the cash bookkeeping", async () => {
    await page.getByRole("button", { name: /^payments$/i }).click();
    await seesText(page, "Cash on the day", "payments");
    await shot(page, "payments-before");
    const markPaid = page.getByRole("button", { name: /^mark paid$/i }).first();
    await markPaid.click();
    await page.waitForTimeout(1200);
    await seesText(page, "Paid", "payments-after");
    await shot(page, "payments-after");
  });

  await step("the day opens, groups are drawn and a card is scored", async () => {
    await page.getByRole("button", { name: /^overview$/i }).click();
    await page.getByRole("button", { name: /^in progress$/i }).click();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /^groups$/i }).click();
    await page.getByRole("button", { name: /auto-allocate/i }).click();
    await seesText(page, "Open scorecard", "groups");
    await page.getByRole("link", { name: /open scorecard/i }).first().click();
    await page.waitForURL(/\/score\//, { timeout: 30_000 });
    await seesText(page, "Live scorecard", "scorecard");
    for (const [hole, strokes] of [[1, 4], [2, 4], [3, 5]]) {
      await page.getByLabel(`Score ${strokes} on hole ${hole}`).click();
      await page.waitForTimeout(650);
    }
    await seesText(page, "holes in", "scorecard-progress");
    await shot(page, "scorecard");
  });

  await step("the player entry page says pay in cash, with no card button", async () => {
    // The event page is reached by slug, so follow the console's own link.
    await open(page, eventUrl);
    const href = await page.locator('a[href^="/events/"]').first().getAttribute("href");
    await open(page, `${base}${href}`);
    const body = await page.locator("body").innerText();
    check(/pay the organiser on the day/i.test(body), "the event page does not say cash on the day");
    check(!/Pay entry/i.test(body), "a card payment button is showing on a cash event");
    await shot(page, "event-page-cash");
  });

  await page.close();
}

async function main() {
  console.log(colour(1, "\nGolfDay end-to-end: one person, three friends, cash on the day\n"));
  console.log(colour(90, `  database: ${dbFile}\n  app:      ${base}${headed ? "  (headed)" : ""}\n`));
  try {
    await step("prepare a throwaway database", async () => {
      mkdirSync(path.join(root, "data"), { recursive: true });
      if (existsSync(dbFile)) rmSync(dbFile, { force: true });
      runScript("scripts/db-push.ts");
      runScript("scripts/seed.ts");
    });
    await step("start the app", async () => {
      const built = existsSync(path.join(root, ".next", "BUILD_ID"));
      const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
      const child = spawn(
        process.execPath,
        [nextBin, built ? "start" : "dev", "-H", "127.0.0.1", "-p", String(port)],
        { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      state.server = child;
      child.stdout.on("data", (c) => process.env.E2E_VERBOSE && process.stdout.write(colour(90, String(c))));
      child.stderr.on("data", (c) => process.env.E2E_VERBOSE && process.stderr.write(colour(90, String(c))));
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
      await new Promise((resolve) => setTimeout(resolve, 400));
      state.server.kill("SIGKILL");
    }
    if (existsSync(dbFile)) {
      rmSync(dbFile, { force: true });
      rmSync(`${dbFile}-wal`, { force: true });
      rmSync(`${dbFile}-shm`, { force: true });
    }
  }
  if (failures === 0) console.log(colour(32, `\n✓ All ${stepNo} steps passed. Screenshots: e2e/artifacts/friends/\n`));
  else console.log(colour(31, "\nThe friends journey did not finish. See e2e/artifacts/friends/.\n"));
  process.exit(failures === 0 ? 0 : 1);
}

main();
