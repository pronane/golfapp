# Making GolfDay pay for itself

A costed answer to "what does it cost to run, what should we charge, and does that
cover 1,000 / 2,000 / 5,000 / 10,000 active monthly users?"

Everything numeric here comes from one script —

```bash
npm run model:pricing          # the tables below
npm run model:pricing -- --json # the same numbers, machine-readable
```

— so the arguments can be re-run instead of trusted. Prices were fetched on
**2–3 November 2026**; competitor prices change, so each one is sourced below.

---

## The short version

| | |
| --- | --- |
| **Hosting is not the problem.** | A golf day costs **£0.008–£0.37** of hosting depending on the stack, i.e. **2p–37p per 19-player event**. At 10,000 active users the whole platform is **£9–£77 a month**, not thousands. |
| **The real cost is people.** | Tools + a modest support load (1 hour per 120 golf days) is **£38/month at 1,000 users and £250/month at 10,000** — 5–10× the hosting bill. That is what has to be covered. |
| **What to charge.** | The **organiser**, never the player: **£15 per golf day**, **£79/year per society**, **£249/year per club**, plus **£25/month sponsor slots**. Free stays genuinely usable. |
| **Breakeven is tiny.** | At any of these scales, **one or two paid golf days a month** covers the hosting outright. With support and tools counted, it takes about **three day passes a month** (or seven Society subscriptions) to break even at 1,000 users — and roughly the same at 10,000. |
| **Where to run it.** | Stay on **Render + Turso** while it is a demo and a side project (**£4–£40/mo**). Move to a **€4.35 Hetzner box** if you want the cheapest credible production home, or to **Cloudflare** only *after* the live board is ported from SSE to hibernating WebSockets — otherwise Cloudflare costs *more* than Hetzner at 10k (see §3). |
| **The trap to avoid.** | Vercel's free Hobby plan is **non-commercial**, so the moment you charge anyone, Vercel becomes **$20/month minimum**. That is the single switch that makes "free hosting" untrue. |

---

## 1. What the market charges

Prices as published, November 2026. The right-hand column is what a 19-player
society golf day actually costs on each — the number an organiser compares when
they are deciding.

