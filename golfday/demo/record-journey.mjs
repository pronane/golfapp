/**
 * End-to-end journey recorder: films a whole society golf day from a fresh
 * database using only the UI - a society and a season, a Texas scramble day,
 * the field and teams, a player carding the team's holes, the live board, the
 * order of merit, an entry fee and a refund.
 *
 *   node demo/record-journey.mjs --out=demo/raw/journey.webm
 *
 * Also drops stills into docs/screenshots/journey/ as it goes, so the screenshots
 * and the film are of exactly the same run.
 *
 * Environment: APP_URL (default http://127.0.0.1:3000), CHROME_PATH, DATABASE_URL.
 * Requires a freshly seeded database (`npm run db:reset`) and `npm run dev`.
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { createClient } from "@libsql/client";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const W = 1440;
const H = 900;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const SHOTS = path.join(HERE, "..", "docs", "screenshots", "journey");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const out = args.out ?? path.join(HERE, "raw", "journey.webm");
const EVENT_NAME = "Captains' Scramble 2027";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** DRY=1 walks the whole journey without recording, to check selectors fast. */
const DRY = process.env.DRY === "1";
const db = createClient({ url: process.env.DATABASE_URL ?? "file:./data/golfday.db" });

let shotNo = 0;
async function shot(page, name, caption) {
  shotNo += 1;
  const file = path.join(SHOTS, `${String(shotNo).padStart(2, "0")}-${name}.jpg`);
  await page.screenshot({ path: file, type: "jpeg", quality: 88 });
  console.log(`  shot ${file.replace(process.cwd() + "/", "")}${caption ? ` - ${caption}` : ""}`);
}

