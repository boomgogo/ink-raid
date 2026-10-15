// What the bot's runs say about the game: the playtest numbers.
//
//   node tools/bot/report.mjs [run dirs...]     (default: every run under OUT_DIR/runs)
//
// Per run and over all of them: how far it got, time spent per wave, damage
// taken per wave and by what, what killed it, which guns did the killing,
// where it got stuck, and whether the heap or the particle counts grow over a
// long run (a leak shows up as a slope, not a spike).
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT = process.env.OUT_DIR || '/run/media/p1/DRIVE2/ink-raid';
let dirs = process.argv.slice(2);
if (!dirs.length) {
  const root = path.join(OUT, 'runs');
  dirs = (await readdir(root)).map((d) => path.join(root, d)).filter((d) => existsSync(path.join(d, 'events.jsonl')));
}

const slope = (pts) => {
  // least squares, units per minute
  const n = pts.length;
  if (n < 3) return 0;
  const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let num = 0, den = 0;
  for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den ? (num / den) * 60 : 0;
};

const rows = [];
const total = { hurtBy: {}, deathBy: {}, killsBy: {}, killsWith: {}, stuck: 0, waveTimes: {}, waveDamage: {}, unseenHits: 0, hits: 0 };
for (const dir of dirs) {
  const lines = (await readFile(path.join(dir, 'events.jsonl'), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const sum = existsSync(path.join(dir, 'summary.json')) ? JSON.parse(await readFile(path.join(dir, 'summary.json'), 'utf8')) : {};
  const samples = lines.filter((e) => e.type === 'sample');
  let wave = 0, waveAt = 0, hpPrev = null;
  const r = { run: path.basename(dir), wave: sum.wave, score: sum.score, kills: sum.kills, seconds: Math.round(sum.gameSeconds || 0), deathBy: sum.deathBy, stuck: 0, errors: (sum.errors || []).length };
  for (const e of lines) {
    if (e.type === 'wave') {
      if (wave) (total.waveTimes[wave] ||= []).push(e.t - waveAt);
      wave = e.n; waveAt = e.t;
    }
    if (e.type === 'hurt') {
      total.hits++;
      if (!e.seen) total.unseenHits++;
      total.hurtBy[e.by] = (total.hurtBy[e.by] || 0) + 1;
      const dmg = hpPrev !== null ? Math.max(0, hpPrev - e.hp) : 0;
      (total.waveDamage[wave] ||= []).push(dmg);
      hpPrev = e.hp;
    }
    if (e.type === 'sample') hpPrev = e.hp;
    if (e.type === 'kill') {
      total.killsBy[e.foe] = (total.killsBy[e.foe] || 0) + 1;
      total.killsWith[e.source] = (total.killsWith[e.source] || 0) + 1;
    }
    if (e.type === 'note' && e.msg === 'stuck') { r.stuck++; total.stuck++; }
    if (e.type === 'death') total.deathBy[e.by] = (total.deathBy[e.by] || 0) + 1;
  }
  const t = (k) => samples.filter((s) => s[k] !== null && s[k] !== undefined).map((s) => [s.t, s[k]]);
  r.heapStart = samples[0]?.heap; r.heapEnd = samples.at(-1)?.heap;
  r.heapPerMin = +slope(t('heap')).toFixed(2);
  r.fxPerMin = +slope(t('fx')).toFixed(2);
  r.listPerMin = +slope(t('list')).toFixed(2);
  rows.push(r);
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const lines = [];
lines.push('# Bot runs', '', '| run | wave | score | kills | s | died to | stuck | errors | heap MB (start→end, /min) | list /min |', '|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) lines.push(`| ${r.run} | ${r.wave} | ${r.score} | ${r.kills} | ${r.seconds} | ${r.deathBy} | ${r.stuck} | ${r.errors} | ${r.heapStart}→${r.heapEnd} (${r.heapPerMin}) | ${r.listPerMin} |`);
lines.push('', '## Per wave (all runs)', '', '| wave | runs | mean s | damage taken (mean per run) |', '|---|---|---|---|');
const waves = Object.keys(total.waveTimes).map(Number).sort((a, b) => a - b);
for (const w of waves) {
  const dmg = (total.waveDamage[w] || []).reduce((a, b) => a + b, 0) / Math.max(1, total.waveTimes[w].length);
  lines.push(`| ${w} | ${total.waveTimes[w].length} | ${avg(total.waveTimes[w]).toFixed(0)} | ${dmg.toFixed(0)} |`);
}
const kv = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
lines.push('', `**Hurt by:** ${kv(total.hurtBy)}`, '', `**Hits from nothing on screen:** ${total.unseenHits} of ${total.hits}`,
  '', `**Deaths by:** ${kv(total.deathBy)}`, '', `**Kills of:** ${kv(total.killsBy)}`, '', `**Kills with:** ${kv(total.killsWith)}`,
  '', `**Stuck:** ${total.stuck}`);
const text = lines.join('\n');
console.log(text);
await writeFile(path.join(OUT, 'report.md'), text + '\n');
