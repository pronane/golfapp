# Hosting GolfDay for free

> **Just want a link to send people, with sign-up switched on?** That is
> [`PUBLIC-DEMO.md`](PUBLIC-DEMO.md): Turso + Render or Vercel, a blueprint
> (`render.yaml`), a GitHub Action that fills the database, and an honest list of what is mocked
> on a public demo. This page is the wider comparison, for when you are choosing a home for real
> golf days rather than a demo.

The app is one Next.js process plus a small SQL database. That shape fits the free tiers
of several providers. Below is what I actually checked against each provider's published
limits (as of late 2026), then the recommended setup in detail.

## TL;DR

| Option | DB | Free tier | Fit for GolfDay |
| --- | --- | --- | --- |
| **Vercel Hobby + Turso** ⭐ | libSQL/SQLite (Turso) | Vercel: 100 GB bandwidth, 1 M function invocations, serverless functions included - **Hobby is non-commercial use only**. Turso: 5 GB storage, 500 M row reads, 10 M row writes / month, 100 databases, no card | Best fit technically. No code changes - the app already speaks libSQL. SSE works on the Node runtime. |
| **Cloudflare Pages/Workers + D1** | SQLite (D1) | Workers: 100 k requests/day. D1: 5 GB, 5 M rows read/day, 100 k rows written/day | Cheapest at scale and D1 is SQLite, but you'd swap `@libsql/client` for the D1 driver and SSE needs the Workers runtime. |
| Netlify + Turso | Turso | 100 GB bandwidth, 300 build minutes | Works, but function streaming behaviour is fussier than Vercel. |
| **Render Hobby + Turso** | Turso | Free web service, no card, **no commercial-use restriction**; 750 instance hours/month; sleeps after 15 min idle (~1 min to wake); no persistent disk | The best "free with no licence catch" option, and the one `render.yaml` in this repo deploys. The idle sleep is the price. |
| Supabase (Postgres) + Vercel | Postgres | 500 MB DB, pauses after 1 week idle | Fine, but means switching Drizzle to the Postgres dialect. |
| Neon (Postgres) + Vercel | Postgres | 0.5 GB, autosuspend | Same dialect switch as Supabase. |

Why Turso rather than Postgres: the schema is tiny (a handful of thousand rows per golf
day), SQLite is a single file for local development (`data/golfday.db`), and Turso gives
you the *same* libSQL driver over HTTP in production - so `npm run db:push` and the app
run unchanged locally and in the cloud.

## Recommended: Vercel Hobby + Turso

**Cost:** £0 / month for a club running a handful of golf days.

### 1. Create the database

```bash
# install the CLI once
curl -sSfL https://get.tur.so/install.sh | bash

turso auth signup
turso db create golfday
turso db show golfday --url          # libsql://golfday-<org>.turso.io
turso db tokens create golfday       # DATABASE_AUTH_TOKEN
```

### 2. Apply the schema

```bash
cd golfday
export DATABASE_URL="libsql://golfday-<org>.turso.io"
export DATABASE_AUTH_TOKEN="<token>"
npm run db:push        # idempotent DDL from src/db/schema.sql
# optional demo data:
npm run db:seed
```

No Node on the target machine? `seed/demo.sql` is the demo day as a single SQL file
(`turso db shell golfday < seed/demo.sql`); it drops and rebuilds every table, so it is also the
way to reset a demo. Regenerate it with `npm run seed:dump`.

### 3. Deploy

```bash
npm i -g vercel
vercel link            # create/link the project, root directory = golfday
vercel env add AUTH_SECRET production          # long random string
vercel env add DATABASE_URL production
vercel env add DATABASE_AUTH_TOKEN production
vercel env add GOLF_COURSE_API_KEY production  # optional, see INTEGRATIONS.md
vercel --prod
```

Notes:

