# Handicaps around the world: what we can integrate with

The short answer: **the country is usually not the thing that matters - the platform
is.** Since 2020 the World Handicap System has been adopted by 120+ countries, so most
"similar systems" are the *same* WHS maths and the same five or six software platforms,
just run by a different national union. GolfDay already speaks to four of them, and its
custom-endpoint source covers the rest without any code change.

This page is the survey: who runs what, how you get access, and what it would take in
GolfDay.

---

## The four families

Everything in the table below falls into one of these:

1. **DotGolf's WHS platform** - England, Scotland, Wales, Ireland (via the ISV API GolfDay
   already uses), New Zealand (DotGolf is wholly owned by Golf NZ and built the original
   centralised handicapping system), and South Africa's HNA, which migrated onto
   *DotGolf Global Systems* in 2026 and also serves Botswana, Eswatini, Lesotho, Malawi,
   Mozambique, Namibia, Tanzania, Zambia, Zimbabwe and the DRC.
2. **GolfBox** (CPG) - the Nordic/Baltic cluster: Denmark, Norway, Sweden, Finland,
   Iceland, Estonia, Latvia, Lithuania, plus Switzerland. It also implemented WHS in
   Australia alongside Golf Australia's own Golf Link product.
3. **National products with their own API** - GHIN (USGA), Golf Canada, Golf Australia
   (Golf Link), Golf Japan (JGA), Korea (KGA), India (IGU) and others.
4. **Federation/club software with no public API** - Germany (DGV, plus club systems such
   as PC CADDIE), France (FFGolf), Spain (RFEG), Italy (Federgolf), the Netherlands (NGF /
   Golf.nl). These are closed to clubs and their software partners; there is no endpoint a
   third party can sign up for.

## Country by country

Status key: **integrated** = a preset adapter with tests; **custom** = connect it today by
pointing the "Any other country / your own endpoint" source at an address your club or
union controls; **closed** = no third-party access, use a CSV export or ask the union.

| Country / region | System | Operator | Access | In GolfDay |
| --- | --- | --- | --- | --- |
| England, Scotland, Wales, Ireland | WHS platform | DotGolf | Club or union credentials, ISV API | **integrated** (`WHS`) |
| United States | GHIN | USGA / GHIN | Club login (email or GHIN #) + password; some clubs pair a token | **integrated** (`GHIN`) |
| Canada | Golf Canada | Golf Canada | Club login | **integrated** (`GOLF_CANADA`) |
| Australia | Golf Link | Golf Australia | Club API key | **integrated** (`GOLF_AUSTRALIA`) |
| New Zealand | DotGolf | Golf NZ (owns DotGolf) | Club credentials | **custom** - same platform family as WHS, so a base URL + credentials usually brings it up |
| South Africa + 10 neighbours | HNA Handicaps | Handicaps Network Africa (on DotGolf Global Systems since 2026) | Club-issued | **custom** |
| Denmark, Norway, Sweden, Finland, Iceland, Estonia, Latvia, Lithuania, Switzerland | GolfBox | CPG | Union/club accounts | **custom** (contract not confirmed) |
| Germany | DGV handicap | DGV + club software (PC CADDIE et al.) | Club software, no public API | **closed** - CSV import |
| France | Mon Espace Golf | FFGolf | Federation account | **closed** - CSV import |
| Spain | RFEG handicap | Real Federación Española de Golf | Federation/club | **closed** - CSV import |
| Italy | Federgolf handicap | Federgolf | Federation/club | **closed** - CSV import |
| Netherlands | Golf.nl handicap | NGF | Federation/club | **closed** - CSV import |
| Japan | JGA handicap | Japan Golf Association | Club/federation | **closed** - CSV import |
| Korea, India, UAE and most other WHS nations | National WHS database | Local union | Club-issued | **custom** if your club's system exposes anything, otherwise CSV |

"Closed" does not mean a player is stuck: they pick **Entered by hand**, **Society or
committee handicap** or **No handicap yet** and the golf day still runs. A lookup is an
offer, never a gate.

---

## What it actually takes to add one

GolfDay's overseas adapter (`src/lib/overseas.ts`) is a table entry plus, at most, a small
mapper. A new country needs five facts:

1. **The base URL** - `https://api2.ghin.com/api/v1`, `https://api.golfcanada.ca/v1`, ...
2. **How you authenticate** - a login that returns a bearer token, a static key, or an
   OAuth client-credentials flow.
3. **The lookup path** - `GET {base}/golfers/{number}` and any fallback.
4. **The payload shape** - the mapper is deliberately tolerant (it finds the index and the
   name under `golfer`, `data.golfer_user.golfer`, snake or camel case, inside arrays), so
   a new wrapper rarely needs code.
5. **Whether the organisation permits it** - the important one. Most of these systems are
   closed to clubs and their registered software partners. Reading them with a scraped
   login would breach their terms and mishandle personal data, so GolfDay will not do it.

If you have (1)-(3) for a country we have not listed, you have two options today, both
without a release:

* **Point the custom source at it.** Society page → **Handicaps** → *Any other country /
  your own endpoint*, then the base URL and an optional bearer key. Anything that answers
  `GET {base}/golfers/{id}` with a name and an index works.
* **Run a five-line proxy.** If the real API is chatty (login → token → two calls), put a
  tiny service in front of it that returns that one shape. `docs/INTEGRATIONS.md` has the
  contract.

When it is stable and you want it first-class, it becomes a preset: a name, a label, an
auth style, candidate paths and a default base URL - and it inherits everything else
(token caching, the 10-second timeout, the tolerant mapper, the 404-vs-error rules, and the
*Test lookup* button).

## The rule that does not change

An overseas answer records the player as **OVERSEAS and verified**; with no credentials
configured the same player stays **declared**. A lookup that cannot run reports 409, 502 or
504 - never "not found" - so a real handicap index is never quietly downgraded, and nothing
is ever invented.

---

## Sources

* DotGolf's appointment as WHS provider for England, Ireland and Wales, and its ownership
  by New Zealand Golf - [wgi.co.nz](https://wgi.co.nz/news/dotgolf-expands-international-reach).
* New Zealand's handicap platform - [aucklandgolfclub.co.nz](https://aucklandgolfclub.co.nz/what-is-a-handicap-in-golf/).
* GolfBox's WHS rollout across Australia, Sweden, Norway, Iceland, Estonia, Latvia,
  Lithuania, Denmark and Switzerland - [cpg.golf](https://cpg.golf/news/golfbox-successfully-activates-the-world-handicap-system-in-7-countries/).
* HNA as South Africa's authorised handicap provider, including its neighbours, and its
  2026 migration to DotGolf - [golfrsa.com](https://golfrsa.com/tag/handicap-network-africa/),
  [tee2pin.co.za](https://tee2pin.co.za/faq/).

Vendor names are used descriptively; no affiliation is implied. Contracts move - treat the
table above as a starting point for a conversation with the union or club, not as a
specification.
