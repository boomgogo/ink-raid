// How legible are the enemies, at range, as a number.
//
//   node tools/figures.mjs            10 / 18 / 28 / 40 / 60 m
//   node tools/figures.mjs 25 50      just these
//
// An enemy you cannot pick out at forty metres is an enemy you cannot fight, and
// "can you see them" is an opinion until something counts it. This stands one
// of each regular type in a row at a fixed distance in front of a fixed camera,
// finds the red figures in the frame, and measures how much of each one's
// bounding box is ink: a figure that has closed into a solid shape reads as a
// body, and one that has thinned to a hollow outline does not.
//
// Every type is drawn in red, so every one placed has to be found, and the
// median figure's fill has to sit inside FIGURE_TOL (compare.mjs).
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { figures, FIGURE_TOL } from './compare.mjs';
import { MOVE } from '../src/entities/player.js';

const URL_BASE = process.env.OURS_URL || 'http://localhost:4173/';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'shots', 'stills');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DISTANCES = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : [10, 18, 28, 40, 60];

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--hide-scrollbars', '--mute-audio', '--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [page throw]', e.message.slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text().slice(0, 160)); });

await page.goto(URL_BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__inkReady === true, { timeout: 30000 });
await sleep(700);

await page.evaluate(() => {
  const G = window.__ink.game;
  G.startRun();
});
await sleep(700);

// Stop the wave director and the AI from moving anything: the measurement has
// to be of the same pose every time or it is not a regression test.
await page.evaluate(() => {
  const G = window.__ink.game;
  G.waves.update = () => {};
  G.ctx.enemies.think = () => {};
  G.ctx.enemies.shoot = () => {};
  G.hud.closeScreen();
  G.hud.setGameVisible(false);
  // The paper planes circle the desk from the moment the page loads, and one
  // crossing the lineup hides a figure behind it: take them out of the picture.
  G.planes.update = () => {};
  for (const m of [G.planes.mesh, G.planes.crosses, G.planes.staples]) m.visible = false;
});

const rows = [];
for (const dist of DISTANCES) {
  const placed = await page.evaluate(({ d, eyeHeight }) => {
    const G = window.__ink.game;
    const E = G.ctx.enemies;
    const p = G.ctx.player;
    E.clear();
    // A line of them across the view at a fixed distance, on open ground in the
    // middle of the plaza, with the camera looking along +z at eye height.
    const types = ['sketch', 'cutter', 'punch', 'liner', 'highlighter', 'tape'];
    // Clear air above the desk, all six at the same height as the eye, spaced by
    // METRES rather than by angle.
    //
    // Spacing by angle put the outer figures outside the 106 deg horizontal FOV
    // at short range, and standing them on the plaza floor put the far ones
    // behind the furniture — either way the tool reported figures missing when
    // what was missing was the test. Up here nothing occludes anything and the
    // only thing being measured is the figure.
    const Y = 26;
    // reads the live MOVE.eyeHeight constant (passed in from Node, since MOVE
    // lives in the page's module graph, not on window.__ink) rather than a
    // hardcoded literal, so this stays in step with the camera height Player
    // actually uses
    p.body.pos.set(0, Y - eyeHeight, 0);
    p.body.vel.set(0, 0, 0);
    p.yaw = Math.PI; p.pitch = 0;
    const V = p.eye.constructor;
    let n = 0;
    const step = Math.min(3.4, Math.max(1.2, d * 0.16));
    types.forEach((t, i) => {
      const at = new V((i - (types.length - 1) / 2) * step, Y, d);
      const e = E.spawn(t, at);
      if (!e) return;
      // The mesh is only moved to the body position inside think(), which is
      // stubbed above to keep the pose deterministic — so without this every
      // figure stays at the world origin, which is exactly where the camera is,
      // and the measurement reports "no figures found" while the renderer is
      // working perfectly.
      e.body.pos.copy(at);
      e.fig.root.position.copy(at);
      e.fig.root.rotation.y = Math.PI;          // facing the camera
      n++;
    });
    return n;
  }, { d: dist, eyeHeight: MOVE.eyeHeight });

  await sleep(260);
  const file = path.join(outDir, `lineup-${dist}m.png`);
  await page.screenshot({ path: file, scale: 'css' });
  const m = figures(file);
  // Only the lineup counts. It stands in clear air, level with the camera, so
  // every figure is above the horizon; anything red below it is the desk, and
  // counting that would let a missing figure pass as found.
  const mid = m.size[1] / 2;
  const big = m.figures.filter((f) => f.rel >= FIGURE_TOL.minRel && f.span[1] <= mid);
  const fills = big.map((f) => f.fill).sort((a, b) => a - b);
  const median = fills.length ? fills[fills.length >> 1] : null;
  const heights = big.map((f) => f.box[1]).sort((a, b) => a - b);
  rows.push({ dist, placed, found: big.length, median, px: heights.length ? heights[heights.length >> 1] : null });
}

await browser.close();

console.log(`\n  dist   placed  found   median height   median fill   (band ${FIGURE_TOL.fillMin}-${FIGURE_TOL.fillMax}, target ${FIGURE_TOL.target})`);
let pass = true;
for (const r of rows) {
  const ok = r.median != null && r.median >= FIGURE_TOL.fillMin && r.median <= FIGURE_TOL.fillMax;
  // Losing a figure entirely is the failure this whole measurement exists for.
  // Every type is drawn in red, so every one has to be found.
  const seen = r.found >= r.placed;
  if (!ok || !seen) pass = false;
  console.log(`  ${String(r.dist).padStart(4)}m  ${String(r.placed).padStart(6)}  `
    + `${String(r.found).padStart(5)}  ${String(r.px ?? '-').padStart(13)}   `
    + `${(r.median ?? 0).toFixed(3).padStart(11)}   ${ok && seen ? 'ok' : 'FAIL'}`);
}
console.log(`\n${pass ? 'PASS' : 'FAIL'} — figures stay readable from 10 m to 60 m`);
process.exit(pass ? 0 : 1);
