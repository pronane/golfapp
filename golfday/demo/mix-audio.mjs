/**
 * Muxes narration audio onto a recorded screen capture, in the browser.
 *
 * The video is played back in real time onto a canvas (so it is re-encoded) and
 * the narration clips are scheduled on an AudioContext at fixed offsets; the
 * canvas stream plus the audio destination are recorded together with
 * MediaRecorder. That keeps the whole post-production step inside Chrome,
 * which means no ffmpeg dependency.
 *
 *   node demo/mix-audio.mjs --video=demo/raw/product.webm \
 *        --audio=demo/narration --plan=demo/narration-product.json \
 *        --out=demo/golfday-product-tour.webm
 *
 * Notes:
 *  - The output is VP9/Opus in a WebM container (Chrome's MediaRecorder offers no
 *    H.264 encoder here). It plays in every current browser.
 *  - Convert for WhatsApp/social if you need MP4 H.264:
 *      ffmpeg -i golfday-product-tour.webm -c:v libx264 -crf 22 -c:a aac -b:a 128k \
 *        -movflags +faststart golfday-product-tour.mp4
 */
import fs from 'node:fs';
import path from 'node:path';

import puppeteer from "puppeteer";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  }),
);
const videoFile = args.video;
const planFile = args.plan;
const outFile = args.out;
const audioDir = args.audio ?? 'demo/narration';
const probe = args.probe === 'true';

const W = 1440;
const H = 900;

const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const videoB64 = fs.readFileSync(videoFile).toString('base64');
const clips = plan.map((seg) => ({
  ...seg,
  b64: fs.readFileSync(path.join(audioDir, seg.file)).toString('base64'),
}));

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--no-sandbox", "--hide-scrollbars"],
  defaultViewport: { width: W, height: H },
  // the mix runs in real time, so a long film needs a far longer CDP budget
  // than the 180s default (the evaluate call only returns when the video ends)
  protocolTimeout: 30 * 60 * 1000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.goto('about:blank');
await page.setContent(`<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>
window.__decoded = [];
window.__load = async (videoB64) => {
  const blob = await (await fetch('data:video/webm;base64,' + videoB64)).blob();
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.src = url; v.muted = false; v.playsInline = true;
  document.body.appendChild(v);
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('video load failed')); });
  // A MediaRecorder WebM carries no Duration element, so Chrome reports
  // Infinity. Once the blob is fully buffered the last buffered range gives the
  // real length, which is what the narration schedule is cut against.
  if (!Number.isFinite(v.duration)) {
    await new Promise((res) => {
      v.oncanplaythrough = () => res();
      setTimeout(res, 6000);
    });
    v.oncanplaythrough = null;
  }
  const duration = Number.isFinite(v.duration)
    ? v.duration
    : v.buffered.length
      ? v.buffered.end(v.buffered.length - 1)
      : NaN;
  window.__video = v;
  return { duration, w: v.videoWidth, h: v.videoHeight };
};
window.__decodeClips = async (clips) => {
  const ctx = new AudioContext({ sampleRate: 48000 });
  await ctx.resume();
  window.__actx = ctx;
  const out = [];
  for (const clip of clips) {
    const buf = await (await fetch('data:audio/mpeg;base64,' + clip.b64)).arrayBuffer();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    let peak = 0;
    for (let ch = 0; ch < audio.numberOfChannels; ch++) {
      const data = audio.getChannelData(ch);
      for (let i = 0; i < data.length; i += 7) peak = Math.max(peak, Math.abs(data[i]));
    }
    out.push({ file: clip.file, start: clip.start, duration: audio.duration, peak: Number(peak.toFixed(3)) });
  }
  window.__buffers = out;
  window.__clipData = clips;
  return out;
};
window.__record = async (mime, opts) => {
  const v = window.__video;
  const canvas = document.getElementById('c');
  const g = canvas.getContext('2d');
  const ctx = window.__actx;
  const dest = ctx.createMediaStreamDestination();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.ratio.value = 2.5; comp.attack.value = 0.01; comp.release.value = 0.25;
  comp.connect(dest);
  // meter exactly what the recorder hears, so we can prove the narration is in the file
  const meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  comp.connect(meter);
  window.__peak = 0;
  window.__meterTimer = setInterval(() => {
    const data = new Uint8Array(meter.fftSize);
    meter.getByteTimeDomainData(data);
    for (const v of data) {
      const amp = Math.abs(v - 128) / 128;
      if (amp > window.__peak) window.__peak = amp;
    }
  }, 40);

  window.__chunks = [];
  const stream = canvas.captureStream(30);
  for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
  window.__rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6000000, audioBitsPerSecond: 160000 });
  window.__rec.ondataavailable = (e) => { if (e.data.size) window.__chunks.push(e.data); };
  window.__rec.start();

  // draw loop
  const draw = () => {
    if (v.ended) return;
    g.drawImage(v, 0, 0, canvas.width, canvas.height);
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(draw);
    else requestAnimationFrame(draw);
  };

  const t0 = ctx.currentTime + 0.12;
  for (const item of opts.schedule) {
    const audioBuf = window.__buffers.find((b) => b.file === item.file);
    const src = ctx.createBufferSource();
    const clip = window.__clipData.find((c) => c.file === item.file);
    const raw = await (await fetch('data:audio/mpeg;base64,' + clip.b64)).arrayBuffer();
    src.buffer = await ctx.decodeAudioData(raw.slice(0));
    src.playbackRate.value = item.rate || 1;
    src.connect(comp);
    src.start(t0 + item.start);
  }

  v.currentTime = 0;
  await v.play();
  draw();
  await new Promise((res) => { v.onended = res; });
  if (opts.tail) {
    // Hold the last frame: the closing narration needs somewhere to land, and
    // the canvas already has the final picture on it.
    await new Promise((r) => setTimeout(r, opts.tail * 1000));
  }
  clearInterval(window.__meterTimer);
  window.__meterPeak = window.__peak;
  await new Promise((r) => setTimeout(r, 400));
  return await new Promise((resolve) => {
    window.__rec.onstop = async () => {
      const blob = new Blob(window.__chunks, { type: window.__rec.mimeType });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      resolve({ b64: btoa(s), size: bytes.length, type: blob.type, meterPeak: window.__meterPeak, audioTracks: dest.stream.getAudioTracks().length });
    };
    window.__rec.stop();
  });
};
window.__probeAudio = async (b64, mime) => {
  const blob = await (await fetch('data:' + mime + ';base64,' + b64)).blob();
  const el = document.createElement('video');
  el.src = URL.createObjectURL(blob);
  el.muted = false; el.volume = 1;
  const ctx = new AudioContext();
  const src = ctx.createMediaElementSource(el);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  analyser.connect(ctx.destination);
  await el.play();
  let peak = 0;
  const data = new Uint8Array(analyser.fftSize);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 50));
    analyser.getByteTimeDomainData(data);
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
  }
  el.pause();
  return { peak, duration: el.duration, w: el.videoWidth, h: el.videoHeight };
};
</script></body></html>`);

