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
   the national authority (England Golf) to clubs/software providers, and is keyed. In the
   UK and Ireland it is DotGolf's WHS platform, with an **ISV API** at
   <https://isvapi.whsplatform.englandgolf.org/> (Swagger) and per-club credentials
   (username + secret key, JWT bearer auth). The country is part of the path:

   | Nation | Union | Country code |
   | --- | --- | --- |
   | England | England Golf | `eng` |
   | Scotland | Scottish Golf | `sco` |
   | Wales | Wales Golf | `wal` |
   | Ireland | Golf Ireland | `irl` |

   The endpoints that matter here:

   * `GET /api/{country}/v1/club/members/{memberUID}/handicap` - a member's current index
   * `GET /api/{country}/v1/club/visitors/{memberUID}` - a **visitor's** index, which is the
     useful one for a society playing away from its home club
   * `POST /api/{country}/v1/scores` + `POST /api/{country}/v1/scorebatches` - returning
     the day's scores to the player's record

   There is no public open API and no published per-lookup price list: a club that is
   already on the platform can usually have credentials issued, and anything that looks up
   *other* clubs' members needs a partner arrangement with the union. Outside the UK/Ireland
   the equivalents are GHIN (USGA, US), Golf Canada and Golf Australia's Golf Link - all
   club/association credentialed in the same way.
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
that speaks your provider's SOAP/REST dialect) and nothing else in the app changes. With
the DotGolf platform that base is `https://isvapi.whsplatform.englandgolf.org/api/eng/v1`
and the key is the club's client token; the proxy is where you would map
`/golfers/{id}` onto `/club/visitors/{id}`. If the mode is `cdh` but the base or key is
missing, lookup fails loudly with `integration_not_configured` rather than quietly falling
back to demo data.

**Giving the choice to the organiser:** today the source is an app-wide env var. Making it
per-society (society A uses the club's CDH key, society B types handicaps in) is a column
on `societies` read by the same resolver - one function, so the app-side work is small; the
credential and the contract are the real cost.

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

---

## 3. Stripe payments and refunds

Entry fees are charged with **Stripe Checkout** and refunded with **Stripe Refunds**,
both over Stripe's REST API - there is no SDK and no webhook to host.

```
STRIPE_SECRET_KEY="sk_test_..."
```

### Taking the fee

The organiser sets a fee in the console's **Games** tab. A player then gets a *Pay entry*
button; `POST /api/events/[id]/payments/checkout` creates a Checkout Session and the
return leg (`…/payments/confirm?session_id=…`) re-reads the session from Stripe before
marking the entry paid - the query string alone proves nothing.

### Giving it back

The **Payments** tab has a *Refund* action per player, for the whole entry fee or part
of it (`POST /api/events/[id]/payments/refund`, organiser only):

* Card payments are refunded **against the PaymentIntent** (`POST /v1/refunds`), with
  `metadata[eventId]` / `metadata[playerId]` attached so the refund is traceable in the
  Stripe dashboard. The PaymentIntent is stored when Checkout completes; for older
  entries it is recovered from the Checkout Session on first refund.
* The amount is checked against **what is left of that payment**, not the fee, so a
  part-refund can be followed by another and a double refund is impossible
  (`409 already_refunded` / `400 refund_too_large`).
* Every refund is written to `payment_refunds` (amount, Stripe refund id, reason, who
  did it), and the entry moves to `PARTIALLY_REFUNDED` or `REFUNDED`. The organiser's
  collected figure is money taken **less** everything refunded.
* Cash / bank-transfer entries have no card to refund: the same ledger records them as
  returned by hand, so the books still add up.
* If Stripe has no PaymentIntent on file the API refuses (`409 no_payment_intent`)
  rather than pretending - refund it in the Stripe dashboard, then record it here.

Refunds made *in the Stripe dashboard* do not flow back into GolfDay (that would need a
webhook endpoint); use the console, or record the manual equivalent.
