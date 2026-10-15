// Let the bot play a run, and record it frame by frame at broadcast quality.
//
//   node tools/autoplay.mjs                    one recorded run, landscape 1920x1080
//   node tools/autoplay.mjs --runs 5           five runs; the best is reported
//   node tools/autoplay.mjs --portrait         1080x1920, for a Short
//   node tools/autoplay.mjs --fast             no recording: as fast as the page steps
//   node tools/autoplay.mjs --seed 7 --max 900 a seed, and a cap in game seconds
//
// Needs `npm run preview` on port 4173 (or OURS_URL). Writes to OUT_DIR, by
// default /run/media/p1/DRIVE2/ink-raid, one folder per run under runs/:
// video.mp4 (picture), sound.wav, run.mp4 (both), events.jsonl, summary.json.
//
// The game runs on a virtual clock (tools/bot/clock.js) and is photographed
// one 60 fps frame at a time, so the video never drops a frame however slow
// the machine is, and the soundtrack is rendered offline to the same clock.
// The bot (tools/bot/brain.js) plays inside the page through the game's
// inputs only; see the notes at the top of brain.js and sense.js.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { buildNav } from './bot/navgrid.mjs';
const here = path.dirname(new URL(import.meta.url).pathname);
const BOT = path.join(here, 'bot');

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(`--${k}`);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };

const OUT = process.env.OUT_DIR || '/run/media/p1/DRIVE2/ink-raid';
const URL_BASE = process.env.OURS_URL || 'http://localhost:4173/';
const RUNS = Number(opt('runs', 1));
const PORTRAIT = flag('portrait');
const RECORD = !flag('fast');
const SEED0 = Number(opt('seed', Date.now() % 100000));
const MAX_S = Number(opt('max', 1800));            // game seconds
const DIFF = opt('difficulty', 'medium');
// unrecorded runs only need the same frustum, not the pixels: a quarter of the
// size is a sixth of the GPU time on an integrated chip
const SCALE = Number(opt('scale', RECORD ? 1 : 1 / 3));
const [VW, VH] = (PORTRAIT ? [1080, 1920] : [1920, 1080]).map((v) => Math.round(v * SCALE));
const HZ = 60;
const TAG = opt('tag', '');

