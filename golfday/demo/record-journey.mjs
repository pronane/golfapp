/**
 * End-to-end journey recorder: films one golf day from an empty database to a
 * live leaderboard, using only the UI - organiser first, then a player.
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
const EVENT_NAME = "Captains' Charity Day 2027";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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

  async goto(url, caption) {
    this.mark(`GOTO: ${url}`);
    if (caption) this.say(caption);
    await this.page.goto(url.startsWith("file:") ? url : BASE + url, { waitUntil: "domcontentloaded" });
    await sleep(1900);
  }

  async moveTo(x, y, steps = 16) {
    await this.page.mouse.move(x, y, { steps });
    await this.page.evaluate((x2, y2) => window.__cursorTo?.(x2, y2, false), x, y).catch(() => {});
  }

  /** Click via a DOM query evaluated in the page (useful for repeated labels). */
  async clickIn(fn, { caption, settle = 1400, arg } = {}) {
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

  async type(selector, text, { caption, delay = 45 } = {}) {
    if (caption) this.say(caption);
    const handle = await this.page.waitForSelector(selector, { visible: true, timeout: 25000 });
    const box = await handle.boundingBox();
    if (box) await this.moveTo(box.x + 20, box.y + box.height / 2, 10);
    await handle.click();
    // Clear with the keyboard: a controlled input can ignore a triple-click
    // select-all, which leaves the old text in front of the new query.
    await this.page.keyboard.down("Control");
    await this.page.keyboard.press("KeyA");
    await this.page.keyboard.up("Control");
    await this.page.keyboard.press("Backspace");
    await sleep(150);
    await handle.type(text, { delay });
    await sleep(420);
  }

  /**
   * Set an input's value the React way. `type()` on a date/time input appends to
   * the browser-rendered segments, which produces nonsense dates like 70612-02-02.
   */
  async setValue(selector, value, { caption } = {}) {
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


async function journey() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const demo = await Recorder.create();
  await demo.page.goto("about:blank");
  await demo.start();
  await demo.title("One golf day, start to finish", "Organiser sets it up · players enter · a group scores · the board updates", 3600);

  // ── Organiser ────────────────────────────────────────────────────────────
  await demo.goto("/", "1. An organiser starts here, with nothing but a course and a date.");
  await demo.shot("landing");

  await demo.goto("/login", "2. They sign in.");
  await demo.type("#email", "admin@golfday.app", { caption: "Alex Morgan, event organiser." });
  await demo.type("#password", "golfday123");
  await demo.click("button[type=submit]", { settle: 3200, caption: "Straight to their own golf and the events they run." });
  await demo.shot("signed-in");

  await demo.goto("/admin", "3. The organiser console - every golf day they run.");
  await demo.shot("organiser-console");

  await demo.goto("/admin/events/new", "4. Create a golf day. Step one: name it and set the date.");
  await demo.type("#name", EVENT_NAME, { caption: "Name, date, first tee and the handicap allowance." });
  await demo.type("#desc", "Three-ball better-ball. Shotgun start at 08:30 - best two scores count.");
  await demo.setValue("#date", "2027-06-12", { caption: "Saturday 12 June 2027, first tee 08:30." });
  await demo.setValue("#time", "08:30");
  await demo.shot("wizard-step-1");

  await demo.click(el.byText("Next: choose the course"), { caption: "5. Step two: which course is it played on?" });
  await demo.click(el.byText("Type a new course"), {
    settle: 1200,
    caption: "No course in the library? The admin names it and supplies the card by hand.",
  });
  await demo.type("#cname", "Harrow Golf Club");
  await demo.type("#cclub", "Harrow Golf Club");
  await demo.type("#caddr", "Oxhey Lane, Harrow");
  await demo.scroll(360, { caption: "Par and stroke index for all 18 holes - editable hole by hole." });
  await demo.shot("wizard-course-card");
  await demo.scroll(-360, { settle: 600 });

  await demo.click(el.byText("Next: review"), { caption: "6. Step three: review what will be created." });
  await demo.shot("wizard-review");
  await demo.click(el.byText("Create golf day"), { settle: 1800, caption: "Created - with a join code, tee groups and a leaderboard link." });
  for (let i = 0; i < 40; i += 1) {
    if (demo.page.url().includes("/admin/events/")) break;
    await sleep(300);
  }
  await sleep(1600);
  await demo.shot("event-created");

  // Poll: the row is committed by the API a moment after the console renders.
  let event;
  for (let i = 0; i < 60 && !event; i += 1) {
    event = (
      await db.execute({
        sql: "select id, slug, join_code from events where name = ? order by created_at desc limit 1",
        args: [EVENT_NAME],
      })
    ).rows[0];
    if (!event) await sleep(300);
  }
  console.log("event:", event);
  if (!event) throw new Error(`the wizard did not create "${EVENT_NAME}"`);

  await demo.click(el.byText("Field"), { caption: "7. The field. Players can be picked from the directory..." });
  await demo.type('input[placeholder^="Search existing players"]', "Mei", { settle: 1400 });
  for (const name of ["Mei", "Gareth", "James"]) {
    await demo.type('input[placeholder^="Search existing players"]', name, { settle: 1500 });
    await demo.clickButton("Add a player", "Add", { caption: `${name}'s card, added to the field.`, settle: 1700 });
  }
  await demo.type('input[placeholder="Full name"]', "Rob Falconer", { caption: "...or a guest with no account, who can claim their entry later." });
  await demo.type('input[placeholder="Handicap index"]', "13.4");
  await demo.type('input[placeholder="Club"]', "Harrow Golf Club");
  await demo.clickButton("New guest player", "Create and enter", { settle: 2200 });
  await demo.shot("field");

  await demo.click(el.byText("Groups"), { caption: "8. Tee groups: one click allocates four-balls and tee times." });
  await demo.page.evaluate(() => {
    const section = [...document.querySelectorAll("section")].find((s) => s.querySelector("h2")?.textContent?.includes("Tee groups"));
    const select = section?.querySelector("select");
    if (!select) return;
    select.value = "3";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(700);
  await demo.clickButton("Tee groups", "Auto-allocate", { settle: 2600, caption: "Three-balls for this one, with tee times ten minutes apart." });
  await demo.shot("groups");
  await demo.scroll(420, { caption: "Each group has its own private scorecard link - no logins on the course." });
  await demo.shot("group-scorecard-links");
  await demo.scroll(-420, { settle: 600 });

  await demo.click(el.byText("Overview"), { settle: 1400 });
  await demo.clickButton("Run the day", "In progress", {
    settle: 2200,
    caption: "9. The day starts: scoring opens and the board goes live.",
  });
  await demo.scroll(520, { caption: "The join code is what players type to put themselves in the field." });
  await demo.shot("join-code");
  await demo.scroll(-520, { settle: 600 });

  // ── Player ───────────────────────────────────────────────────────────────
  await demo.page.evaluate(() => fetch("/api/auth/logout", { method: "POST" }));
  await demo.goto("/register", "10. Now a player. New account, with their Golf England ID.");
  await demo.type("#name", "Fiona MacLeod", { caption: "One lookup pulls the handicap index and home club from Golf England." });
  await demo.type("#email", "fiona.journey@golfday.app");
  await demo.type("#password", "golfday123");
  await demo.type("#ge", "GE100246");
  await demo.click(el.byText("Look up"), { settle: 900, caption: "Index and home club, straight from Golf England." });
  // Wait for the lookup to resolve rather than guessing at a settle time.
  for (let i = 0; i < 60; i += 1) {
    const state = await demo.page.evaluate(() => {
      const msg = [...document.querySelectorAll("p")].map((p) => p.textContent ?? "").find((t) => t.startsWith("Found") || t.includes("No golfer"));
      return { msg, hcp: document.querySelector("#hcp")?.value ?? "" };
    });
    if (state.msg && state.hcp) break;
    await sleep(250);
  }
  await demo.say("Found: index 14.9 at St Andrews Links - the organiser never types it in.");
  await sleep(1200);
  await demo.shot("player-register");
  await demo.click("button[type=submit]", { settle: 1500, caption: "Signed in as a player." });
  for (let i = 0; i < 60; i += 1) {
    if (!demo.page.url().includes("/register")) break;
    await sleep(250);
  }
  const stuck = await demo.page.evaluate(() => document.body.innerText.match(/[^\n]*(?:exist|incorrect|wrong|valid)[^\n]*/i)?.[0] ?? null);
  if (demo.page.url().includes("/register")) throw new Error(`registration did not complete: ${stuck ?? "no error shown"}`);
  await sleep(1200);

  await demo.goto("/events", "11. The fixture list. Entering is a join code, or the organiser adding you.");
  await demo.type('input[placeholder="A1B2C3"]', event.join_code ?? "ABC123", { caption: "Typing the six-character join code the organiser shared." });
  await demo.shot("join-by-code");
  // The join has to land before the group picker is useful, so drive it through
  // the component's own API and then film the page it produces.
  await demo.page.evaluate(async (code) => {
    await fetch("/api/events/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
  }, String(event.join_code));
  await demo.say("In the field. Now the event page for the day.");
  await demo.goto(`/events/${event.slug}`, "12. On the event page: their card, their group, the field.");
  await sleep(1200);

  // Requirement 4: the player chooses their own tee group. No admin involved.
  const groups = (
    await db.execute({ sql: "select id, name, tee_time from groups where event_id = ? order by sort_order", args: [event.id] })
  ).rows;
  const target = groups[groups.length - 1];
  await demo.say("Requirement four: the player marks their own tee group - no admin needed.");
  await demo.click("select.select", { settle: 700 });
  await demo.page.select("select.select", String(target.id));
  // Wait for the save to round-trip and the page to re-render with the new group.
  let settled = false;
  for (let i = 0; i < 40 && !settled; i += 1) {
    settled = await demo.page.evaluate((id) => document.querySelector("select.select")?.value === id, String(target.id));
    if (!settled) await sleep(250);
  }
  console.log("group picker settled:", settled, "into", target.name);
  await sleep(1400);
  await demo.shot("player-picks-group");

  await demo.goto("/dashboard", "13. Their own golf: today's round, their group, and the live board.");
  await demo.shot("player-dashboard");

  const fiona = (
    await db.execute({
      sql: `select ep.player_id, g.token as token, g.name as group_name, e.slug as slug, e.id as event_id
            from event_players ep
            join players p on p.id = ep.player_id
            join events e on e.id = ep.event_id
            left join groups g on g.id = ep.group_id
            where p.name = 'Fiona MacLeod' and e.id = ? limit 1`,
      args: [event.id],
    })
  ).rows[0];
  console.log("fiona:", fiona);
  if (!fiona?.token) throw new Error("Fiona did not end up in a tee group - the group picker failed.");


  await demo.goto(`/score/${fiona.token}`, `14. The ${fiona.group_name} scorecard link. Tap the number and the card saves.`);
  await sleep(1200);
  await demo.shot("scorecard");
  for (const [nth, caption] of [
    [4, "A par on the first - two points."],
    [3, "A birdie on the second - three points."],
    [5, "A bogey on the third."],
    [4, "And another par."],
  ]) {
    await demo.clickIn(
      (n) => {
        const grid = [...document.querySelectorAll('div[class*="sm:grid-cols-8"]')].pop();
        const buttons = grid ? [...grid.querySelectorAll("button")] : [];
        const b = buttons[n - 1];
        if (!b) return null;
        b.scrollIntoView({ block: "center" });
        const r = b.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      },
      { caption, settle: 1000, arg: nth },
    );
  }
  await demo.say("The top five on the right re-ranks as the card is filled in.");
  await sleep(1600);
  await demo.shot("scorecard-progress");

  await demo.goto(`/live/${event.slug}`, "15. The public leaderboard - the link anyone can watch.");
  await demo.shot("live-board");
  await demo.say("Now a score from the course, while this page is open...");
  await demo.page.evaluate(
    async (eventId, playerId) => {
      await fetch("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, playerId, holeNumber: 5, strokes: 3 }),
      });
    },
    event.id,
    fiona.player_id,
  );
  await demo.say("...and the board updates itself, in place, within two seconds. No refresh.");
  await sleep(3200);
  await demo.shot("live-board-updated");

  await demo.title("That is the whole day", "set up · enter · group · score · live board", 3600);
  await demo.stop(out);
}

try {
  await journey();
} catch (err) {
  console.error(err);
  process.exit(1);
}
