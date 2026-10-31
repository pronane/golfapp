# Demo videos

| File | Length | What it shows |
| --- | --- | --- |
| `golfday-product-tour.mp4` | ~2½ min | The whole product: courses, creating a golf day, the field, groups, admins, entries, Golf England handicap lookup |
| `golfday-live-scoring.mp4` | ~1 min | Two screens side by side: a four-ball entering scores and the clubhouse leaderboard updating live (with corrections) |

Both are 1440×900 H.264/AAC MP4s, also available as `.webm` (VP9/Opus).

## How they were made (no ffmpeg required)

The app itself is driven by a headless browser, and the browser does the recording:

```
Puppeteer drives the real app
        │  CDP Page.startScreencast  →  JPEG per painted frame
        ▼
demo/recorder.html  (1440×900 canvas)
        │  paints frames + caption bar + software cursor
        │  canvas.captureStream(0) → track.requestFrame()
        ▼
MediaRecorder (VP9) → .webm      → voice-over mixed in (WebAudio) → .mp4
        │
        └── cues.json  (when every caption appeared, for the voice-over timings)
```

`demo/live-stage.html` is the two-pane "on the course / in the clubhouse" page used by the
live demo; it simply iframes the group scorecard (`/score/<token>`) and the leaderboard
(`/live/<slug>`). Real clicks are dispatched into the iframes, so the two panes genuinely
talk to the same database.

### Re-recording

```bash
npm i -D puppeteer
npx puppeteer browsers install chrome
npm run db:reset            # deterministic demo data
npm run dev                 # in another terminal

node demo/record.mjs --scene=product --out=demo/product.webm
node demo/record.mjs --scene=live    --out=demo/live.webm
```

`APP_URL` overrides the target (default `http://127.0.0.1:3000`), `CHROME_PATH` points at a
specific Chrome build. Each run also writes `<name>.cues.json` with the exact second each
caption appeared.

## Voice-over script

The narration is written to sit between the caption cues. One narrator, British English,
steady pace.

### Product tour

| From | Narration |
| --- | --- |
| 0:00 | GolfDay - live scoring for golf days, outings and society meets. |
| 0:03 | This is the public site. A golf day is an event: one course, one card, one field, and a leaderboard anybody can watch - no app for players to install. |
| 0:16 | Spectators open the leaderboard link weeks or minutes before the first tee. Here the whole field is on the course; each row shows position, holes completed, Stableford points, gross and to par, and the hole-by-hole grid is one click away. |
| 0:37 | Signing in is a normal email and password. Organisers land on their own golf: today's round, their tee group, their position. |
| 0:48 | The organiser console lists every golf day they run, each with the join code they can paste into a WhatsApp group. |
| 1:00 | One console runs the day. The field, with handicaps converted to a playing handicap. Groups, auto-allocated into four-balls, each with its own private scorecard link. The card itself, so an admin can correct par or stroke index on the day. And admins, or a scorer who can only enter scores. |
| 1:15 | Courses come from a free course database, or they can be typed in hole by hole - par, stroke index, slope and rating. Anything imported lands in the club's own library, so it is there next year. |
| 1:27 | Creating a golf day is a three-step wizard. Name it, set the date, format and handicap allowance; pick the course, and the full eighteen-hole card is snapshotted onto the event so later edits never rewrite a played round. |
| 1:57 | Players can also enter themselves with the join code, and new players sign up with their Golf England ID: one lookup pulls their handicap index and home club. |
| 2:15 | GolfDay. Next.js and a small SQL database - free to host. |

### Live scoring

| From | Narration |
| --- | --- |
| 0:00 | Same database, two screens. On the left, group one's scorecard on a phone in the group. On the right, the leaderboard on the clubhouse screen. |
| 0:07 | Alex taps in a three on the seventeenth - an eagle, four points with his shot. |
| 0:11 | Watch the top of the clubhouse board: within a second and a half the row flashes and the points move. No refresh button, nothing to install. |
| 0:17 | On to the eighteenth for a birdie. The mini leaderboard inside the scorecard moves at the same moment. |
| 0:23 | Now Mei, another player in the same four-ball, holes out for a two on the last. The order at the top of the board changes while the group is still walking off the green. |
| 0:34 | The full board carries positions, holes completed, points, gross and to par, and lower down the group sweep and the card of the day. |
| 0:44 | Scores can be corrected after the fact - every change is written to an audit trail and the leaderboard adjusts again. |
| 0:53 | That is the whole loop: score a hole, the board updates, everybody stays in step. |
