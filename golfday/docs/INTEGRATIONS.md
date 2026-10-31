# Integrations: Golf England (WHS) and the course database

Both integrations are optional. With no keys configured GolfDay still works: it falls back
to a bundled course catalogue and a mock handicap directory.

---

## 1. Golf courses

### GolfCourseAPI.com (free tier)

* Free API key, no credit card, 10 requests/minute. Docs: <https://golfcourseapi.com>.
* Two endpoints are used:
  * `GET /v1/search?search_query=<text>` - search by club or course name
  * `GET /v1/getCourse/<id>` - full card with par, stroke index and tee ratings
* Header: `Authorization: Key <API_KEY>`.

Set the key in `.env`:

```
GOLF_COURSE_API_KEY="your-key"
# Optional, for self-hosted proxies / testing:
# GOLF_COURSE_API_URL="https://api.golfcourseapi.com/v1"
```

The organiser flow is: **Search** → pick a result → **Import** (which copies par, stroke
index, tees/slope/rating into the local `courses` + `course_holes` tables) → the event
snapshots that card into `event_holes`. Nothing at scoring time depends on the API, so a
rate limit or outage can never break a live round.

Requests are cached for 24 h (`next: { revalidate: 86400 }`) so the free rate limit is
never a problem in practice.

### Fallback catalogue

`src/lib/catalogue.ts` ships six real venues (St Andrews Old, Wentworth West, The Belfry
Brabazon, Walton Heath Old, Sunningdale Old, Celtic Manor Twenty Ten) with plausible par
and stroke-index cards. **These are demo values, not official cards** - the seed uses them
so the app is demo-able offline. Validate a card before running a real event.

### Adding a course by hand

Any event admin can create a course with a full 18-hole card: name, club, address, tee
name, slope, rating, and a par + stroke index for every hole. Stroke indexes must be
unique 1-18; the editor flags duplicates. The card is validated server-side
(`createCourseSchema`).

---

## 2. Golf England / WHS handicaps

**Short answer:** there is no public, unauthenticated England Golf API. What exists:

1. **WHS Centralised Handicap Database (CDH)** - the standard CDH web-service interface
   that clubs' handicap software uses to read/write handicap records. Access is granted by
   the national authority (England Golf) to clubs/software providers, and is keyed.
2. **Club handicap software exports** - every club system (ClubV1 / HowDidiDo, IG,
   HandicapMaster, Golf Genius) can export the handicap list as CSV/XLSX.
3. **iGolf** (for players without a club) - handicap lookup in the England Golf app, again
   not a documented public API.

So GolfDay implements three paths, all behind one interface in `src/lib/golfengland.ts`:

### a) CDH adapter (production path)

```env
GOLF_ENGLAND_MODE="cdh"
CDH_API_BASE="https://<your-cdh-endpoint>/v1"
CDH_API_KEY="<key>"
```

`lookupByGolfEnglandId(id)` calls `GET {CDH_API_BASE}/golfers/{id}`, expects
`{ name, handicapIndex, homeClub, country, gender, updatedAt }`, and normalises it. Point
`CDH_API_BASE` at whatever your club's provider exposes (or at a small proxy you control
that speaks your provider's SOAP/REST dialect) and nothing else in the app changes.

### b) CSV import (works today, no keys)

Organiser console → **Field → Import a CSV**. Headers are matched loosely, so any of these
work:

```
name, handicap, club, golf england id, email
Name,Handicap Index,Home Club,Golf England ID,Email
player name,hcp,cdh id
```

Quoted fields, CRLF and commas inside quotes are handled; rows with a bad handicap are
reported and skipped rather than silently imported. Importing a row with an existing Golf
England ID updates that player's handicap instead of duplicating them.

### c) Mock directory (demo)

`GOLF_ENGLAND_MODE="mock"` (the default) exposes ten fictional golfers through
`/api/golfengland/search`, so the "look up my handicap by GE ID" flow can be shown in a
demo without credentials. IDs look like `GE100241`.

### Handicap maths (all modes)

```
courseHandicap  = round(index × slope ÷ 113 + (rating − par))
playingHandicap = round(courseHandicap × allowance%)
shots received  = f(playingHandicap, stroke index)   // >18 and plus handicaps supported
```

A player's index is stored on their profile, snapshotted into `event_players` when they
enter, and can be refreshed from the dashboard ("Refresh from Golf England"). Changing an
event's allowance recalculates every playing handicap in it.

**Compliance note:** a handicap index is personal data. Handicaps are copied into the event
snapshot so a played round is reproducible; if you need to honour deletion requests, add a
hard delete in the admin console that also clears `event_players.handicap_index`.
