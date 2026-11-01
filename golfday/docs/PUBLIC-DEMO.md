# Put a public demo online, free

You want a link you can send to a stranger where they can **create an account, sign in, look a
handicap up and run a golf day**. This page is how to get that for £0/month, what each free tier
actually costs you in behaviour, and what GitHub can and cannot do here.

## The short answer

**GitHub Pages cannot run this app.** Pages serves files and nothing else: no server, no
database, no cookies, no `POST`. Sign-up, sign-in and score entry are all `POST` requests that
write to a database and set a signed session cookie, so a Pages deployment could show the
screens and then do nothing when anyone taps a button. There is no "just point it at a JSON
file" version of that: the app *writes*, from several people at once, and a login is only real
if a server can verify the password hash and sign the cookie.

What GitHub *can* do, and what this repository now does, is two useful things:

| On GitHub | What it gives you |
| --- | --- |
| **GitHub Pages: the recordings** | `Screenshots site` workflow publishes the three films and the 24 journey stills as a page anyone can scroll. "What does it look like?" - answered, no server. |
| **GitHub Actions: the database** | `Seed the demo database` workflow applies the schema and loads the demo day into your free Turso database, on demand or nightly. |

The app itself needs **a server + a SQL database**, which is two free accounts:

| Piece | Where | Why this one |
| --- | --- | --- |
| Database | **Turso** (free) | It is libSQL - the same driver the app already uses (`@libsql/client`), so `npm run db:push` and the app run unchanged. Free: 100 databases, 5 GB, 500M row reads + 10M row writes a month, no card. |
| App | **Render** (free) *or* **Vercel Hobby** (free) *or* **Cloudflare Workers** (free) | Render: no licence restriction, but sleeps after 15 min idle. Vercel: instant and no cold start, but Hobby is **non-commercial use only**. Cloudflare: generous and commercial-OK, but needs the OpenNext adapter. |

Pick one row from each column. The fastest to a working link is **Turso + Vercel**; the one with
the fewest strings attached for a demo you might later use commercially is **Turso + Render**.

## The ten-minute version

1. **Turso** → *Create Database* → `golfday-demo` → copy the `libsql://` URL and create a token.
2. **Render** → *New → Blueprint* → pick this repository → **leave Blueprint Path blank** (the
   `render.yaml` at the repository root is the blueprint; it builds `golfday/`).
3. Paste the two values it asks for - `DATABASE_URL` and `DATABASE_AUTH_TOKEN`, both from the Turso
   dashboard. (`AUTH_SECRET` is not asked for: the blueprint uses `generateValue: true`, so Render
   invents a 256-bit secret itself.) Deploy.
4. Open `https://<service>.onrender.com` — the app creates its own tables and loads the demo day
   on the first boot (`AUTO_PUSH_SCHEMA=1`, `DEMO_AUTOSEED=1` in the blueprint), so there is no
   `db:push` step and nothing to run locally. Sign in with `admin@golfday.app` / `golfday123`.

`https://<service>.onrender.com/api/health` should say `{"ok":true,"db":"up","schema":"ready","players":18}`.
The rest of this page is the same thing with the reasoning, plus the options that are not Render.

---

## 1. The database: Turso (5 minutes)

