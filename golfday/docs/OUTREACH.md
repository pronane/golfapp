# Outreach: the club and society emails

A small generator for the emails we send to clubs and societies, so the pitch,
the competitor comparison and the prices all live in one place and cannot drift
apart between two documents.

```bash
npm run outreach                          # both example emails, plain text (send this)
npm run outreach -- --md                  # the same, as markdown
npm run outreach -- --type club --name "Harrow Golf Club" --contact "Sue"
npm run outreach -- --type society --name "the North London Golf Society" --contact "Dave"
npm run outreach -- --type club --name "..." --contact "..." --subject-only
```

The script **prints** an email. It does not send anything — sending stays a
person pressing send, one real recipient at a time. A mail-merge blast is how a
small product earns a spam reputation before it earns a customer, and every
recipient here is a human who runs golf for a living or for love.

## The position, in one paragraph

We are **not** asking anyone to leave HowDidiDo, Golf Genius or ClubV1. Those
systems run the club: membership, tee sheets, billing, official handicaps, and
they are wired in too deep for a sensible secretary to rip out. Golfday runs the
days those systems price out or don't cover well — society fixtures, captain's
days, charity opens, away days — for **£15 a day or £79 a year**, with players
never paying a penny to use it. And GolfNow is a different job again: it finds
you a tee time, it doesn't run a competition. A society can use GolfNow to book
the tee sheet *and* Golfday to run the day, and most should.

## The comparison table

Source of truth: `COMPETITORS` and `CAPABILITIES` in
[`scripts/outreach.mjs`](../scripts/outreach.mjs) — edit there, regenerate here.

| What it does | Golfday | GolfNow | HowDidiDo | Golf Genius |
| --- | --- | --- | --- | --- |
| Built for | Competition days & societies | Booking tee times | Club members | Tournaments & leagues |
| Live leaderboard | Yes - every tier | No | Yes | Premium tier only |
| Score entry | QR/WhatsApp, no app to install | Casual scorekeeping only | App, marker attestation | App (Premium), GGID |
| Entry fees | Card or cash - players never forced online | n/a (tee-time payment) | In-app payments | Registration + payments (Premium) |
| Tee-time booking | No - tee groups only | Yes - the core of it | Yes, home & away | Open tee times (Premium) |
| Official handicaps (CDH) | Lookup only - never required | No | Yes, submitted overnight | Yes - approved WHS ISV |
| Club membership & billing | No - by design | No (club ops tools sold separately) | Yes, via ClubV1/intelligentgolf | Via club-system integration |
| Getting started | Minutes - paste the field, click | n/a for organisers | Club-configured | Onboarding fee + training |

Prices, checked **3 November 2026**:

- **Golfday** — Free / £15 per day / £79 a year per society / £249 a year per
  club. *Our published prices.*
- **GolfNow** — Free for golfers; per-player booking fees in the US (GolfPass
  waives them); UK clubs buy Golf Business Solutions (tee sheet, marketing,
  dynamic pricing) at contact-for-price. *Sources: golfnow.co.uk,
  golfnow.com/business, teetimego.com.*
- **HowDidiDo (Club Systems)** — £2.99–£9.99 per member a year, club-wide about
  £1,400 a year. *Secondary sources, not the vendor's own page — flag it as such
  if a club quotes a different figure.*
- **Golf Genius TM** — TM Club about $1,425 a year + $200 onboarding *(secondary
  source)*; TM Premium **$4,275 a year + $500** *(golfgenius.com/products/tm)*.
  **Live scoring is Premium-only** — their own feature table says so.

## The emails

Generated with `npm run outreach` on 3 November 2026. Regenerate rather than
editing these — they are output, not source.

