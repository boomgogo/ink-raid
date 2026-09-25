// Objective style metrics: the look of the page as numbers, so a change that
// drifts it is caught.
//
//   node tools/compare.mjs measure shots/stills/spawn.png
//   node tools/compare.mjs gate shots/stills/spawn.png        (checks tolerances)
import { readFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { findBlobs, mergeBlobs } from './lib/redblobs.mjs';

// --- the style contract --------------------------------------------------------
// The page as this build draws it, measured over the seventeen establishing
// shots (spawn and ring0-15) of `node tools/shots.mjs`, so the gate catches a
// change that drifts the look. Values are what the screenshots read back, which
// on this machine is a little off what the page writes.
export const CONTRACT = {
  paper: [243, 242, 235],   // STYLE.paper under the grain, as screenshots read it
  // The pen as it lays down, in the middle of what the shots measure. The spread
  // (13-26 per channel) is the pen against the denser BLACK of heavy props,
  // depending on which fills the darkest few percent of a shot.
  ink: [20, 20, 24],
  red: [204, 26, 56],       // INK red (0.80, 0.10, 0.22), written linear
  dotPeriodDiv: 27,         // a dot every cssHeight / 27, both ways (29.6 px at 800)
  tol: { paperDE: 3, inkDE: 6, dotPct: 0.06, edgePct: 0.3 },
  // Ink load: the fraction of pixels on a stroke's edge. It protects two things:
  // that the page reads as a drawing, and that it is not so busy it reads as
  // noise. Over the seventeen shots it runs 0.146-0.543, median 0.21; the band
  // is the tenth to ninetieth percentile (0.17-0.34), rounded out. ring0 sits
  // above it: a big wall a few metres off fills half that frame with lines.
  inkLoad: { min: 0.14, max: 0.38, median: 0.21 },
};

function load(file) {
  const png = PNG.sync.read(readFileSync(file));
  return { w: png.width, h: png.height, d: png.data };
}

const at = (img, x, y) => {
  const i = (y * img.w + x) * 4;
  return [img.d[i], img.d[i + 1], img.d[i + 2]];
};

// CIE76 in Lab is overkill here; a perceptually weighted RGB distance is stable
// enough to catch the drift that matters (a warmer paper, a tinted pen).
function deltaE(a, b) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / 4;
}

const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

// The most common bright colour is the paper. Quantise to 4-bit buckets so the
// grain and the dot grid do not each claim their own peak.
function paperColour(img) {
  const hist = new Map();
  for (let y = 0; y < img.h; y += 2) {
    for (let x = 0; x < img.w; x += 2) {
      const p = at(img, x, y);
      if (lum(p) < 170) continue;
      const k = (p[0] >> 4) * 4096 + (p[1] >> 4) * 256 + (p[2] >> 4);
      const e = hist.get(k) || [0, 0, 0, 0];
      e[0] += p[0]; e[1] += p[1]; e[2] += p[2]; e[3]++;
      hist.set(k, e);
    }
  }
  let best = null;
  for (const e of hist.values()) if (!best || e[3] > best[3]) best = e;
  return best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]] : [0, 0, 0];
}

// The world pen at full strength.
//
// Keep only pixels that are neutral (no stronger in blue or red than in the
// others: not the dot grid, not an accent, not an enemy) and dark enough to be
// ink rather than paper, then average the darkest 5% of those. A tighter
// percentile on a sparse composition reaches past the stroke cores into
// half-covered edge pixels and reports the pen paler than it is.
function inkColour(img) {
  const px = [];
  for (let y = 0; y < img.h; y += 2)
    for (let x = 0; x < img.w; x += 2) {
      const p = at(img, x, y);
      if (Math.max(p[0], p[1], p[2]) - Math.min(p[0], p[1], p[2]) > 22) continue;   // a colour, not the pen
      if (lum(p) > 150) continue;            // paper, or a grid dot
      px.push([lum(p), p]);
    }
  if (!px.length) return [0, 0, 0];
  px.sort((a, b) => a[0] - b[0]);
  const n = Math.max(1, Math.floor(px.length * 0.05));
  const s = [0, 0, 0];
  for (let i = 0; i < n; i++) { s[0] += px[i][1][0]; s[1] += px[i][1][1]; s[2] += px[i][1][2]; }
  return [s[0] / n, s[1] / n, s[2] / n];
}