// --- the bot plays by the rules: a static check --------------------------------
// brain.js decides from the snapshot alone. If it ever names the game, the page
// or a global other than its own, it could be reading or writing what a player
// cannot, and the run would mean nothing.
{
  const src = await readFile(path.join(BOT, 'brain.js'), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [/__ink/, /\bdocument\b/, /window\.(?!__bot\b)/, /\bperformance\b/, /\bglobalThis\b/, /\beval\b/, /\bFunction\(/]
    .filter((r) => r.test(code));
  if (bad.length) { console.error('brain.js reaches past the snapshot:', bad.map(String).join(' ')); process.exit(2); }
}

function ffmpegVideo(file) {
  const ff = spawn('ffmpeg', [
    '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(HZ), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-pix_fmt', 'yuv420p', '-g', String(HZ * 2), file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((r) => ff.on('close', r));
  return {
    async write(buf) { if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r)); },
    async end() { ff.stdin.end(); return done; },
  };
}

function wav(samples, sr) {
  // 16-bit mono, with a gentle limiter so a stacked moment does not clip
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const x = Math.tanh(samples[i] * 1.1);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x * 32767))), 44 + i * 2);
  }
  return buf;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function oneRun(seed, idx) {
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const name = `${stamp}-${PORTRAIT ? 'portrait' : 'landscape'}-s${seed}${TAG ? '-' + TAG : ''}${RECORD ? '' : '-fast'}`;
  const dir = path.join(OUT, 'runs', name);
  await mkdir(dir, { recursive: true });
  const evFile = path.join(dir, 'events.jsonl');
  await writeFile(evFile, '');

  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--hide-scrollbars', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'],
  });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1 });
  for (const f of ['clock.js', 'sense.js', 'brain.js', 'driver.js']) await ctx.addInitScript({ path: path.join(BOT, f) });
  // a clean slate: no remembered settings or best score from a previous run
  await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('__botInit')) { localStorage.clear(); localStorage.setItem('ink_volume', '60'); sessionStorage.setItem('__botInit', '1'); } } catch {} });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); console.log('  [page throw]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await page.goto(URL_BASE, { waitUntil: 'load' });
  for (let i = 0; i < 600; i++) {
    if (await page.evaluate(() => { window.__vt.step(1); return window.__inkReady === true; })) break;
  }
  await page.evaluate((n) => { window.__bot.navData = n; }, NAV);
  const renderer = await page.evaluate(() => {
    const g = document.createElement('canvas').getContext('webgl');
    const d = g?.getExtension('WEBGL_debug_renderer_info');
    return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });

  const video = RECORD ? ffmpegVideo(path.join(dir, 'video.mp4')) : null;
  let frame = 0;
  const t0 = Date.now();
  let stepMs = 0;
  const STEP = `window.__vt.step(1); window.__ink.game.state`;
  async function advance(n) {
    if (!RECORD) {
      const a = Date.now();
      const r = await page.evaluate((k) => { window.__vt.step(k); return window.__ink.game.state; }, n);
      stepMs += Date.now() - a;
      frame += n;
      return r;
    }
    let state;
    for (let i = 0; i < n; i++) {
      const a = Date.now();
      // sent back to back: the session runs them in order, and the round trip is shared
      const ev = cdp.send('Runtime.evaluate', { expression: STEP, returnByValue: true });
      const shot = cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, optimizeForSpeed: true });
      state = (await ev).result.value;
      const { data } = await shot;
      stepMs += Date.now() - a;
      await video.write(Buffer.from(data, 'base64'));
      frame++;
    }
    return state;
  }
  async function drain() {
    const evs = await page.evaluate(() => window.__bot.events());
    if (evs.length) await appendFile(evFile, evs.map((e) => JSON.stringify(e)).join('\n') + '\n');
    return evs;
  }

  // the title screen for a moment, then a real click on PLAY, the way a person starts
  await page.evaluate(() => window.__bot.markStart());
  await page.evaluate((s) => window.__bot.start(s), { seed, overlay: flag('overlay') });
  await advance(Math.round(HZ * 2.5));
  const btn = page.locator(`[data-difficulty="${DIFF}"]`);
  await btn.click();
  await page.evaluate(() => window.__bot.ev('start', {}));
  const startFrame = frame;

  let state = 'playing', deadAt = -1, last = { wave: 0, score: 0 }, lastLog = 0;
  const all = [];
  while (frame - startFrame < MAX_S * HZ) {
    state = await advance(RECORD ? 30 : 60);
    const evs = await drain();
    all.push(...evs.filter((e) => e.type !== 'sample' && e.type !== 'note'));
    for (const e of evs) if (e.type === 'sample') last = e;
    if (state === 'dead' && deadAt < 0) deadAt = frame;
    // hold on the death screen long enough to read it
    if (deadAt >= 0 && frame - deadAt > HZ * 5) break;
    if (state === 'paused') {
      // nothing should pause a headless page; if something did, do what a player does
      await page.mouse.click(VW / 2, VH / 2);
      await page.evaluate(() => window.__bot.ev('unpause', {}));
    }
    const gs = (frame - startFrame) / HZ;
    if (Date.now() - lastLog > (flag('debug') || flag('prof') ? 3000 : 15000)) {
      lastLog = Date.now();
      const rate = (stepMs / Math.max(1, frame)).toFixed(1);
      console.log(`  [${idx}] ${gs.toFixed(0)} s  wave ${last.wave} (${last.ws})  score ${last.score}  hp ${last.hp}  left ${last.left}  ${rate} ms/frame`);
      if (flag('prof')) console.log('      prof', JSON.stringify(await page.evaluate(() => { const p = window.__bot.prof; const o = { sense: +(p.sense / p.n).toFixed(2), brain: +(p.brain / p.n).toFixed(2), game: +(window.__vt.pageMs / p.n).toFixed(2), alive: window.__ink.game.enemies.list.length, fx: window.__ink.game.effects.particles.length }; p.sense = p.brain = p.n = 0; window.__vt.pageMs = 0; return o; })));
      if (flag('debug')) console.log('     ', JSON.stringify(await page.evaluate(() => ({ ...window.__bot.brain.debug(), keys: Object.entries(window.__bot.lastOut()?.keys || {}).filter((x) => x[1]).map((x) => x[0]), pos: window.__bot.lastSnap?.me.pos }))));
    }
  }
  await drain();
  const summary = await page.evaluate(() => {
    const G = window.__ink.game;
    return { state: G.state, wave: G.waves.wave, score: G.score, kills: G.kills, hp: Math.round(G.ctx.player.hp), soundEvents: window.__bot.soundCount() };
  });
  const gameSeconds = (frame - startFrame) / HZ;
  const videoSeconds = frame / HZ;

  // the soundtrack, in 20 s pieces rendered offline and laid end to end
  let soundFile = null;
  if (RECORD) {
    await video.end();
    const SR = 48000, PIECE = 20;
    const total = new Float32Array(Math.ceil((videoSeconds + 3) * SR));
    for (let a = 0; a < videoSeconds; a += PIECE) {
      const b64 = await page.evaluate(([x, y]) => window.__bot.renderAudio(x, y), [a, Math.min(videoSeconds, a + PIECE)]);
      const buf = Buffer.from(b64, 'base64');
      const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      const off = Math.round(a * SR);
      for (let i = 0; i < f.length && off + i < total.length; i++) total[off + i] += f[i];
    }
    soundFile = path.join(dir, 'sound.wav');
    await writeFile(soundFile, wav(total.subarray(0, Math.ceil(videoSeconds * SR)), SR));
    await new Promise((r) => spawn('ffmpeg', ['-v', 'error', '-y', '-i', path.join(dir, 'video.mp4'), '-i', soundFile,
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', path.join(dir, 'run.mp4')],
    { stdio: 'inherit' }).on('close', r));
    // run.mp4 carries the same picture: keep the one file, they are large
    if (existsSync(path.join(dir, 'run.mp4'))) await rm(path.join(dir, 'video.mp4'));
  }
  await browser.close();

  const out = {
    name, dir, seed, portrait: PORTRAIT, recorded: RECORD, difficulty: DIFF, renderer,
    ...summary, gameSeconds, videoSeconds, startSecond: startFrame / HZ,
    deathSecond: deadAt >= 0 ? deadAt / HZ : null,
    wallSeconds: (Date.now() - t0) / 1000, msPerFrame: +(stepMs / Math.max(1, frame)).toFixed(2),
    errors,
    killsByFoe: all.filter((e) => e.type === 'kill').reduce((a, e) => ((a[e.foe] = (a[e.foe] || 0) + 1), a), {}),
    deathBy: all.find((e) => e.type === 'death')?.by || null,
  };
  await writeFile(path.join(dir, 'summary.json'), JSON.stringify(out, null, 2));
  console.log(`  [${idx}] done: wave ${out.wave}, score ${out.score}, ${out.kills} kills, ${gameSeconds.toFixed(0)} s of play, ` +
    `died to ${out.deathBy}${errors.length ? `, ${errors.length} page errors` : ''} -> ${dir}`);
  return out;
}

if (!existsSync(OUT)) { console.error(`no ${OUT}: set OUT_DIR`); process.exit(1); }
const NAV = buildNav();
const results = [];
for (let i = 0; i < RUNS; i++) results.push(await oneRun(SEED0 + i, i));
const best = results.slice().sort((a, b) => b.wave - a.wave || b.score - a.score)[0];
console.log(`\nbest: wave ${best.wave}, score ${best.score}, ${best.gameSeconds.toFixed(0)} s -> ${best.dir}`);
await sleep(10);
