# GolfDay

Live scoring, entries and leaderboards for golf days, outings and society meets -
with Texas scrambles, society fixture lists, season orders of merit and real Stripe refunds.

GolfDay is a **new Next.js application that lives alongside the original Spring Boot /
React prototype in this repository** (see `../src`, `../reactSrc`). Nothing in the old
app was changed - this is a clean rebuild that covers the brief end to end, is free to
host, and ships with a small SQL database behind it.

```
golfday/
├── src/app          # Next.js App Router pages + REST API routes
├── src/components   # client components (score pad, live board, organiser console)
├── src/db           # Drizzle schema + raw SQL DDL + libSQL client
├── src/lib          # scoring, WHS handicaps, auth, catalogue, integrations
├── scripts          # db push + demo seed
├── tests            # vitest unit tests (scoring, scrambles, seasons, refunds, permissions)
├── demo             # demo videos (narrated), recorder + mix scripts, cue sheets
├── install          # the macOS/Linux and Windows installers + shared setup
├── e2e              # the browser click-through (npm run e2e)
└── docs             # install, hosting/public demo, integrations, handicaps around the world, screenshots
```

---

**Just want to run a golf day?** Start with
[`docs/GETTING-STARTED.md`](docs/GETTING-STARTED.md) - a plain-English walkthrough for a
secretary, from creating the society to the live board. The rest of this README is for
whoever deploys and maintains the app.

---

## Quick start

### The one-command install (macOS, Linux, Windows)

```bash
# macOS / Linux
./install/install.sh

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File install\install.ps1
```

It checks the machine for Node.js 20+ and installs a private copy if it is missing
(no admin rights, nothing system-wide), installs the dependencies, writes `.env` with a
generated `AUTH_SECRET`, creates the SQLite database and applies the schema from source,
seeds the demo, writes the start launchers, builds, and then **drives a real browser
through a complete golf day** as a final proof (15 steps: register, create a society,
create a day in the wizard, fill the field, allocate groups, score a card, watch the live
board). Screenshots of every step land in `e2e/artifacts/`.

Then: `./start-golfday.sh` (or `start-golfday.cmd`) and open <http://localhost:3000>.
Full details, flags and troubleshooting: [`docs/INSTALL.md`](docs/INSTALL.md).

### By hand

```bash
cd golfday
npm install
cp .env.example .env          # then set AUTH_SECRET (openssl rand -base64 48)
npm run db:reset              # creates data/golfday.db, applies schema, seeds a demo
npm run dev                   # http://localhost:3000
```

There is no database server to run: storage is libSQL/SQLite - one file, applied from
`src/db/schema.sql` by `npm run db:push`.

Demo accounts (all use the password `golfday123`):

| Account | Role |
| --- | --- |
| `admin@golfday.app` | Alex Morgan - owns all three demo events, site admin |
| `sam@golfday.app` | Sam Whitcombe - player, already on the course today |
| `priya@golfday.app` | Priya Raman - player |

Useful scripts:

```bash
npm run db:push    # apply schema (idempotent) - run against Turso in CI
npm run db:seed    # seed only if the database is empty
npm run db:reset   # wipe and reseed demo data
npm test           # 122 unit tests
npm run e2e        # the browser click-through (own database, own server)
npm run e2e:friends # the friends' day: no society, hand-typed course, cash entry
npm run setup      # env + schema + launchers + checks, no browser run
```

---

## Demo

Three narrated screen recordings live in [`demo/`](demo/README.md):

* **`demo/golfday-start-to-finish.webm`** (4:10) - the whole process in one unedited sitting:
  the organiser creates the golf day, types in a course card, fills the field, allocates tee
  groups and opens scoring; a player signs up with their Golf England ID, joins with the code,
  picks their own tee group, scores four holes and watches the public board update live. It also
  generates the step-by-step stills in [`docs/screenshots/journey/`](docs/screenshots/journey).
* **`demo/golfday-product-tour.webm`** (1:25) - landing page and live leaderboard, sign in,
  player dashboard, the organiser console (field, groups, card, admins), the course library,
  creating a golf day in the three-step wizard, and a player signing up with their Golf England ID.
* **`demo/golfday-live-scoring.webm`** (0:49) - the money shot: a four-ball entering scores on a
  phone next to the clubhouse leaderboard updating live, including a score correction. Two panes,
  one database, real clicks.

They are WebM (VP9 + Opus narration); `demo/README.md` has a one-line ffmpeg command to convert to
MP4 and the full script for all three. Static screenshots of every screen are in
[`docs/screenshots/`](docs/screenshots).