// Dot-grid period. The dots are the only thing on the page that is bluer than
// the paper without being dark: the pen is neutral, the accents are not pale.
// So count, per row, the pale bluish pixels across the middle of the frame,
// and the rows with dots in them stand out; their spacing is the period.
function dotPeriod(img) {
  const x0 = Math.floor(img.w * 0.16), x1 = Math.floor(img.w * 0.48);
  const rows = new Float64Array(img.h);
  for (let y = 0; y < img.h; y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) {
      const p = at(img, x, y);
      const l = lum(p);
      if (l > 150 && l < 226 && p[2] - p[0] >= 5) n++;
    }
    rows[y] = n;
  }
  const hits = [];
  for (let y = 0; y < img.h; y++) if (rows[y] >= 4) hits.push(y);
  if (hits.length < 4) return 0;
  const groups = [];
  let cur = [hits[0]];
  for (let i = 1; i < hits.length; i++) {
    if (hits[i] - hits[i - 1] <= 2) cur.push(hits[i]);
    else { groups.push(cur); cur = [hits[i]]; }
  }
  groups.push(cur);
  const centres = groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
  const deltas = centres.slice(1).map((c, i) => c - centres[i]);
  if (!deltas.length) return 0;
  deltas.sort((a, b) => a - b);
  return +deltas[deltas.length >> 1].toFixed(2);
}

// Fraction of pixels that sit on a stroke's edge. A proxy for "how much ink is
// on the page": it catches line weight, stroke spacing and dot size drifting.
function edgeDensity(img) {
  let n = 0, tot = 0;
  for (let y = 1; y < img.h - 1; y++)
    for (let x = 1; x < img.w - 1; x++) {
      const c = lum(at(img, x, y));
      const r = lum(at(img, x + 1, y));
      const d = lum(at(img, x, y + 1));
      tot++;
      if (Math.abs(c - r) > 18 || Math.abs(c - d) > 18) n++;
    }
  return n / tot;
}

/**
 * Whether the frame is COMPOSED, or whether it is a thin band of level with a
 * giant blank diagonal over it.
 *
 * A ground-level establishing shot can come out as a long object slashing
 * corner to corner, the level squeezed into a narrow strip and a third of the
 * frame bare paper. Reading depth off a line drawing needs layers (near,
 * middle, far) because there is no colour or shadow to carry it.
 *
 * Two numbers, both cheap: how many horizontal fifths of the frame carry ink at
 * all, and what fraction of the frame is empty paper.
 */
export function composition(file) {
  const img = load(file);
  const BANDS = 5;
  const C = 32;
  const bands = new Array(BANDS).fill(0);
  const bandCells = new Array(BANDS).fill(0);
  let blank = 0, cells = 0;

  for (let cy = 0; cy + C <= img.h; cy += C) {
    for (let cx = 0; cx + C <= img.w; cx += C) {
      let ink = 0;
      for (let y = 0; y < C; y += 2) {
        for (let x = 0; x < C; x += 2) {
          const c = lum(at(img, cx + x, cy + y));
          const r = lum(at(img, cx + x + 1, cy + y));
          if (Math.abs(c - r) > 18) ink++;
        }
      }
      const dens = ink / ((C / 2) * (C / 2));
      const b = Math.min(BANDS - 1, Math.floor((cy + C / 2) / (img.h / BANDS)));
      bands[b] += dens;
      bandCells[b]++;
      cells++;
      if (dens < 0.01) blank++;
    }
  }
  const perBand = bands.map((v, i) => +(v / Math.max(1, bandCells[i])).toFixed(4));
  return {
    file,
    bands: perBand,
    // a band counts as carrying the drawing if it has any real ink in it
    filled: perBand.filter((v) => v >= 0.02).length,
    blank: +(blank / Math.max(1, cells)).toFixed(3),
  };
}

/**
 * The page's two marks, measured: strokes and dots, in pixels.
 *
 * Patches with ink in them, neither blank nor solid and with no red (figures
 * are figures()'s job), are cut into marks: 4-connected pixels clearly darker
 * than the paper. Each mark's second moments say whether it is long and thin
 * (a stroke) or small and round (a dot). Reported: the median dot's diameter,
 * the median stroke's width, and the median gap between neighbouring strokes of
 * one direction, measured along their normal.
 */
