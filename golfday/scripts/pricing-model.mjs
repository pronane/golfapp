/**
 * The money model.
 *
 *   npm run model:pricing            # every table, markdown
 *   npm run model:pricing -- --json  # the same numbers as JSON
 *
 * One place for the assumptions and arithmetic behind `docs/MONETISATION.md`, so
 * the document's numbers can be regenerated (and argued with) instead of being
 * typed once and going stale.
 *
 * Everything is derived from a handful of measured facts about this app plus
 * published prices. Where a price is uncertain it is stated as a range and the
 * model uses the pessimistic end.
 *
 * Measured on this build (a seeded 19-player event, `next start`, local):
 *   - full leaderboard JSON   = 21,895 bytes
 *   - live page HTML          = 51,003 bytes
 *   - event page HTML         = 44,984 bytes
 *   - SSE: 22,034 bytes for the first board, then ~34 bytes every 2s keep-alive
 *
 * Published prices, fetched 2-3 November 2026:
 *   vercel.com/pricing            Pro $20/mo, $20 usage credit, 1TB Fast Data
 *                                 Transfer, $0.15/GB beyond, 1M invocations,
 *                                 $0.60/M beyond, $0.128/active-CPU-hour,
 *                                 $0.0106/GB-hr provisioned memory
 *   render.com/pricing            Hobby $0 (sleeps), $7 (0.5 CPU/512MB),
 *                                 $25 (1 CPU/2GB), Pro workspace $25/mo
 *   turso.tech/pricing            Free 500M rows read / 10M written / 5GB,
 *                                 Developer $4.99 (2.5B / 25M / 9GB),
 *                                 Scaler $24.92 (100B / 100M / 24GB)
 *   developers.cloudflare.com     Workers Paid $5/mo min, 10M requests then
 *                                 $0.30/M, 30M CPU-ms then $0.02/M, D1 25B rows
 *                                 read + 50M written then $0.001/M + $1.00/M,
 *                                 no egress charge, static assets free
 *   Hetzner CX22 (2 vCPU/4GB/40GB/20TB) ~€4.35/mo excl. VAT
 */

const FX_GBP_PER_USD = 0.77; // £1 ≈ $1.30; pessimistic for a GBP cost table
const USD_PER_EUR = 1.09; // €1 ≈ $1.09

/* ————— What one golf day costs the platform ————— */

/** A typical golf day in this app: a full tee sheet, 18 holes, live board. */
const EVENT = {
  players: 19,
  holes: 18,
  /** boards opened per player during the round (score pad + a few peeks) */
  boardSessionsPerPlayer: 2,
  /** minutes each board session stays open */
  boardSessionMinutes: 8,
  /** non-playing spectators watching the board, and their sessions */
  spectators: 4,
  spectatorSessions: 1,
  /** HTML/JSON bytes measured above */
  boardBytes: 21_895,
  pageBytes: 48_000,
  keepAliveBytesPerTick: 34,
  /** minutes from the first tee to the last card coming in */
  roundMinutes: 270,
  /** the stream ticks every 2s (src/app/api/events/[id]/stream/route.ts) */
  streamTickSeconds: 2,
  /** writes: one per player per hole */
  scoreWrites: 19 * 18,
  /** page loads: score pad, event page, board page, organiser console */
  pageLoads: 19 * 3 + 4 + 6,
  /** rows one leaderboard rebuild reads (scores + holes + settings + players) */
  rowsPerBoardBuild: 420,
  /** serverless hosts cut a streaming response at ~300s, forcing a reconnect */
  streamMaxSeconds: 300,
};

