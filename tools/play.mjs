// Record a scripted run around the real map, for judging feel by eye.
//
// The numbers in tools/feel.mjs say the movement is correct. They cannot say
// whether it looks good — whether the bob is too much, the roll too little, the
// landing dip readable, the grapple satisfying. That needs watching.
import { chromium } from 'playwright';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const videoDir = path.join(root, 'shots', 'video');
await mkdir(videoDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--hide-scrollbars', '--mute-audio'] });
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  recordVideo: { dir: videoDir, size: { width: 1280, height: 800 } },
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [page throw]', e.message));
await page.goto(process.env.OURS_URL || 'http://localhost:4173/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__inkReady === true, { timeout: 30000 });
await sleep(1200);

const hold = (a) => page.evaluate((k) => { for (const x of k) window.__ink.input.state[x] = true; }, a);
const release = (a) => page.evaluate((k) => { for (const x of k) window.__ink.input.state[x] = false; }, a);
const tap = (a) => page.evaluate((k) => window.__ink.tap(k), a);
const face = (y, p = 0) => page.evaluate(([a, b]) => window.__ink.face(a, b), [y, p]);
// turning the head is what shows the hatching staying put on a wall
const turn = async (from, to, ms) => {
  const steps = Math.max(1, Math.round(ms / 16));
  for (let i = 0; i <= steps; i++) {
    await page.evaluate(([y]) => window.__ink.face(y, window.__ink.player.pitch), [from + (to - from) * (i / steps)]);
    await sleep(16);
  }
};

async function beat(label, fn) {
  console.log('  ', label);
  await fn();
}

// Start facing the middle of the arena. Left to itself the camera keeps
// whatever pitch the last beat gave it, and half the run ends up filming sky.
const level = await page.evaluate(() => ({ start: window.__ink.level.startPoint }));
const faceCentre = () => {
  const p = level.start;
  return face(Math.atan2(p.x, p.z), -0.02);
};
await faceCentre();
await sleep(300);

await beat('walk', async () => { await hold(['forward']); await sleep(1400); });
await beat('look around while walking', async () => {
  const y0 = await page.evaluate(() => window.__ink.player.yaw);
  await turn(y0, y0 + 1.1, 1100);
  await turn(y0 + 1.1, y0, 900);
});
await beat('sprint', async () => { await hold(['sprint']); await sleep(1600); });
await beat('slide', async () => { await hold(['crouch']); await sleep(1100); await release(['crouch']); });
await beat('jump', async () => { await tap('jump'); await sleep(500); });
await beat('double jump', async () => { await tap('jump'); await sleep(900); });
await beat('strafe past a wall', async () => {
  await release(['forward', 'sprint']);
  await hold(['right']);
  await sleep(1800);
  await release(['right']);
});
await beat('air dash', async () => { await tap('jump'); await sleep(150); await tap('crouch'); await sleep(900); });
await beat('grapple', async () => {
  const a = await page.evaluate(() => {
    const p = window.__ink.player.body.pos;
    const anchors = window.__ink.level.anchors;
    let best = null, bd = 1e9;
    for (const q of anchors) {
      const d = Math.hypot(q.x - p.x, q.z - p.z);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  });
  if (a) {
    const p = await page.evaluate(() => window.__ink.player.body.pos);
    const yaw = Math.atan2(-(a.x - p.x), -(a.z - p.z));
    const pitch = Math.atan2(a.y - (p.y + 1.6), Math.hypot(a.x - p.x, a.z - p.z));
    await face(yaw, Math.min(1.4, pitch));
    await sleep(300);
    await tap('grapple');
    await sleep(1400);
    await tap('jump');
    await sleep(600);
    await face(yaw, -0.05);          // level out, or the rest of the run films sky
    await sleep(700);
  }
});
await beat('run back', async () => { await hold(['forward', 'sprint']); await sleep(1500); await release(['forward', 'sprint']); });

const stats = await page.evaluate(() => window.__ink.stats());
console.log('  stats', JSON.stringify(stats));

await ctx.close();
await browser.close();

const vids = (await readdir(videoDir)).filter((f) => f.endsWith('.webm'));
for (const v of vids) {
  const dest = path.join(videoDir, 'movement.webm');
  const src = path.join(videoDir, v);
  if (src === dest) continue;
  if (existsSync(dest)) await rm(dest);
  await rename(src, dest);
}
console.log('video ->', path.join(videoDir, 'movement.webm'));