export function strokes(file, opts = {}) {
  const img = load(file);
  const P = opts.patch ?? 64;
  const dots = [], widths = [], gaps = [];
  const x0 = Math.floor(img.w * 0.05), x1 = Math.floor(img.w * 0.95);
  const y0 = Math.floor(img.h * 0.05), y1 = Math.floor(img.h * 0.75);
  const mask = new Uint8Array(P * P);
  const seen = new Uint8Array(P * P);

  for (let py = y0; py + P <= y1; py += P) {
    for (let px = x0; px + P <= x1; px += P) {
      let red = 0, dark = 0;
      for (let y = 0; y < P; y++) for (let x = 0; x < P; x++) {
        const p = at(img, px + x, py + y);
        if (p[0] - p[2] > 40) red++;
        const ink = lum(p) < 150;
        mask[y * P + x] = ink ? 1 : 0;
        if (ink) dark++;
      }
      if (red > P * P * 0.01 || dark < P * P * 0.03 || dark > P * P * 0.7) continue;

      seen.fill(0);
      const marks = [];
      for (let s0 = 0; s0 < P * P; s0++) {
        if (!mask[s0] || seen[s0]) continue;
        const stack = [s0];
        seen[s0] = 1;
        let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, edge = false;
        while (stack.length) {
          const k = stack.pop();
          const x = k % P, y = (k / P) | 0;
          n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
          if (x === 0 || y === 0 || x === P - 1 || y === P - 1) edge = true;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= P || ny >= P) continue;
            const q = ny * P + nx;
            if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
          }
        }
        if (n < 3) continue;
        const mx = sx / n, my = sy / n;
        const cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
        const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
        const l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det));
        const l2 = Math.max(tr / 2 - Math.sqrt(Math.max(0, tr * tr / 4 - det)), 1 / 12);
        const ratio = Math.sqrt(l1 / l2);
        if (!edge && n <= 60 && ratio < 1.8) dots.push(2 * Math.sqrt(n / Math.PI));
        else if (ratio > 4 && n >= 12) {
          const len = Math.sqrt(12 * l1);
          widths.push(n / len);
          const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
          marks.push({ mx, my, ang });
        }
      }
      // strokes of one direction, sorted along their shared normal
      for (const a of marks) {
        const nx = -Math.sin(a.ang), ny = Math.cos(a.ang);
        const along = marks
          .filter((b) => Math.abs(Math.sin(b.ang - a.ang)) < 0.17)
          .map((b) => b.mx * nx + b.my * ny).sort((u, v) => u - v);
        for (let i = 1; i < along.length; i++) if (along[i] - along[i - 1] > 1.5) gaps.push(along[i] - along[i - 1]);
        break;
      }
    }
  }
  const med = (a) => (a.length ? +a.sort((u, v) => u - v)[a.length >> 1].toFixed(2) : null);
  return {
    file,
    dots: { n: dots.length, diameter: med(dots) },
    strokes: { n: widths.length, width: med(widths), spacing: med(gaps) },
  };
}

/**
 * How legible the enemies are.
 *
 * An enemy you cannot pick out at range is an enemy you cannot fight, so count
 * it: find the red figures, and measure what fraction of each one's bounding
 * box actually carries ink. A figure that has closed into a solid shape reads
 * as a body at forty metres; one that has thinned to a hollow outline does not.
 */
export function figures(file) {
  const img = load(file);
  // figures() is only ever called by tools/figures.mjs, which hides the HUD
  // before it screenshots (G.hud.setGameVisible(false)) so the lineup is
  // measured clean. With no HUD on screen there is nothing to mask out — and
  // masking anyway, with HUD_RECTS's centre box in particular, blanked
  // out real figures lined up through the middle of the frame. If a caller
  // ever wants this run against a live (HUD-visible) shot, it should mask
  // with HUD_RECTS.
  const blobs = mergeBlobs(findBlobs(img, { maskHud: false }));
  return {
    file,
    size: [img.w, img.h],
    count: blobs.length,
    figures: blobs.map((b) => ({
      box: [b.w, b.h],
      // top and bottom row, so a caller can tell a figure from red furniture
      span: [b.y, b.y + b.h],
      px: b.n,
      fill: +(b.n / (b.w * b.h)).toFixed(3),
      // apparent height as a fraction of frame height, so figures from
      // different captures are comparable
      rel: +(b.h / img.h).toFixed(3),
    })),
  };
}

// Measured on this build's lineups (tools/figures.mjs, 10-60 m), 30 figures:
//
//   fill  p10 0.49   median 0.63   p90 0.79
//
// The band is that tenth to ninetieth percentile, rounded out. The gate judges
// the MEDIAN figure in a shot rather than every figure: one enemy caught
// mid-death or half behind cover is legitimately outside the band, and failing
// a whole shot on it would make the gate noise. minRel is the smallest figure
// worth judging: ten pixels on an 800-pixel frame.
export const FIGURE_TOL = { fillMin: 0.45, fillMax: 0.85, target: 0.63, minRel: 0.0125 };

