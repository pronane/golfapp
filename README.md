# golfapp

Two things live in this repository:

| Path | What it is | Stack |
| --- | --- | --- |
| [`golfday/`](golfday/README.md) | **GolfDay** - the current app: live scoring, entries, tee groups, course cards and a real-time leaderboard for golf days and outings. Free to host, small SQL database, WHS handicaps, Golf England integration, demo videos. | Next.js 15 (App Router), TypeScript, Tailwind, Drizzle ORM, libSQL/SQLite |
| `src/`, `reactSrc/`, `reworkedFrontEnd/`, `*.sql`, `page3.html` | The original prototype (Spring Boot + React, MariaDB). Left untouched for reference. | Spring Boot 3, React, MariaDB |

**Start here:** [`golfday/README.md`](golfday/README.md) - quick start, requirement-by-requirement
mapping, API surface and design notes.

```bash
cd golfday
npm install
cp .env.example .env          # set AUTH_SECRET
npm run db:reset              # SQLite schema + demo golf day in play
npm run dev                   # http://localhost:3000
```

Demo logins: `admin@golfday.app` (organiser), `sam@golfday.app` (player) - password `golfday123`.

Hosting options (Vercel + Turso, Cloudflare + D1, and the trade-offs): [`golfday/docs/HOSTING.md`](golfday/docs/HOSTING.md).
Golf England / course API integration notes: [`golfday/docs/INTEGRATIONS.md`](golfday/docs/INTEGRATIONS.md).
