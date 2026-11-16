/**
 * The outreach generator.
 *
 *   npm run outreach                      # both example emails (club + society)
 *   npm run outreach -- --type club \
 *     --name "Harrow GC" --contact "Sue"  # one ready-to-send email
 *   npm run outreach -- --md              # markdown instead of plain text
 *   npm run outreach -- --type society --name "..." --contact "..." --subject-only
 *
 * One place for the competitor comparison and the pitch, so the email that goes
 * to a club and the table in docs/OUTREACH.md cannot drift apart. The script
 * prints an email; it does not send anything - sending stays a human pressing
 * send, one real person at a time, because a mail-merge blast is how a small
 * product earns a spam rep before it earns a customer.
 *
 * Rules baked into every email (see docs/OUTREACH.md for why):
 *   - we say plainly that we are NOT replacing HowDidiDo / Golf Genius /
 *     ClubV1 - we run alongside them for society, charity and away days;
 *   - every competitor price carries its source and a "checked" date;
 *   - we never claim official handicap (CDH/WHS) submission - we don't have it;
 *   - players never pay to use the app, and cash is never forced online.
 *
 * Competitor prices, checked 3 November 2026 (sources in COMPETITORS below).
 */

const CHECKED = "3 November 2026";

/** Where each product actually sits - "level" is the honest one-line answer. */
const COMPETITORS = [
  {
    id: "golfday",
    name: "Golfday (us)",
    level: "Competition days, societies and charity days - not club membership",
    price: "Free / £15 per day / £79 a year per society / £249 a year per club",
    priceNote: "our published prices",
    source: "golfday",
  },
  {
    id: "golfnow",
    name: "GolfNow",
    level: "Finding and booking a tee time (marketplace) - no competitions",
    price: "Free for golfers; per-player booking fees in the US; UK clubs pay Golf Business Solutions (contact for price)",
    priceNote: "golfnow.co.uk, teetimego.com (fees)",
    source: "golfnow.co.uk, golfnow.com/business, teetimego.com",
    checked: "Nov 2026",
  },
  {
    id: "howdidido",
    name: "HowDidiDo (Club Systems)",
    level: "A club member's whole golf life - booking, handicaps, bills",
    price: "£2.99-£9.99 per member a year; club-wide about £1,400 a year",
    priceNote: "secondary sources, not the vendor's own page",
    source: "secondary sources",
    checked: "Oct 2026",
  },
  {
    id: "golfgenius",
    name: "Golf Genius TM",
    level: "Tournament management for clubs and associations",
    price: "TM Club about $1,425 a year + $200 onboarding; TM Premium $4,275 a year + $500 (live scoring is Premium only)",
    priceNote: "Premium price from golfgenius.com/products/tm; Club price is a secondary source",
    source: "golfgenius.com/products/tm + secondary",
    checked: "Nov 2026",
  },
];

/** Capability rows: what to say (and what to admit) about each product. */
const CAPABILITIES = [
  { label: "Built for", golfday: "Competition days & societies", golfnow: "Booking tee times", howdidido: "Club members", golfgenius: "Tournaments & leagues" },
  { label: "Live leaderboard", golfday: "Yes - every tier", golfnow: "No", howdidido: "Yes", golfgenius: "Premium tier only" },
  { label: "Score entry", golfday: "QR/WhatsApp, no app to install", golfnow: "Casual scorekeeping only", howdidido: "App, marker attestation", golfgenius: "App (Premium), GGID" },
  { label: "Entry fees", golfday: "Card or cash - players never forced online", golfnow: "n/a (tee-time payment)", howdidido: "In-app payments", golfgenius: "Registration + payments (Premium)" },
  { label: "Tee-time booking", golfday: "No - tee groups only", golfnow: "Yes - the core of it", howdidido: "Yes, home & away", golfgenius: "Open tee times (Premium)" },
  { label: "Official handicaps (CDH)", golfday: "Lookup only - never required", golfnow: "No", howdidido: "Yes, submitted overnight", golfgenius: "Yes - approved WHS ISV" },
  { label: "Club membership & billing", golfday: "No - by design", golfnow: "No (club ops tools sold separately)", howdidido: "Yes, via ClubV1/intelligentgolf", golfgenius: "Via club-system integration" },
  { label: "Getting started", golfday: "Minutes - paste the field, click", golfnow: "n/a for organisers", howdidido: "Club-configured", golfgenius: "Onboarding fee + training" },
];