You can do all of this in the dashboard at [app.turso.tech](https://app.turso.tech) - *Create
Database*, then *Create Token* - and skip the CLI entirely. The CLI equivalent:

```bash
curl -sSfL https://get.tur.so/install.sh | bash   # or: brew install tursodatabase/tap/turso
turso auth signup                                  # GitHub login, no card
turso db create golfday-demo lhr                   # lhr, fra, iad ... pick a region
turso db show golfday-demo --url                   # → libsql://golfday-demo-<org>.turso.io
turso db tokens create golfday-demo                # → DATABASE_AUTH_TOKEN (copy it once)
```

**On Render you can skip this section entirely** - the blueprint sets `AUTO_PUSH_SCHEMA=1` and
`DEMO_AUTOSEED=1`, so the first boot creates the tables and loads `seed/demo.sql` itself. Fill the
database by hand when you are deploying somewhere else (Vercel, Cloudflare, your own box), or when
you want to reset a demo that strangers have been playing with:

Then fill it, either from a checkout of this repository:

```bash
cd golfday
export DATABASE_URL="libsql://golfday-demo-<org>.turso.io"
export DATABASE_AUTH_TOKEN="<the token>"
npm ci
npm run db:push     # applies src/db/schema.sql (idempotent)
npm run db:reset    # the demo day: 3 golf days, accounts, a live board
```

...or, if you would rather not point Node at production, from the dump that lives in the
repository. `seed/demo.sql` is the whole demo day as text - schema plus 649 rows - so it is one
command and needs no environment at all:

```bash
turso db shell golfday-demo < golfday/seed/demo.sql
```

It drops and rebuilds every table before loading, which is also how you put a public demo back to
normal after strangers have been poking at it. `npm run seed:dump` regenerates the file from
whatever `DATABASE_URL` points at, and a test (`tests/demo-sql.test.ts`) replays it to prove the
file still matches the schema.

Either way, the **Seed the demo database** workflow does the same thing from GitHub (secrets:
`DATABASE_URL`, `DATABASE_AUTH_TOKEN`, optional variable `DEMO_URL`) - or nightly, if you keep the
schedule in `.github/workflows/demo-db.yml`.

Check it worked: `turso db shell golfday-demo "select count(*) from players"` should be 18.

## 2. The app: Render (free, sleeping)

This repository carries a blueprint at the root: **`render.yaml`** (it builds `golfday/`, and the
app bootstraps its own database - see `src/lib/bootstrap.ts`).

1. Render dashboard → **New → Blueprint** → pick `pronane/golfapp`. Leave **Blueprint Path**
   blank: it reads `render.yaml` from the repository root (root directory `golfday`,
   `npm ci --include=dev && npm run build`, health check `/api/health`).
2. Fill in the two secrets it asks for:
   - `DATABASE_URL` - the `libsql://` URL, from the Turso dashboard
   - `DATABASE_AUTH_TOKEN` - the Turso token (Turso dashboard -> your database -> **Tokens** ->
     **Create Token**, or `turso db tokens create golfday-demo`)

   `AUTH_SECRET` is **not** asked for: the blueprint declares it with `generateValue: true`, so
   Render invents a random 256-bit value at provision time and it never touches git, a terminal,
   or a chat window. `APP_URL` is not asked for either: Stripe return links and OAuth redirects use
   the request's own origin. Set it by hand only behind a proxy or on a custom domain.

   To rotate `AUTH_SECRET` later, generate a new value and paste it in the service's Environment
   tab (`openssl rand -base64 48`, or any 32+ character random string). Rotating it signs everybody
   out, which is the point of rotating it.
3. Deploy. First build takes a few minutes, and the first boot prints
   `[bootstrap] schema+seed - 18 players` in the logs.

Free-service behaviour, so nobody is surprised: it **sleeps after 15 minutes without traffic**
and takes ~30-60 seconds to wake (the visitor sees Render's loading page), it gets 750 instance
hours a month (enough for one service used during working hours), and it has no persistent disk -
which is exactly why the database is Turso and not a file.

### What URL do I get?

The blueprint names the service `golfday-demo`, so the URL is
**`https://golfday-demo.onrender.com`** - unless that name is already taken, in which case Render
adds a suffix (for example `golfday-demo-ab12.onrender.com`) and says so on the service page. The
address is at the top of the service's dashboard page, under its name, with a copy button.

### Or: Vercel Hobby (free, instant)

```bash
npm i -g vercel
cd golfday && vercel link
vercel env add DATABASE_URL production
vercel env add DATABASE_AUTH_TOKEN production
vercel env add AUTH_SECRET production
vercel env add APP_URL production
vercel --prod
```

No cold starts, 100 GB transfer and 1M function invocations a month. The catch is a licence one:
Vercel's fair-use rules restrict **Hobby to non-commercial personal use**. A free public demo is
fine; if GolfDay ever takes money through it, that is a Pro plan requirement - use Render or
Cloudflare instead.

### Or: Cloudflare Workers (free, commercial-OK)

`@opennextjs/cloudflare` runs the whole app on the Workers runtime; pair it with Turso (over
HTTP) or move to D1 and swap the driver in `src/db/client.ts`. Free tier: 100k requests/day, no
egress charges, commercial use allowed. More setup than the two above - see the alternative
section in `docs/HOSTING.md`.

## 2b. What "the app sets itself up" means

Two switches, both set in the blueprint and both off by default:

| Variable | What it does | Safe to leave on? |
| --- | --- | --- |
| `AUTO_PUSH_SCHEMA=1` | On boot, if the `users` table is missing, apply `src/db/schema.sql` (idempotent DDL) | Yes - it only ever creates |
| `DEMO_AUTOSEED=1` | ...and if the database has **no accounts at all**, load `seed/demo.sql` | Yes for a demo - it never runs on a database that has any accounts |

Nothing here deletes anything, which is why *resetting* a demo is still a deliberate act (next
section) rather than something a restart can do by accident. For a deployment that will hold real
golf days, set `DEMO_AUTOSEED=0` (and probably `AUTO_PUSH_SCHEMA=0`, running `npm run db:push`
yourself).

## 3. A demo that can be reset

A public demo collects debris fast: test accounts, half-built days, cards with one hole in them.
Two ways to keep it presentable:

* **Nightly reset** - the workflow already runs on a schedule (`04:17 UTC`) with `db:reset`. Turn
  it off by deleting the `schedule:` block, or press **Run workflow** whenever you like.
* **A second database** - keep `golfday-demo` for the public link and a private `golfday` for
  real use. Turso's free tier gives you 100 of them.

Say so on the demo page. The sign-in screen already lists the demo logins
(`admin@golfday.app` / `sam@golfday.app` / `priya@golfday.app`, password `golfday123`), which is
what makes a stranger's first 30 seconds work.

## 4. What a visitor can actually do

| Works on the demo | Notes |
| --- | --- |
| Create an account, sign in, sign out | Email + password; bcrypt hashes, JWT cookie. Social sign-in only appears if you add OAuth keys. |
| Create a golf day for friends (no society) | Including typing a course card in by hand, which is saved to the library. |
| Create a society, season, order of merit | Anyone who visits can; that is the point of a demo. |
| Enter scores, watch the live board | Each four-ball gets its own `/score/<token>` link - no login on the course. |
| Cash entry fees, mark paid, part-refund | Cash is the default; no Stripe keys needed. |
| Card payments | Off unless you set `STRIPE_SECRET_KEY`. Leave it off on a public demo. |

| Not real on the demo | Why |
| --- | --- |
| **Golf England / WHS / GHIN lookups** | `GOLF_ENGLAND_MODE=mock` returns plausible stand-in data. The live DotGolf ISV API needs a **federation partnership** (a username, secret and signed client token issued to a club or society) - see `docs/INTEGRATIONS.md`. Anybody can try the *flow*; nobody can try the real handshake without those credentials. |
| Email | Nothing is sent: join codes, claim codes and group links are shown on screen to copy. |
| Payments moving money | Cash is recorded, card needs your own Stripe keys and a public HTTPS domain. |

## 5. Demo hygiene

* Everyone shares one database, and the demo accounts are published. That is deliberate - it is a
  sandbox. Do not put anything private in it.
* No rate limiting is wired up. `/api/scores` and `/api/players` are open to anyone with a
  session or a group token. For a link posted publicly, put a cheap per-IP limit in front
  (Cloudflare's free WAF rules, or `@vercel/firewall`).
* `AUTH_SECRET` is per-deployment. Changing it logs everybody out - do not rotate it mid-demo.
* The **Turso token** is a password for that database: it goes in the host's environment
  variables and in GitHub Actions secrets, and nowhere else. Never paste it into a chat, an
  issue, a commit or a screenshot - if it does leak, `turso db tokens revoke <name>` and make a
  new one (revoking does not touch the data).
* The floor really is £0: Turso (5 GB, no card) + Render (750 h, no card) or Vercel Hobby. The
  first thing you would hit is Render's idle sleep, not a bill.

## 6. Sharing without deploying at all

If you want to show someone today, from your own laptop:

```bash
cd golfday && npm run setup && npm start     # http://localhost:3000
cloudflared tunnel --url http://localhost:3000   # free, random https://*.trycloudflare.com link
```

The tunnel lasts as long as the command runs and needs no account. Handy for a demo call; not a
link you can leave in a README.

## 7. GitHub Pages: the recordings (already wired up)

```bash
node demo/build-gallery.mjs   # → demo/gallery/index.html + assets (stills + films)
```

The `Screenshots site` workflow runs that on every change to the stills or the films and
publishes it. One-time setup: **Settings → Pages → Source: GitHub Actions**. The result is a page
of the real screens and the three films - honest about being a recording, and useful as the
"what does it look like?" link you paste into a chat without asking anyone to sign up.