/** Requests, bytes, database rows and compute for one golf day. */
function perEvent(event = EVENT) {
  const sessions = event.players * event.boardSessionsPerPlayer + event.spectators * event.spectatorSessions;
  const streamSeconds = sessions * event.boardSessionMinutes * 60;
  const ticks = streamSeconds / event.streamTickSeconds;
  // Every revision change re-sends the whole board to every open stream. Only a
  // fraction of the sessions are open at any one moment: 42 eight-minute looks
  // spread across a four-and-a-half-hour round is about 1.2 streams at a time.
  const avgOpenStreams = Math.max(1, (sessions * event.boardSessionMinutes) / event.roundMinutes);
  const boardPushes = event.scoreWrites * avgOpenStreams;
  const sseBytes = sessions * event.boardBytes + boardPushes * event.boardBytes + ticks * event.keepAliveBytesPerTick;
  const pageBytes = event.pageLoads * event.pageBytes;
  const bytes = sseBytes + pageBytes;
  const streamRequests = Math.ceil(streamSeconds / event.streamMaxSeconds);
  const apiRequests = event.scoreWrites + sessions * 3 + 40;
  const requests = event.pageLoads + apiRequests + sessions + streamRequests;
  // The revision poll is one cheap query per tick; each board push is a rebuild.
  const rowsRead = ticks + boardPushes * event.rowsPerBoardBuild + requests * 6;
  // Active CPU: ~3ms per request, plus the stream's polling loop.
  const cpuMs = requests * 3 + ticks * 1.5;
  // Concurrent streams if every event on a busy Saturday ran at once (see below).
  return {
    sessions,
    ticks,
    boardPushes: Math.round(boardPushes),
    bytes,
    megabytes: bytes / 1_048_576,
    requests,
    streamRequests,
    rowsRead,
    cpuMs,
    cpuSeconds: cpuMs / 1000,
    streamSeconds,
  };
}

/* ————— How many golf days a user base implies ————— */

/**
 * "Active monthly user" = somebody who scored, watched or organised at least one
 * golf day in the month. A society golfer plays about twice a month in season.
 * An organiser runs ~1.2 golf days a month and stays an organiser for about half
 * the year, so the yearly organiser cohort is twice the monthly one.
 */
const USAGE = {
  roundsPerActiveUser: 2,
  eventsPerMonthPerOrganiser: 1.2,
  organiserSeasonMonths: 6,
  /** the share of a month's golf days that happen on the busiest weekend */
  peakShareOfMonth: 0.22,
  /** live boards open at once during a shotgun start */
  peakStreamsPerEvent: 3,
};

function loads(mau) {
  const participations = mau * USAGE.roundsPerActiveUser;
  const events = participations / EVENT.players;
  const organisersPerMonth = events / USAGE.eventsPerMonthPerOrganiser;
  const organisersPerYear = organisersPerMonth * (12 / USAGE.organiserSeasonMonths);
  const per = perEvent();
  const peakEventsInADay = events * USAGE.peakShareOfMonth; // across the busiest weekend
  return {
    mau,
    participations: Math.round(participations),
    events: Math.round(events),
    eventsPerPeakDay: Math.round(peakEventsInADay / 2),
    organisersPerMonth: Math.round(organisersPerMonth),
    organisersPerYear: Math.round(organisersPerYear),
    requests: Math.round(per.requests * events),
    gigabytes: (per.megabytes * events) / 1024,
    rowsRead: Math.round(per.rowsRead * events),
    streamHours: (per.streamSeconds * events) / 3600,
    cpuHours: (per.cpuSeconds * events) / 3600,
    peakConcurrentStreams: Math.round(peakEventsInADay * USAGE.peakStreamsPerEvent),
  };
}

/* ————— Hosts ————— */

const usd = (n) => Math.max(0, n);
const beyond = (value, limit, rate, per) => (value > limit ? ((value - limit) / per) * rate : 0);

/** Vercel Pro + Turso. No ops, and the priciest per stream. */
function vercel(l) {
  // A streaming response is billed on wall-clock: provisioned memory for every
  // second the stream is open, and active CPU for the work inside it.
  const memoryGbHours = l.streamHours * 0.5; // 512MB instances
  const cpuHours = l.cpuHours;
  const transferGb = l.gigabytes;
  const meters =
    beyond(l.requests, 1_000_000, 0.6, 1_000_000) +
    beyond(cpuHours, 4, 0.128, 1) +
    beyond(memoryGbHours, 360, 0.0106, 1) +
    beyond(transferGb, 1024, 0.15, 1) +
    beyond(l.requests, 10_000_000, 0.5, 1_000_000);
  const base = 20;
  const usageBilled = Math.max(0, meters - 20); // Pro includes $20 of usage
  const turso = l.rowsRead <= 500_000_000 ? 0 : l.rowsRead <= 2_500_000_000 ? 4.99 : 24.92;
  return {
    lines: { "Vercel Pro": base, "Vercel usage": usageBilled, Turso: turso },
    total: usd(base + usageBilled + turso),
    notes: [`${l.streamHours.toFixed(0)} stream-hours`, `${memoryGbHours.toFixed(0)} GB-hr memory`],
  };
}