| Product | Model | Published price | Cost of a 19-player golf day | Notes |
| --- | --- | --- | --- | --- |
| **Golf Genius** (TM Club) | annual | **$1,425/yr + $200 onboarding** | ~$118 if you run 12 days a year | The incumbent; 11k+ clubs; GHIN write-back. [perchgolf.com/compare](https://perchgolf.com/compare/), cites golfgenius.com/products/tm |
| **Golf Genius** (TM Premium) | annual | **$4,275/yr + $500 onboarding** | ~$356 | The tier that can take registration payments |
| **Golf Genius Flex** | per round, per player | **$2.00–$1.00** per round | **$19–$38** | Billed every week a league plays. [fareway.golf/compare](https://fareway.golf/compare/) |
| **HowDidiDo** (Club Systems) | per member, per year | **£2.99** app, **£9.99** ad-free; club **£1,400/yr** | £0 to the organiser | Website free with ads; the app is paid. [National Club Golfer, Jan 2026](https://www.nationalclubgolfer.com/club/news/howdidido-new-app-charges/) |
| **ScrambleSync** | per event | **$149/event**, Season **$790/yr**, Pro **$2,400/yr** | $149 | [scramblesync.com guide](https://scramblesync.com/guides/golf-tournament-software-cost) |
| **GolfStatus** | per event | **$299** (free for non-profits) | $299 | US, charity-outing focused, same source |
| **Birdease** | per event | **$299** | $299 | same source |
| **Golf League Guru** | per player, per year | **~$8.95** | ~$14 across 19 players | [fareway.golf/compare](https://fareway.golf/compare/) |
| **Fareway** | per registration | **$2–$6** | **$38–$114** | same source |
| **Squabbit** | free | **$0** | **£0** | No limits, 30+ formats, donation-supported. The real competitive threat. [App Store listing](https://mwm.ai/apps/squabbit-golf-tournament-app/1556538444) |

**What that tells us.** There is a chasm between "free" (Squabbit, HowDidiDo's
website, GolfDay's own demo) and "$1,400+ a year" (Golf Genius). Almost nobody
prices for a **society that runs six to twelve days a year and has no club
system, no committee and no procurement**. That is the gap — and it is exactly the
group the app has been built for (cash-first, no club needed, no app install, a
printed QR code on the buggy).

It also tells us what we must *not* do: charge players, or gate the leaderboard, or
take a cut of green fees. Those are how the incumbent gets resented.

---

## 2. What one golf day costs to run

Measured on this build — full 19-player field, 18 holes, live board open — plus a
model over it (`scripts/pricing-model.mjs`):

| Measure | Per golf day (19 players, 18 holes) |
| --- | --- |
| Score writes | 342 |
| HTTP requests | 685 |
| …of which live-stream connects/reconnects | 68 |
| Data transferred | 13.2 MB |
| Database rows read | 193k |
| Server CPU | 17 s |
| Live-board stream-minutes | 336 |

Byte counts are real, not guessed: the full leaderboard JSON is **21,895 bytes**,
the live page **51,003 bytes**, and an SSE connection sends **22,034 bytes** then
~34 bytes every two seconds as a keep-alive.

### Where the database load actually goes

| Source | Rows read / golf day | Share | What would cut it |
| --- | --- | --- | --- |
| Full leaderboard rebuild, once per score change, per open board | 179k | 93% | One rebuild per revision shared by every viewer (an in-process cache), or sending only the rows that changed |
| Revision poll every 2s per open board | 10k | 5% | A slower tick, or push instead of poll |
| Pages, cards, score writes | 4k | 2% | Nothing — this is the product |

This is the only part of the architecture that scales with **players × viewers**,
so it is the first thing to fix if usage ever grows 10×. Today it is fine: at
10,000 active users that is 203M rows a month, inside Turso's free 500M.

### Load, by active monthly users

"Active monthly user" here means somebody who scored, watched or organised at
least one golf day in the month. A society golfer plays about twice a month in
season; an organiser runs ~1.2 days a month for about half the year.

| MAU | Golf days / mo | Requests / mo | Egress / mo | Rows read / mo | Stream-hours / mo | Peak open boards | Organisers / yr |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | 105 | 72,105 | 1.4 GB | 20M | 589 | 69 | 175 |
| 2,000 | 211 | 144,211 | 2.7 GB | 41M | 1,179 | 139 | 351 |
| 5,000 | 526 | 360,526 | 6.8 GB | 102M | 2,947 | 347 | 877 |
| 10,000 | 1,053 | 721,053 | 13.5 GB | 203M | 5,895 | 695 | 1,754 |

Note how small those numbers are. Ten thousand active golfers is **721k requests a
month** — about 0.3 requests a second on average. Golf is a weekend, daytime,
good-weather business: the peak matters and the average does not.

---

## 3. Hosting: what it costs on each stack

Prices from **vercel.com/pricing**, **render.com/pricing**, **turso.tech/pricing**,
**developers.cloudflare.com/workers/platform/pricing** (all fetched 3 Nov 2026)
and Hetzner CX22 listings. £1 ≈ $1.30, €1 ≈ $1.09; VAT excluded.

### Monthly platform cost

| MAU | Vercel | Render | Cloudflare | Hetzner | Cheapest |
| --- | --- | --- | --- | --- | --- |
| 1,000 | $20.00 (£15.40) | $50.00 (£38.50) | $5.00 (£3.85) | $5.73 (£4.41) | Cloudflare |
| 2,000 | $20.00 (£15.40) | $50.00 (£38.50) | $6.79 (£5.23) | $5.73 (£4.41) | Hetzner |
| 5,000 | $20.00 (£15.40) | $75.00 (£57.75) | $16.98 (£13.07) | $5.74 (£4.42) | Hetzner |
| 10,000 | $27.56 (£21.22) | $100.00 (£77.00) | $33.95 (£26.14) | $11.43 (£8.80) | Hetzner |

What is in each bill:

| Stack | Build-up at 10,000 MAU |
| --- | --- |
| **Vercel** | Pro $20 + usage $7.56 (5,895 stream-hours of provisioned memory) + Turso £0 |
| **Render** | three 1 CPU / 2 GB services $75 (one per ~400 open streams, plus a standby) + Pro workspace $25 + Turso £0 |
| **Cloudflare** | Workers Paid $5 + $28.95 of Durable Object duration, because an SSE connection polling every 2s keeps the object awake |
| **Hetzner** | two CX22 boxes (2 vCPU / 4 GB / 40 GB / 20 TB) at €4.35 + 20% backups, plus Backblaze B2 for Litestream |

### Cost per golf day

| MAU | Vercel | Render | Cloudflare | Hetzner | Cheapest |
| --- | --- | --- | --- | --- | --- |
| 1,000 | £0.147 | £0.367 | £0.037 | £0.042 | £0.037 |
| 2,000 | £0.073 | £0.182 | £0.025 | £0.021 | £0.021 |
| 5,000 | £0.029 | £0.110 | £0.025 | £0.008 | £0.008 |
| 10,000 | £0.020 | £0.073 | £0.025 | £0.008 | £0.008 |

**Read that as: at £15 per golf day, hosting is 0.05–2.5% of the revenue from a
single paid day.** Hosting choice is a reliability and effort decision, not a
survival one.

### The cheaper alternatives, honestly

| Option | Cost at 10k MAU | What it actually requires | Verdict |
| --- | --- | --- | --- |
| **Hetzner CX22 + SQLite on disk + Litestream** | **£9/mo** | You run one box: Node, Caddy for TLS, Litestream to B2, `systemctl`. No autoscaling; a restart is downtime of seconds; you are the 3am phone call. | **Best value by a mile.** Do this when there is paying revenue and a person who likes servers. |
| **Cloudflare Workers + D1 + Durable Objects** (today's SSE) | £26/mo | Port the score APIs to Workers (Drizzle supports D1), replace libSQL with D1, put the stream in a Durable Object. | Only worth it *with* the WebSocket work below; otherwise it costs more than Hetzner. |
| **Cloudflare with WS + hibernation** | **£5/mo flat** | The same port, plus: replace SSE with WebSockets, use the Hibernation API, push on revision change instead of polling every 2s. | **Cheapest at any scale, and it removes the 300s serverless stream timeout.** This is the eventual destination if the live board gets rewritten. |
| **Render free → paid** | £38–77/mo | Nothing: it is what the demo runs on. Free instances sleep after 15 minutes, which is unacceptable for a paid product, so paid compute starts at $7 and realistic production at $25+. | Right answer for the next 12 months. |
| **Vercel** | £21/mo | Nothing at first — but Hobby is **non-commercial only**, so the day you charge, Pro is mandatory. Streaming responses also hit function duration limits and reconnect churn. | Fine for the marketing site and previews; the wrong shape for long-lived streams. |
| **Fly.io / Railway / Neon** | ~£10–£40 | Similar trade to Render/Hetzner. Not modelled here because their 2026 pricing pages were not verified in this pass — treat any number as unknown until checked. | Not recommended on unverified numbers. |

**Where to run it, stage by stage**

1. **Now (demo, no revenue):** Render free + Turso free. £0. Already live.
2. **First paying customers (~1k users):** Render 1 CPU / 2 GB + Turso free = **£4–£15/mo**. Do not
   move for money that small; move for reliability. Add the Pro workspace the first time the service
   restarts under a paying customer's round.
3. **Product with a few hundred a month of revenue (~5k users):** **Hetzner CX22 + Litestream** at
   **£9/mo** *if* somebody enjoys servers, otherwise Render at £58. This is where Vercel's
   stream-duration model starts to look like the wrong shape.
4. **If the live board is ever rewritten for real-time:** Cloudflare with **WebSockets and
   hibernation** at **$5/mo flat** beats everything, and the Durable Object also removes the 300-second
   serverless stream timeout that currently forces every viewer to reconnect ~54 times a round.

**Strategic risk worth writing down:** the Turso pricing page currently carries a
"Turso is joining Supabase" announcement. The schema is plain SQLite and
`src/db/push.ts` is a plain DDL runner, so moving to D1, a local file on Hetzner,
or Postgres + Drizzle is a driver change, not a rewrite — but it is a reason not to
depend on Turso-only features.

---

## 4. What to charge

### The principles

1. **The organiser pays; the player never does.** Golfers already pay a green fee,
   a sweep and a charity donation. A per-player charge kills the product.
2. **Cash stays free.** No payment may ever be forced — card entries are optional,
   and taking cash keeps costing the organiser nothing.
3. **The free tier is real.** One golf day a month, up to 12 players, live board,
   WhatsApp share, QR codes. A Sunday fourball with a mate's friends must work
   forever, unpaid, with no club and no handicap. That promise is the marketing.
4. **Price against the round of drinks, not against software.** £15 for a day is
   under 80p a player. Golf Genius is £1,425 a year.

### The tiers

| Plan | Price | Who it is for | What is included |
| --- | --- | --- | --- |
| **Free** | £0 | A fourball, a one-off, a curious organiser | 1 golf day a month, up to 12 players, live board, group scorecards, WhatsApp share, QR cart signs, Stableford + stroke play + scramble |
| **Day pass** | **£15 per golf day** | The annual outing, the stag do, the charity day | Up to 40 players, **email invitations**, flights, the **master scorecard** + audit trail, hide-the-board, sponsors, no GolfDay branding on the board |
| **Society** | **£79/year** (or £8/month) | The regular society: 6–12 days a year | Everything in Day pass, 12 golf days a year, up to 40 players each, season order of merit, society roster |
| **Club** | **£249/year** | A club or a big society running 20+ days | Unlimited golf days, up to 120 players, multiple organisers, sponsor logos on the clubhouse TV board, CSV exports, priority support |
| **Sponsor slot** | **£25/month** | A brand, a pro shop, a local brewery | A named sponsor on the free-tier live boards and the clubhouse screen |
| **Card entries** | **1% of entry fees** | Organisers who *choose* card payments | Optional. Cash, bank transfer and "pay the organiser" remain free forever |

### Sanity check against the market

| | GolfDay Day pass | GolfDay Society | Golf Genius Flex (19 players) | Golf Genius TM Club | Squabbit |
| --- | --- | --- | --- | --- | --- |
| Cost of one golf day | **£15** | £6.58 (79 ÷ 12) | $19–$38 | ~$118 (12 days/yr) | £0 |
| Cost for a 12-day season | **£79** (Society) | **£79** | $228–$456 | ~$1,425 | £0 |
| Email invitations | ✔ | ✔ | ✔ (higher tier) | ✔ | ✘ |
| Printed QR cart signs | ✔ | ✔ | partial | ✔ | ✘ |
| Works with no club or union membership | ✔ | ✔ | ✘ (GHIN-centric) | ✘ | ✔ |
| Cash entries, no payment required | ✔ | ✔ | ✘ (payments tier) | ✘ (payments tier) | ✔ |

Against Squabbit the honest answer is not price — it is that a society secretary
who wants the cards printed, the emails sent and the teams allocated before
Sunday is not comparing feature lists. **Sell the two hours of admin back, not the
leaderboard.**

---

## 5. Does it pay for itself?

Conversion is the only real assumption, so it is a dial with three settings:

- **lean** — 1 golf day in 50 pays £15; 1 organiser in 50 subscribes; no sponsors
- **steady** — 1 golf day in 20 pays £15; 1 organiser in 20 subscribes; 2 sponsor slots
- **sponsored** — same, plus 8 sponsor slots a month

### Revenue, GBP/month

| MAU | Mix | Revenue | Payers | Day passes | Subscriptions | Sponsors |
| --- | --- | --- | --- | --- | --- | --- |
| 1,000 | lean | **£72** | 6 | £32 | £30 | £0 |
| 1,000 | steady | **£230** | 17 | £79 | £76 | £50 |
| 2,000 | steady | **£410** | 32 | £158 | £152 | £50 |
| 5,000 | steady | **£949** | 77 | £395 | £380 | £50 |
| 10,000 | lean | **£720** | 60 | £316 | £304 | £0 |
| 10,000 | steady | **£1,849** | 151 | £790 | £759 | £50 |
| 10,000 | sponsored | **£1,999** | 157 | £790 | £759 | £200 |

Even the **lean** case — one golf day in fifty paying, one organiser in fifty
subscribing — clears £720 a month at 10,000 users.

### Does it cover the costs people forget?

Hosting is not the number that decides this. Tools and support are:

| Line | Cost |
| --- | --- |
| Domain and DNS | £0.83/month (~£10/year) |
| Transactional email (Resend) | £0–15/month (free to 3,000 messages, then ~£15) |
| Bookkeeping | £15/month, or a spreadsheet |
| Support time | 1 hour per 120 golf days at £25/hour |
| Card fees (Stripe 1.5% + 20p) | only on optional card entries — cash is free |
| VAT | not modelled below the £90k registration threshold |

| MAU | Hosting | Tools + support | Card fees | **Total cost** | Revenue (steady) | Left over | Cover |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1,000 | £4 | £38 | £2 | **£44** | £230 | £186 | 5.2× |
| 2,000 | £4 | £75 | £4 | **£84** | £410 | £327 | 4.9× |
| 5,000 | £4 | £140 | £11 | **£156** | £949 | £793 | 6.1× |
| 10,000 | £9 | £250 | £22 | **£281** | £1,849 | £1,568 | 6.6× |

### The smallest thing that pays for it

At **1,000 active users (£44/month all-in)**:

- **3 day passes a month** (£45), or
- **7 Society subscriptions** (£46/month of annual revenue), or
- **2 sponsor slots** (£50), or
- **1 Club + 1 Day pass** (£35.75), or
- **a 1-in-20 conversion at 1,000 users alone** (£79 of day passes + £76 of subscriptions).

At **10,000 active users (£281/month all-in)**: 19 day passes, or 43 societies, or
12 sponsor slots. Notice that the required paying share *falls* as the user base
grows, because support scales with golf days, not with hosting.

---

## 6. What would break this model

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| **Squabbit is free** | A determined organiser can always pay nothing | Sell admin time, printing, email and UK handicaps; make the free tier good enough to be word-of-mouth, not good enough to run a 40-person charity day |
| **Seasonality** | UK golf revenue lands April–September; hosting is flat | Annual subscriptions (Society/Club) smooth cash; the Day pass is the summer product |
| **Churn after the trip** | A society that plays one trip a year does not renew | That customer is a Day pass, not a Society — do not sell them a subscription |
| **VAT** | At £90k of turnover, 20% comes off the top | Not a problem until roughly 4,500 Society-equivalents; price is quoted inc-VAT and reviewed at the threshold |
| **Card fees** | 1.5% + 20p per entry eats small fees | Card is optional by design; cash and bank transfer are free |
| **Support is human** | One angry secretary on a Saturday morning costs an hour | Publish the FAQ, put the join code and the QR printing in the invite email, and keep the console boring |
| **Data protection** | Names, emails, handicaps, and possibly payment data | Already minimal (no payment data stored beyond Stripe ids); add a privacy page and a deletion request path before the first paid customer |
| **Hosting/platform shifts** | Turso's Supabase announcement; Vercel's non-commercial Hobby | Plain SQLite, plain SQL, no provider-specific features; the upgrade path is a driver swap |
| **The "free forever" promise** | Changing it later destroys trust | Free tier is a published commitment: 1 day a month, 12 players, all scoring formats, forever |

---

## 7. The code it takes to make this real

Small and unglamorous. Nothing here needs rewriting the app.

| # | Change | Where | Effort |
| --- | --- | --- | --- |
| 1 | `plan` + `plan_until` on `users` and `societies`; `plan` on `events` for a day pass | `src/db/schema.ts`, `schema.sql`, `ADDED_COLUMNS` (see `tests/schema-drift.test.ts` — it will catch a missed column) | S |
| 2 | A single `canUseFeature(plan, feature)` helper, so limits are stated once | new `src/lib/plan.ts` + unit tests | S |
| 3 | Enforce the limits: free = 1 live day/month and ≤12 players; day pass = ≤40; no email invites on free | `src/lib/events.ts`, `api/events/[id]/invites/route.ts`, `GamesConsole` (flights/master scorecard) | M |
| 4 | Billing: Stripe Checkout for Day pass/Society/Club, webhook-free verification on return (the pattern already used for entry fees in `src/lib/payments.ts`) | new `src/lib/billing.ts`, `src/app/admin/billing/page.tsx` | M |
| 5 | Sponsor inventory: a house sponsor slot on the free board, sold separately | `src/components/GamesPanels.tsx` (`SponsorStrip`) | S |
| 6 | Usage metering so the model above can be replaced with facts: events, players, emails, streams per month | new table + a counter in the stream and invite routes | M |
| 7 | A pricing page, and an honest "what is free" section that matches the code | `src/app/pricing/page.tsx` | S |

Two product decisions that cost nothing and raise conversion:

- **Put the organiser's name on the board** ("Run by Dave at Chiswick Park") —
  it is the only acquisition channel a society app has.
- **Ask for the email when the day is created**, because that is the moment the
  invitation batch becomes the reason to pay.

---

## 8. What I did not verify

- No paying customer, no checkout, no Stripe subscription has been run. Every
  revenue number is a scenario, not a result.
- Competitor prices are from their published pages and third-party comparisons on
  the dates cited; enterprise and association pricing is quoted privately and may
  be lower than list.
- Vercel's overage rate for Fast Data Transfer is quoted at **$0.15/GB** on the
  page fetched here; other 2026 write-ups quote $0.40/GB. The model never exceeds
  the included 1TB at these scales, so the difference does not change any total.
- Fly.io, Railway and Neon were **not** checked in this pass and are excluded from
  the tables rather than guessed at.
- The load model assumes 19-player fields, two rounds per active user per month,
  1.2 golf days per organiser per month and an organiser season of six months.
  Change them at the top of `scripts/pricing-model.mjs` and every table moves.
- Everything is modelled in pounds at £1 ≈ $1.30 and €1 ≈ $1.09, excluding VAT.
- **No load test was run.** The "how many open live boards fit on one 1 CPU service" figures (≈250–400)
  are engineering estimates from connection count and query rate, not a benchmark. Before charging
  anybody, run a few hundred concurrent SSE clients against a staging box and find the real number.
- Vercel's provisioned-memory charge assumes 512 MB per instance; Render's instance sizing assumes one
  1 CPU / 2 GB service per ~400 open streams. Both are stated so they can be argued with.