const AUDIENCES = {
  club: {
    subject: (name) => `Running your ${name} charity/open days without the spreadsheet`,
    opener: (name, contact) =>
      `Hello ${contact},\n\nI'm getting in touch about the days at ${name} that sit outside your club system - your captain's day, the charity open, the away day - where the organiser ends up with a spreadsheet, a WhatsApp group and a shoebox of entry money.`,
    pitch:
      "Golfday runs those days: a public event page, entries with handicaps, tee groups with QR scorecards, a live leaderboard, printed cart signs and side games with settlement. Cash stays cash - players are never forced to pay online. Set-up is a form you can finish in a few minutes, or paste your whole field in at once.",
    audienceNote:
      "This is not a proposal to move your members off HowDidiDo or Golf Genius. Keep your club system for membership, tee sheets and official handicaps - Golfday sits alongside it for the events your system charges $149-299 a time to run, or doesn't cover at all.",
    cta: "You can run a real day free (one event a month, up to 12 players, every format) - no card details, and nothing your members have to sign up for.",
  },
  society: {
    subject: (name) => `${name} - the next golf day, minus the admin`,
    opener: (name, contact) =>
      `Hello ${contact},\n\nI'm writing to you as someone who organises golf for ${name} - the fixtures, the handicaps, the entry money and the group chats that go with them.`,
    pitch:
      "Golfday is built for societies like yours: create the day in a few minutes (or paste the whole field in one box), enter players with their handicaps, split them into four-balls, share one link, and watch the leaderboard update live while you play. Cash stays cash - players are never forced to pay online - and next month's day is a 'run it again' button.",
    audienceNote:
      "Societies are the gap the big systems don't price for: HowDidiDo and Golf Genius are built around a club's members, and GolfNow is for booking tee times, not running competitions. You don't have to leave anything behind to use Golfday.",
    cta: "Free to try: one day a month, up to 12 players, every format - and £79 a year if the society wants the extras (rosters, more days, bigger fields).",
  },
};

/** Plain-text table, because most email clients render markdown badly. */
function tableText(rows, columns) {
  const widths = columns.map((col) => Math.max(col.header.length, ...rows.map((row) => String(row[col.key] ?? "").length)));
  const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join("  ");
  return [line(columns.map((c) => c.header)), line(widths.map((w) => "-".repeat(w))), ...rows.map((row) => line(columns.map((c) => row[c.key] ?? "")))].join("\n");
}

function tableMarkdown(rows, columns) {
  const header = `| ${columns.map((c) => c.header).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((c) => row[c.key] ?? "").join(" | ")} |`);
  return [header, divider, ...body].join("\n");
}

function comparisonTable({ markdown = false } = {}) {
  const columns = [
    { key: "label", header: "What it does" },
    { key: "golfday", header: "Golfday" },
    { key: "golfnow", header: "GolfNow" },
    { key: "howdidido", header: "HowDidiDo" },
    { key: "golfgenius", header: "Golf Genius" },
  ];
  const rows = CAPABILITIES.map((row) => ({
    label: row.label,
    golfday: row.golfday,
    golfnow: row.golfnow,
    howdidido: row.howdidido,
    golfgenius: row.golfgenius,
  }));
  return markdown ? tableMarkdown(rows, columns) : tableText(rows, columns);
}

function priceBlock({ markdown = false } = {}) {
  const lines = COMPETITORS.map((c) => {
    const price = `${c.price} [${c.priceNote}]`;
    return markdown ? `- **${c.name}** - ${c.level}. ${price}. Checked ${c.checked ?? CHECKED}.` : `${c.name} - ${c.level}\n    ${price} (checked ${c.checked ?? CHECKED})`;
  });
  return lines.join("\n");
}

/**
 * Render one ready-to-send email.
 * @param {{ type: "club" | "society", name: string, contact?: string, markdown?: boolean }} options
 */
export function renderEmail({ type, name, contact = "there", markdown = false }) {
  const audience = AUDIENCES[type];
  if (!audience) throw new Error(`Unknown audience "${type}" - use "club" or "society"`);
  if (!name || !name.trim()) throw new Error("Give the club or society a name with --name");

  const comparison = comparisonTable({ markdown });
  const prices = priceBlock({ markdown });

  const parts = [
    `Subject: ${audience.subject(name.trim())}`,
    audience.opener(name.trim(), contact.trim()),
    audience.pitch,
    audience.audienceNote,
    `${markdown ? "### How we compare, honestly" : "How we compare, honestly:"}\n\n${comparison}`,
    `${markdown ? "### What it costs" : "What it costs:"}\n\n${prices}`,
    audience.cta,
    `Try it: ${DEMO_URL} - or reply to this email and I'll set up a day for you.`,
    `Prices checked ${CHECKED}. Golfday prices are ours; HowDidiDo and Golf Genius club prices are from published secondary sources and GolfNow does not publish club-side pricing - happy to be corrected on any of it.`,
    "-- sent by a person, not a mail-merge",
  ];
  return parts.map((part) => part.trimEnd()).join("\n\n");
}

const DEMO_URL = "https://golfday-demo.onrender.com";

/** The two canned examples, for docs/OUTREACH.md and `npm run outreach`. */
export function renderExamples({ markdown = false } = {}) {
  return [
    "================ CLUB ================",
    renderEmail({ type: "club", name: "Harrow Golf Club", contact: "Sue", markdown }),
    "",
    "================ SOCIETY ================",
    renderEmail({ type: "society", name: "the North London Golf Society", contact: "Dave", markdown }),
  ].join("\n");
}

// --- CLI -------------------------------------------------------------------
import { pathToFileURL } from "node:url";
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true;
  };
  const markdown = Boolean(flag("md"));
  const type = flag("type");
  const subjectOnly = Boolean(flag("subject-only"));

  if (!type) {
    process.stdout.write(renderExamples({ markdown }) + "\n");
    process.exit(0);
  }
  const email = renderEmail({ type: String(type), name: String(flag("name") ?? ""), contact: String(flag("contact") ?? "there"), markdown });
  process.stdout.write((subjectOnly ? email.split("\n")[0] : email) + "\n");
}
