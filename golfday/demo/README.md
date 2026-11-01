# Demo videos

| File | Length | What it shows |
| --- | --- | --- |
| [`golfday-start-to-finish.webm`](golfday-start-to-finish.webm) | 3:47 | **The whole process, one sitting, nothing faked.** An organiser starts a **society**, takes members from the player directory, opens an **order-of-merit season**, then builds a golf day from the club page: a three-step wizard, **Texas scramble** format, a card snapshotted from the course library, a field of eight, two four-balls allocated in one click, a £25 entry fee and a signed-up fixture. A player then opens **their team's** card, records the drive and the score for four holes, the public board updates live, the desk marks a cash entry paid and issues a **part-refund against that entry**, and the season's order of merit fills in. It ends on the **TV board** |
| [`golfday-product-tour.webm`](golfday-product-tour.webm) | 1:25 | The whole product: landing page and live leaderboard, sign in, player dashboard, the organiser console (field, groups, card, admins), the course library, the three-step "create a golf day" wizard, and a player signing up with their Golf England ID |
| [`golfday-live-scoring.webm`](golfday-live-scoring.webm) | 0:49 | Two screens side by side: a four-ball entering scores on a phone and the clubhouse leaderboard updating live, including a correction |

All three are **1440×900 VP9/Opus WebM with English narration and burned-in captions**. They play in
every current browser. To convert to MP4/H.264 for WhatsApp or social:

```bash
ffmpeg -i golfday-live-scoring.webm -c:v libx264 -crf 22 -c:a aac -b:a 128k \
  -movflags +faststart golfday-live-scoring.mp4
```

The start-to-finish film also produces the 24 stills in
[`../docs/screenshots/journey/`](../docs/screenshots/journey) - one picture per step, taken from the
same run, so the screenshots and the video can never drift apart. Every still is named after its
step: landing, sign-in, societies, society, roster, season form, empty season page, wizard format and
review, the created event, field, teams, private scorecard links, entry fee, the opened day, the
season fixture, the event page, the team card and its progress, the live board before and after the
next team cards, payments, the refund, and the order of merit.

## How they were made (no ffmpeg needed)

```
Puppeteer drives the real app
        │  CDP Page.startScreencast → one JPEG per painted frame
        ▼
demo/recorder.html  (1440×900 canvas)
        │  paints each frame, adds the caption bar + software cursor
        │  canvas.captureStream(0) → track.requestFrame()
        ▼
MediaRecorder (VP9) → raw .webm  +  cues.json (when each caption appeared)
        │
        ▼
demo/mix-audio.mjs  replays the raw video onto a canvas, schedules the narration
        │           clips on an AudioContext, and records canvas + audio together
        ▼
golfday-*.webm  (VP9 video + Opus narration, aligned to the cue sheet)
```

`demo/live-stage.html` is the two-pane "on the course / in the clubhouse" page used by the live
demo: it simply iframes the group scorecard (`/score/<token>`) and the leaderboard
(`/live/<slug>`). Real mouse clicks are dispatched into the iframes, so both panes genuinely read
and write the same database - nothing is mocked or replayed.

## Re-recording

```bash
npm i -D puppeteer
npx puppeteer browsers install chrome
npm run db:reset            # deterministic demo data
npm run dev                 # in another terminal

node demo/record.mjs --scene=product --out=demo/raw/product.webm
node demo/record.mjs --scene=live    --out=demo/raw/live.webm
node demo/record-journey.mjs --out=demo/raw/journey.webm   # needs a fresh db:reset

node demo/mix-audio.mjs --video=demo/raw/product.webm --audio=demo/narration \
  --plan=demo/narration-product.json --out=demo/golfday-product-tour.webm
node demo/mix-audio.mjs --video=demo/raw/live.webm --audio=demo/narration \
  --plan=demo/narration-live.json --out=demo/golfday-live-scoring.webm
node demo/mix-audio.mjs --video=demo/raw/journey.webm --audio=demo/narration \
  --plan=demo/narration-journey.json --out=demo/golfday-start-to-finish.webm
```

`APP_URL` overrides the target (default `http://127.0.0.1:3000`); `CHROME_PATH` points at a
specific Chrome build. Each recording run writes `<name>.cues.json` with the exact second each
caption appeared, so the narration plan can be re-cut without re-filming.

`narration-*.json` is that plan: `{ file, start }` pairs pointing at the clips in
`demo/narration/`. `mix-audio.mjs` validates the schedule (no clip may overrun the next one or
the end of the video, otherwise it time-compresses that clip by up to 18% and tells you).