const loaded = await page.evaluate((b64) => window.__load(b64), videoB64);
const meta = { ...loaded, duration: Number.isFinite(loaded.duration) ? loaded.duration : Number(args.duration) };
if (!Number.isFinite(meta.duration) || meta.duration < 1) {
  throw new Error("cannot read the video's length: pass --duration=<seconds> (see the .cues.json)");
}
const tail = Number(args.tail ?? 0);
const total = meta.duration + tail;
const durations = await page.evaluate((clips) => window.__decodeClips(clips), clips.map(({ b64, ...rest }) => ({ ...rest, b64 })));
console.log('video', meta, tail ? `+ ${tail}s hold` : "");
console.log('clips', durations.map((d) => `${d.file} ${d.duration.toFixed(2)}s @${d.start} peak ${d.peak}`).join(' | '));

// validate the schedule: a clip may not run into the next one (0.15s grace) or past the video
const schedule = [];
let problems = 0;
const sorted = [...durations].sort((a, b) => a.start - b.start);
sorted.forEach((clip, i) => {
  const next = sorted[i + 1];
  const limit = Math.min(next ? next.start - 0.15 : total - 0.3, total - 0.3);
  const available = limit - clip.start;
  let rate = 1;
  if (clip.duration > available) {
    rate = Math.min(1.18, clip.duration / available);
    problems++;
    console.log(`  ! ${clip.file} ${clip.duration.toFixed(2)}s > window ${available.toFixed(2)}s -> speed ${rate.toFixed(3)}`);
  }
  schedule.push({ file: clip.file, start: clip.start, rate });
});

const mime = args.mime ?? 'video/webm;codecs=vp9,opus';
console.log('recording with', mime, '(problems:', problems, ')');
const result = await page.evaluate((mime, schedule, tailSeconds) => window.__record(mime, { schedule, tail: tailSeconds }), mime, schedule, tail);
fs.writeFileSync(outFile, Buffer.from(result.b64, 'base64'));
console.log(`wrote ${outFile} ${(result.size / 1024 / 1024).toFixed(2)} MB ${result.type}`);
console.log(`audio tracks: ${result.audioTracks}, peak level reaching the recorder: ${result.meterPeak?.toFixed(3)}`);

if (probe) {
  const audio = await page.evaluate((b64, mime) => window.__probeAudio(b64, mime), result.b64, result.type.split(';')[0]);
  console.log('audio probe', audio);
}
await browser.close();