```text
================ CLUB ================
Subject: Running your Harrow Golf Club charity/open days without the spreadsheet

Hello Sue,

I'm getting in touch about the days at Harrow Golf Club that sit outside your club system - your captain's day, the charity open, the away day - where the organiser ends up with a spreadsheet, a WhatsApp group and a shoebox of entry money.

Golfday runs those days: a public event page, entries with handicaps, tee groups with QR scorecards, a live leaderboard, printed cart signs and side games with settlement. Cash stays cash - players are never forced to pay online. Set-up is a form you can finish in a few minutes, or paste your whole field in at once.

This is not a proposal to move your members off HowDidiDo or Golf Genius. Keep your club system for membership, tee sheets and official handicaps - Golfday sits alongside it for the events your system charges $149-299 a time to run, or doesn't cover at all.

How we compare, honestly:

What it does               Golfday                                     GolfNow                              HowDidiDo                        Golf Genius
-------------------------  ------------------------------------------  -----------------------------------  -------------------------------  ---------------------------------
Built for                  Competition days & societies                Booking tee times                    Club members                     Tournaments & leagues
Live leaderboard           Yes - every tier                            No                                   Yes                              Premium tier only
Score entry                QR/WhatsApp, no app to install              Casual scorekeeping only             App, marker attestation          App (Premium), GGID
Entry fees                 Card or cash - players never forced online  n/a (tee-time payment)               In-app payments                  Registration + payments (Premium)
Tee-time booking           No - tee groups only                        Yes - the core of it                 Yes, home & away                 Open tee times (Premium)
Official handicaps (CDH)   Lookup only - never required                No                                   Yes, submitted overnight         Yes - approved WHS ISV
Club membership & billing  No - by design                              No (club ops tools sold separately)  Yes, via ClubV1/intelligentgolf  Via club-system integration
Getting started            Minutes - paste the field, click            n/a for organisers                   Club-configured                  Onboarding fee + training

What it costs:

Golfday (us) - Competition days, societies and charity days - not club membership
    Free / £15 per day / £79 a year per society / £249 a year per club [our published prices] (checked 3 November 2026)
GolfNow - Finding and booking a tee time (marketplace) - no competitions
    Free for golfers; per-player booking fees in the US; UK clubs pay Golf Business Solutions (contact for price) [golfnow.co.uk, teetimego.com (fees)] (checked Nov 2026)
HowDidiDo (Club Systems) - A club member's whole golf life - booking, handicaps, bills
    £2.99-£9.99 per member a year; club-wide about £1,400 a year [secondary sources, not the vendor's own page] (checked Oct 2026)
Golf Genius TM - Tournament management for clubs and associations
    TM Club about $1,425 a year + $200 onboarding; TM Premium $4,275 a year + $500 (live scoring is Premium only) [Premium price from golfgenius.com/products/tm; Club price is a secondary source] (checked Nov 2026)

You can run a real day free (one event a month, up to 12 players, every format) - no card details, and nothing your members have to sign up for.

Try it: https://golfday-demo.onrender.com - or reply to this email and I'll set up a day for you.

Prices checked 3 November 2026. Golfday prices are ours; HowDidiDo and Golf Genius club prices are from published secondary sources and GolfNow does not publish club-side pricing - happy to be corrected on any of it.

-- sent by a person, not a mail-merge
```

