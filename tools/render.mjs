// The renderer's own gate: what the page must and must not draw, measured.
//
//   node tools/render.mjs            everything
//   node tools/render.mjs floor ink  just these (names as printed)
//
// Runs against `npm run preview` on port 4173 in a visible Chrome, like the
// other tools. Every check prints PASS or FAIL; any FAIL exits non-zero.
// Captures land in shots/render/.
//
// The measurements lean on the page's debug views (Pipeline.setView): 'edges'
// is the outlines alone, 'pattern' the pattern's ink before any fade, 'tone'
// the tone, 'ink' each surface's ink flat, 'depth' the depth with the held
// weapon in blue. They are the page buffer's channels, drawn one at a time.
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodeInkLook, decodeInkLook } from '../src/render/pack.js';
import { INK, INK_COUNT, INK_RGB, LOOK, LOOK_COUNT } from '../src/render/palette.js';
import { toneTargets } from '../src/render/tone.js';
import { pixelRatio } from '../src/render/pixels.js';

const URL_BASE = process.env.OURS_URL || 'http://localhost:4173/';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'shots', 'render');
mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => !only.length || only.some((o) => name.startsWith(o));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${detail}`);
}

// --- images ------------------------------------------------------------------

const decode = (buf) => { const p = PNG.sync.read(buf); return { w: p.width, h: p.height, d: p.data }; };
const px = (img, x, y) => {
  const i = ((y | 0) * img.w + (x | 0)) * 4;
  return [img.d[i], img.d[i + 1], img.d[i + 2]];
};
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const inside = (img, x, y) => x >= 0 && y >= 0 && x < img.w && y < img.h;
// captured grey -> the grey the page wrote; identity until calibrated (below)
let GREY = Array.from({ length: 256 }, (_, i) => i);
/** Ink on the paper: 0 for white, 1 for black, from a debug view drawn black on white. */
const inkAt = (img, x, y) => (inside(img, x, y) ? 1 - GREY[Math.round(lum(px(img, x, y)))] / 255 : 0);

function pointInPoly(x, y, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
function shrink(poly, k) {
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  return poly.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
function polyPixels(img, poly) {
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const out = [];
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(img.h - 1, Math.ceil(Math.max(...ys))); y++) {
    for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(img.w - 1, Math.ceil(Math.max(...xs))); x++) {
      if (pointInPoly(x + 0.5, y + 0.5, poly)) out.push([x, y]);
    }
  }
  return out;
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

/** Normalised cross-correlation of two grey images over a rectangle, at a shift. */
function ncc(a, b, rect, dx, dy) {
  let sa = 0, sb = 0, n = 0;
  const [x0, y0, x1, y1] = rect;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (!inside(b, x + dx, y + dy)) continue;
    sa += inkAt(a, x, y); sb += inkAt(b, x + dx, y + dy); n++;
  }
  const ma = sa / n, mb = sb / n;
  let num = 0, va = 0, vb = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (!inside(b, x + dx, y + dy)) continue;
    const p = inkAt(a, x, y) - ma, q = inkAt(b, x + dx, y + dy) - mb;
    num += p * q; va += p * p; vb += q * q;
  }
  return num / Math.sqrt(va * vb + 1e-12);
}
/** The shift of b against a that matches best, to a tenth of a pixel. */
function bestShift(a, b, rect, range) {
  let best = { dx: 0, dy: 0, r: -2 };
  for (let dy = -range[1]; dy <= range[1]; dy++) for (let dx = -range[0]; dx <= range[0]; dx++) {
    const r = ncc(a, b, rect, dx, dy);
    if (r > best.r) best = { dx, dy, r };
  }
  // a parabola through the peak and its neighbours, each way
  const sub = (m, z, p) => (m - 2 * z + p !== 0 ? (0.5 * (m - p)) / (m - 2 * z + p) : 0);
  const fx = sub(ncc(a, b, rect, best.dx - 1, best.dy), best.r, ncc(a, b, rect, best.dx + 1, best.dy));
  const fy = sub(ncc(a, b, rect, best.dx, best.dy - 1), best.r, ncc(a, b, rect, best.dx, best.dy + 1));
  return { dx: best.dx + fx, dy: best.dy + fy, r: best.r };
}

/** 8-connected components of a mask. */
function components(w, h, mask) {
  const lab = new Int32Array(w * h).fill(-1);
  const out = [];
  const st = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    const pts = [];
    st.push(i); lab[i] = out.length;
    while (st.length) {
      const q = st.pop();
      pts.push(q);
      const qx = q % w, qy = (q / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (mask[n] && lab[n] < 0) { lab[n] = out.length; st.push(n); }
      }
    }
    out.push(pts);
  }
  return out;
}
/** Shape of a blob: area, length, elongation, principal direction, spread off that direction. */
function shape(pts, w) {
  let sx = 0, sy = 0;
  for (const q of pts) { sx += q % w; sy += (q / w) | 0; }
  const n = pts.length, mx = sx / n, my = sy / n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (const q of pts) { const x = (q % w) - mx, y = ((q / w) | 0) - my; cxx += x * x; cyy += y * y; cxy += x * y; }
  cxx /= n; cyy /= n; cxy /= n;
  const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l2 = Math.max(1e-6, tr / 2 - Math.sqrt(Math.max(0, (tr * tr) / 4 - det)));
  const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  let perp = 0, along = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) {
    const qx = q % w, qy = (q / w) | 0, x = qx - mx, y = qy - my;
    perp = Math.max(perp, Math.abs(-uy * x + ux * y));
    along = Math.max(along, Math.abs(ux * x + uy * y));
    x0 = Math.min(x0, qx); y0 = Math.min(y0, qy); x1 = Math.max(x1, qx); y1 = Math.max(y1, qy);
  }
  return { n, mx, my, elong: Math.sqrt((l1 + 0.083) / (l2 + 0.083)), ang, perp, len: 2 * along + 1, box: [x0, y0, x1, y1] };
}

// --- in node, before the browser -------------------------------------------------

if (want('pack')) {
  let bad = 0, n = 0;
  for (let ink = 0; ink < INK_COUNT; ink++) for (let look = 0; look < LOOK_COUNT; look++) {
    // what an UNORM8 target stores: the nearest of 256 steps
    const stored = Math.round(encodeInkLook(ink, look) * 255) / 255;
    const back = decodeInkLook(stored);
    n++;
    if (back.ink !== ink || back.look !== look) bad++;
  }
  check('pack: ink and look', bad === 0 && n === INK_COUNT * LOOK_COUNT, `${n - bad}/${n} combinations round-trip through 8 bits`);
}

if (want('glsl')) {
  // every template literal in src/ that is shader code is tagged, so the build
  // can strip its comments (vite.config.js)
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk(path.join(root, 'src'));
  const looksGlsl = /\b(void\s+main|uniform\s|gl_Position|gl_FragCoord|texelFetch|smoothstep|vec[234]\s*\(|precision\s+highp)/;
  let tagged = 0;
  const untagged = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const re = /`([^`]*)`/g;
    let m;
    while ((m = re.exec(src))) {
      if (!looksGlsl.test(m[1])) continue;
      if (src.slice(Math.max(0, m.index - 11), m.index) === '/* glsl */ ') tagged++;
      else untagged.push(`${path.relative(root, f)}:${src.slice(0, m.index).split('\n').length}`);
    }
  }
  check('glsl: every shader tagged', untagged.length === 0 && tagged > 0,
    `${tagged} tagged${untagged.length ? `, untagged at ${untagged.join(' ')}` : ''}`);
}