---

## What it does (mapped to the brief)

| # | Requirement | Where it lives |
| --- | --- | --- |
| 1 | Multiple players and users | `users` (logins) and `players` (golfing identity) are separate tables. Organisers can add a player who has no account yet; they claim it later with a claim code. |
| 2 | Players play in a golf day / outing | `events` + `event_players` registrations, with handicap snapshots per event. |
| 3 | Multiple outings, not at the same time | Registration refuses a second event on the same date (`player_clash`) unless an admin explicitly overrides. |
| 4 | Players mark their own group; an admin is assigned to the day | `event_admins` (OWNER / ADMIN / SCORER) and self-service group selection on the event page. Admins can auto-allocate four-balls and drag players between groups. |
| 5 | Optional to play in a match | `event_players.status` = REGISTERED / WAITLIST / WITHDRAWN. Being registered is never required to watch or administer. |
| 6 | A golf day is an event | Everything hangs off `events` (slug, join code, status, format, allowance, max field). |
| 7 | Many players ↔ many events | Many-to-many through `event_players`, unique per (event, player). |
| 8 | Many events at once, one player per course per date | Player clash check (one event per player per date) plus `findCourseClash` which warns if two flagged events overlap on the same course. |
| 9 | Courses from a free/open source | `src/lib/courseApi.ts` - GolfCourseAPI adapter (free tier, 10 req/min) with a bundled 6-course catalogue fallback so it works with no keys. |
| 10 | Course selected per event, or admin creates the 18 holes | Course library (`/admin/courses`) with a hole-by-hole editor (par + stroke index + tees/slope/rating); the card is snapshotted to `event_holes` so later edits never rewrite history. |
| 11 | Live leaderboard on every hole, separate link, top-3/5 in the scoring page | `/live/[slug]` is a standalone, shareable URL driven by Server-Sent Events. `/score/[token]` (the group card) shows a live top-5 alongside the score pad. |
| 12 | Golf England / WHS handicaps | `src/lib/golfengland.ts`: CDH lookup adapter + CSV import + mock directory, and per-player "refresh from Golf England". Course and playing handicaps are computed with the WHS slope formula. |
| 13 | Event admin creates everything | The organiser console (`/admin/events/[id]`) covers details, field, groups, card, admins, sharing and status. |

### Extras added beyond the brief

* **Stableford and net stroke play**, both with correct WHS course/playing handicap maths and stroke-index allocation (including handicaps over 18 and plus handicaps).
* **Audit trail** (`score_audit`) for every score change - important when a card is disputed.
* **Group sweep** (combined points per four-ball) and a colour-coded hole-by-hole grid.
* **CSV export** of the final card for the club noticeboard, plus CSV import for players.
* **Sign in with Google, Apple or Facebook** (optional, per deployment) as well as email and
  password. Linking is by verified email, an unverified one is refused, and a social sign-in
  creates a player - never an admin. See [`docs/SIGN-IN.md`](docs/SIGN-IN.md).
* **Join code** so players can enter themselves, and **claim codes** so a guest player added by an organiser can later take ownership of their record.
* **Revisions + SSE** instead of websockets: every write bumps `event_state.revision`, the stream pushes the board when it changes. This keeps it serverless-friendly.

### Formats, societies and seasons

* **Texas scramble** - a team card instead of four individual ones. Set the format when
  you create the day; each tee group is a team, a hole takes one gross score, and the
  team handicap is the England Golf scramble allowance (25/20/15/10 of the players'
  course handicaps, lowest first). The card also records **whose drive was used** on
  every hole, counts them and warns when a player still owes drives under the
  minimum-drives rule (four each in a four-ball). The live board, the clubhouse TV and
  the group scorecard all switch to team mode, and team cards keep their own audit trail.
* **Societies** (`/societies`) - create a club, share its six-character code, and get a
  roster with handicaps, a fixture list and seasons in one place. Roles are owner,
  secretary and member: owners and secretaries can add fixtures, manage the roster and
  create seasons; members can join and leave. A golf day created from a society page
  lands on that fixture list automatically, and a roster carries guest players who have
  no login yet. The field tab offers the roster in one click - **Enter N from the
  roster** - so the same regulars do not have to be searched and added one at a time
  every month (anyone full or already playing that day is skipped and reported, not
  silently dropped).