* `AUTH_SECRET` must be a long random string (`openssl rand -base64 48`). Changing it logs
  everybody out. The app refuses to boot in production if it is missing, shorter than 32
  characters, or still looks like a placeholder (`change-me`, `your-secret`, ...), because a
  guessable secret lets anybody forge a login cookie.
* The SSE route (`/api/events/[id]/stream`) declares `runtime = "nodejs"` so it can hold a
  long-lived response. A serverless function has a wall-clock ceiling anyway (Vercel Hobby
  allows up to 300 s today, and it has been lower in the past), so the client's `EventSource`
  is written to reconnect when the stream is cut: `useLiveBoard` treats a dropped connection
  as "reconnecting" and re-subscribes with backoff, and every new stream sends the current
  board immediately, so nothing is missed.
* Turso free tier allows 500 M row reads/month. A live board with 48 players costs roughly
  3 reads per 2 s per connected spectator - dozens of spectators for a whole day is still
  well inside the free tier. If you expect hundreds of spectators, poll the JSON endpoint
  every 10 s instead of streaming (or put Cloudflare in front).

### 4. Custom domain, HTTPS, backups

Vercel gives HTTPS and a `*.vercel.app` domain free. Turso has point-in-time restore on
paid plans; for the free tier use `turso db dump golfday > backup.sql` after each event.

## Alternative: Cloudflare Workers + D1

If you would rather stay inside Cloudflare's generous free tier:

1. `npx create-cloudflare@latest` with the Next.js + D1 template, or deploy through
   `@opennextjs/cloudflare`.
2. Replace `src/db/client.ts` with the D1 binding:

   ```ts
   import { drizzle } from "drizzle-orm/d1";
   export const db = (env: Env) => drizzle(env.DB, { schema });
   ```

3. Run the same `src/db/schema.sql` against D1
   (`wrangler d1 execute golfday --file=src/db/schema.sql --remote`).
4. SSE works on Workers, but each invocation is limited by CPU time (10 ms free, 30 s
   paid model) - long-lived streams are fine because they are I/O bound.

Everything else in `src/lib` and `src/app` is unchanged.

## Things to know before you charge money for it

* No email delivery is wired up (entries, group links and claim codes are shown in the UI
  and can be copied/shared). Add Resend (free: 3 000 emails/month) if you want real email.
* No rate limiting on the public API. Add Vercel's `@vercel/firewall` or a simple
  per-IP counter in front of `/api/scores` before a big event.
* Anyone with a group's `/score/<token>` link can edit that group's card. That is
  deliberate (one phone per four-ball, no logins) - rotate the token by recreating the
  group if a link leaks.
* Scores can be edited until the event status is set to **Completed**, after which the API
  refuses writes. Every change is written to `score_audit`.

## Is it up? Is it seeded?

`GET /api/health` is unauthenticated and answers with counts, never secrets:

```json
{ "ok": true, "db": "up", "schema": "ready", "players": 23, "ms": 41 }
```

* `db: "down"` → wrong `DATABASE_URL`, missing `DATABASE_AUTH_TOKEN`, or the database was deleted.
  Also a `503`, which is what the Render blueprint's health check reacts to.
* `schema: "empty"` → the database is reachable but nobody ran `npm run db:push` against it.
  The app still serves (200), it just has no tables to read.

## What GitHub can host (and cannot)

GitHub Pages is a static file host: no `POST`, no cookies, no database. GolfDay's sign-in
and score entry are writes behind a session cookie, so a Pages deployment can only *show* the
app, not run it. Two things GitHub does well here, both wired up in this repository:

* `.github/workflows/pages.yml` publishes the films and journey stills (built by
  `demo/build-gallery.mjs`) - the "what does it look like?" link.
* `.github/workflows/demo-db.yml` applies the schema and seeds the demo day into your Turso
  database, on demand or nightly, so a public demo can be reset without a laptop.

## Local development data

`data/golfday.db` is a plain SQLite file, ignored by git. `npm run db:reset` recreates it
with the demo day in play; `sqlite3 data/golfday.db` works if you want to poke at it.
