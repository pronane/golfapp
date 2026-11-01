/**
 * Builds a static "what it looks like" page for GitHub Pages.
 *
 *   node demo/build-gallery.mjs          # writes demo/gallery/index.html + assets
 *
 * This is the one thing GitHub *can* host on its own: the films and the stills
 * from the journey, as a page anybody can scroll. It is explicitly not the app -
 * GitHub Pages serves files, and GolfDay needs a server for sign-in, sign-up and
 * score writes. docs/PUBLIC-DEMO.md explains the difference.
 */
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, "..");
const SHOTS = path.join(ROOT, "docs", "screenshots", "journey");
const OUT = path.join(HERE, "gallery");
const ASSETS = path.join(OUT, "assets");

const FILMS = [
  {
    file: "golfday-start-to-finish.webm",
    title: "A golf day, start to finish",
    length: "3:50",
    blurb:
      "A society, a season, a Texas scramble, a team card, the live board, a cash entry marked paid and a part-refund.",
  },
  {
    file: "golfday-product-tour.webm",
    title: "The product tour",
    length: "1:25",
    blurb: "Every screen: the leaderboard, signing in, the organiser console, courses, the wizard, a player signing up.",
  },
  {
    file: "golfday-live-scoring.webm",
    title: "Live scoring, two screens",
    length: "0:49",
    blurb: "A four-ball scoring on a phone while the clubhouse board updates beside it.",
  },
];

/** "08-wizard-format" -> "Wizard format". */
function titleOf(file) {
  const slug = file.replace(/^\d+-/, "").replace(/\.jpg$/, "");
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

const stills = fs
  .readdirSync(SHOTS)
  .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
  .sort();
for (const still of stills) fs.copyFileSync(path.join(SHOTS, still), path.join(ASSETS, still));

const films = [];
for (const film of FILMS) {
  const src = path.join(ROOT, "demo", film.file);
  if (!fs.existsSync(src)) {
    console.warn(`skipping missing film ${film.file}`);
    continue;
  }
  fs.copyFileSync(src, path.join(ASSETS, film.file));
  films.push(film);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const html = `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>GolfDay - what it looks like</title>
<meta name="description" content="Films and screenshots of GolfDay: society golf days, live scoring, cash or card entry fees, order of merit.">
<style>
  :root{--ink:#2b3a31;--sage:#7ba98b;--paper:#fbfaf5;--sand:#f6efdf;--blush:#f7d6d3}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
  .wrap{max-width:1100px;margin:0 auto;padding:0 22px}
  header.hero{padding:64px 0 40px;background:
    radial-gradient(60% 120% at 15% -20%,#e6f0e8 0%,rgba(251,250,245,0) 60%),
    radial-gradient(50% 100% at 100% 0%,var(--blush) 0%,rgba(251,250,245,0) 70%),var(--paper)}
  h1{font-size:clamp(30px,4.4vw,46px);line-height:1.1;letter-spacing:-.02em;margin:0 0 12px}
  .lede{font-size:18px;max-width:62ch;color:#4f6457}
  .note{margin-top:22px;padding:14px 18px;border:1px solid #d8e4da;background:#f1f7f2;border-radius:14px;font-size:14.5px;max-width:70ch}
  h2{font-size:22px;margin:46px 0 14px;letter-spacing:-.01em}
  .films{display:grid;gap:22px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
  .film{background:#fff;border:1px solid #e6ebe3;border-radius:16px;overflow:hidden;box-shadow:0 10px 26px -22px rgba(43,58,49,.5)}
  .film video{width:100%;display:block;background:#000;aspect-ratio:16/10}
  .film .body{padding:14px 16px 18px}
  .film h3{margin:0 0 4px;font-size:16px}
  .film .len{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7c8d81}
  .film p{margin:6px 0 0;font-size:14px;color:#4f6457}
  .stills{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
  figure{margin:0;background:#fff;border:1px solid #e6ebe3;border-radius:14px;overflow:hidden}
  figure img{width:100%;display:block}
  figcaption{padding:8px 12px;font-size:13px;color:#4f6457}
  a.btn{display:inline-block;margin-top:10px;background:var(--sage);color:#fff;text-decoration:none;
    padding:9px 16px;border-radius:10px;font-weight:600;font-size:14.5px}
  footer{padding:44px 0 60px;color:#6b7d71;font-size:13.5px}
  code{background:var(--sand);padding:1px 5px;border-radius:5px;font-size:.92em}
</style>
</head>
<body>
<div class="hero"><div class="wrap">
  <h1>GolfDay, in pictures</h1>
  <p class="lede">Set up a golf day, hand every four-ball a scorecard on their phone, watch one leaderboard update,
  and let the season's order of merit fill itself in. Cash on the day or card online - the organiser chooses.</p>
  <p class="note"><strong>This page is a recording, not the running app.</strong> GitHub Pages can serve files;
  signing in, creating an account and entering scores need the server half. To try it for real, follow
  <code>golfday/docs/PUBLIC-DEMO.md</code> - a free Turso database plus a free host takes about fifteen minutes.</p>
  <a class="btn" href="https://github.com/pronane/golfapp/blob/master/golfday/docs/PUBLIC-DEMO.md">Put a demo online</a>
</div></div>

<div class="wrap">
  <h2>Films</h2>
  <div class="films">
${films
  .map(
    (f) => `    <div class="film">
      <video controls preload="metadata" src="assets/${esc(f.file)}"></video>
      <div class="body"><div class="len">${esc(f.length)}</div><h3>${esc(f.title)}</h3><p>${esc(f.blurb)}</p></div>
    </div>`,
  )
  .join("\n")}
  </div>

  <h2>Screens, one per step</h2>
  <p class="lede" style="font-size:15.5px">Taken from the same run as the film above.</p>
  <div class="stills">
${stills
  .map(
    (s) => `    <figure><img src="assets/${esc(s)}" alt="${esc(titleOf(s))}" loading="lazy"><figcaption>${esc(titleOf(s))}</figcaption></figure>`,
  )
  .join("\n")}
  </div>

  <footer>
    GolfDay - stableford scoring, WHS handicaps and a live leaderboard for every golf day.
    Built by <a href="https://github.com/pronane/golfapp">pronane/golfapp</a>.
  </footer>
</div>
</body>
</html>
`;

fs.writeFileSync(path.join(OUT, "index.html"), html);
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");
const mb = (dir) =>
  fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) / 1024 / 1024;
console.log(`wrote demo/gallery (${stills.length} stills, ${films.length} films, ${mb(ASSETS).toFixed(1)} MB) - open demo/gallery/index.html or npm run gallery`);