function figureGate(file) {
  const m = figures(file);
  const big = m.figures.filter((f) => f.rel >= FIGURE_TOL.minRel);
  if (!big.length) {
    console.log(' FAIL  figures  none found (a figure has to be visible before it can be judged)');
    return false;
  }
  const fills = big.map((f) => f.fill).sort((a, b) => a - b);
  const median = fills[fills.length >> 1];
  const ok = median >= FIGURE_TOL.fillMin && median <= FIGURE_TOL.fillMax;
  const sizes = big.map((f) => `${f.box[0]}x${f.box[1]}@${f.fill}`).slice(0, 5).join(' ');
  console.log(` ${ok ? 'PASS' : 'FAIL'}  figures  ${big.length} found, median fill ${median.toFixed(3)} `
    + `(want ${FIGURE_TOL.fillMin}-${FIGURE_TOL.fillMax}, target median ${FIGURE_TOL.target})`);
  console.log(`                ${sizes}`);
  return ok;
}

export function measure(file) {
  const img = load(file);
  return {
    file,
    size: [img.w, img.h],
    paper: paperColour(img).map(Math.round),
    ink: inkColour(img).map(Math.round),
    dotPeriod: dotPeriod(img),
    edgeDensity: +edgeDensity(img).toFixed(4),
  };
}

function gate(file) {
  const m = measure(file);
  const t = CONTRACT.tol;
  const out = [];
  const paperDE = deltaE(m.paper, CONTRACT.paper);
  const inkDE = deltaE(m.ink, CONTRACT.ink);
  const expectPeriod = m.size[1] / CONTRACT.dotPeriodDiv;
  const dotPct = Math.abs(m.dotPeriod - expectPeriod) / expectPeriod;

  out.push(['paper', paperDE <= t.paperDE, `ΔE ${paperDE.toFixed(2)} (max ${t.paperDE}) rgb(${m.paper})`]);
  out.push(['ink', inkDE <= t.inkDE, `ΔE ${inkDE.toFixed(2)} (max ${t.inkDE}) rgb(${m.ink})`]);
  out.push(['dots', dotPct <= t.dotPct, `period ${m.dotPeriod}px, want ${expectPeriod.toFixed(1)}px (${(dotPct * 100).toFixed(1)}%)`]);
  // An aerial overview of the whole map is a diagnostic pose, not a
  // composition anyone plays in, and holding it to the band just means "the
  // desk does not fill a shot taken from above the desk". Reported, not
  // enforced, for those.
  const L = CONTRACT.inkLoad;
  const diagnostic = /overview|far|top|calib|lineup/.test(file);
  const inBand = m.edgeDensity >= L.min && m.edgeDensity <= L.max;
  out.push(['inkload', diagnostic || inBand,
    `edge density ${m.edgeDensity} (band ${L.min}-${L.max}, our median ${L.median})`
    + (diagnostic ? ' [diagnostic pose — not enforced]' : '')]);

  let pass = true;
  for (const [name, ok, msg] of out) {
    if (!ok) pass = false;
    console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(8)} ${msg}`);
  }
  return pass;
}

// Only as a command. tools/figures.mjs imports `figures` from here, and this
// reading ITS arguments as a command turned `figures.mjs 40 60` into a usage
// error.
const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const [, , cmd, ...args] = direct ? process.argv : [];
if (cmd === 'measure') {
  for (const f of args.length ? args : readdirSync('shots/stills').map((x) => 'shots/stills/' + x)) {
    console.log(JSON.stringify(measure(f)));
  }
} else if (cmd === 'gate') {
  let ok = true;
  for (const f of args) { console.log(f); if (!gate(f)) ok = false; }
  process.exit(ok ? 0 : 1);
} else if (cmd === 'figure') {
  let ok = true;
  for (const f of args) { console.log(f); if (!figureGate(f)) ok = false; }
  process.exit(ok ? 0 : 1);
} else if (cmd === 'comp') {
  for (const f of args) console.log(JSON.stringify(composition(f)));
} else if (cmd === 'strokes') {
  for (const f of args) console.log(JSON.stringify(strokes(f)));
} else if (cmd === 'figures') {
  for (const f of args) console.log(JSON.stringify(figures(f)));
} else if (cmd) {
  console.error('usage: compare.mjs measure|gate|figure|figures|strokes|comp <files...>');
  process.exit(2);
}