/** Render + Turso: what the demo runs on today, scaled up honestly. */
function render(l) {
  // ~400 open streams per 1 CPU / 2GB service; a warm standby above 250.
  const peak = l.peakConcurrentStreams;
  const instances = peak <= 250 ? 1 : Math.ceil(peak / 400) + 1;
  const compute = instances * 25;
  const workspace = 25; // Render Pro: autoscaling, 25GB bandwidth, more services
  const turso = l.rowsRead <= 500_000_000 ? 0 : l.rowsRead <= 2_500_000_000 ? 4.99 : 24.92;
  return {
    lines: { "Render 1CPU/2GB": compute, "Render Pro": workspace, Turso: turso },
    total: usd(compute + workspace + turso),
    notes: [`${instances} service${instances > 1 ? "s" : ""}`],
  };
}

/**
 * Cloudflare Workers + D1. Two very different bills depending on whether the
 * live board is ported from SSE to hibernating WebSockets in a Durable Object:
 *
 *  - as SSE-in-a-DO (a poll every 2s keeps the object awake), duration is billed
 *    and the "Workers is $5" headline is wrong;
 *  - with WebSocket hibernation and push-on-change, idle boards cost nothing.
 */
function cloudflare(l, { hibernating = true } = {}) {
  const requests = l.requests;
  const cpuMs = l.cpuHours * 3_600_000;
  const rowsWritten = l.events * (EVENT.scoreWrites + 200);
  // Duration only while a Durable Object is awake: 128MB per object.
  const durationGbSeconds = hibernating ? l.requests * 0.05 * 0.128 : l.streamHours * 3600 * 0.128;
  const meters =
    beyond(requests, 10_000_000, 0.3, 1_000_000) +
    beyond(cpuMs, 30_000_000, 0.02, 1_000_000) +
    beyond(l.rowsRead, 25_000_000_000, 0.001, 1_000_000) +
    beyond(rowsWritten, 50_000_000, 1.0, 1_000_000) +
    beyond(durationGbSeconds, 400_000, 12.5, 1_000_000);
  return {
    lines: { "Workers Paid": 5, "Workers/D1/DO usage": meters },
    total: usd(5 + meters),
    notes: [hibernating ? "requires WS + hibernation" : "SSE as it is today, in a Durable Object"],
  };
}

/** One or two Hetzner boxes, SQLite on local disk, Litestream to Backblaze B2. */
function hetzner(l) {
  const boxes = l.peakConcurrentStreams <= 400 ? 1 : l.peakConcurrentStreams <= 900 ? 2 : Math.ceil(l.peakConcurrentStreams / 600) + 1;
  const cx22Eur = 4.35;
  const backupsEur = cx22Eur * 0.2; // Hetzner's backup option
  const storageGb = 5 + l.events * 0.002; // a golf day is ~2MB of rows
  const b2 = 0.006 * storageGb + 0.01;
  const total = (cx22Eur + backupsEur) * USD_PER_EUR * boxes + b2;
  return {
    lines: { [`Hetzner CX22 x${boxes}`]: Number(((cx22Eur + backupsEur) * USD_PER_EUR * boxes).toFixed(2)), Backblaze: b2 },
    total: usd(total),
    notes: [`${boxes} box${boxes > 1 ? "es" : ""}`, "you are the ops team"],
  };
}

const STACKS = { Vercel: vercel, Render: render, Cloudflare: (l) => cloudflare(l, { hibernating: false }), Hetzner: hetzner };

/* ————— What we charge ————— */

/** Prices in GBP, argued for in docs/MONETISATION.md. */
const PRICING = {
  dayPass: 15,
  societyYear: 79,
  clubYear: 249,
  /** optional share of card entry fees (organisers can always use cash) */
  entryFeeTake: 0.01,
  /** a local sponsor slot on the free-tier board, per month */
  sponsorSlotMonth: 25,
};