* **Two ways in, one app** - the home page offers *One day, a few friends* alongside
  *A whole season*, and the wizard defaults to **Me and my friends**, so a solo organiser
  never has to make a society, a roster or a club to run a Sunday fourball. A course that
  is not in the library is typed in (and saved), and an entry fee defaults to **cash on the
  day**: players are told to bring it, the organiser ticks people off in Payments, and a
  card button only appears if the organiser explicitly chooses card payments *and* the
  deployment has Stripe keys. `npm run e2e:friends` proves that path in a browser.
* **A handicap without a club** - a player can be WHS, iGolf, an overseas system (GHIN,
  Golf Canada, Golf Australia), a society handicap, typed in by hand, or have **no handicap
  yet** (scratch). Anyone can register and enter a golf day regardless; only a national
  lookup sets the "verified" tick, and organisers see which index was confirmed. See
  [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).
* **Per-society handicaps** - each club chooses where its indexes come from: typed in by
  hand, the GolfDay directory, the national WHS platform (England / Scotland / Wales /
  Ireland, via the DotGolf ISV API), an overseas system (GHIN, Golf Canada, Golf
  Australia) or the club's own CDH endpoint. Credentials are sealed
  with AES-256-GCM, never returned to a browser, and a **Test lookup** button proves the
  integration before a competition. An overseas answer marks the index verified; a
  lookup that cannot run reports 409/502/504 rather than pretending nobody was found.
  See [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md), and
  [`docs/HANDICAP-SYSTEMS.md`](docs/HANDICAP-SYSTEMS.md) for which other countries run the
  same kind of system and what connecting to each one takes.
* **Seasons and the order of merit** (`/seasons/<slug>`) - attach fixtures to a season and
  the table builds itself from the live boards. Positions score 100-90-80-75… down the
  field (or sum Stableford points instead), ties share the position, and a **best-N**
  rule can count only a player's best results while still showing everything played.
  Texas scramble fixtures count too: each team member earns the team's result.

### Games, money and the clubhouse screen

Set up in the organiser console's **Games** and **Payments** tabs.

* **Skins** (net or gross, carry-overs optional). A hole only settles once everyone who has started has scored it.
* **Nearest the pin / longest drive** on any hole. Measurements are entered on the group scorecard (feet / yards) and the leaders show on the board.
* **Better-ball pairs (4BBB)** - pair each tee group automatically (1+2, 3+4); each hole counts the better Stableford score.
* **Ryder Cup-style match play** - name the two teams, add singles or fourball matches (or auto-draw balanced singles). Strokes are taken off the low handicap in each match; the board shows each match ("2 UP thru 11", "3&2"), banked points and projected points.
* **Entry fees** - set a fee; with `STRIPE_SECRET_KEY` players get a "Pay entry" button (Stripe Checkout, verified with Stripe on return, no webhook needed). Organisers can always mark cash or bank transfers as paid.
* **Real refunds** - the Payments tab refunds a card entry **through Stripe** (`POST /v1/refunds` against the PaymentIntent), in full or in part, with a reason. The amount is checked against what is left of that payment, so a part-refund can be followed by another and a double refund is impossible. Every refund is kept in a ledger (`payment_refunds`), the entry moves to partially-refunded or refunded, and the "collected" figure is money taken less money given back. Cash entries are recorded the same way, by hand.
* **Sponsors** along the live board, and a **clubhouse TV mode** at `/live/<slug>?tv=1`: full-screen, big type, the leaderboard scrolls itself, games alongside, sponsors along the bottom.
* **Offline scoring** - with no signal, scores are kept on the phone ("3 saved on this phone · will sync") and sent automatically when the connection returns.

---

## Design notes

**Live updates.** Every mutation calls `bumpRevision(eventId)`. `/api/events/[id]/stream`
is an SSE endpoint that polls that single integer every 2s and pushes the full board when
it moves (plus a keep-alive comment). That is cheap on a serverless database, survives
cold starts, and works through the Vercel proxy. Clients flash the rows that changed.

**Handicaps.** `courseHandicap = round(index × slope ÷ 113 + (rating − par))`, then
`playingHandicap = round(courseHandicap × allowance%)`. Strokes are given lowest stroke
index first; plus handicaps give strokes back on the easiest holes. All of this is unit
tested in `tests/scoring.test.ts`.

**Card snapshots.** `event_holes` is a copy of the course card taken when the event is
created, so an admin fixing a stroke index in the library does not rewrite a played day.
Event admins can still amend their own day's card.