```text
================ SOCIETY ================
Subject: the North London Golf Society - the next golf day, minus the admin

Hello Dave,

I'm writing to you as someone who organises golf for the North London Golf Society - the fixtures, the handicaps, the entry money and the group chats that go with them.

Golfday is built for societies like yours: create the day in a few minutes (or paste the whole field in one box), enter players with their handicaps, split them into four-balls, share one link, and watch the leaderboard update live while you play. Cash stays cash - players are never forced to pay online - and next month's day is a 'run it again' button.

Societies are the gap the big systems don't price for: HowDidiDo and Golf Genius are built around a club's members, and GolfNow is for booking tee times, not running competitions. You don't have to leave anything behind to use Golfday.

How we compare, honestly:

What it does               Golfday                                     GolfNow                              HowDidiDo                        Golf Genius
-------------------------  ------------------------------------------  -----------------------------------  -------------------------------  ---------------------------------
Built for                  Competition days & societies                Booking tee times                    Club members                     Tournaments & leagues
Live leaderboard           Yes - every tier                            No                                   Yes                              Premium tier only
Score entry                QR/WhatsApp, no app to install              Casual scorekeeping only             App, marker attestation          App (Premium), GGID
Entry fees                 Card or cash - players never forced online  n/a (tee-time payment)               In-app payments                  Registration + payments (Premium)
Tee-time booking           No - tee groups only                        Yes - the core of it                 Yes, home & away                 Open tee times (Premium)
Official handicaps (CDH)   Lookup only - never required                No                                   Yes, submitted overnight         Yes - approved WHS ISV
Club membership & billing  No - by design                              No (club ops tools sold separately)  Yes, via ClubV1/intelligentgolf  Via club-system integration
Getting started            Minutes - paste the field, click            n/a for organisers                   Club-configured                  Onboarding fee + training

What it costs:

Golfday (us) - Competition days, societies and charity days - not club membership
    Free / £15 per day / £79 a year per society / £249 a year per club [our published prices] (checked 3 November 2026)
GolfNow - Finding and booking a tee time (marketplace) - no competitions
    Free for golfers; per-player booking fees in the US; UK clubs pay Golf Business Solutions (contact for price) [golfnow.co.uk, teetimego.com (fees)] (checked Nov 2026)
HowDidiDo (Club Systems) - A club member's whole golf life - booking, handicaps, bills
    £2.99-£9.99 per member a year; club-wide about £1,400 a year [secondary sources, not the vendor's own page] (checked Oct 2026)
Golf Genius TM - Tournament management for clubs and associations
    TM Club about $1,425 a year + $200 onboarding; TM Premium $4,275 a year + $500 (live scoring is Premium only) [Premium price from golfgenius.com/products/tm; Club price is a secondary source] (checked Nov 2026)

Free to try: one day a month, up to 12 players, every format - and £79 a year if the society wants the extras (rosters, more days, bigger fields).

Try it: https://golfday-demo.onrender.com - or reply to this email and I'll set up a day for you.

Prices checked 3 November 2026. Golfday prices are ours; HowDidiDo and Golf Genius club prices are from published secondary sources and GolfNow does not publish club-side pricing - happy to be corrected on any of it.

-- sent by a person, not a mail-merge
```

## Sending rules

These are enforced by `tests/outreach.test.ts` where they can be, and by the
person pressing send where they can't:

1. **One real recipient at a time.** Change the name, the contact and the first
   paragraph. If it reads like a form letter, it is one.
2. **The "alongside" paragraph stays.** Every club email says plainly that we
   are not replacing HowDidiDo or Golf Genius. Deleting it to "sound more
   competitive" is how we end up in a fight we cannot win and do not need.
3. **Never claim CDH/official handicap submission, tee-time booking, or member
   billing.** We don't have them. The table admits it on purpose — admitting a
   gap is what makes the rest of the table believable.
4. **Prices keep their sources and dates.** If a club says "HowDidiDo doesn't
   cost that", the right answer is "you're probably right, ours is a secondary
   source — what does yours come to?" Update the script either way.
5. **Free tier first.** The ask is "run one real day free", not a demo call.
6. **No bought lists, no scraping, no automated sending.** The bot generates
   words; a human chooses who receives them.

## What the bot does not do

- It does not send email (no SMTP, no mail-merge, no scheduled blasts).
- It does not store recipients — put the name in when you run it.
- It does not know a club's actual competitor prices; it knows published ones,
  dated, and says so.

## Scheduled prospecting and reviewed delivery

For the shared local tool that discovers Away hostels and mapped GolfDay clubs,
prepares product-specific drafts, and attaches PDF fact sheets, use the
[Away + GolfDay outreach desk](https://github.com/pronane/hostelawaygo/tree/master/apps/outreach).
Its Windows Task Scheduler task prepares drafts only. Each message still needs
to be reviewed and approved before sending. Current GolfDay discovery uses
OpenStreetMap; searching the wider web for society directories needs a
separately chosen search provider.