/**
 * Conversion is the only real assumption here, so it is a dial, not a forecast:
 * `paidEventShare` = share of golf days that pay a day pass,
 * `societyShare`   = share of the yearly organiser cohort on a subscription,
 * `sponsorSlots`   = sponsor slots sold.
 */
const MIXES = {
  /** One golf day in fifty pays; one organiser in fifty subscribes. */
  lean: { paidEventShare: 0.02, societyShare: 0.02, clubShare: 0.002, sponsorSlots: 0, avgEntryFee: 25 },
  /** One golf day in twenty pays; one organiser in twenty subscribes. */
  steady: { paidEventShare: 0.05, societyShare: 0.05, clubShare: 0.005, sponsorSlots: 2, avgEntryFee: 25 },
  /** Same conversion, plus eight sponsor slots a month. */
  sponsored: { paidEventShare: 0.05, societyShare: 0.05, clubShare: 0.005, sponsorSlots: 8, avgEntryFee: 25 },
};

function revenue(l, mix) {
  const dayPasses = l.events * mix.paidEventShare * PRICING.dayPass;
  const societies = l.organisersPerYear * mix.societyShare;
  const clubs = l.organisersPerYear * mix.clubShare;
  const subs = (societies * PRICING.societyYear + clubs * PRICING.clubYear) / 12;
  const sponsors = mix.sponsorSlots * PRICING.sponsorSlotMonth;
  // Only card entries produce this, and card is never required.
  const entries = l.participations * mix.avgEntryFee * PRICING.entryFeeTake * mix.paidEventShare;
  return {
    gross: dayPasses + subs + sponsors + entries,
    dayPasses,
    subs,
    sponsors,
    entries,
    payingOrganisers: Math.round(l.events * mix.paidEventShare + societies + clubs + mix.sponsorSlots),
  };
}

/* ————— Report ————— */

const MAUS = [1000, 2000, 5000, 10_000];
const gbp = (usdValue) => usdValue * FX_GBP_PER_USD;

function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const pad = (s, i) => String(s).padEnd(widths[i]);
  const line = (cells) => `| ${cells.map(pad).join(" | ")} |`;
  return [line(headers), `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`, ...rows.map((r) => line(r))].join("\n");
}