class Recorder {
  static async create() {
    const browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || undefined,
      headless: true,
      args: ["--hide-scrollbars", "--force-color-profile=srgb", "--font-render-hinting=none", "--no-sandbox"],
      defaultViewport: { width: W, height: H },
    });
    const rec = await browser.newPage();
    await rec.setViewport({ width: W, height: H });
    await rec.goto(`file://${HERE}/recorder.html`);
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H });
    await page.evaluateOnNewDocument(() => {
      const ensure = () => {
        if (!document.body || document.getElementById("__cursor")) return;
        const el = document.createElement("div");
        el.id = "__cursor";
        el.style.cssText =
          "position:fixed;left:0;top:0;z-index:2147483647;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;" +
          "background:rgba(255,255,255,.9);box-shadow:0 0 0 2.5px rgba(4,36,26,.75),0 0 14px rgba(0,0,0,.45);" +
          "pointer-events:none;transition:transform .09s linear;transform:translate3d(-60px,-60px,0)";
        document.body.appendChild(el);
      };
      ensure();
      document.addEventListener("DOMContentLoaded", ensure);
      window.__cursorTo = (x, y, pressed) => {
        ensure();
        const el = document.getElementById("__cursor");
        if (!el) return;
        el.style.transform = `translate3d(${x}px,${y}px,0) scale(${pressed ? 0.7 : 1})`;
        el.style.background = pressed ? "rgba(231,194,122,.95)" : "rgba(255,255,255,.9)";
      };
    });
    const r = new Recorder();
    r.browser = browser;
    r.page = page;
    r.rec = rec;
    r.caption = null;
    r.authUser = null;
    r.heartbeat = null;
    r.cues = [];
    r.t0 = 0;
    return r;
  }

  mark(label) {
    if (!this.t0) return;
    this.cues.push({ t: Number(((Date.now() - this.t0) / 1000).toFixed(2)), label });
  }

  say(caption) {
    if (caption && caption !== this.caption) this.mark(`CAPTION: ${caption}`);
    this.caption = caption;
  }

  async start() {
    this.t0 = Date.now();
    await this.rec.evaluate(() => window.__start("video/webm;codecs=vp9"));
    this.cdp = await this.page.createCDPSession();
    this.cdp.on("Page.screencastFrame", async (frame) => {
      this.cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
      await this.rec.evaluate((f, c) => window.__frame(f, c), frame.data, this.caption).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  }

  async title(title, subtitle, holdMs = 3000) {
    await this.rec.evaluate((t, s) => window.__title(t, s), title, subtitle);
    await this.rec.evaluate(() => (window.__paused = true));
    await sleep(holdMs);
    await this.rec.evaluate(() => (window.__paused = false));
  }

  /**
   * Sign in again from inside the page, without showing the form: the demo
   * browser can lose the session cookie partway through a long journey, and a
   * recorder that stops to film a login it did not plan is worse than useless.
   */
  async reauth() {
    if (!this.authUser) return false;
    const user = this.authUser;
    const status = await this.page
      .evaluate(async (u) => {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(u),
        });
        return res.status;
      }, user)
      .catch(() => 0);
    return status === 200;
  }

  /**
   * The sandboxed headless browser drops the session cookie every half a minute
   * or so, which would strand a long journey on a login page. Ping a route that
   * needs a session and sign in again (invisibly) when it says 401.
   */
  startHeartbeat(ms = 8000) {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => void this.keepSession(), ms);
    this.heartbeat.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  async keepSession() {
    if (!this.authUser) return;
    const status = await this.page
      .evaluate(async () => {
        try {
          return (await fetch("/api/players?q=__session_ping__")).status;
        } catch {
          return 0;
        }
      })
      .catch(() => 0);
    if (status === 401) await this.reauth();
  }

  /**
   * If a click or a redirect dropped us on the login page, sign in again and go
   * back to where the journey was headed. Returns true when it had to.
   */
  async healLogin() {
    const current = this.page.url();
    if (!current.includes("/login?next=")) return false;
    const next = new URL(current).searchParams.get("next") || "/";
    await this.reauth();
    await this.page.goto(BASE + next, { waitUntil: "domcontentloaded" });
    await sleep(1200);
    return true;
  }

  async goto(url, caption) {
    this.mark(`GOTO: ${url}`);
    if (caption) this.say(caption);
    const target = url.startsWith("file:") ? url : BASE + url;
    await this.page.goto(target, { waitUntil: "domcontentloaded" });
    if (!url.startsWith("file:") && this.page.url().includes("/login?next=")) {
      await this.reauth();
      await this.page.goto(target, { waitUntil: "domcontentloaded" });
    }
    await sleep(1900);
  }

  async moveTo(x, y, steps = 16) {
    await this.page.mouse.move(x, y, { steps });
    await this.page.evaluate((x2, y2) => window.__cursorTo?.(x2, y2, false), x, y).catch(() => {});
  }

  /** Click via a DOM query evaluated in the page (useful for repeated labels). */
  async clickIn(fn, { caption, settle = 1400, arg } = {}) {
    await this.healLogin();
    if (caption) this.say(caption);
    const box = await this.page.evaluate(fn, arg);
    if (!box) throw new Error("clickIn: element not found");
    await this.moveTo(box.x, box.y, 14);
    await this.page.evaluate((x, y) => window.__cursorTo?.(x, y, true), box.x, box.y).catch(() => {});
    await sleep(160);
    await this.page.mouse.click(box.x, box.y);
    await sleep(settle);
  }

  /**
   * Click the button whose label matches, inside the section whose <h2> contains
   * `heading`. Puppeteer's text selectors are order-dependent and several panels
   * reuse "Add" / "Enter", so scope the query first.
   */
  async clickButton(heading, label, { caption, settle = 1400 } = {}) {
    await this.healLogin();
    if (caption) this.say(caption);
    const find = (h, l) => {
      const section = [...document.querySelectorAll("section")].find((s) =>
        s.querySelector("h2")?.textContent?.includes(h),
      );
      if (!section) return null;
      const button = [...section.querySelectorAll("button")].find((b) => b.textContent.trim() === l);
      if (!button) return null;
      button.scrollIntoView({ block: "center" });
      const r = button.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    // The panel is populated by a fetch, so poll for the button instead of
    // assuming it is already on screen.
    let box = null;
    for (let i = 0; i < 40 && !box; i += 1) {
      box = await this.page.evaluate(find, heading, label);
      if (!box) await sleep(250);
    }
    if (!box) {
      const seen = await this.page.evaluate(() =>
        [...document.querySelectorAll("section")].map((s) => ({
          h2: s.querySelector("h2")?.textContent?.trim() ?? null,
          buttons: [...s.querySelectorAll("button")].map((b) => b.textContent.trim()),
        })),
      );
      console.log("debug sections:", JSON.stringify(seen));
      throw new Error(`clickButton: no "${label}" under "${heading}"`);
    }
    await this.moveTo(box.x, box.y, 14);
    await this.page.evaluate((x, y) => window.__cursorTo?.(x, y, true), box.x, box.y).catch(() => {});
    await sleep(160);
    await this.page.mouse.click(box.x, box.y);
    await sleep(settle);
  }

  async click(selector, { caption, settle = 1400 } = {}) {
    await this.healLogin();
    if (caption) this.say(caption);
    const handle = await this.page.waitForSelector(selector, { visible: true, timeout: 25000 });
    const box = await handle.boundingBox();
    if (box) {
      await this.moveTo(box.x + box.width / 2, box.y + box.height / 2);
      await this.page.evaluate((x, y) => window.__cursorTo?.(x, y, true), box.x + box.width / 2, box.y + box.height / 2).catch(() => {});
    }
    await sleep(140);
    await handle.click().catch(async () => handle.evaluate((el) => el.click()));
    await sleep(settle);
  }

  /**
   * Switch console tabs. The tab bar can be under a flash notice when the click
   * lands, so retry until the panel a tab owns is actually on screen.
   */
  async tab(label, marker) {
    const open = () =>
      this.page.evaluate(
        (m) => [...document.querySelectorAll("section h2")].some((h) => h.textContent.includes(m)),
        marker,
      );
    for (let attempt = 0; attempt < 4; attempt += 1) {
      // The tab bar sits under the page header: from a scrolled-down page the
      // pointer click lands on the sticky nav instead of the tab.
      await this.page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await sleepLong(500);
      if (attempt === 0) {
        await this.click(`button::-p-text(${label})`, { settle: 1600 });
      } else {
        const clicked = await this.page.evaluate((l) => {
          const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === l);
          if (!button) return false;
          button.click();
          return true;
        }, label);
        if (!clicked) {
          await sleepLong(900); // the panel can be mid-refresh
          continue;
        }
        await sleepLong(1700);
      }
      if (await open()) return;
    }
    throw new Error(`tab ${label} would not open`);
  }


  async type(selector, text, { caption, delay = 45 } = {}) {
    await this.healLogin();
    if (caption) this.say(caption);
    const handle = await this.page.waitForSelector(selector, { visible: true, timeout: 25000 });
    const box = await handle.boundingBox();
    if (box) await this.moveTo(box.x + 20, box.y + box.height / 2, 10);
    await handle.click();
    // Clear the React way, not with the keyboard: a controlled input ignores
    // select-all, which leaves a default value ("2026 Order of Merit") in front
    // of the new text and turns it into one long slug.
    await handle.evaluate((el) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(150);
    await handle.type(text, { delay });
    await sleep(420);
  }

  /**
   * Set an input's value the React way. `type()` on a date/time input appends to
   * the browser-rendered segments, which produces nonsense dates like 70612-02-02.
   */
  async setValue(selector, value, { caption } = {}) {
    await this.healLogin();
    if (caption) this.say(caption);
    const handle = await this.page.waitForSelector(selector, { visible: true, timeout: 25000 });
    const box = await handle.boundingBox();
    if (box) await this.moveTo(box.x + 20, box.y + box.height / 2, 10);
    await handle.evaluate((el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await sleep(420);
  }

  async scroll(dy, { caption, settle = 1000 } = {}) {
    if (caption) this.say(caption);
    for (let i = 0; i < 18; i++) {
      await this.page.evaluate((d) => window.scrollBy(0, d), dy / 18);
      await sleep(28);
    }
    await sleep(settle);
  }

  async shot(name, caption) {
    await shot(this.page, name, caption);
  }

  async stop(file) {
    await this.rec.evaluate(() => (window.__paused = true)).catch(() => {});
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await sleep(600);
    const result = await this.rec.evaluate(() => window.__stop());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(result.b64, "base64"));
    fs.writeFileSync(file.replace(/\.\w+$/, ".cues.json"), JSON.stringify(this.cues, null, 1));
    console.log(`wrote ${file} (${(result.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(this.cues.map((c) => `${c.t.toFixed(1)}s  ${c.label}`).join("\n"));
    await this.browser.close();
  }
}

const el = {
  byText: (text, tag = "button") => `${tag}::-p-text(${text})`,
};

const sleepLong = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(demo, predicate, label, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (await demo.healLogin()) continue;
    if (await predicate()) return true;
    await sleepLong(250);
  }
  throw new Error(`timed out waiting for ${label} (at ${demo.page.url()})`);
}

async function journey() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const demo = await Recorder.create();
  await demo.page.goto("about:blank");
  if (!DRY) await demo.start();
  await demo.title(
    "A society golf day, start to finish",
    "club and season · a Texas scramble · team card · live board · order of merit · refund",
    3800,
  );

  // ── The club ─────────────────────────────────────────────────────────────
  await demo.goto("/", "1. A golf day - and now the club that runs it, its season and its money.");
  await demo.shot("landing");

  await demo.goto("/login", "2. Alex Morgan, the society's secretary, signs in.");
  await demo.type("#email", "admin@golfday.app", { caption: "Alex runs the society's golf days." });
  await demo.type("#password", "golfday123");
  await demo.click("button[type=submit]", { settle: 3200, caption: "Into everything they organise." });
  await demo.shot("signed-in");
  demo.authUser = { email: "admin@golfday.app", password: "golfday123" };
  demo.startHeartbeat();

  await demo.goto("/societies", "3. A society keeps a roster, a fixture list and a season in one place.");
  await demo.shot("societies");
  await demo.type("#society-name", "Harrow Golf Society", { caption: "Start a society: Alex becomes its owner." });
  await demo.type("#society-club", "Harrow Golf Club");
  await demo.click(el.byText("Create society"), { settle: 2600, caption: "It gets a six-character code, so members can join themselves." });
  await waitFor(demo, () => /\/societies\/[a-z0-9-]+$/.test(demo.page.url()), "the society page");
  await sleepLong(1200);
  await demo.shot("society");

  /**
   * The roster search is a debounced fetch, and the first search on a cold dev
   * server can land while the route is still compiling - in which case the list
   * stays empty and never retries on its own. Poll for the row, and retype if
   * the query produced nothing.
   */
  async function addRosterMember(name, caption) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await demo.type('input[placeholder^="Search players"]', name, {
        settle: 1500,
        ...(attempt === 0 && caption ? { caption } : {}),
      });
      for (let i = 0; i < 8; i += 1) {
        const box = await demo.page.evaluate((firstName) => {
          const section = [...document.querySelectorAll("section")].find((s) =>
            s.querySelector("h2")?.textContent?.includes("Roster"),
          );
          const row = [...(section?.querySelectorAll("li") ?? [])].find((li) =>
            li.textContent.trim().startsWith(firstName),
          );
          const button = [...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent.trim() === "Add");
          if (!button) return null;
          button.scrollIntoView({ block: "center" });
          const r = button.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, name);
        if (box) {
          await demo.moveTo(box.x, box.y, 12);
          await sleepLong(160);
          await demo.page.mouse.click(box.x, box.y);
          await sleepLong(1900);
          return;
        }
        await sleepLong(300);
      }
    }
    throw new Error(`roster add failed for ${name}`);
  }

  await addRosterMember("Sam", "The roster comes from the player directory, handicaps included.");
  await addRosterMember("Priya");
  const rosterSize = Number(
    (await db.execute({ sql: "select count(*) as n from society_members" })).rows[0].n,
  );
  console.log("roster size:", rosterSize);
  if (rosterSize < 3) throw new Error(`expected the founder plus two members, found ${rosterSize}`);
  await demo.shot("society-roster");

  const society = (
    await db.execute({ sql: "select id, slug, join_code from societies order by created_at desc limit 1" })
  ).rows[0];
  console.log("society:", society);

  // ── The season ───────────────────────────────────────────────────────────
  await demo.scroll(520, { caption: "4. And a season: the order of merit that runs across the year." });
  await demo.type("#season-name", "2027 Order of Merit");
  await demo.setValue("#season-start", "2027-01-01");
  await demo.setValue("#season-end", "2027-12-31");
  await demo.say("A season has a window: only golf days played inside it score.");
  await sleepLong(900);
  await demo.shot("season-form");
  // The form is a client action: if the header re-renders under the pointer the
  // click can vanish, so nudge it again from inside the page.
  let seasonCreated = false;
  for (let attempt = 0; attempt < 3 && !seasonCreated; attempt += 1) {
    if (attempt === 0) {
      await demo.click(el.byText("Create season"), { settle: 2800, caption: "A win is worth 100, second 90, and so on down the field." });
    } else {
      await demo.page.evaluate(() => {
        const button = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Create season");
        button?.scrollIntoView({ block: "center" });
        button?.click();
      });
      await sleepLong(2200);
    }
    seasonCreated = await waitFor(demo, () => demo.page.url().includes("/seasons/"), "the season page", 24).catch(() => false);
  }
  if (!seasonCreated) throw new Error("the season would not create");
  await sleepLong(1200);
  await demo.shot("season-empty");

  const season = (await db.execute({ sql: "select id, slug from seasons order by created_at desc limit 1" })).rows[0];
  console.log("season:", season);

  // ── The golf day ─────────────────────────────────────────────────────────
  await demo.goto(`/societies/${society.slug}`, "5. Back at the club: a golf day created here joins the fixture list by itself.");
  await demo.click(el.byText("New golf day", "a"), { settle: 2600, caption: "The three-step wizard." });

  await demo.type("#name", EVENT_NAME, { caption: "Name it, pick the date and the first tee." });
  await demo.type("#desc", "Texas scramble, teams of four. Every player's drive has to be used at least four times.");
  await demo.setValue("#date", "2027-06-12");
  await demo.setValue("#time", "09:00");
  await demo.page.select("#format", "TEXAS_SCRAMBLE");
  await demo.say("Format: Texas scramble - the card belongs to the team, not the player.");
  await sleepLong(1200);
  await demo.shot("wizard-format");

  await demo.click(el.byText("Next: choose the course"), { caption: "6. Step two: the course and its card." });
  await demo.type('input[placeholder^="Search by course"]', "Sunningdale", { settle: 1800 });
  await demo.clickIn(
    () => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent.includes("Old Course") && b.textContent.includes("Sunningdale"),
      );
      if (!button) return null;
      button.scrollIntoView({ block: "center" });
      const r = button.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    { caption: "Picked from the course library - par, stroke index and tees come with it.", settle: 1600 },
  );
  await demo.click(el.byText("Next: review"), { caption: "7. Review. The card is snapshotted onto the day, so later edits cannot rewrite it." });
  await demo.shot("wizard-review");
  await demo.click(el.byText("Create golf day"), { settle: 2200, caption: "Created - with a join code, a team scorecard per four-ball and a leaderboard link." });
  await waitFor(demo, () => demo.page.url().includes("/admin/events/"), "the organiser console");
  await sleepLong(1800);
  await demo.shot("event-created");

  let event;
  for (let i = 0; i < 80 && !event; i += 1) {
    event = (await db.execute({ sql: "select id, slug, join_code from events where name = ? order by created_at desc limit 1", args: [EVENT_NAME] })).rows[0];
    if (!event) await sleepLong(300);
  }
  console.log("event:", event);
  if (!event) throw new Error(`the wizard did not create "${EVENT_NAME}"`);

  // ── Field and teams ──────────────────────────────────────────────────────
  await demo.click(el.byText("Field"), { caption: "8. The field." });

  const fieldCount = async () =>
    Number(
      (await db.execute({ sql: "select count(*) as n from event_players where event_id = ? and status = 'REGISTERED'", args: [event.id] })).rows[0].n,
    );

  /**
   * The result list refreshes a beat after the click, so clicking "Add" twice in
   * a row can hit the same player again (and the API rightly refuses). Search,
   * click that specific row, then wait for the registration to land in the db.
   */
  async function addPlayer(name, caption, attempt = 0) {
    const before = await fieldCount();
    const findRow = (firstName) =>
      demo.page.evaluate((firstName) => {
        const section = [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent?.includes("Add a player"));
        const row = [...(section?.querySelectorAll("li") ?? [])].find((li) => li.textContent.trim().startsWith(firstName));
        const button = row?.querySelector("button");
        if (!button) return null;
        button.scrollIntoView({ block: "center" });
        const r = button.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, firstName);
    // the directory search is debounced and is re-run after every add, so the
    // result list can lag the typed text by a second or two: poll, and retype
    // once if the row still has not appeared (a stale query can also return the
    // previous player only).
    let box = null;
    for (let attempt = 0; attempt < 3 && !box; attempt += 1) {
      await demo.type('input[placeholder^="Search existing players"]', name, { settle: 900, ...(attempt === 0 && caption ? { caption } : {}) });
      for (let i = 0; i < 10 && !box; i += 1) {
        box = await findRow(name);
        if (!box) await sleepLong(250);
      }
    }
    if (!box) throw new Error(`no search result for ${name}`);
    await demo.moveTo(box.x, box.y, 12);
    await demo.page.evaluate((x, y) => window.__cursorTo?.(x, y, true), box.x, box.y).catch(() => {});
    await sleepLong(200);
    await demo.page.mouse.click(box.x, box.y);
    for (let i = 0; i < 40; i += 1) {
      if ((await fieldCount()) > before) return;
      await sleepLong(250);
    }
    // The list can re-render between finding the row and clicking it; search
    // again from a clean box rather than leaving a gap in the field.
    if (attempt < 2) return addPlayer(name, attempt === 0 ? caption : null, attempt + 1);
    throw new Error(`${name} would not go into the field`);
  }

  const field = ["Mei", "Gareth", "James", "Tom", "Nina", "Ravi", "Sam", "Priya"];
  for (let i = 0; i < field.length; i += 1) {
    await addPlayer(field[i], i === 0 ? "Players come from the directory - handicap and club come with them." : null);
  }
  const registered = await fieldCount();
  console.log("field size:", registered);
  if (registered !== field.length) throw new Error(`expected ${field.length} in the field, found ${registered}`);
  await demo.shot("field");

  await demo.click(el.byText("Groups"), { caption: "9. Two four-balls, ten minutes apart, in one click." });
  await demo.page.evaluate(() => {
    const section = [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent?.includes("Tee groups"));
    const select = section?.querySelector("select");
    if (!select) return;
    select.value = "4";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleepLong(700);
  await demo.clickButton("Tee groups", "Auto-allocate", { settle: 2800, caption: "Each team gets its own private scorecard link - no logins on the course." });
  await demo.shot("teams");
  await demo.scroll(420);
  await demo.shot("team-scorecard-links");
  await demo.scroll(-420, { settle: 600 });

  // ── Money ────────────────────────────────────────────────────────────────
  await demo.tab("Games", "Entry fee");
  await demo.say("10. £25 a head. Card payments go through Stripe when it is switched on; today the desk takes cash.");
  await demo.type("#g-fee", "25");
  await demo.clickButton("Entry fee", "Save fee", { settle: 2000, caption: "Saved." });
  await demo.shot("entry-fee");

  await demo.tab("Overview", "Run the day");
  await demo.clickButton("Run the day", "In progress", { settle: 2400, caption: "11. Open the day: scoring unlocks and the board goes live." });
  await demo.shot("day-open");

  // ── The season takes the fixture ─────────────────────────────────────────
  await demo.goto(`/seasons/${season.slug}`, "12. The season knows nothing yet - one fixture to add.");
  await demo.page.select("#season-fixture", event.id);
  await demo.say("The scramble counts towards the order of merit.");
  await sleepLong(800);
  await demo.clickButton("Fixtures", "Add fixture", { settle: 2600, caption: "Attached. The table fills in as the cards come in." });
  await demo.shot("season-fixture");

  // ── The player, on the course ────────────────────────────────────────────
  demo.authUser = null; // the sign-out below is deliberate, so don't undo it
  await demo.stopHeartbeat();
  await demo.page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  await demo.goto("/login", "13. Now a player's phone: Sam, in the field, with a team to keep score for.");
  await demo.type("#email", "sam@golfday.app");
  await demo.type("#password", "golfday123");
  await demo.click("button[type=submit]", { settle: 3000, caption: "Signed in as a player." });
  demo.authUser = { email: "sam@golfday.app", password: "golfday123" };
  demo.startHeartbeat();

  await demo.goto(`/events/${event.slug}`, "14. The day as the field sees it: teams, tee times and the live board.");
  await demo.shot("event-page");

  const samGroup = (
    await db.execute({
      sql: `select g.id, g.token, g.name from event_players ep
            join players p on p.id = ep.player_id
            join groups g on g.id = ep.group_id
            where p.name = 'Sam Whitcombe' and ep.event_id = ? limit 1`,
      args: [event.id],
    })
  ).rows[0];
  console.log("sam's group:", samGroup);
  if (!samGroup?.token) throw new Error("Sam did not end up in a tee group");

  const otherGroup = (
    await db.execute({ sql: "select id, token, name from groups where event_id = ? and id <> ? order by sort_order limit 1", args: [event.id, samGroup.id] })
  ).rows[0];
  console.log("other group:", otherGroup);

  await demo.goto(`/score/${samGroup.token}`, `15. The ${samGroup.name} team card: one score per hole - and whose drive the team used.`);
  await sleepLong(1400);
  await demo.shot("team-card");

  const clickScore = (strokes, caption) =>
    demo.clickIn(
      (n) => {
        const grid = [...document.querySelectorAll('div[class*="sm:grid-cols-8"]')].pop();
        const buttons = grid ? [...grid.querySelectorAll("button")] : [];
        const b = buttons[n - 1];
        if (!b) return null;
        b.scrollIntoView({ block: "center" });
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      { caption, settle: 1100, arg: strokes },
    );

  const clickDrive = (firstName, caption) =>
    demo.clickIn(
      (name) => {
        const b = [...document.querySelectorAll("button")].find(
          (btn) => btn.className.includes("pill") && btn.textContent.trim().startsWith(name),
        );
        if (!b) return null;
        b.scrollIntoView({ block: "center" });
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      { caption, settle: 1300, arg: firstName },
    );

  const teamMembers = (
    await db.execute({
      sql: `select p.name from event_players ep join players p on p.id = ep.player_id
            where ep.group_id = ? order by p.name`,
      args: [samGroup.id],
    })
  ).rows.map((r) => r.name);
  console.log("team:", teamMembers);

  // Credit the drive before carding the hole: the next tap saves both together,
  // which is how a four-ball actually does it standing on the tee.
  await clickDrive(teamMembers[0].split(" ")[0], "Whose drive was it? The team taps the player.");
  await clickScore(4, "A par on the first - and the drive is logged with it.");
  await clickDrive(teamMembers[1].split(" ")[0], "Every player's tee shot has to be used - this is tracked, not remembered.");
  await clickScore(3, "A birdie on the second.");
  await clickDrive(teamMembers[2].split(" ")[0]);
  await clickScore(5, "A bogey on the third.");
  await clickDrive(teamMembers[0].split(" ")[0]);
  await clickScore(4, "Par on the fourth.");
  await demo.say("The drive ledger on the right counts them, and says who still owes one.");
  await sleepLong(1800);
  await demo.shot("team-card-progress");

  // ── The board ────────────────────────────────────────────────────────────
  await demo.goto(`/live/${event.slug}`, "16. The public board: the team is the competitor, with a scramble team handicap.");
  await demo.shot("live-board");

  await demo.say("Another team starts carding their holes, while this page is open...");
  const otherCard = [3, 3, 4, 4, 4, 3];
  await demo.page.evaluate(
    async (eventId, groupId, strokesPerHole) => {
      for (let i = 0; i < strokesPerHole.length; i += 1) {
        await fetch("/api/scramble", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, groupId, holeNumber: i + 1, strokes: strokesPerHole[i] }),
        });
      }
    },
    event.id,
    otherGroup.id,
    otherCard,
  );
  await demo.say("...and the board updates itself, in place, within two seconds. No refresh.");
  await sleepLong(3600);
  await demo.shot("live-board-updated");

  // ── The money, back at the desk ──────────────────────────────────────────
  demo.authUser = null; // signing back in as the organiser is deliberate
  await demo.stopHeartbeat();
  await demo.page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  await demo.goto("/login", "17. Back at the desk: the money.");
  await demo.type("#email", "admin@golfday.app");
  await demo.type("#password", "golfday123");
  await demo.click("button[type=submit]", { settle: 3000 });
  demo.authUser = { email: "admin@golfday.app", password: "golfday123" };
  demo.startHeartbeat();

  await demo.goto(`/admin/events/${event.id}`, "18. The organiser console for this day.");
  await demo.tab("Payments", "Entry fees");
  await demo.say("19. Who has paid - and a refund recorded against that entry.");
  await demo.clickButton("Entry fees", "Mark paid", { settle: 2000, caption: "A player paid their £25 in cash - the organiser marks it here." });
  await sleepLong(600);
  await demo.shot("payments");

  await demo.clickButton("Entry fees", "Refund", { settle: 1600, caption: "Then a part refund - part or all of it, never more than was paid." });
  await demo.type("#refund-amount", "10");
  await demo.click(el.byText("Refund £10"), { settle: 2600, caption: "Checked against what is left of that entry, so a double refund is impossible. With card payments on, the refund goes back through Stripe." });
  await demo.shot("refund");

  // ── The season, after the day ────────────────────────────────────────────
  await demo.goto(`/seasons/${season.slug}`, "20. And the order of merit, built from the day: every team member earns the team's result.");
  await sleepLong(1400);
  await demo.shot("order-of-merit");

  await demo.goto(`/live/${event.slug}?tv=1`, "21. The clubhouse screen: the same board, big enough to read from the bar.");
  await sleepLong(3000);
  await demo.title("That is the whole day", "society · season · scramble · team card · live board · refund", 3800);
  if (DRY) {
    await demo.browser.close();
    console.log("DRY run complete - all steps reached the end.");
    return;
  }
  await demo.stop(out);
}

try {
  await journey();
} catch (err) {
  console.error(err);
  process.exit(1);
}