**Authorisation.** Site admins can do anything. Otherwise `event_admins` decides:
OWNER/ADMIN can edit the event, SCORER can only enter scores. A player can enter and
withdraw themselves and move themselves between groups. Group scorecards are accessed
with an unguessable token in the URL so a four-ball can score from one phone without
logging in.

---

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | cookie session (JWT, httpOnly) |
| GET | `/api/auth/me` | current user + player id |
| GET/POST | `/api/events` | list (`scope=public\|mine\|admin`) and create |
| GET/PATCH/DELETE | `/api/events/[id]` | event detail / edit / delete |
| POST | `/api/events/join` | enter by join code |
| POST/DELETE | `/api/events/[id]/players[/playerId]` | register / withdraw a player |
| GET/POST/PATCH | `/api/events/[id]/groups` | list, create, rename groups |
| POST/DELETE | `/api/events/[id]/groups/[groupId]` | add/remove a player, delete a group |
| POST | `/api/events/[id]/auto-groups` | balanced four-balls + tee times |
| PUT | `/api/events/[id]/holes` | amend the day's card |
| GET | `/api/events/[id]/leaderboard` | JSON leaderboard (polling fallback) |
| POST | `/api/scramble` | enter a Texas scramble team hole (group token, admin or team member) |
| GET | `/api/events/[id]/stream` | **SSE live leaderboard** (`?lite=1` for top 5) |
| GET | `/api/events/[id]/export` | CSV of the card |
| POST | `/api/events/[id]/admins`, DELETE `…/admins/[userId]` | manage admins/scorers |
| POST | `/api/scores` | enter a score (admin, the player, or a group token) |
| GET | `/api/groups/[token]` | group scorecard payload |
| GET/POST | `/api/courses`, `/api/courses/[id]` | library |
| GET | `/api/courses/search` | GolfCourseAPI + catalogue search |
| POST | `/api/courses/import` | save a provider course locally |
| GET/POST | `/api/players`, `/api/players/import`, PATCH `/api/players/me` | players, CSV import, handicap refresh |
| GET/POST | `/api/societies`, `/api/societies/join` | my societies, start one, join with a code |
| GET/PUT/POST | `/api/societies/[id]/integration` | handicap source + credentials (masked), and a live "test lookup" |
| GET/PATCH | `/api/societies/[id]` | society, roster and fixtures |
| POST/DELETE | `/api/societies/[id]/members` | add / remove a member (secretary tools) |
| POST/DELETE | `/api/societies/[id]/events` | put a golf day on the fixture list |
| GET/POST | `/api/seasons` | seasons (optionally by `?societyId=`) and create |
| GET/PATCH/DELETE | `/api/seasons/[id]` | order of merit table, edit, delete |
| POST/DELETE | `/api/seasons/[id]/events` | count a fixture in the season |
| POST | `/api/events/[id]/payments/refund` | refund an entry fee (full or partial, Stripe) |
| GET | `/api/golfengland/search` | handicap directory lookup |

---

## Free hosting

Short version: **Turso (free database) + Render or Vercel Hobby (free app)**, or **Cloudflare
Workers/Pages + D1**.

Want a link you can send to strangers, where they can create an account and run a day? That is
[`docs/PUBLIC-DEMO.md`](docs/PUBLIC-DEMO.md) - about fifteen minutes, £0/month, and it is honest
about what is mocked on a public demo (the federation handicap lookups unless you hold WHS
credentials, and card payments unless you add Stripe keys).

[`docs/HOSTING.md`](docs/HOSTING.md) has the provider-by-provider comparison; GolfCourseAPI and the
Golf England CDH adapter are covered in [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).

### GitHub, specifically

GitHub Pages cannot host the app - it serves files, and sign-up/sign-in/score entry are writes
behind a session cookie. GitHub can host the **recordings** (`Screenshots site` workflow →
`node demo/build-gallery.mjs`) and can **fill the demo database** (`Seed the demo database`
workflow → Turso, on demand or nightly). Both are already wired up.

### The demo database as a file

`seed/demo.sql` is the whole demo day (schema + 649 rows) in one diffable text file, for the hosts
that would rather be handed a database than a script:

```bash
turso db shell golfday-demo < seed/demo.sql   # build or reset a Turso database
npm run seed:import                            # …or whatever DATABASE_URL points at
npm run seed:dump                              # regenerate it from a seeded database
```

Health check: `GET /api/health` reports `{ ok, db, schema, players }` - it is what the Render
blueprint in [`render.yaml`](render.yaml) watches, and the first thing to read when a fresh deploy
shows an empty site (`schema: "empty"` means `npm run db:push` has not been run against that
database).
