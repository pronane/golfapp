/**
 * Demo recorder - renders the demo videos that ship in this folder.
 *
 * How it works
 * ------------
 * 1. Puppeteer drives the real app in a headless Chrome (1440x900).
 * 2. Chrome's CDP screencast gives us a JPEG per painted frame; `recorder.html`
 *    paints them onto a canvas, adds the caption bar and the software cursor.
 * 3. The canvas is recorded with MediaRecorder (VP9) - no ffmpeg needed, which
 *    is handy in sandboxes where ffmpeg cannot be installed.
 * 4. `cues.json` records when each caption appeared, so the voice-over can be
 *    laid on top afterwards (see demo/README.md).
 *
 * Usage
 * -----
 *   npm i -D puppeteer
 *   npx puppeteer browsers install chrome
 *   npm run dev                       # in another terminal
 *   node demo/record.mjs --scene=product --out=demo/product.webm
 *   node demo/record.mjs --scene=live    --out=demo/live.webm
 *
 * Environment: APP_URL (default http://127.0.0.1:3000), CHROME_PATH (optional).
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer";
import { createClient } from "@libsql/client";

const BASE = process.env.APP_URL ?? "http://127.0.0.1:3000";
const W = 1440;
const H = 900;
const HERE = path.dirname(new URL(import.meta.url).pathname);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? "true"];
  }),
);
const scene = args.scene ?? "product";
const out = args.out ?? `demo/${scene}.webm`;

/** Everything the scenes need to know about the seeded data. */
async function fixture() {
  const client = createClient({ url: process.env.DATABASE_URL ?? "file:./data/golfday.db" });
  const live = (await client.execute("select id, slug from events where status = 'IN_PROGRESS' limit 1")).rows[0];
  if (!live) throw new Error("Run `npm run db:reset` first - no in-progress event to film.");
  const group = (
    await client.execute(`select token from groups where event_id = '${live.id}' order by sort_order limit 1`)
  ).rows[0];
  return { slug: live.slug, eventId: live.id, scoreToken: group.token };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Recorder {
  constructor(browser, page, rec) {
    this.browser = browser;
    this.page = page;
    this.rec = rec;
    this.caption = null;
    this.cues = [];
    this.t0 = 0;
  }

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
    return new Recorder(browser, page, rec);
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
    const cdp = await this.page.createCDPSession();
    this.cdp = cdp;
    cdp.on("Page.screencastFrame", async (frame) => {
      cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
      await this.rec.evaluate((f, c) => window.__frame(f, c), frame.data, this.caption).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 95, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  }

  async title(title, subtitle, holdMs = 2800) {
    await this.rec.evaluate((t, s) => window.__title(t, s), title, subtitle);
    await this.rec.evaluate(() => (window.__paused = true));
    await sleep(holdMs);
    await this.rec.evaluate(() => (window.__paused = false));
  }

  async goto(url, caption) {
    this.mark(`GOTO: ${url}`);
    if (caption) this.say(caption);
    await this.page.goto(url.startsWith("file:") ? url : BASE + url, { waitUntil: "domcontentloaded" });
    await sleep(1800);
  }

  async moveTo(x, y, steps = 16) {
    await this.page.mouse.move(x, y, { steps });
    await this.page.evaluate((x2, y2) => window.__cursorTo?.(x2, y2, false), x, y).catch(() => {});
  }

  async click(selector, { caption, settle = 1200 } = {}) {
    if (caption) this.say(caption);
    const handle = await this.page.waitForSelector(selector, { visible: true, timeout: 20000 });
    const box = await handle.boundingBox();
    if (box) {
      await this.moveTo(box.x + box.width / 2, box.y + box.height / 2);
      await this.page.evaluate((x, y) => window.__cursorTo?.(x, y, true), box.x + box.width / 2, box.y + box.height / 2);
    }
    await sleep(140);
    await handle.click().catch(async () => handle.evaluate((el) => el.click()));
    await sleep(settle);
  }

  async type(selector, text, { caption, delay = 55 } = {}) {
    if (caption) this.say(caption);
    const handle = await this.page.waitForSelector(selector, { visible: true, timeout: 20000 });
    const box = await handle.boundingBox();
    if (box) await this.moveTo(box.x + 20, box.y + box.height / 2, 10);
    await handle.click({ clickCount: 3 });
    await sleep(120);
    await handle.type(text, { delay });
    await sleep(400);
  }

  async scroll(dy, { caption, settle = 900 } = {}) {
    if (caption) this.say(caption);
    for (let i = 0; i < 18; i++) {
      await this.page.evaluate((d) => window.scrollBy(0, d), dy / 18);
      await sleep(28);
    }
    await sleep(settle);
  }

  frameFor(part) {
    const frame = this.page.frames().find((f) => f.url().includes(part));
    if (!frame) throw new Error(`no frame containing ${part}`);
    return frame;
  }

  async iframePoint(iframeId, x, y) {
    return this.page.evaluate(
      (id, x2, y2) => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return { x: r.left + m.a * x2 + (m.e || 0), y: r.top + m.d * y2 + (m.f || 0) };
      },
      iframeId,
      x,
      y,
    );
  }

  async clickInFrame(frame, selector, { caption, settle = 1200, iframeId = "left" } = {}) {
    if (caption) this.say(caption);
    const handle = await frame.waitForSelector(selector, { visible: true, timeout: 20000 });
    const box = await handle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const pt = await this.iframePoint(iframeId, box.x, box.y);
    await this.page.mouse.move(pt.x, pt.y, { steps: 16 });
    await this.page.evaluate((x, y) => window.__cursorTo?.(x, y, true), pt.x, pt.y);
    await sleep(180);
    await this.page.mouse.click(pt.x, pt.y);
    await sleep(settle);
  }

  async scrollFrame(frame, dy, { caption, settle = 700 } = {}) {
    if (caption) this.say(caption);
    for (let i = 0; i < 16; i++) {
      await frame.evaluate((d) => window.scrollBy(0, d), dy / 16);
      await sleep(30);
    }
    await sleep(settle);
  }

  async stop(file) {
    await this.pause();
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await sleep(500);
    const result = await this.rec.evaluate(() => window.__stop());
    fs.writeFileSync(file, Buffer.from(result.b64, "base64"));
    fs.writeFileSync(file.replace(/\.\w+$/, ".cues.json"), JSON.stringify(this.cues, null, 1));
    console.log(`wrote ${file} (${(result.size / 1024 / 1024).toFixed(2)} MB)`);
    console.log(this.cues.map((c) => `${c.t.toFixed(1)}s  ${c.label}`).join("\n"));
    await this.browser.close();
  }

  async pause() {
    await this.rec.evaluate(() => (window.__paused = true)).catch(() => {});
  }

  async sleep(ms) {
    await sleep(ms);
  }
}

async function productTour(fx) {
  const demo = await Recorder.create();
  await demo.page.goto("about:blank");
  await demo.start();
  await demo.title("GolfDay", "Live scoring for golf days and outings");
  await demo.goto("/", "One place to run a golf day: the card, tee groups, entries and a leaderboard everyone can watch.");
  await demo.scroll(620, { caption: "Stableford or net stroke play, WHS handicaps, and no app for players to install." });
  await demo.scroll(-620, { settle: 600 });
  await demo.click('a::-p-text(Watch the live demo)', { settle: 2200, caption: "Spectators just open the leaderboard link - no login needed." });
  await demo.click("button::-p-text(Show hole-by-hole)", { settle: 1600, caption: "The whole field, hole by hole, refreshed within two seconds of a score." });
  await demo.goto("/login", "Organisers and players sign in with a normal account.");
  await demo.type("#email", "admin@golfday.app", { caption: "Signing in as the event organiser..." });
  await demo.type("#password", "golfday123");
  await demo.click("button[type=submit]", { settle: 3200, caption: "Straight to their own golf." });
  await demo.goto("/dashboard", "Players see today's round, their tee group and their live position.");
  await demo.goto("/admin", "The organiser console: every golf day they run, with its join code.");
  await demo.click(`a[href="/admin/events/${fx.eventId}"]`, { settle: 2200, caption: "Opening today's event." });
  for (const tab of ["Field", "Groups", "Card", "Admins"]) {
    await demo.click(`button::-p-text(${tab})`, { settle: 1500, caption: `${tab}: everything the day needs, in one tab.` });
  }
  await demo.goto("/admin/courses", "Courses come from a free course API, or an 18-hole card the organiser types in.");
  await demo.type('input[placeholder^="Sunningdale"]', "Sunningdale", { caption: "Searching the course database..." });
  await demo.click("button::-p-text(Search)", { settle: 1500, caption: "Results import into the club's own library with par, stroke index, slope and rating." });
  await demo.goto("/admin/events/new", "Creating a golf day: a three-step wizard.");
  await demo.type("#name", "Captains' Charity Day 2027", { caption: "Name it, set the date, format and handicap allowance..." });
  await demo.click("button::-p-text(Next: choose the course)", { settle: 1400, caption: "Then pick the course it is played on." });
  await demo.type('input[placeholder^="Search by course"]', "Wentworth", { caption: "Search by club, course or town." });
  await demo.click("button::-p-text(Virginia Water)", { settle: 1500, caption: "Pick it and the full 18-hole card is snapshotted onto the event." });
  await demo.click("button::-p-text(Next: review)", { settle: 1600, caption: "Review, then create." });
  await demo.click("button::-p-text(Create golf day)", { settle: 3000, caption: "Done - the golf day exists, with a join code and a leaderboard URL." });
  await demo.page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  await demo.goto("/register", "New players sign up with their Golf England ID.");
  await demo.type("#name", "Fiona MacLeod", { caption: "The handicap index comes from Golf England, so an organiser never types it in." });
  await demo.type("#email", "fiona.demo@golfday.app");
  await demo.type("#password", "golfday123");
  await demo.type("#ge", "GE100246", { caption: "One lookup fills in the index and home club." });
  await demo.click("button::-p-text(Look up)", { settle: 1800 });
  await demo.title("GolfDay", "Next.js + SQLite - free to host", 3000);
  await demo.stop(out);
}

async function liveScoring(fx) {
  const template = fs.readFileSync(path.join(HERE, "live-stage.html"), "utf8");
  const stage = template.replaceAll("__SCORE_TOKEN__", fx.scoreToken).replaceAll("__SLUG__", fx.slug);
  fs.writeFileSync(path.join(HERE, ".stage-run.html"), stage);

  const demo = await Recorder.create();
  await demo.page.goto("about:blank");
  await demo.start();
  await demo.rec.evaluate(() => (window.__paused = true));
  await demo.rec.evaluate((t, s) => window.__title(t, s), "Live scoring", "Every card update reaches the leaderboard in seconds");
  await demo.page.goto(`file://${HERE}/.stage-run.html`, { waitUntil: "domcontentloaded" });
  // wait for both panes to hydrate, then reveal
  for (let i = 0; i < 60; i++) {
    const urls = demo.page.frames().map((f) => f.url());
    if (urls.some((u) => u.includes("/score/")) && urls.some((u) => u.includes("/live/"))) break;
    await sleep(300);
  }
  await sleep(2500);
  await demo.rec.evaluate(() => (window.__paused = false));

  const score = demo.frameFor("/score/");
  const live = demo.frameFor("/live/");
  await score.evaluate(() => window.scrollTo(0, 118));
  await demo.say("Two screens, one database: the four-ball scores on the left, the clubhouse sees the right.");
  await sleep(2800);

  await demo.clickInFrame(score, 'div[class*="sm:grid-cols-8"] > button:nth-child(3)', {
    caption: "Alex taps in a 3 on the 17th - an eagle, 4 points with his shot.",
    settle: 400,
  });
  await sleep(1200);
  await demo.say("The leaderboard flashes the row that changed. No refresh, no app, a second and a half later.");
  await sleep(2600);

  await demo.clickInFrame(score, 'div[class*="sm:grid-cols-8"] > button:nth-child(4)', {
    caption: "Next hole, a birdie - the mini leaderboard on the card moves too.",
    settle: 400,
  });
  await sleep(1200);
  await demo.say("Every hole is written to the card, the leaderboard revision bumps, and both screens re-render.");
  await sleep(2800);

  await demo.clickInFrame(score, "header > div:nth-of-type(2) > button:nth-child(3)", {
    caption: "Now Mei, in the same four-ball...",
    settle: 1400,
  });
  await demo.clickInFrame(score, 'div[class*="sm:grid-cols-8"] > button:nth-child(2)', {
    caption: "... and holes out for a 2 on the 18th. Watch the order at the top of the board change.",
    settle: 400,
  });
  await sleep(1000);
  await demo.say("Mei jumps the field on the clubhouse screen while the group is still walking off the green.");
  await sleep(3000);

  await demo.scrollFrame(live, 560, { caption: "The full board: position, thru, points, gross and to-par." });
  await sleep(2200);
  await demo.scrollFrame(live, -560, { settle: 400 });
  await demo.scrollFrame(live, 700, { caption: "Further down: the group sweep and the card of the day build themselves." });
  await sleep(2200);
  await demo.scrollFrame(live, -700, { settle: 400 });

  await demo.clickInFrame(score, 'div[class*="sm:grid-cols-8"] > button:nth-child(5)', {
    caption: "A score can be corrected afterwards - the change is audited and the board adjusts again.",
    settle: 300,
  });
  await demo.say("Spectators, the clubhouse screen and the group's phone all stay in step.");
  await sleep(2800);
  await demo.rec.evaluate((t, s) => window.__title(t, s), "GolfDay", "Scoring, live updates and refreshes - no app needed");
  await sleep(3200);
  await demo.stop(out);
}

const fx = await fixture();
fs.mkdirSync(path.dirname(out), { recursive: true });
if (scene === "live") await liveScoring(fx);
else await productTour(fx);
