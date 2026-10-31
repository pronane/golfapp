# Demo videos

| File | Length | What it shows |
| --- | --- | --- |
| [`golfday-start-to-finish.webm`](golfday-start-to-finish.webm) | 4:10 | **The whole process, one sitting, nothing faked.** An organiser creates a golf day from scratch (name, date, a course card typed in by hand), fills the field, allocates tee groups and opens scoring; a player signs up with a Golf England ID, joins with the join code, **marks their own tee group**, scores four holes on the group card, and the public leaderboard updates live |
| [`golfday-product-tour.webm`](golfday-product-tour.webm) | 1:25 | The whole product: landing page and live leaderboard, sign in, player dashboard, the organiser console (field, groups, card, admins), the course library, the three-step "create a golf day" wizard, and a player signing up with their Golf England ID |
| [`golfday-live-scoring.webm`](golfday-live-scoring.webm) | 0:49 | Two screens side by side: a four-ball entering scores on a phone and the clubhouse leaderboard updating live, including a correction |

All three are **1440×900 VP9/Opus WebM with English narration and burned-in captions**. They play in
every current browser. To convert to MP4/H.264 for WhatsApp or social:

```bash
ffmpeg -i golfday-live-scoring.webm -c:v libx264 -crf 22 -c:a aac -b:a 128k \
  -movflags +faststart golfday-live-scoring.mp4
```

The start-to-finish film also produces the stills in
[`../docs/screenshots/journey/`](../docs/screenshots/journey) - one picture per step, taken from the
same run, so the screenshots and the video can never drift apart.

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

| At | Clip | Spoken |
| --- | --- | --- |
| 0:04 | j1 | This is GolfDay, filmed end to end in one sitting. An organiser sets the day up from an empty diary, players enter themselves, and a four-ball scores. Nothing is faked and nothing is edited: one browser, one database. |
| 0:26 | j2 | Step one: name the day, set the date, the first tee and the handicap allowance. Then choose the course, and review. No spreadsheets, and no separate handicap table to keep in step. |
| 0:49 | j3 | If the course is not in the library, the organiser simply types it in, naming it and giving par and stroke index for all eighteen holes. |
| 1:11 | j4 | Next, the field. Players come from the directory, or are typed in as guests who can claim their entry later. Tee groups are then allocated in one click, each group getting its own private scorecard link. |
| 2:00 | j5 | When the day starts, scoring opens. Players put themselves in the field with the six-character join code, so the organiser never has to do it for them. |
| 2:36 | j6 | A new player signs up with their Golf England ID. The handicap index and home club arrive from the lookup, so nobody types a handicap in by hand. |
| 2:58 | j7 | And this is the piece that matters: the player marks their own tee group. No admin, no waiting for somebody else to do it. Their dashboard then shows the group they are in and the board as it stands. |
| 3:25 | j8 | On the course, the group opens its scorecard link. No logins, no app: one phone does the whole four-ball. Every tap saves the score, and the top five beside the card re-rank as the holes go in. |
| 3:56 | j9 | Finally, the public leaderboard. Anyone with the link can watch, and it updates itself in place the moment a score lands. |

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
