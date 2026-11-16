# GolfDay: competitor comparison and competitive checklist

*Reviewed 6 November 2026. Competitor prices below are from linked public pages
and may vary by country, currency, subscription, and in-app offer. “Unknown”
means no comparable public organizer-software price was found; it does not mean
free.*

## What GolfDay offers today

GolfDay targets golf days, outings, and societies: event setup, entries, groups
and tee times, live scoring and boards, handicap/course workflows, many
competition formats, societies and seasons, invitations, exports, entry
payments/refunds, and an installable web experience. It is stronger as an
organizer's event workflow than as a golfer's GPS, shot-tracking, or tee-time
marketplace app. The repo's price model is a proposal, not evidence that
customers have validated those prices.

## Alternatives

| Product | Free / paid offer and overlap | Where GolfDay can differentiate |
|---|---|---|
| [Golf Genius](https://www.golfgenius.com/) | Commercial tournament-management suite with live standings and broader club/event operations. No comparable public numeric organizer price was found on the reviewed pages. | A simpler path for a small society or one-off outing: create an event, enter a field, score, and share the board without adopting a full club platform. |
| [GolfStatus](https://golfstatus.com/) | Commercial charity-tournament operations including registration, payments, sponsorships/donations, communications, and leaderboards. Public pricing was not found; the site promotes a demo. | Focus on recurring society fixtures and everyday scoring; do not claim parity with fundraising operations. |
| [societyGolf](https://societygolf.co.uk/) | Direct UK society overlap: results/leaderboards, WHS and society handicaps, season reporting, tee draws, and society management are advertised. Public pricing was not found on the reviewed site. | Make onboarding, score entry, broad formats, data portability, and an easy parallel trial demonstrably better. |
| [Golfshot](https://golfshot.com/) | Golfer-facing GPS, scoring, handicap, statistics, and wearable features; Golf Genius integration is advertised. The US App Store listing is free to download and showed in-app prices from **$4.99 to $79.99**, plus a **$99.99** bundle; terms varied by item. | Complement a player's preferred GPS app with an organizer-run day, season, field, groups, and event board. |
| [Golf Pad](https://golfpadgps.com/) | Golfer GPS, scorecards, live leaderboard, offline maps, handicap, and group-play features. The US App Store listing is free to download and showed paid items from **$19.99–$49.99**; terms varied by item. | Lead with society/event operations and portable live scorecards, not GPS parity. |
| [GolfNow](https://www.golfnow.com/) | Primarily a tee-time discovery and booking marketplace in the reviewed consumer offer; tee times vary by course and time. No comparable society-management software price was found. | Serve the society after it has arranged its own outing; don't try to replace tee-time inventory or booking. |
| Spreadsheets, paper cards, WhatsApp | Common low-cost alternatives for a small outing; flexible, but the organizer must reconcile entries, groups, scores, and results manually. | Demonstrate a complete outing in one short setup, with live scoring and a shareable board on players' existing phones. |

Sources for GolfDay's described scope: [README](../README.md),
[integration guide](./INTEGRATIONS.md), [handicap systems](./HANDICAP-SYSTEMS.md),
and [proposed monetisation model](./MONETISATION.md).

## Competitive checklist

### Must prove before selling broadly

- [ ] Run pilots with both a one-off friends' day and a recurring society.
  Measure setup time, percentage of players who score on their own phone,
  corrections, completed cards, organizer effort, and repeat event creation.
- [ ] Publish customer-facing pricing and what's included. Keep hosting cost
  estimates distinct from the proposed £15/day, £79/year society, and
  £249/year club prices in the model; test willingness to pay before treating
  the model as a market fact.
- [ ] Make handicap provenance, course/tee setup, allowances, and score
  corrections easy to inspect. Give the organizer an auditable reconciliation
  view at the end of the day.
- [ ] Document what each national handicap integration actually supports,
  what credentials are required, and which systems are manual/CSV only.
- [ ] Validate rules and scoring with society organizers for the formats they
  actually run; have a visible correction and dispute process.

### Make switching low-risk

- [ ] Provide guided CSV templates and preview/import for player rosters,
  handicap indexes, courses, tee times, and fixtures; give row-level validation
  errors and a rollback-safe import.
- [ ] Add clear CSV exports for roster, event, scores, standings, and seasons so
  organizers can leave with their data.
- [ ] Make the first event useful without a society account, paid integration,
  Stripe account, or native app install. Keep card fees, cash handling, and
  optional integrations explicit.
- [ ] Improve score-entry resilience: retain pending scores visibly, retry
  transient failures, distinguish page-only storage from durable local storage,
  and test offline/reconnect and multi-round cases.
- [ ] Offer printable cards, QR links, and a readable clubhouse display as
  practical fallbacks when players' phones or signal fail.
- [ ] Prioritize the integrations requested by pilot organizers. Do not claim
  official federation access or automated data sync until it is approved,
  implemented, and exercised with real credentials.

### Avoid losing the product focus

- [ ] Do not try to outbuild Golfshot/Golf Pad GPS, GolfNow inventory, or the
  full Golf Genius/GolfStatus tournament and fundraising suites.
- [ ] Consider deeper fundraising, club accounts, or native apps only after
  pilots show repeat demand and the support/operations cost is understood.
- [ ] Protect organizers' and players' data with clear access controls, exports,
  retention rules, backups, and tested schema upgrades.

## How to win customers from alternatives

1. **Offer a parallel first event, not a forced migration.** Take one fixture
   from the society's existing system, import a roster where the society has
   permission to export it, and run GolfDay alongside the current workflow.
   Reconcile the final card and standings before asking anyone to switch.
2. **Target small societies and informal outings deliberately.** Lead with
   “run this Sunday four-ball” and the no-society path, then show how the same
   event can join a season later. Avoid competing for enterprise tournaments
   until those workflows exist.
3. **Make the organizer's setup the demo.** Use a real course card, a sample
   roster, automatic groups, a QR scorecard, and the live board. Count the
   minutes and hand-offs saved versus spreadsheet + messaging.
4. **Remove lock-in anxiety.** Provide a sample import, a downloadable export,
   transparent handicap provenance, and a human-assisted first migration. Do
   not scrape a competitor or copy private data; use customer-authorized
   exports.
5. **Coexist with player tools.** Let golfers keep Golfshot, Golf Pad, or
   GolfNow for GPS and tee times. Position GolfDay as the society's shared
   event, scorecard, and season layer.
6. **Convert with proof and honest pricing.** After a successful event, offer
   the next fixture or a short season trial with clear terms. Publish the
   customer price and payment fees up front; don't describe proposed prices as
   established or claim competitor pricing is hidden or excessive.
7. **Build referral loops around completed days.** Give organizers a branded
   shareable results page and an optional invitation for the next event; ask
   permission before using society names, logos, or testimonials.

## Public sources checked

- [Golf Genius](https://www.golfgenius.com/)
- [GolfStatus](https://golfstatus.com/)
- [societyGolf](https://societygolf.co.uk/)
- [Golfshot](https://golfshot.com/) and [US App Store listing](https://apps.apple.com/us/app/golfshot-golf-gps-range-finder/id622851626)
- [Golf Pad](https://golfpadgps.com/) and [US App Store listing](https://apps.apple.com/us/app/golf-pad-gps-range-finder/id446320556)
- [GolfNow](https://www.golfnow.com/)
- [GolfDay README](../README.md) and [monetisation model](./MONETISATION.md)