if (want('curve')) {
  // the curve the shader runs (tone.js): total coverage never falls
  let prev = 0, worst = 0;
  for (let t = 0; t <= 1.0001; t += 0.005) {
    const c = toneTargets(t).c;
    worst = Math.min(worst, c - prev);
    prev = c;
  }
  check('curve: coverage monotone', worst > -1e-9, `worst step ${worst.toExponential(1)}, ${toneTargets(0).c.toFixed(2)} lit to ${toneTargets(1).c.toFixed(2)} dark`);
}

// --- in the browser ----------------------------------------------------------------

const browserNeeded = ['boot', 'floor', 'silhouette', 'crease', 'tone', 'stipple', 'anchor', 'density', 'still', 'ink', 'weapon', 'instanced', 'phone']
  .some((n) => want(n));
if (!browserNeeded) finish();

const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--hide-scrollbars', '--mute-audio', '--disable-blink-features=AutomationControlled'],
});

// What each ink looks like by the time a screenshot has it. The capture does
// not hand back the values the page wrote — on this machine #131318 comes back
// as (26, 26, 30), for a CSS box as much as for the canvas — so the inks are
// measured the same way: a swatch of each, in CSS, through the same screenshot.
const SEEN = await (async () => {
  const page = await browser.newPage({ viewport: { width: 40 * INK_COUNT, height: 40 } });
  const hex = (c) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
  await page.setContent(`<body style="margin:0;display:flex">${INK_RGB.map((c) => `<div style="width:40px;height:40px;background:${hex(c)}"></div>`).join('')}</body>`);
  const img = decode(await page.screenshot());
  await page.close();
  return INK_RGB.map((_, i) => px(img, i * 40 + 20, 20));
})();
const isInk = (c, i) => c.every((v, k) => Math.abs(v - SEEN[i][k]) <= 2);
// ...and the same for every grey, so a view's value can be read back exactly
{
  const page = await browser.newPage({ viewport: { width: 256, height: 128 } });
  await page.setContent(`<body style="margin:0;display:flex;flex-wrap:wrap;width:256px">${Array.from({ length: 256 }, (_, v) => `<div style="width:16px;height:8px;background:rgb(${v},${v},${v})"></div>`).join('')}</body>`);
  const img = decode(await page.screenshot());
  await page.close();
  const seen = Array.from({ length: 256 }, (_, v) => lum(px(img, (v % 16) * 16 + 8, ((v / 16) | 0) * 8 + 4)));
  GREY = Array.from({ length: 256 }, (_, c) => {
    let best = 0;
    for (let v = 1; v < 256; v++) if (Math.abs(seen[v] - c) < Math.abs(seen[best] - c)) best = v;
    return best;
  });
}