function report() {
  const per = perEvent();
  console.log("## What one golf day costs to run\n");
  console.log(
    table(
      ["Measure", "Per golf day (19 players, 18 holes)"],
      [
        ["Score writes", EVENT.scoreWrites],
        ["HTTP requests", Math.round(per.requests)],
        [" of which SSE connects/reconnects", per.streamRequests],
        ["Data transferred", `${per.megabytes.toFixed(1)} MB`],
        ["Database rows read", `${Math.round(per.rowsRead / 1000)}k`],
        ["Server CPU", `${Math.round(per.cpuSeconds)} s`],
        ["Live-board stream-minutes", Math.round(per.streamSeconds / 60)],
      ],
    ),
  );

  console.log("\n## Load, by active monthly users\n");
  console.log(
    table(
      ["MAU", "Golf days / mo", "Requests / mo", "Egress / mo", "Rows read / mo", "Stream-hours / mo", "Peak open boards", "Organisers / yr"],
      MAUS.map((mau) => {
        const l = loads(mau);
        return [
          mau.toLocaleString("en-GB"),
          l.events.toLocaleString("en-GB"),
          l.requests.toLocaleString("en-GB"),
          `${l.gigabytes.toFixed(1)} GB`,
          `${(l.rowsRead / 1e6).toFixed(0)}M`,
          l.streamHours.toFixed(0),
          l.peakConcurrentStreams,
          l.organisersPerYear.toLocaleString("en-GB"),
        ];
      }),
    ),
  );

  console.log("\n## Monthly platform cost, by stack\n");
  const costRows = [];
  const costGrid = {};
  for (const mau of MAUS) {
    const l = loads(mau);
    costGrid[mau] = {};
    for (const [name, fn] of Object.entries(STACKS)) {
      const c = fn(l);
      costGrid[mau][name] = c.total;
      costRows.push([
        mau.toLocaleString("en-GB"),
        name,
        `$${c.total.toFixed(2)}`,
        `£${gbp(c.total).toFixed(2)}`,
        Object.entries(c.lines)
          .map(([k, v]) => `${k} $${Number(v).toFixed(2)}`)
          .join(" + "),
      ]);
    }
  }
  console.log(table(["MAU", "Stack", "USD/mo", "GBP/mo", "Build-up"], costRows));

  console.log("\n## Cost per golf day (GBP)\n");
  console.log(
    table(
      ["MAU", ...Object.keys(STACKS), "Cheapest"],
      MAUS.map((mau) => {
        const l = loads(mau);
        const cells = Object.values(costGrid[mau]).map((v) => `£${(gbp(v) / l.events).toFixed(3)}`);
        return [mau.toLocaleString("en-GB"), ...cells, `£${(gbp(Math.min(...Object.values(costGrid[mau]))) / l.events).toFixed(3)}`];
      }),
    ),
  );

  console.log("\n## Revenue, GBP/month, by conversion\n");
  const revRows = [];
  for (const mau of MAUS) {
    const l = loads(mau);
    for (const [mixName, mix] of Object.entries(MIXES)) {
      const r = revenue(l, mix);
      const cheap = Math.min(...Object.values(costGrid[mau]));
      revRows.push([
        mau.toLocaleString("en-GB"),
        mixName,
        `£${r.gross.toFixed(0)}`,
        r.payingOrganisers,
        `£${r.dayPasses.toFixed(0)}`,
        `£${r.subs.toFixed(0)}`,
        `£${r.sponsors.toFixed(0)}`,
        `£${gbp(cheap).toFixed(0)}`,
        `${(r.gross / gbp(cheap)).toFixed(0)}x`,
      ]);
    }
  }
  console.log(
    table(["MAU", "Mix", "Revenue", "Payers", "Day passes", "Subscriptions", "Sponsors", "Cheapest cost", "Cover"], revRows),
  );

  console.log("\n## Breakeven: how little it takes to cover the platform\n");
  console.log(
    table(
      ["MAU", "Vercel £/mo", "Render £/mo", "Cheapest £/mo", "Day passes (Vercel / cheapest)", "Societies (Vercel / cheapest)", "Clubs (Vercel / cheapest)", "Paid events as % of events (cheapest)"],
      MAUS.map((mau) => {
        const l = loads(mau);
        const v = gbp(costGrid[mau].Vercel);
        const r = gbp(costGrid[mau].Render);
        const h = gbp(Math.min(...Object.values(costGrid[mau])));
        const passes = (cost) => Math.max(1, Math.ceil(cost / PRICING.dayPass));
        const societies = (cost) => Math.max(1, Math.ceil(cost / (PRICING.societyYear / 12)));
        const clubs = (cost) => Math.max(1, Math.ceil(cost / (PRICING.clubYear / 12)));
        return [
          mau.toLocaleString("en-GB"),
          `£${v.toFixed(0)}`,
          `£${r.toFixed(0)}`,
          `£${h.toFixed(0)}`,
          `${passes(v)} / ${passes(h)}`,
          `${societies(v)} / ${societies(h)}`,
          `${clubs(v)} / ${clubs(h)}`,
          `${((passes(h) / l.events) * 100).toFixed(1)}%`,
        ];
      }),
    ),
  );

  console.log("\n## Where the load actually goes, and the lever that moves it\n");
  {
    const rebuilds = Math.round(per.boardPushes);
    const tickRows = Math.round(per.ticks);
    const otherRows = Math.round(per.rowsRead) - rebuilds * EVENT.rowsPerBoardBuild - tickRows;
    console.log(
      table(
        ["Source", "Rows read / golf day", "Share", "What would cut it"],
        [
          ["Full leaderboard rebuild per score change per open board", `${Math.round((rebuilds * EVENT.rowsPerBoardBuild) / 1000)}k`, `${(((rebuilds * EVENT.rowsPerBoardBuild) / per.rowsRead) * 100).toFixed(0)}%`, "one rebuild per revision, shared by every viewer (an in-process cache), or sending only the rows that changed"],
          ["Revision poll every 2s per open board", `${Math.round(tickRows / 1000)}k`, `${((tickRows / per.rowsRead) * 100).toFixed(0)}%`, "a slower tick, or push instead of poll"],
          ["Pages, cards, score writes", `${Math.round(otherRows / 1000)}k`, `${((otherRows / per.rowsRead) * 100).toFixed(0)}%`, "not much: this is the product"],
        ],
      ),
    );
    console.log(
      `\nAt 10,000 MAU that is ${(loads(10_000).rowsRead / 1e6).toFixed(0)}M rows read a month, which is inside Turso's free 500M. ` +
        "The rebuild is the thing that scales with *players x viewers*, so it is the one to fix before it stops being free: " +
        "caching one board per revision would cut it roughly in proportion to how many people are watching the same board.",
    );
  }

  console.log("\n## Running costs that are not hosting\n");
  const OPEX = {
    "Domain and DNS": 0.83, // ~£10/yr
    "Transactional email (Resend)": 0, // free to 3,000/mo; £15 above
    "Bookkeeping software": 15,
    "Support (1 h per 120 golf days at £25/h)": 25 / 120,
    "Card fees (Stripe 1.5% + 20p)": 0, // modelled against revenue below
  };
  console.log(
    table(
      ["Line", "GBP/month", "Notes"],
      [
        ["Domain and DNS", "£0.83", "~£10/year for .co.uk or .com"],
        ["Transactional email", "£0-15", "Resend free to 3,000 messages/mo, then £15"],
        ["Bookkeeping", "£15", "or a spreadsheet, honestly"],
        ["Support time", "£0.21 per golf day", "1 hour per 120 golf days at £25/h"],
        ["Card fees", "1.5% + 20p", "only on optional card entries; cash is free"],
      ],
    ),
  );

  console.log("\n## Does it pay for itself? (GBP/month, with support and tools counted)\n");
  const opexFor = (l) => {
    const email = l.events * EVENT.players > 2500 ? 15 : 0;
    return 0.83 + email + 15 + (l.events / 120) * 25;
  };
  const payRows = [];
  for (const mau of MAUS) {
    const l = loads(mau);
    const cheapest = gbp(Math.min(...Object.values(costGrid[mau])));
    const opex = opexFor(l);
    const r = revenue(l, MIXES.steady);
    const cardFees = r.dayPasses * 0.015 + l.events * MIXES.steady.paidEventShare * 0.2;
    const totalCost = cheapest + opex + cardFees;
    payRows.push([
      mau.toLocaleString("en-GB"),
      `£${cheapest.toFixed(0)}`,
      `£${opex.toFixed(0)}`,
      `£${cardFees.toFixed(0)}`,
      `£${totalCost.toFixed(0)}`,
      `£${r.gross.toFixed(0)}`,
      `£${(r.gross - totalCost).toFixed(0)}`,
      `${(r.gross / totalCost).toFixed(1)}x`,
    ]);
  }
  console.log(
    table(["MAU", "Hosting (cheapest)", "Tools + support", "Card fees", "Total cost", "Revenue (steady mix)", "Left over", "Cover"], payRows),
  );

  console.log("\n## If the live board were ported from SSE to hibernating WebSockets\n");
  console.log(
    table(
      ["MAU", "Cloudflare today (SSE in a Durable Object)", "Cloudflare with WS + hibernation"],
      MAUS.map((mau) => {
        const l = loads(mau);
        return [`${mau.toLocaleString("en-GB")}`, `$${cloudflare(l, { hibernating: false }).total.toFixed(2)}`, `$${cloudflare(l, { hibernating: true }).total.toFixed(2)}`];
      }),
    ),
  );
}

if (process.argv.includes("--json")) {
  const out = MAUS.map((mau) => {
    const l = loads(mau);
    return {
      mau,
      load: l,
      cost: Object.fromEntries(Object.entries(STACKS).map(([k, fn]) => [k, fn(l)])),
      revenue: Object.fromEntries(Object.entries(MIXES).map(([k, mix]) => [k, revenue(l, mix)])),
    };
  });
  console.log(JSON.stringify({ perEvent: perEvent(), fx: { GBP_PER_USD: FX_GBP_PER_USD, USD_PER_EUR }, pricing: PRICING, result: out }, null, 2));
} else {
  report();
}
