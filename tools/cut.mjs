// Cut the bot's recorded runs into the videos people watch.
//
//   node tools/cut.mjs --long <run dir> [--short <portrait run dir>] [--x <run dir>]
//                      [--link <play url>] [--text]
//
// --text writes only the .txt posts, from the same picks, without encoding.
//
// Out, in OUT_DIR/out (default /run/media/p1/DRIVE2/ink-raid/out):
//
//   youtube_long.mp4   the whole run, title screen to death screen, one take
//   youtube_long.txt   a description with chapters from the waves and bosses
//   thumbnail.png      1280x720, the best moment and the wave reached
//   short.mp4          1080x1920, 45-58 s of the portrait run's best moments
//   short.txt          the Short's title and description
//   x.mp4              1920x1080, 30-45 s of the long run's best moments, captioned
//   x.txt              the post to go with it, within X's 280 characters
//   cuts.json          which windows went in, and why
//
// Highlights come from the run's events.jsonl (tools/autoplay.mjs): kills
// weighted by combo, headshots and bosses, grouped into moments, and the best
// moments taken until the length is reached. The best one goes first, so a
// viewer scrolling past sees action in the first two seconds; the rest keep
// their order in the run. Titles and captions are drawn in Kalam, the game's
// own hand, by rendering them in Chrome: ffmpeg has no woff2.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const OUT = process.env.OUT_DIR || '/run/media/p1/DRIVE2/ink-raid';
const DEST = path.join(OUT, 'out');
const TMP = path.join(DEST, 'tmp');
await mkdir(TMP, { recursive: true });

const LONG = opt('long');
const SHORT = opt('short');
const XRUN = opt('x', LONG);
const LINK = opt('link', '<link>');
const TEXT = argv.includes('--text');
if (!LONG && !SHORT) { console.error('usage: cut.mjs --long <run dir> [--short <run dir>] [--x <run dir>]'); process.exit(1); }