/** A page, with every console warning and error kept. */
async function open(query, o = {}) {
  const ctx = await browser.newContext({
    viewport: { width: o.w ?? 1280, height: o.h ?? 800 },
    deviceScaleFactor: o.dsf ?? 1, isMobile: !!o.mobile, hasTouch: !!o.mobile,
  });
  const page = await ctx.newPage();
  const noise = [];
  page.on('console', (m) => {
    const t = m.type();
    // the only 404 is the favicon, which the page does not have
    if ((t === 'error' || t === 'warning') && !/Failed to load resource/.test(m.text())) noise.push(`${t}: ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => noise.push(`throw: ${e.message}`));
  await page.goto(URL_BASE + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__inkReady === true, { timeout: 30000 });
  await page.waitForTimeout(400);
  return { ctx, page, noise };
}
const frames = (page, n = 3) => page.evaluate((k) => new Promise((r) => {
  let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f);
}), n);
async function grab(page, view, name) {
  await page.evaluate((v) => window.__ink.renderer.setView(v), view);
  await frames(page);
  const buf = await page.screenshot({ scale: 'css' });
  if (name) writeFileSync(path.join(outDir, `${name}-${view}.png`), buf);
  return decode(buf);
}
const pose = (page, eye, at) => page.evaluate(([e, a]) => window.__ink.poseLook(e, a), [eye, at]);
/** World points to CSS pixels, through the camera as it is now. */
const project = (page, pts) => page.evaluate((list) => {
  const cam = window.__ink.camera;
  cam.updateMatrixWorld();
  const V = cam.position.constructor;
  return list.map(([x, y, z]) => {
    const v = new V(x, y, z).project(cam);
    return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight, v.z];
  });
}, pts);

/** A pinned calibration page: the camera is ours, the player does not touch it. */
async function calibPage() {
  const o = await open('?scene=calib');
  await o.page.evaluate(() => window.__ink.shot('calib-ladder'));
  return o;
}

const cubeCorners = (cx, cy, cz, s, h = s) => {
  const out = [];
  for (const x of [-s / 2, s / 2]) for (const y of [0, h]) for (const z of [-s / 2, s / 2]) out.push([cx + x, cy + y, cz + z]);
  return out;
};

// --- 1. clean boot, and 13. the phone's resolution -------------------------------

if (want('boot') || want('phone')) {
  for (const tier of [
    { name: 'desktop', w: 1280, h: 800, dsf: 1 },
    { name: 'phone', w: 390, h: 844, dsf: 2, mobile: true },
  ]) {
    const { ctx, page, noise } = await open('', tier);
    // a run as well as the menu: the weapon, the figures and the effects
    // compile their programs on first sight
    await page.evaluate(() => {
      const G = window.__ink.game;
      G.startRun();
      const E = G.ctx.enemies, p = G.ctx.player, V = p.eye.constructor;
      for (const [i, t] of ['sketch', 'cutter', 'punch'].entries()) E.spawn(t, new V(-4 + i * 4, 0.3, 4), { mind: 'hunt' });
      G.effects.burst(new V(0, 1, 8), new V(0, 1, 0), 10, {});
      G.effects.hurt = 1;
    });
    await page.waitForTimeout(1500);
    for (const v of ['edges', 'tone', 'pattern', 'ink', 'depth', 'final']) {
      await page.evaluate((x) => window.__ink.renderer.setView(x), v);
      await frames(page, 2);
    }
    const programs = await page.evaluate(() => window.__ink.renderer.renderer.info.programs.length);
    if (want('boot')) check(`boot: ${tier.name}`, noise.length === 0, noise.length ? noise.slice(0, 3).join(' | ') : `no WebGL or shader warnings, ${programs} programs`);
    if (tier.mobile && want('phone')) {
      const s = await page.evaluate(() => ({ ...window.__ink.renderer.size, cw: document.getElementById('c').width, ch: document.getElementById('c').height, dpr: devicePixelRatio, touch: matchMedia('(pointer: coarse)').matches }));
      const r = pixelRatio(s.cssW, s.cssH, s.dpr, s.touch);
      const ok = s.touch && Math.abs(s.ratio - r) < 1e-6 && s.w === Math.floor(s.cssW * r) && s.h === Math.floor(s.cssH * r) && s.cw === s.w && s.ch === s.h;
      check('phone: internal resolution', ok, `${s.cssW}x${s.cssH} css at dpr ${s.dpr} -> ratio ${s.ratio} (policy ${r}), drawn at ${s.w}x${s.h}, canvas ${s.cw}x${s.ch}`);
    }
    await ctx.close();
  }
}

// --- 2. a flat floor draws no outline ---------------------------------------------

if (want('floor')) {
  const { ctx, page } = await open('?scene=calib&view=edges');
  await page.evaluate(() => window.__ink.shot('calib-floor'));
  // from the south edge of the objects, looking away from all of them: 160 m
  // of floor to its far edge, and nothing on it
  const eye = [0, 1.7, 40];
  await pose(page, eye, [0, 1.7 - Math.tan(0.35) * 100, 140]);
  const img = await grab(page, 'edges', 'floor');
  const [edge] = await project(page, [[0, 0, 200]]);
  let ink = 0, n = 0;
  const y0 = Math.ceil(edge[1]) + 4;
  for (let y = y0; y < img.h; y++) for (let x = 0; x < img.w; x++) { n++; if (inkAt(img, x, y) > 0.2) ink++; }
  check('floor: no outline', ink <= n * 1e-4, `${ink} line pixels in ${n} of floor below its far edge (row ${y0})`);
  await ctx.close();
}

// --- 3. silhouettes and 8. density, on the cubes from 8 m to 128 m ------------------

if (want('silhouette') || want('density')) {
  const { ctx, page } = await calibPage();
  const cover = [];
  const dens = { front: [], side: [] };
  for (const d of [8, 16, 32, 64, 128]) {
    const c = [0, 2, -d];
    const a = (55 * Math.PI) / 180;
    // from the west-south-west and a little above, so the top, the front (+z)
    // and the west face (-x) are all in view: at 55 degrees off the front the
    // sightline clears the cylinder, the sphere and the walls at every distance,
    // and no other cube is behind this one
    await pose(page, [c[0] - d * Math.sin(a), 3.5, c[2] + d * Math.cos(a)], c);
    const corners = cubeCorners(0, 0, -d, 4);
    const P = await project(page, corners);
    const H = hull(P.map((p) => [p[0], p[1]]));
    if (want('silhouette')) {
      const img = await grab(page, 'edges', `cube${d}`);
      // walk the hull; leave out the bottom edges, where the cube meets the
      // floor (a concave crease, drawn thin and broken on purpose), and the
      // lowest fifth of the uprights, where the floor behind comes up to meet it
      const bottom = P.filter((_, i) => corners[i][1] === 0).map((p) => p[0] + ',' + p[1]);
      const isBottom = (q) => bottom.includes(q[0] + ',' + q[1]);
      let hit = 0, tot = 0;
      for (let i = 0; i < H.length; i++) {
        const p = H[i], q = H[(i + 1) % H.length];
        if (isBottom(p) && isBottom(q)) continue;
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const steps = Math.max(4, Math.round(L));
        for (let s = 1; s < steps; s++) {
          let t = s / steps;
          if (isBottom(p) && t < 0.2) continue;
          if (isBottom(q) && t > 0.8) continue;
          const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
          tot++;
          let m = 0;
          for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m = Math.max(m, inkAt(img, x + dx, y + dy));
          if (m > 0.5) hit++;
        }
      }
      cover.push({ d, frac: hit / tot, px: Math.round(Math.max(...P.map((p) => p[1])) - Math.min(...P.map((p) => p[1]))) });
    }
    if (want('density')) {
      const img = await grab(page, 'pattern', `cube${d}`);
      const face = async (pts) => {
        const Q = shrink((await project(page, pts)).map((p) => [p[0], p[1]]), 0.7);
        const pix = polyPixels(img, Q);
        return pix.reduce((acc, [x, y]) => acc + inkAt(img, x, y), 0) / Math.max(1, pix.length);
      };
      dens.front.push(await face([[-2, 0, -d + 2], [2, 0, -d + 2], [2, 4, -d + 2], [-2, 4, -d + 2]]));
      dens.side.push(await face([[-2, 0, -d - 2], [-2, 0, -d + 2], [-2, 4, -d + 2], [-2, 4, -d - 2]]));
    }
  }
  if (want('silhouette')) {
    const worst = Math.min(...cover.map((c) => c.frac));
    check('silhouette: cubes 8-128 m', worst >= 0.95,
      cover.map((c) => `${c.d}m(${c.px}px) ${(c.frac * 100).toFixed(0)}%`).join('  '));
  }
  if (want('density')) {
    for (const k of ['front', 'side']) {
      const v = dens[k], m = median(v);
      const ok = v.every((x) => x >= m / 1.6 && x <= m * 1.6 && x > 0.02 && x < 0.85);
      check(`density: ${k} face 8-128 m`, ok, `${v.map((x) => x.toFixed(3)).join(' ')} (median ${m.toFixed(3)}, band x/1.6 to x1.6)`);
    }
  }
  await ctx.close();
}

// --- 4. creases: the step pyramid -------------------------------------------------

if (want('crease')) {
  const { ctx, page } = await calibPage();
  await page.evaluate(() => window.__ink.shot('calib-creases'));
  const img = await grab(page, 'edges', 'creases');
  const s = (i) => 10 - i * 1.8;
  const segs = { convex: [], concave: [] };
  for (let i = 0; i < 5; i++) {
    const y1 = 1.4 * (i + 1);
    segs.convex.push([[-s(i) / 2, y1, 14 + s(i) / 2], [s(i) / 2, y1, 14 + s(i) / 2]]);
    // where this step stands on the one below it, or on the floor
    const y0 = 1.4 * i;
    segs.concave.push([[-s(i) / 2, y0, 14 + s(i) / 2], [s(i) / 2, y0, 14 + s(i) / 2]]);
  }
  const measure = async (list) => {
    const out = [];
    for (const [a, b] of list) {
      const [p, q] = await project(page, [a, b]);
      const nx = -(q[1] - p[1]), ny = q[0] - p[0], nl = Math.hypot(nx, ny);
      for (let t = 0.1; t <= 0.9; t += 0.02) {
        const x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t;
        let m = 0, sum = 0;
        for (let k = -3; k <= 3; k++) {
          const v = inkAt(img, x + (nx / nl) * k, y + (ny / nl) * k);
          m = Math.max(m, v); sum += v;
        }
        out.push({ m, sum });
      }
    }
    return out;
  };
  const cv = await measure(segs.convex), cc = await measure(segs.concave);
  const drawn = cv.filter((o) => o.m > 0.5).length / cv.length;
  const inkCv = cv.reduce((a, o) => a + o.sum, 0) / cv.length;
  const inkCc = cc.reduce((a, o) => a + o.sum, 0) / cc.length;
  check('crease: steps outlined', drawn >= 0.95, `${(drawn * 100).toFixed(0)}% of the convex step edges carry a line`);
  check('crease: concave lighter', inkCc < 0.7 * inkCv, `ink across a concave crease ${inkCc.toFixed(2)} vs convex ${inkCv.toFixed(2)}`);
  await ctx.close();
}

// --- 5. tone on the sphere, and 6. what the ink blobs look like --------------------

if (want('tone') || want('stipple')) {
  const { ctx, page } = await calibPage();
  const spherePose = [[12, 5, 0], [12, 5, -14]];
  if (want('tone')) {
    await pose(page, ...spherePose);
    const tone = await grab(page, 'tone', 'sphere');
    const pat = await grab(page, 'pattern', 'sphere');
    const [c, e] = await project(page, [[12, 5, -14], [12 + 4 * 14 / Math.sqrt(14 * 14 - 16), 5, -14]]);
    const R = Math.hypot(e[0] - c[0], e[1] - c[1]) * 0.9;
    const bins = Array.from({ length: 20 }, () => ({ n: 0, s: 0 }));
    for (let y = Math.floor(c[1] - R); y <= c[1] + R; y++) for (let x = Math.floor(c[0] - R); x <= c[0] + R; x++) {
      if (Math.hypot(x - c[0], y - c[1]) > R) continue;
      const t = inkAt(tone, x, y);
      const b = bins[Math.min(19, Math.floor(t * 20))];
      b.n++; b.s += inkAt(pat, x, y);
    }
    const used = bins.map((b, i) => ({ t: i / 20, n: b.n, c: b.n ? b.s / b.n : 0 })).filter((b) => b.n >= 150);
    let falls = 0, worst = 0;
    for (let i = 1; i < used.length; i++) { const d = used[i].c - used[i - 1].c; if (d < -0.03) falls++; worst = Math.min(worst, d); }
    const lit = used.filter((b) => b.t < 0.2);
    const litInk = lit.length ? Math.max(...lit.map((b) => b.c)) : 0;
    check('tone: coverage never falls', falls === 0 && used.length >= 8,
      `${used.length} tone bins, worst step ${worst.toFixed(3)}: ${used.map((b) => b.c.toFixed(2)).join(' ')}`);
    check('tone: lit side bare', lit.length > 0 && litInk < 0.03, `ink below tone 0.2: ${litInk.toFixed(3)} (${lit.length} bins)`);
  }
  if (want('stipple')) {
    const poses = {
      overhang: [[0, 1.7, 8], [0, 7, -6]],
      sphere: spherePose,
      wall: [[-24, 6.0, -8], [-24, 6, -30]],
      curve: [[0, 4.0, 4], [0, 4, -14]],
      raked: [[10, 4.0, -6], [26, 5, -30]],
    };
    let dark = 0, round = 0, half = 0, long = 0, crosses = 0, patches = 0, coherent = 0;
    const where = [];
    for (const [name, [eye, at]] of Object.entries(poses)) {
      await pose(page, eye, at);
      const pat = await grab(page, 'pattern', `stipple-${name}`);
      const tone = await grab(page, 'tone', `stipple-${name}`);
      const edges = await grab(page, 'edges', `stipple-${name}`);
      // and the same pattern with the stipple left out: crossing is a question
      // about lines, and dots lying over them would join them into blobs of
      // no direction at all
      await page.evaluate(() => window.__ink.renderer.debugDots(false));
      const linesOnly = await grab(page, 'pattern', `stipple-${name}-lines`);
      await page.evaluate(() => window.__ink.renderer.debugDots(true));
      const { w, h } = pat;
      // cut the pattern along every outline, so two faces' lines meeting at an
      // edge are not taken for one blob with two directions
      const cut = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (inkAt(edges, x, y) > 0.15) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inside(pat, x + dx, y + dy)) cut[(y + dy) * w + x + dx] = 1;
      }
      const mask = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = !cut[y * w + x] && inkAt(pat, x, y) > 0.5 ? 1 : 0;
      const withTone = (pts) => {
        const s = shape(pts, w);
        let t = 0;
        for (const q of pts) t += inkAt(tone, q % w, (q / w) | 0);
        return { ...s, tone: t / pts.length };
      };
      const blobs = components(w, h, mask).map(withTone);
      const thin = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) thin[y * w + x] = !cut[y * w + x] && inkAt(linesOnly, x, y) > 0.5 ? 1 : 0;
      const strokes = components(w, h, thin).map(withTone);
      const clipped = (b) => b.box[0] <= 1 || b.box[1] <= 1 || b.box[2] >= w - 2 || b.box[3] >= h - 2;
      for (const b of strokes) {
        if (clipped(b)) continue;
        // two directions crossing: a stroke that spreads well off its own axis
        if (b.n >= 20 && b.perp > 5 && b.perp > 0.35 * b.len) {
          crosses++;
          if (where.length < 4) where.push(`${name}@${b.mx.toFixed(0)},${b.my.toFixed(0)}`);
        }
      }
      const byPatch = new Map();
      for (const b of blobs) {
        // blobs the frame cuts short are not their own shape: leave them out
        if (clipped(b)) continue;
        if (b.tone >= 0.86 && b.n >= 3) {
          dark++;
          if (b.n <= 40 && b.elong <= 2.2) round++;
        }
        if (b.tone >= 0.25 && b.tone < 0.48 && b.n >= 12) {
          half++;
          if (b.elong >= 3.5) long++;
          const k = `${Math.floor(b.mx / 48)},${Math.floor(b.my / 48)}`;
          if (!byPatch.has(k)) byPatch.set(k, []);
          byPatch.get(k).push(b.ang);
        }
      }
      for (const angs of byPatch.values()) {
        if (angs.length < 3) continue;
        patches++;
        const cx = angs.reduce((a, t) => a + Math.cos(2 * t), 0) / angs.length;
        const cy = angs.reduce((a, t) => a + Math.sin(2 * t), 0) / angs.length;
        if (Math.hypot(cx, cy) >= 0.9) coherent++;
      }
    }
    check('stipple: darkest are dots', dark >= 50 && round >= 0.9 * dark, `${round}/${dark} blobs in the darkest tones are small and round`);
    check('stipple: half-tones are lines', half >= 50 && long >= 0.85 * half, `${long}/${half} half-tone blobs are long`);
    check('stipple: one direction a patch', patches >= 10 && coherent >= 0.9 * patches, `${coherent}/${patches} 48 px patches have one direction`);
    check('stipple: nothing crosses', crosses === 0, `${crosses} crossing blobs${where.length ? ' at ' + where.join(' ') : ''}`);
  }
  await ctx.close();
}

// --- 7. anchored: the wall, and the train ---------------------------------------------

if (want('anchor')) {
  {
    const { ctx, page } = await calibPage();
    const eye = [-24, 6, -8], at = [-24, 6, -30];
    await pose(page, eye, at);
    const a = await grab(page, 'pattern', 'anchor-wall-a');
    // the wall's face is at z = -29, 21 m ahead
    const [p0] = await project(page, [[-24, 6, -29]]);
    await pose(page, [eye[0] + 0.25, eye[1], eye[2]], [at[0] + 0.25, at[1], at[2]]);
    const b = await grab(page, 'pattern', 'anchor-wall-b');
    const [p1] = await project(page, [[-24, 6, -29]]);
    const expect = p1[0] - p0[0];
    const rect = [490, 250, 790, 550];
    // a field of parallel lines matches itself anywhere along the lines, so
    // the search is across them only: the camera moved sideways, not up
    const s = bestShift(a, b, rect, [12, 0]);
    const still = ncc(a, b, rect, 0, 0);
    check('anchor: wall', Math.abs(s.dx - expect) <= 1 && Math.abs(s.dy) <= 0.6 && s.r > 0.5 && still < s.r - 0.2,
      `moved ${s.dx.toFixed(2)},${s.dy.toFixed(2)} px (wall moved ${expect.toFixed(2)}), match ${s.r.toFixed(2)} vs ${still.toFixed(2)} unmoved`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open('?shot=spawn');
    // beside the first car, square to it, 9 m off
    const car = await page.evaluate(() => {
      const t = window.__ink.level.train, b = t.cars[0].body;
      const e = b.matrix.elements;
      return { pos: b.pos.toArray(), fwd: [e[0], e[1], e[2]], side: [e[8], e[9], e[10]] };
    });
    const c = [car.pos[0], 1.4, car.pos[2]];
    // the side of the train the arena is on
    const sgn = car.pos[0] * car.side[0] + car.pos[2] * car.side[2] > 0 ? -1 : 1;
    await pose(page, [c[0] + car.side[0] * 9 * sgn, 2.2, c[2] + car.side[2] * 9 * sgn], c);
    const a = await grab(page, 'pattern', 'anchor-train-a');
    // what is in view is the car's near side, 1.4 m nearer than its middle:
    // that is the depth the pattern moves at
    const near = (p) => [p[0] + car.side[0] * 1.4 * sgn, 1.4, p[2] + car.side[2] * 1.4 * sgn];
    const [q0] = await project(page, [near(car.pos)]);
    await page.evaluate(() => {
      const L = window.__ink.level;
      L.train.s += 0.25;
      L.train.place();
      L.movers.step(1 / 60, L, []);
    });
    const moved = await page.evaluate(() => window.__ink.level.train.cars[0].body.pos.toArray());
    const b = await grab(page, 'pattern', 'anchor-train-b');
    const [q1] = await project(page, [near(moved)]);
    const rect = [Math.round(q0[0] - 70), Math.round(q0[1] - 50), Math.round(q0[0] + 70), Math.round(q0[1] + 40)];
    const s = bestShift(a, b, rect, [30, 1]);
    const ex = q1[0] - q0[0], ey = q1[1] - q0[1];
    check('anchor: train', Math.hypot(s.dx - ex, s.dy - ey) <= 1.5 && s.r > 0.5,
      `moved ${s.dx.toFixed(2)},${s.dy.toFixed(2)} px (car moved ${ex.toFixed(2)},${ey.toFixed(2)}), match ${s.r.toFixed(2)}`);
    await ctx.close();
  }
}

// --- 9. still means still ---------------------------------------------------------------

if (want('still')) {
  for (const q of ['?shot=spawn', '?scene=calib&shot=calib-curve']) {
    const { ctx, page } = await open(q);
    await page.waitForTimeout(300);
    const a = await page.screenshot({ scale: 'css' });
    await page.waitForTimeout(500);
    const b = await page.screenshot({ scale: 'css' });
    const A = decode(a), B = decode(b);
    let diff = 0;
    for (let i = 0; i < A.d.length; i += 4) if (A.d[i] !== B.d[i] || A.d[i + 1] !== B.d[i + 1] || A.d[i + 2] !== B.d[i + 2]) diff++;
    check(`still: ${q.split('=').pop()}`, diff === 0, `${diff} pixels changed in 0.5 s`);
    await ctx.close();
  }
}

// --- 10. inks ----------------------------------------------------------------------------

if (want('ink')) {
  const { ctx, page } = await calibPage();
  const names = Object.keys(INK);
  const rows = [];
  let ok = 0;
  for (let i = 0; i < INK_COUNT; i++) {
    const x = -18 + i * 5.4;
    // from the north: the step pyramid stands south of the row and buries
    // two of the cubes' south faces
    await pose(page, [x - 2, 3.4, 3], [x, 1.6, 10]);
    const flat = await grab(page, 'ink', `palette${i}`);
    const fin = await grab(page, 'final', `palette${i}`);
    const P = await project(page, cubeCorners(x, 0, 10, 3.2));
    const pix = polyPixels(fin, shrink(hull(P.map((p) => [p[0], p[1]])), 0.97));
    // the ink the page says the surface has
    const flatOk = pix.filter(([px_, py]) => isInk(px(flat, px_, py), i)).length / pix.length;
    // and what the drawing shows: the darkest 5% of the cube, its outline,
    // must be nearer this ink than any other
    const cols = pix.map(([px_, py]) => px(fin, px_, py)).sort((a, b) => lum(a) - lum(b));
    const k = Math.max(3, Math.floor(cols.length * 0.05));
    const mean = [0, 1, 2].map((c) => cols.slice(0, k).reduce((a, v) => a + v[c], 0) / k);
    let best = -1, bd = Infinity;
    SEEN.forEach((rgb, j) => { const d = Math.hypot(...rgb.map((v, c) => v - mean[c])); if (d < bd) { bd = d; best = j; } });
    const pass = best === i && flatOk > 0.9;
    if (pass) ok++;
    rows.push(`${names[i]}${pass ? '' : '(' + names[best] + ')'} ${mean.map(Math.round).join(',')}`);
  }
  check('ink: every cube its ink', ok === INK_COUNT, rows.join('  '));
  await ctx.close();
}

// --- 11. the held weapon, and 12. instanced inks -------------------------------------------

if (want('weapon') || want('instanced')) {
  const { ctx, page, noise } = await open('');
  await page.evaluate(() => {
    const G = window.__ink.game;
    G.startRun();
    G.waves.update = () => {};
    G.ctx.enemies.clear();
    G.ctx.enemies.think = () => {};
    G.ctx.enemies.shoot = () => {};
    G.hud.closeScreen();
    G.hud.setGameVisible(false);
  });
  if (want('weapon')) {
    // somewhere open to stand, facing a long way of nothing; then somewhere
    // with a wall right in front of the eye. The rifle reaches 0.84 m forward.
    const spot = await page.evaluate(() => {
      const I = window.__ink, p = I.player, V = p.eye.constructor;
      const clearAhead = (o, yaw, d) => !I.raycastLevel(o, new V(-Math.sin(yaw), 0, -Math.cos(yaw)), d);
      let open = null, wall = null;
      for (let yaw = 0; yaw < Math.PI * 2 && !(open && wall); yaw += Math.PI / 8) {
        const o = new V(p.body.pos.x, 1.6, p.body.pos.z);
        const dir = new V(-Math.sin(yaw), 0, -Math.cos(yaw));
        if (!open && clearAhead(o, yaw, 60)) open = { yaw };
        const hit = I.raycastLevel(o, dir, 40);
        if (!wall && hit && hit.dist > 4 && Math.abs(hit.normal.y) < 0.1 && Math.abs(hit.normal.dot(dir)) > 0.9) {
          wall = { yaw, at: hit.point.clone().addScaledVector(dir, -0.36).toArray() };
        }
      }
      return { open, wall, start: p.body.pos.toArray() };
    });
    const stand = async (pos, yaw) => {
      await page.evaluate(([q, y]) => { window.__ink.teleport(q[0], q[1], q[2]); window.__ink.face(y, 0); }, [pos, yaw]);
      await page.waitForTimeout(1200);
    };
    if (!spot.open || !spot.wall) {
      check('weapon: against a wall', false, `no ${spot.open ? 'wall' : 'open view'} found from the start`);
    } else {
      await stand(spot.start, spot.wall.yaw);
      await stand([spot.wall.at[0], spot.start[1], spot.wall.at[2]], spot.wall.yaw);
      const gap = await page.evaluate(() => {
        const I = window.__ink, cam = I.camera, V = cam.position.constructor;
        const d = new V(0, 0, -1).applyQuaternion(cam.quaternion);
        return I.raycastLevel(cam.position.clone(), d, 5)?.dist ?? 99;
      });
      const wallDepth = await grab(page, 'depth', 'weapon-wall');
      const wallEdges = await grab(page, 'edges', 'weapon-wall');
      await grab(page, 'final', 'weapon-wall');
      await stand(spot.start, spot.open.yaw);
      const openDepth = await grab(page, 'depth', 'weapon-open');
      const isHand = (img, x, y) => { const c = px(img, x, y); return c[2] > 180 && c[0] < 120; };
      let both = 0, either = 0, border = 0, lined = 0;
      const { w, h } = wallDepth;
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const a = isHand(wallDepth, x, y), b = isHand(openDepth, x, y);
        if (a && b) both++;
        if (a || b) either++;
        // the weapon's own edge against the wall: its outline must be there
        if (a && !(isHand(wallDepth, x + 1, y) && isHand(wallDepth, x - 1, y) && isHand(wallDepth, x, y + 1) && isHand(wallDepth, x, y - 1))
          && x > 4 && y > 4 && x < w - 5 && y < h - 5) {
          border++;
          let m = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) m = Math.max(m, inkAt(wallEdges, x + dx, y + dy));
          if (m > 0.5) lined++;
        }
      }
      const iou = both / Math.max(1, either);
      check('weapon: whole against a wall', gap < 0.7 && iou >= 0.97 && either > 2000, `wall ${gap.toFixed(2)} m from the eye, rifle ${either} px, ${(iou * 100).toFixed(1)}% the same as in the open`);
      check('weapon: outlined', border > 100 && lined >= 0.9 * border, `${lined}/${border} px of its edge carry a line`);
    }
  }
  if (want('instanced')) {
    const at = await page.evaluate((blackInk) => {
      const I = window.__ink, G = I.game, p = G.ctx.player, V = p.eye.constructor;
      I.teleport(p.body.pos.x, p.body.pos.y, p.body.pos.z);
      const cam = I.camera;
      const fwd = new V(0, 0, -1).applyQuaternion(cam.quaternion).setY(0).normalize();
      const right = new V(fwd.z * -1, 0, fwd.x);
      const base = p.body.pos.clone().addScaledVector(fwd, 7);
      const e = G.ctx.enemies.spawn('sketch', base.clone().addScaledVector(right, 1.2));
      e.body.pos.copy(base).addScaledVector(right, 1.2);
      e.fig.root.position.copy(e.body.pos);
      // the ! over its head, at its settled size (marks.js)
      e.markT = 0.8;
      // and a ? over another's, which the marks draw in BLACK on a mesh whose
      // material is RED: only the per-instance ink can make it black
      const q = G.ctx.enemies.spawn('sketch', base.clone().addScaledVector(right, -1.4));
      q.body.pos.copy(base).addScaledVector(right, -1.4);
      q.fig.root.position.copy(q.body.pos);
      q.mind = 'roam'; q.notice = 1; q.markT = 0;
      window.__askOf = q;
      // three metres out and above the eye: the start looks over a pencil
      // lying on the desk, which would hide anything lower
      const spark = cam.position.clone().addScaledVector(fwd, 3).addScaledVector(right, -1.0);
      spark.y += 0.6;
      G.effects.particle(spark, new V(0, 0, 0), { ink: blackInk, size: 0.25, life: 1e4, gravity: 0, drag: 0, stretch: 0 });
      window.__markOf = e;
      return { spark: spark.toArray() };
    }, INK.BLACK);
    await page.waitForTimeout(300);
    const img = await grab(page, 'ink', 'instanced');
    await grab(page, 'final', 'instanced');
    // where marks.js draws the !: from 0.08 to 0.98 of 0.55 m, above the head
    const mk = await page.evaluate(() => [window.__markOf, window.__askOf].flatMap((e) => {
      const b = e.body;
      const y = b.pos.y + b.height * 1.18 + 0.2;
      return [[b.pos.x, y + 0.04, b.pos.z], [b.pos.x, y + 0.6, b.pos.z]];
    }));
    const [m0, m1, a0, a1, s] = await project(page, [...mk, at.spark]);
    const count = (x0, y0, x1, y1, ink) => {
      let n = 0;
      for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) {
        if (inside(img, x, y) && isInk(px(img, x, y), ink)) n++;
      }
      return n;
    };
    const half = Math.abs(m1[1] - m0[1]) * 0.3;
    const red = count(m0[0] - half, Math.min(m0[1], m1[1]), m0[0] + half, Math.max(m0[1], m1[1]), INK.RED);
    const black = count(s[0] - 14, s[1] - 14, s[0] + 14, s[1] + 14, INK.BLACK);
    const ah = Math.abs(a1[1] - a0[1]) * 0.45;
    const ask = count(a0[0] - ah, Math.min(a0[1], a1[1]), a0[0] + ah, Math.max(a0[1], a1[1]), INK.BLACK);
    check('instanced: own inks', red >= 6 && black >= 20 && ask >= 6,
      `red !: ${red} px of RED; black ? on the same red mesh: ${ask} px of BLACK; particle: ${black} px of BLACK`);
  }
  if (noise.length) check('weapon: no warnings', false, noise.slice(0, 2).join(' | '));
  await ctx.close();
}

await browser.close();
finish();

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
