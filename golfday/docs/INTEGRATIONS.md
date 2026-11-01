# Integrations: Golf England (WHS), overseas handicaps and the course database

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

## A handicap without a club

The national database is only *one* way to hold a handicap, and plenty of
golfers have none of it. Provenance is therefore a property of the **player**
(`src/lib/handicapProvenance.ts`), not of a club:

| Stored | Shown as | Official? | Lookup? |
| --- | --- | --- | --- |
| `WHS` | National WHS database | yes | yes - the only *verified* route |
| `IGOLF` | iGolf (no club needed) | yes | no |
| `OVERSEAS` | Another country's system (GHIN, Golf Canada, Golf Australia…) | yes, elsewhere | no |
| `SOCIETY` | Society or committee handicap | no - local | no |
| `MANUAL` | Entered by hand | no | no |
| `NONE` | No handicap yet - plays off scratch | no | no |

* **Nothing is blocked.** A player with `NONE` registers, is entered in a field,
  gets a playing handicap of 0 and scores normally; `tests/handicap-provenance.test.ts`
  proves that end to end. It is a documented state, not an error.
* **Only a lookup verifies.** `players.handicap_verified` is set by a national
  lookup and by nothing else, so an organiser can see at a glance whether an
  index was confirmed (`WHS ✓ verified`) or merely declared. Typing a new number
  clears the flag; so does changing the source.
* **The club setting is optional.** A society that picks *Typed in by hand*
  does no lookups at all - it is a convenience, not a requirement, and every
  player keeps their own declared handicap either way.
* **Where it is set:** register (a "Where does your handicap come from?" step),
  the player's profile card, and the organiser's *New guest player* form - so a
  secretary can enter a guest with a society handicap or no handicap at all.
* **Overseas systems** are recorded, with the federation/number in
  `players.handicap_note`, rather than pretending a GHIN index can be verified
  from here. Adding a provider later (GHIN, Golf Canada, Golf Australia) means
  one more entry in the lookup resolver, not a schema change.

## Per-society sources

A handicap source is chosen **per society**, because that is where the decision
belongs: one club has WHS credentials from its union, the next types numbers in
by hand, a third runs its own export endpoint. The default for everybody else is
the deployment environment.

| Source | What it means | Needs |
| --- | --- | --- |
| `MANUAL` | Nothing is looked up; organisers and players type the index in | nothing |
| `DIRECTORY` | Search players already in GolfDay (the ten-person demo directory) | nothing |
| `WHS` | The national WHS platform (DotGolf ISV API) | club username + secret, or a client token |
| `GHIN` | GHIN / USGA (United States) | club login + password (+ token if GHIN issued one) |
| `GOLF_CANADA` | Golf Canada | club login + password |
| `GOLF_AUSTRALIA` | Golf Australia / Golf Link | API key |
| `CDH` | Your own endpoint answering `GET {base}/golfers/{id}` | a URL (+ optional key) |

Set it on the club page → **Handicaps** (owner or secretary only): choose the
source, fill in the credential fields, **Save**, then **Test lookup** with a real
CDH/member ID. The test runs a live call with the saved configuration and reports
exactly what the provider said, which is the difference between a settings form
and an integration.

### a) WHS provider (`src/lib/whs.ts`)

The UK and Ireland WHS platform is DotGolf's. It is not public: a club (or its
software provider) is issued credentials, and every call carries a bearer token:

```
POST {base}/api/{country}/v1/account/token               {"clientToken": "..."} -> {accessToken, expiresIn}
GET  {base}/api/{country}/v1/club/visitors/{uid}         -> a visitor's handicap
GET  {base}/api/{country}/v1/club/members/{uid}/handicap -> a member's index
```

`{country}` is `eng`, `sco`, `wal` or `irl` - the same API serves all four
unions, so a Scottish club is one dropdown different, not one codebase different.
GolfDay defaults `{base}` to `https://isvapi.whsplatform.englandgolf.org` and:

* **visitor first**: a society day is usually played away from home, and the
  visitor endpoint is the one that answers; members fall back to the club
  handicap endpoint.
* **token caching**: the bearer token is reused until ~30 s before it expires,
  so a field of 40 is not 40 sign-ins.
* **a client token is used verbatim** when the union issued a signed one;
  otherwise GolfDay signs a short-lived HS256 assertion with the club username
  and secret (claims `sub`/`iss` = username, `aud` = `whs-isv-api`). If your
  union's onboarding pack specifies different claims, paste their client token
  into the token field instead - no code change needed.
* **honest failures**: 10 s timeout -> `integration_timeout` (504), rejected
  credentials -> `integration_unauthorised`, anything else -> `integration_error`.
  A misconfigured club never silently falls back to demo data.

