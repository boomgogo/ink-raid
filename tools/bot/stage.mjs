// Set a scene and watch the bot (and the enemies) think, half a second a line.
//
//   AT=x,y,z SPAWNS='[["sketch",x,y,z], ...]' N=40 node tools/bot/stage.mjs
//
// The player is put at AT, the waves are stopped, the SPAWNS are placed, and
// nobody has made contact for 30 s (so the straggler rule is about to apply).
// For reproducing what a run's events.jsonl shows: a stalemate, a trap, a
// place the bot will not leave. This one does write to the game: it is a test
// bench, not a run, and nothing it does is recorded.
import { chromium } from 'playwright';
import path from 'node:path';
import { buildNav } from './navgrid.mjs';
const BOT = path.dirname(new URL(import.meta.url).pathname);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
for (const f of ['clock.js', 'sense.js', 'brain.js', 'driver.js']) await ctx.addInitScript({ path: path.join(BOT, f) });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('THROW', e.message));
await page.goto(process.env.OURS_URL || 'http://localhost:4173/');
for (let i = 0; i < 600; i++) if (await page.evaluate(() => { window.__vt.step(1); return window.__inkReady === true; })) break;
await page.evaluate((n) => { window.__bot.navData = n; }, buildNav());
await page.evaluate(() => window.__bot.start({ seed: 1 }));
await page.locator('[data-difficulty="medium"]').click();
await page.evaluate(() => window.__vt.step(60));
const [x, y, z] = (process.env.AT || '-8,6.3,-21.5').split(',').map(Number);
await page.evaluate((s) => { window.__spawns = s; }, process.env.SPAWNS || '[["sketch",-15.2,0,-12.4]]');
await page.evaluate(([x, y, z]) => {
  const G = window.__ink.game; G.waves.stop(); G.enemies.clear();
  window.__ink.teleport(x, y + 0.1, z);
  const V = G.ctx.player.eye.constructor;
  for (const [t, x, y, z] of JSON.parse(window.__spawns)) G.enemies.spawn(t, new V(x, y + 0.1, z));
  G.enemies.contactT = 30;
}, [x, y, z]);
for (let k = 0; k < Number(process.env.N || 16); k++) {
  await page.evaluate(() => window.__vt.step(30));
  console.log(JSON.stringify(await page.evaluate(() => ({ t: +(performance.now() / 1000).toFixed(1), ...window.__bot.brain.debug(), keys: Object.entries(window.__bot.lastOut()?.keys || {}).filter((x) => x[1]).map((x) => x[0]), pos: window.__bot.lastSnap?.me.pos, pips: window.__bot.lastSnap?.pips, foe: window.__ink.game.enemies.list.map((e) => [e.mind, e.body.pos.toArray().map((v) => +v.toFixed(1)), e.roamTo && e.roamTo.toArray().map((v) => +v.toFixed(1)), +e.lookT.toFixed(1), +e.wallT.toFixed(1), e.straggling, +e.mindT.toFixed(1)]), contact: +window.__ink.game.enemies.contactT.toFixed(0) }))));
}
await browser.close();
