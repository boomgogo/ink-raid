// Shoot our build in every named camera pose. Deterministic: the poses are
// pinned by name, so round N and round N+1 are comparable frame for frame.
//
//   node tools/shots.mjs                 all poses
//   node tools/shots.mjs wall floor      just these
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const URL_BASE = process.env.OURS_URL || 'http://localhost:4173/';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'shots', 'stills');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--disable-blink-features=AutomationControlled', '--hide-scrollbars', '--mute-audio'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text()); });
page.on('pageerror', (e) => console.log('  [page throw]', e.message));

await mkdir(outDir, { recursive: true });

const SCENE = process.env.SCENE ? `?scene=${process.env.SCENE}` : '';
await page.goto(URL_BASE + SCENE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__inkReady === true, { timeout: 30000 });
await sleep(600);

// Dismiss the menu panel. It is a translucent cream sheet over the middle of the
// frame, and leaving it up makes every style measurement read the panel instead
// of the paper — the gate fails on paper colour and cannot find the ruled lines.
await page.evaluate(() => {
  const g = window.__ink.game;
  if (g) { g.hud.closeScreen(); g.hud.setGameVisible(false); }
});
await sleep(200);

const all = await page.evaluate(() => window.__ink.shots);
const argv = process.argv.slice(2);
const want = argv.length ? (argv[0] === 'calib' ? all.filter((n) => n.startsWith('calib-')) : argv) : all.filter((n) => !n.startsWith('calib-'));

for (const name of want) {
  if (!all.includes(name)) { console.log('  ? unknown pose', name); continue; }
  await page.evaluate((n) => window.__ink.shot(n), name);
  await sleep(350);
  await page.screenshot({ path: path.join(outDir, `${name}.png`), scale: 'css' });
  console.log('  shot', name);
}

const stats = await page.evaluate(() => window.__ink.stats());
console.log('  stats', JSON.stringify(stats));

await browser.close();