Credentials are sealed at rest (`src/lib/secrets.ts`, AES-256-GCM with a key
derived from `AUTH_SECRET`), returned to clients only as "saved" plus a masked
hint, and are never logged. Rotating `AUTH_SECRET` invalidates them: the society
degrades to "not configured" until an owner re-enters the key, which is the
correct behaviour for a leaked secret.

**Deployment defaults** (used by anyone not in a configured society):

```env
GOLF_ENGLAND_MODE="mock"          # mock | whs | cdh | ghin | golfcanada | golfaustralia
WHS_COUNTRY="eng"
WHS_API_USERNAME=""
WHS_API_SECRET=""
# WHS_CLIENT_TOKEN=""             # a pre-signed client token, if you were given one
# WHS_API_BASE="https://isvapi.whsplatform.englandgolf.org"
# CDH_API_BASE="https://api.cdh.example.com/v1"
# CDH_API_KEY=""
```

### a1) Overseas providers: GHIN, Golf Canada, Golf Australia

An overseas member used to be stuck on "declared": their index is official, but
the national WHS platform does not know them. Nothing about that changes the
rule that **nobody is required to belong to a club or a union** - a lookup is an
offer, not a gate - but where a club *does* hold credentials, the same resolver
can now verify the number instead of taking it on trust.

| Provider | Country | Auth | Lookup |
| --- | --- | --- | --- |
| `GHIN` | USA | `POST {base}/golfers/login.json` with `{user:{email_or_ghin,password}, token}`, bearer thereafter | `GET {base}/golfers/{ghin}.json` |
| `GOLF_CANADA` | CAN | `POST {base}/auth/login` `{username,password}`, bearer thereafter | `GET {base}/golfers/{number}` |
| `GOLF_AUSTRALIA` | AUS | static API key in `Authorization: Bearer <key>` | `GET {base}/golfers/{GA number}` or `/handicaps/{id}` |

Default bases are `https://api2.ghin.com/api/v1`, `https://api.golfcanada.ca/v1`
and `https://api.golf.org.au/v1`, every one of which can be overridden on the
society page - these are partnership/client APIs rather than documented public
ones, so a provider moving a path is a settings change, not a release.

The adapter (`src/lib/overseas.ts`) is deliberately forgiving in two ways and
strict in a third:

* **tolerant reads** - the handicap and the name are found wherever they sit in
  the JSON (`golfer`, `data.golfer_user.golfer`, a one-element array, snake or
  camel case), so a new wrapper does not need a code change;
* **candidate paths** - each preset lists the paths that provider's own clients
  use and they are tried in order; a 404 moves on, so a guess that misses is not
  an error;
* **no silent "not found"** - a rejected login or lookup is a 502
  (`integration_unauthorised`), a 10 s silence is a 504 (`integration_timeout`),
  and a source with no credentials is a 409 (`integration_not_configured`). If
  the number comes back empty the index stays *declared*, because a failed
  lookup must never look like a verification.

Verified provenance is therefore earned: a `GHIN` / `Golf Canada` / `Golf
Australia` answer records the player as `OVERSEAS` **and** `handicapVerified =
true`; with no club credentials configured the same player records as declared
`OVERSEAS` and the organiser sees it.

**Deployment defaults**, if you would rather not configure it per society:

```env
GOLF_ENGLAND_MODE="ghin"            # mock | whs | cdh | ghin | golfcanada | golfaustralia
OVERSEAS_GHIN_USERNAME=""           # the club's GHIN login
OVERSEAS_GHIN_SECRET=""
# OVERSEAS_GHIN_CLIENT_TOKEN=""     # only if GHIN paired one with the login
# OVERSEAS_GHIN_API_BASE="https://api2.ghin.com/api/v1"

OVERSEAS_GOLF_CANADA_USERNAME=""
OVERSEAS_GOLF_CANADA_SECRET=""

OVERSEAS_GOLF_AUSTRALIA_SECRET=""   # the API key is all this one needs
```

**Unverified here:** these request shapes come from the providers' client
contracts, and neither the live handshake nor a real golfer's index can be
exercised from a sandbox with no egress. The request bodies, bearer handling,
token caching, 404-vs-error behaviour and payload mapping are pinned by
`tests/overseas.test.ts` against a stubbed `fetch`; the **Test lookup** button on
the society page is the live confirmation, and it should be pressed before the
first competition that depends on it.

### a2) CDH proxy provider

For a club whose software can expose a small REST endpoint, the contract is
`GET {base}/golfers/{id}` -> `{ name, handicapIndex, homeClub, country, gender,
updatedAt }`. Set that URL (and an optional bearer key) on the society page.
This is also the right place to put a proxy that speaks your provider's
SOAP/REST dialect, or maps a national URL onto your own.

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

### c) Demo directory

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
enter, and can be refreshed from the dashboard wherever the source is lookupable (WHS, or
an overseas system your club has credentials for). Changing an
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
