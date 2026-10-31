# GolfDay

Live scoring, entries and leaderboards for golf days, outings and society meets.

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
├── tests            # vitest unit tests (scoring, handicaps, CSV import)
├── demo             # demo videos (narrated), recorder + mix scripts, cue sheets
└── docs             # hosting + integrations notes, screenshots
```

---

## Quick start

```bash
cd golfday
npm install
cp .env.example .env          # then set AUTH_SECRET to something long
npm run db:reset              # creates data/golfday.db, applies schema, seeds a demo
npm run dev                   # http://localhost:3000
```

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
npm test           # unit tests
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
* **Join code** so players can enter themselves, and **claim codes** so a guest player added by an organiser can later take ownership of their record.
* **Revisions + SSE** instead of websockets: every write bumps `event_state.revision`, the stream pushes the board when it changes. This keeps it serverless-friendly.

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
| GET | `/api/events/[id]/stream` | **SSE live leaderboard** (`?lite=1` for top 5) |
| GET | `/api/events/[id]/export` | CSV of the card |
| POST | `/api/events/[id]/admins`, DELETE `…/admins/[userId]` | manage admins/scorers |
| POST | `/api/scores` | enter a score (admin, the player, or a group token) |
| GET | `/api/groups/[token]` | group scorecard payload |
| GET/POST | `/api/courses`, `/api/courses/[id]` | library |
| GET | `/api/courses/search` | GolfCourseAPI + catalogue search |
| POST | `/api/courses/import` | save a provider course locally |
| GET/POST | `/api/players`, `/api/players/import`, PATCH `/api/players/me` | players, CSV import, handicap refresh |
| GET | `/api/golfengland/search` | handicap directory lookup |

---

## Free hosting

Short version: **Vercel (Hobby) + Turso (free)**, or **Cloudflare Workers/Pages + D1**.
Full comparison, limits and a step-by-step deploy runbook are in
[`docs/HOSTING.md`](docs/HOSTING.md). GolfCourseAPI and the Golf England CDH adapter are
covered in [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md).
