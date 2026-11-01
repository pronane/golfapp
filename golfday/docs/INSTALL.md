# Install GolfDay on your own machine

One command checks your machine, installs what is missing, builds the database, and then
proves the whole thing works by driving a real browser through a complete golf day.

| Your machine | Run |
| --- | --- |
| macOS / Linux | `./install/install.sh` |
| Windows | `powershell -ExecutionPolicy Bypass -File install\install.ps1` |

Afterwards:

| | |
| --- | --- |
| Start it | `./start-golfday.sh` (macOS: double-click `start-golfday.command`) / `start-golfday.cmd` |
| Open | <http://localhost:3000> |
| Sign in | `admin@golfday.app` · `golfday123` (organiser) |
| Re-run the check | `npm run e2e` |

The installer is safe to run again: it never overwrites `.env`, never wipes your database,
and the end-to-end run uses its own throwaway database file.

## What it does

1. **Finds Node.js 20+.** If you already have a good one it is used as-is. If not, it tries
   your system package manager (Homebrew, `winget`, `apk`) and otherwise downloads the
   official Node.js build into `.install/node` inside the project - **no admin rights, no
   PATH changes, nothing installed machine-wide.** Downloads are verified against
   nodejs.org's published SHA-256 sums.
2. **Installs dependencies** with `npm ci` (exact versions from `package-lock.json`).
3. **Writes `.env`** from `.env.example`, generating an `AUTH_SECRET` (used for sessions and
   for sealing integration passwords) and a `DATABASE_URL` that points at a local file.
4. **Builds the database**: creates `data/`, applies the schema from `src/db/schema.sql`
   plus the `ADDED_COLUMNS` migrations, then seeds the demo (courses, three golf days, the
   demo accounts). Re-running applies only what is missing - it is a migration, not a wipe.
5. **Writes the launchers**: `start-golfday.sh`, `start-golfday.command` (macOS),
   `start-golfday.cmd` and `start-golfday.ps1`. They start the app on a spare-free port,
   open your browser when it answers, and stop on Ctrl+C.
6. **Fetches a headless Chromium** for the end-to-end run (skipped gracefully with no
   internet - it will fall back to your installed Chrome or Edge).
7. **Builds** the production app (`next build`).
8. **Runs the end-to-end click-through** and prints every step, with screenshots in
   `e2e/artifacts/`.

Flags: `--skip-e2e` / `-SkipE2E`, `--skip-browsers` / `-SkipBrowsers`, `--no-build` /
`-NoBuild`, `--force-node` / `-ForceNode`.

## About the database: there is no Postgres to install

GolfDay stores everything in **libSQL/SQLite** - a single file at `data/golfday.db`, opened
by the app itself. That is a deliberate choice, not an omission:

* nothing to install, nothing to keep running, no port, no password, no scheduled backup;
* the schema is plain SQL (`src/db/schema.sql`), so "create all the tables from source" is
  `npm run db:push`, which the installer runs for you;
* the same driver talks to a hosted libSQL/Turso database if you outgrow the file.

To use a different database, set `DATABASE_URL` in `.env` before running the installer:

```env
DATABASE_URL="file:./data/golfday.db"              # default: a local file
# DATABASE_URL="libsql://your-db.turso.io"         # hosted libSQL
# DATABASE_AUTH_TOKEN="..."                        # if the host needs one
```

Then run `npm run db:push` (and `npm run db:seed` for demo data). A **PostgreSQL** driver
would be a code change (Drizzle supports it, but the SQL and the `sqlite_master` checks are
SQLite-specific); it is not something an installer can quietly switch on, so we have not
pretended otherwise.

## The end-to-end check

`npm run e2e` starts the app on port 3210 (override with `E2E_PORT`), creates a throwaway
database (`data/e2e-run.db`, deleted afterwards), and then, in a real browser:

1. loads the landing page;
2. registers a player who picks **No handicap yet** and lands on their dashboard;
3. signs in as the organiser;
4. creates a society and puts two players on the roster;
5. creates a golf day in the three-step wizard, picking a course card;
6. fills the field from the roster in one click;
7. auto-allocates tee groups and opens the day;
8. opens a group's private scorecard and enters four holes;
9. checks the live board shows the round and the points;
10. goes back to the organiser console and confirms the field.

Screenshots of every step land in `e2e/artifacts/`, and a failing step is captured too.

Options:

```bash
npm run e2e -- --headed          # watch the browser
E2E_PORT=4000 npm run e2e        # different port
E2E_VERBOSE=1 npm run e2e        # stream the server log
GOLFDAY_E2E_BROWSER=/path/to/chrome npm run e2e   # use a specific browser
npx playwright-core install chromium              # fetch Playwright's own Chromium
```

Any of Chromium, Google Chrome or Microsoft Edge will do - the runner tries them in that
order, so a locked-down machine with only Edge still works.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| "Could not download Node.js" | You are offline or behind a proxy. Install the LTS from <https://nodejs.org> and re-run; the installer will find it. |
| Corporate proxy | `export HTTPS_PROXY=http://proxy:8080` (Windows: `$env:HTTPS_PROXY="..."`) before running. npm honours `npm config set proxy`. |
| `powershell ... cannot be loaded because running scripts is disabled` | Use the exact command above with `-ExecutionPolicy Bypass`, or run `Set-ExecutionPolicy -Scope Process RemoteSigned`. |
| Port 3000 is busy | `PORT=4000 ./start-golfday.sh` |
| The end-to-end run cannot find a browser | `npx playwright-core install chromium`, or install Chrome/Edge, or set `GOLFDAY_E2E_BROWSER`. |
| Apple silicon vs Intel | Nothing to do - the installer picks `darwin-arm64` or `darwin-x64` automatically. |
| Alpine / musl Linux | No official Node build exists; the installer uses `apk add nodejs npm` (needs root or sudo). |
| WSL | Works as Linux. The browser the app opens is Windows' default browser; if `xdg-open` is missing, just visit <http://localhost:3000> yourself. |
| I want to start over | Delete `data/golfday.db` and run `npm run db:reset`, or delete the folder entirely - nothing was installed outside it. |
| I want to uninstall | Delete the `golfday` folder. If the installer downloaded a private Node it lives in `.install/`, so it goes with it. |

## What has been verified, honestly

* The Unix installer, `install/setup.mjs`, the launchers and the full end-to-end journey
  were run end to end on Linux (Ubuntu-class, x86-64) with **all 15 steps passing**,
  against both the development and the production server.
* The **Windows** PowerShell installer follows the identical steps and delegates everything
  after Node detection to the same cross-platform `install/setup.mjs`, but it has not been
  executed on a Windows machine here. If it trips, the error message names the step, and
  the equivalent manual commands are in the [README](../README.md#quick-start).