function ff(args, label) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg failed: ${label}`))));
  });
}
function probe(file) {
  return new Promise((res) => {
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
    let o = '';
    p.stdout.on('data', (d) => (o += d));
    p.on('close', () => res(Number(o.trim())));
  });
}
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

async function loadRun(dir) {
  const events = (await readFile(path.join(dir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const summary = JSON.parse(await readFile(path.join(dir, 'summary.json'), 'utf8'));
  return { dir, events, summary, video: path.join(dir, 'run.mp4'), duration: await probe(path.join(dir, 'run.mp4')) };
}

// --- what is worth watching --------------------------------------------------------
const BOSS_NAMES = { author: 'THE AUTHOR', stapler: 'THE STAPLER', stamp: 'THE STAMP' };
function moments(run) {
  const interest = [];
  for (const e of run.events) {
    let w = 0;
    if (e.type === 'kill') w = 1 + (e.crit ? 0.5 : 0) + (e.boss ? 5 : 0) + Math.min(e.combo || 1, 9) * 0.15;
    else if (e.type === 'plane') w = 0.5;
    else if (e.type === 'wave' && e.boss) w = 1.5;
    else if (e.type === 'note' && /^grenade/.test(e.msg)) w = 0.6;
    if (w > 0) interest.push({ t: e.t, w, e });
  }
  interest.sort((a, b) => a.t - b.t);
  const groups = [];
  for (const i of interest) {
    const g = groups[groups.length - 1];
    if (g && i.t - g.last < 6) { g.last = i.t; g.items.push(i); } else groups.push({ first: i.t, last: i.t, items: [i] });
  }
  const waveAt = (t) => run.events.filter((e) => e.type === 'wave' && e.t <= t).slice(-1)[0];
  return groups.map((g) => {
    let a = g.first - 2.5, b = g.last + 1.8;
    // a long brawl: the best 12 s of it
    if (b - a > 12) {
      let best = a, bs = -1;
      for (let s = a; s + 12 <= b; s += 0.5) {
        const sc = g.items.filter((i) => i.t >= s + 1 && i.t <= s + 11).reduce((x, i) => x + i.w, 0);
        if (sc > bs) { bs = sc; best = s; }
      }
      a = best; b = best + 12;
    }
    const items = g.items.filter((i) => i.t >= a && i.t <= b);
    const kills = items.filter((i) => i.e.type === 'kill');
    const boss = kills.find((i) => i.e.boss);
    const combo = Math.max(1, ...kills.map((i) => i.e.combo || 1));
    const w = waveAt(a);
    const caption = boss ? `${BOSS_NAMES[boss.e.foe] || 'THE BOSS'} DOWN`
      : combo >= 4 ? `x${combo} COMBO`
        : w?.boss ? 'BOSS WAVE' : null;
    return {
      a: Math.max(0, a), b: Math.min(run.duration - 0.1, b),
      score: items.reduce((x, i) => x + i.w, 0), kills: kills.length, caption, wave: w?.n ?? 1,
      peak: (boss || kills.sort((x, y) => y.w - x.w)[0] || items[0]).t,
    };
  });
}

function pick(ms, lo, hi) {
  const ranked = ms.slice().sort((x, y) => y.score - x.score);
  const out = [];
  let len = 0;
  for (const m of ranked) {
    const l = m.b - m.a;
    if (len + l > hi) continue;
    out.push(m);
    len += l;
    if (len >= lo) break;
  }
  const [hook, ...rest] = out;
  return { list: hook ? [hook, ...rest.sort((x, y) => x.a - y.a)] : [], length: len };
}

// --- cards, in the game's hand --------------------------------------------------------
let browser = null;
async function card(file, w, h, html) {
  browser ||= await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const font = (await readFile(path.join(root, 'public/fonts/kalam-latin.woff2'))).toString('base64');
  await page.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Kalam; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 300 700; }
    html, body { margin: 0; background: transparent; width: ${w}px; height: ${h}px; overflow: hidden; }
    body { font-family: Kalam, cursive; color: #1d1d22; display: flex; flex-direction: column; align-items: center; justify-content: center; }
    .halo { text-shadow: 0 0 6px #f4f1ea, 0 0 12px #f4f1ea, 0 0 18px #f4f1ea; }
    .red { color: #c8102e; }
    .panel { background: rgba(244, 241, 234, .9); border: 2px solid #1d1d22; border-radius: 14px; padding: .1em .6em; box-shadow: 4px 5px 0 rgba(29, 29, 34, .18); text-align: center; }
  </style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: file, omitBackground: true });
  await page.close();
  return file;
}

/** Cut [a, b] of `video` into a segment of its own, with the sound faded at both ends. */
async function segment(video, a, b, file, vf = null) {
  const d = b - a;
  await ff(['-ss', a.toFixed(3), '-i', video, '-t', d.toFixed(3),
    ...(vf ? ['-vf', vf] : []),
    '-af', `afade=t=in:d=0.12,afade=t=out:st=${(d - 0.2).toFixed(3)}:d=0.2`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-r', '60', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', file], `segment ${a}-${b}`);
  return file;
}

async function join(segs, file) {
  const list = path.join(TMP, `${path.basename(file)}.txt`);
  await writeFile(list, segs.map((s) => `file '${s}'`).join('\n'));
  await ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', file], 'join');
  return file;
}

/** Lay cards over a video at given times, normalise the loudness, and write the final file. */
async function finish(video, cards, file, maxrate = '40M') {
  const inputs = ['-i', video];
  const parts = [];
  let last = '0:v';
  cards.forEach((c, i) => {
    // only as long as it shows: setpts moves it to `at`, and a longer one holds the
    // last frame of the video on screen until it runs out
    inputs.push('-loop', '1', '-t', String(c.dur + 0.1), '-i', c.png);
    const fo = Math.max(0, c.dur - 0.35);
    parts.push(`[${i + 1}:v]format=rgba,fade=t=in:st=0:d=0.3:alpha=1,fade=t=out:st=${fo.toFixed(2)}:d=0.35:alpha=1,setpts=PTS+${c.at.toFixed(3)}/TB[c${i}]`);
    parts.push(`[${last}][c${i}]overlay=x=${c.x ?? '(W-w)/2'}:y=${c.y ?? '(H-h)/2'}:enable='between(t,${c.at.toFixed(3)},${(c.at + c.dur).toFixed(3)})'[v${i}]`);
    last = `v${i}`;
  });
  const fc = parts.length ? ['-filter_complex', parts.join(';'), '-map', `[${last}]`] : ['-map', '0:v'];
  await ff([...inputs, ...fc, '-map', '0:a', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-maxrate', maxrate, '-bufsize', String(parseInt(maxrate) * 2) + 'M', '-r', '60', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', file], `finish ${path.basename(file)}`);
  return file;
}

const cuts = {};

/** YouTube wants the first chapter at 0:00 and each at least 10 s apart. */
function chapters(run) {
  const out = [{ t: 0, label: 'Title screen' }];
  for (const e of run.events) {
    if (e.type !== 'wave') continue;
    const label = e.boss ? `Wave ${e.n}: boss` : `Wave ${e.n}${e.mod ? ` (${e.mod.toLowerCase()})` : ''}`;
    if (e.t - out[out.length - 1].t >= 10) out.push({ t: e.t, label });
  }
  const death = run.events.find((e) => e.type === 'death');
  if (death && death.t - out[out.length - 1].t >= 10) out.push({ t: death.t, label: 'The end' });
  return out;
}

// --- the posts that go with the reels ----------------------------------------------------
// The opening moment is the hook, said in words as well: both autoplay muted.
function hook(m) {
  const boss = m?.caption?.match(/^(.+) DOWN$/);
  if (boss) return `Taking down ${boss[1]} in a shooter drawn in pen`;
  const combo = m?.caption?.match(/^x(\d+) COMBO$/);
  if (combo) return `An x${combo[1]} combo in a shooter drawn in pen`;
  if (m?.caption === 'BOSS WAVE') return 'A boss wave in a shooter drawn in pen';
  return 'Ink Raid: a first-person shooter drawn in pen on paper';
}
// X counts every link as 23 characters, whatever its length
const xLength = (t) => t.replace(/https?:\/\/\S+|<link>/g, 'x'.repeat(23)).length;

function posts(name, run, list) {
  const s = run.summary;
  const pts = s.score.toLocaleString('en');
  const h = hook(list[0]);
  if (name === 'short') {
    // YouTube: a title of at most 100 characters, then the description
    const title = `${h} #Shorts`;
    if (title.length > 100) console.warn(`short.txt: the title is ${title.length} characters, over 100`);
    return [
      'TITLE', title, '',
      'DESCRIPTION',
      'Ink Raid: a first-person shooter drawn as pen on paper, running in the browser, on desktop or phone. Everything on screen is drawn from code at run time, and every sound is synthesised.',
      '',
      `This run: wave ${s.wave}, ${pts} points, ${s.kills} kills. Played by an autoplay bot held to human limits.`,
      '',
      `Play it: ${LINK}`,
      '',
      '#Shorts #indiegame #fps #browsergame #threejs',
    ].join('\n');
  }
  // X: 280 characters; drop the least needed lines until it fits
  const lines = [
    `${h}.`,
    'Ink Raid runs in your browser, on desktop or phone. Every line is drawn from code as you play.',
    `Bot run: wave ${s.wave}, ${pts} points, ${s.kills} kills.`,
    `Play it: ${LINK}`,
    '#indiedev #threejs',
  ];
  let text = lines.join('\n\n');
  for (const drop of [4, 1]) {
    if (xLength(text) <= 280) break;
    lines.splice(drop, 1);
    text = lines.join('\n\n');
  }
  if (xLength(text) > 280) console.warn(`x.txt: ${xLength(text)} characters, over 280`);
  return text;
}