## Narration script (as recorded)

### `golfday-start-to-finish.webm`

Full script with timings: [`narration-script-journey.md`](narration-script-journey.md).

| At | Clip | Spoken |
| --- | --- | --- |
| 0:03 | j1 | This is one society golf day, start to finish. Alex runs the club's golf days. First, the society itself: a roster, a fixture list and a season in one place. A six-character code lets members join themselves, and handicaps come straight from the player directory. Sam and Priya are on the roster in two clicks. |
| 0:34 | j2 | Then a season: the order of merit that runs across the year. It has a window, so only golf days played inside it score. A win is a hundred points, second ninety, and so on down the field. |
| 0:47 | j3 | Now the golf day, created from the club page so it lands on the fixture list by itself. Format: Texas scramble, where the card belongs to the team, not the player. The course and its card come from the library, and are snapshotted onto the day. |
| 1:03 | j13 | Step two: the course. Par and stroke index for all eighteen holes come with it, and the card is copied onto the day, so later edits cannot rewrite a round already played. |
| 1:15 | j4 | The field is picked from the directory, handicaps included. |
| 1:28 | j15 | Players come from the directory, or from the society roster in one click, so the regulars are entered without typing a name. |
| 1:36 | j11 | Two four-balls, ten minutes apart, in one click. Each team gets its own private scorecard link. |
| 1:45 | j5 | Twenty-five pounds a head. Card payments go through Stripe when the club switches it on; today the desk takes cash. Open the day, and scoring goes live. |
| 1:57 | j6 | The scramble is added to the season, so it counts towards the order of merit. Then a player's phone: the day as the field sees it, and then their own team card. One score per hole, and whose drive the team used, which has to be tracked, not remembered. |
| 2:21 | j7 | Tee shot, then score. The captain taps the player whose drive they took, then the number of shots. The ledger counts them, and says who still owes one. Four holes in, and the team is top of the board. |
| 2:36 | j12 | Every player's tee shot has to be used, so the ledger on the right counts them. A bogey on the third, a par on the fourth, and the card keeps filling in. |
| 2:47 | j16 | Four holes in, and the team is top of the board, with every drive logged against the hole it was used on. |
| 3:01 | j8 | The public board, where the team is the competitor, with a scramble team handicap. Another team starts carding, and this page updates itself, in place, with no refresh. |
| 3:13 | j9 | At the desk: who has paid, and a part refund against that entry. Part or all of it, never more than was paid. |
| 3:22 | j14 | The ledger keeps the bookkeeping honest: what was paid, what came back, and what is still refundable on each entry. |
| 3:37 | j10 | And the order of merit, built from the day itself: every team member earns the team's result. That is one golf day, start to finish. |

### `golfday-product-tour.webm`

| At | Clip | Spoken |
| --- | --- | --- |
| 0:03 | p1 | This is GolfDay. Live scoring for golf days, outings and society meets. Nothing for players to install. |
| 0:11 | p2 | Spectators just open the leaderboard link. Every hole, every player, refreshed within two seconds. |
| 0:21 | p3 | Signing in is a normal email and password, and organisers land on their own golf: today's round, their tee group, their live position. Then one console runs the day. The field with WHS playing handicaps, four balls with private scorecard links, the card itself, admins and scorers. |
| 0:40 | p6 | Field, groups, card and admins. Everything the day needs, in one place. |
| 0:51 | p4 | Courses come from a free course API, or a card typed in by hand. Creating a golf day is a three step wizard: name it, set the date and allowance, pick the course, and its eighteen hole card is snapshotted onto the event. |
| 1:14 | p5 | New players sign up with their Golf England ID. One lookup pulls the handicap and home club. GolfDay, free to host on Vercel and Turso. |

### `golfday-live-scoring.webm`

| At | Clip | Spoken |
| --- | --- | --- |
| 0:06 | l1 | Same database, two screens. Group one's scorecard on a phone, and the clubhouse leaderboard. |
| 0:12 | l2 | Alex taps in a three on the seventeenth. An eagle, four points. Within a second and a half, the clubhouse row flashes and the points move. |
| 0:21 | l3 | A birdie at the last, then Mei holes out for a two, and the order at the top of the board changes before the group has left the green. |
| 0:31 | l4 | The full board: positions, holes completed, points, gross and to par. Scores can be corrected afterwards, audited, and the board adjusts again. |

The narration was generated once (British English, single narrator) and committed under
`demo/narration/` so the videos can be re-cut without regenerating audio.