// --- 1. the long one: the whole run --------------------------------------------------
if (LONG) {
  const run = await loadRun(LONG);
  const s = run.summary;
  const ch = chapters(run);
  const kb = Object.entries(s.killsByFoe || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
  const desc = [
    `Ink Raid: one continuous run, from the title screen to the last wave. Wave ${s.wave}, ${s.score.toLocaleString('en')} points, ${s.kills} kills, ${mmss(s.gameSeconds)} of play on the standard difficulty.`,
    '',
    'A first-person shooter drawn as pen on paper, in the browser. Everything on screen is drawn from code at run time, and every sound is synthesised.',
    '',
    'Played by an autoplay bot held to human limits (reaction time, mouse speed, only what is on screen), recorded frame by frame at 1080p60.',
    '',
    `Play it: ${LINK}`,
    '',
    ...ch.map((c) => `${mmss(c.t)} ${c.label}`),
    '',
    `Kills: ${kb}`,
    '',
    '#indiegame #fps #browsergame #threejs #gamedev',
  ].join('\n');
  await writeFile(path.join(DEST, 'youtube_long.txt'), desc + '\n');
  console.log(`youtube_long.txt: ${ch.length} chapters`);
}
if (LONG && !TEXT) {
  const run = await loadRun(LONG);
  const s = run.summary;
  const startT = s.startSecond ?? 2.5;
  // the game's own title screen is the title; this only says what follows
  const title = await card(path.join(TMP, 'title.png'), 1920, 160,
    `<div class="panel" style="font-size:52px">one run, start to finish</div>`);
  const endT = s.deathSecond ?? run.duration - 5;
  const end = await card(path.join(TMP, 'end.png'), 1920, 300,
    `<div class="panel" style="font-size:88px;font-weight:700;line-height:1.2">WAVE ${s.wave} &middot; <span class="red">${s.score.toLocaleString('en')}</span></div>`);
  await finish(run.video, [
    { png: title, at: 0.3, dur: Math.max(2.2, startT + 1.5), y: 'H-h-40' },
    { png: end, at: Math.min(run.duration - 4.6, endT + 0.4), dur: 4.2, y: 'H-h-90' },
  ], path.join(DEST, 'youtube_long.mp4'));

  // the thumbnail: the best moment, and the wave it got to
  const best = moments(run).sort((a, b) => b.score - a.score)[0];
  const at = best ? best.peak + 0.15 : run.duration / 2;
  const frame = path.join(TMP, 'thumb-frame.png');
  await ff(['-ss', at.toFixed(3), '-i', run.video, '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', frame], 'thumb frame');
  const bg = (await readFile(frame)).toString('base64');
  await card(path.join(DEST, 'thumbnail.png'), 1280, 720,
    `<img src="data:image/png;base64,${bg}" style="position:absolute;inset:0;width:1280px;height:720px">
     <div class="panel" style="position:absolute;left:36px;bottom:30px;text-align:left;padding:6px 28px 2px">
       <div style="font-size:132px;font-weight:700;line-height:.95">WAVE <span class="red">${s.wave}</span></div>
       <div style="font-size:50px;font-weight:700;line-height:1.3">INK RAID &middot; ${s.score.toLocaleString('en')}</div>
     </div>`);
  cuts.long = { run: run.dir, duration: run.duration, chapters: chapters(run), thumbnailAt: at };
  console.log(`youtube_long.mp4: ${mmss(run.duration)}, wave ${s.wave}, score ${s.score}`);
}

// --- 2. and 3. the highlight reels ----------------------------------------------------
async function reel(run, { name, lo, hi, w, h, captions }) {
  const ms = moments(run);
  const { list, length } = pick(ms, lo, hi);
  await writeFile(path.join(DEST, `${name}.txt`), posts(name, run, list) + '\n');
  console.log(`${name}.txt: opens on ${list[0]?.caption || 'no caption'}`);
  if (TEXT) return;
  const segs = [];
  for (let i = 0; i < list.length; i++) segs.push(await segment(run.video, list[i].a, list[i].b, path.join(TMP, `${name}-${i}.mp4`),
    `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`));
  const joined = await join(segs, path.join(TMP, `${name}-joined.mp4`));
  const cards = [];
  let t = 0;
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    // the opening one always says what this is: X and Shorts start muted
    if (i === 0 && !m.caption) m.caption = 'INK RAID';
    if (captions && m.caption) {
      const png = await card(path.join(TMP, `${name}-cap${i}.png`), w, Math.round(Math.min(w, h) * 0.3),
        `<div class="panel" style="font-size:${Math.round(w / 18)}px;font-weight:700">${m.caption}</div>`);
      cards.push({ png, at: t + 0.2, dur: Math.min(2.6, m.b - m.a - 0.3), y: Math.round(h * 0.12) });
    }
    t += m.b - m.a;
  }
  const s = run.summary;
  const outro = await card(path.join(TMP, `${name}-outro.png`), w, Math.round(h * 0.3),
    `<div class="panel"><div style="font-size:${Math.round(w / 9)}px;font-weight:700;line-height:1.1">INK RAID</div>
     <div style="font-size:${Math.round(w / 22)}px">wave ${s.wave} &middot; ${s.score.toLocaleString('en')} points</div></div>`);
  cards.push({ png: outro, at: Math.max(0, t - 2.6), dur: 2.5, y: `(H-h)/2` });
  await finish(joined, cards, path.join(DEST, `${name}.mp4`), name === 'x' ? '20M' : '40M');
  cuts[name] = { run: run.dir, length, clips: list };
  console.log(`${name}.mp4: ${length.toFixed(1)} s from ${list.length} moments`);
}

if (SHORT) await reel(await loadRun(SHORT), { name: 'short', lo: 45, hi: 58, w: 1080, h: 1920, captions: true });
if (XRUN) await reel(await loadRun(XRUN), { name: 'x', lo: 30, hi: 45, w: 1920, h: 1080, captions: true });

// added to what earlier cuts wrote: a Short cut on its own keeps the long video's entry
if (!TEXT) {
  const prev = existsSync(path.join(DEST, 'cuts.json')) ? JSON.parse(await readFile(path.join(DEST, 'cuts.json'), 'utf8')) : {};
  await writeFile(path.join(DEST, 'cuts.json'), JSON.stringify({ ...prev, ...cuts }, null, 2));
}
await browser?.close();
if (existsSync(TMP) && !argv.includes('--keep')) await rm(TMP, { recursive: true });
