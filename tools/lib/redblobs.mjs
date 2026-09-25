// Find the enemies on screen, from pixels alone.
//
// Against stills and recorded video there is no page to query and no enemy
// list to read — the only place they exist is the screen. Which is fine,
// because they are the only red *objects* in the world: this game reserves
// rgb(204,26,56) for enemies, damage and danger.
//
// Everything else that is red is either in a known place (the margin rule, the
// HUD) or has a shape a person does not (the hurt vignette is a diffuse wash
// along the frame edge; killfeed and modifier text is wide and short). So the
// filter is: the right red, in the right part of the frame, in a shape that is
// taller than it is wide.
//
// Self-test:  node tools/lib/redblobs.mjs shots/stills/*.png

// Normalised, so the same numbers work on a 1280x800 still and a 640x400
// screencast frame.
export const ROI = { x0: 0.115, x1: 0.945, y0: 0.045, y1: 0.78 };

// HUD furniture that can be red, in normalised [x0, y0, x1, y1]. Red is used
// only where it means danger: low HP, RELOADING and the awareness eye
// (bottom-left), the wave modifier (top-right), the boss bar (top-centre), an
// empty weapon slot (bottom-right), and the crosshair-adjacent furniture
// (hitmarkers, damage wedges, pips, a broken guard, low grapple stamina and
// the scope's centre dot), which all sit in one modest box around the middle
// of the screen, so an enemy walking through the centre of frame is still
// findable everywhere else.
export const HUD_RECTS = [
  [0.00, 0.66, 0.38, 1.00],   // bottom-left: HP, ammo/RELOADING, icons, eye, tally
  [0.60, 0.62, 1.00, 1.00],   // bottom-right: weapon name/hint, slots (empty mark)
  [0.64, 0.00, 1.00, 0.34],   // top-right: wave / enemies left / modifier / kill feed
  [0.24, 0.00, 0.76, 0.13],   // top-centre: boss bar
  [0.39, 0.32, 0.61, 0.68],   // centre: hitmarkers, damage wedges, pips, guard, scope dot
];

// The crosshair is red and sits at the exact centre — but it is FOUR separate
// ticks (left, right, top, bottom) about 26 px out, not one blob on the centre
// pixel, so a radius tight enough to mean "dead centre" misses all four of them.
// Small, and within a tick's reach of the middle, is the crosshair.
//
// A very distant enemy we happen to be perfectly aimed at is inside this too.
// That is the right trade: if it is that small and that centred we are already
// on target and the aim loop has nothing to correct. The live harness also
// learns a furniture mask (see refplay.mjs), which catches these by the fact
// that they never move.
export const CROSSHAIR = { radius: 0.030, maxSpan: 0.018 };

/**
 * Two thresholds, used as a hysteresis pair.
 *
 * `core` is the enemy red proper. It deliberately rejects the two other warm
 * inks this game uses, which a naive "r is big, g is small" test does not:
 *
 *   enemy  #cc1a38 -> g/r 0.13  b/r 0.27   accepted
 *   orange #eb8c14 -> g/r 0.60             rejected by g
 *   pink   #e666a8 ->           b/r 0.73   rejected by b   (the margin rule)
 *
 * `halo` is the anti-aliased, paper-blended edge. On its own it would also
 * catch the hurt vignette, so it is only ever used to grow a blob that already
 * has core pixels in it — which is what makes a figure at 50 m, where almost
 * nothing reaches full saturation, still come out as one connected shape.
 */
export function isCore(r, g, b) {
  return r > 110 && g < 0.55 * r && b < 0.45 * r && r - g > 45;
}
export function isHalo(r, g, b) {
  return r > 140 && g < 0.80 * r && b < 0.76 * r && r - g > 26 && r - b > 22;
}

/**
 * @param {{w:number,h:number,d:Uint8Array}} img  RGBA
 * @param {object} [o]
 * @param {boolean} [o.maskHud]   drop the HUD rects and the crosshair (false when measuring a bare render)
 * @param {Array}   [o.hudRects]  which table to mask with (default: HUD_RECTS)
 * @param {number}  [o.minCore]   core pixels a blob needs to exist at all
 * @param {number}  [o.minAspect] height / width floor — people are upright
 * @returns {Array<{x,y,w,h,cx,cy,n,core,fill}>} in pixels, biggest first
 */
export function findBlobs(img, o = {}) {
  const W = img.w, H = img.h, d = img.d;
  const maskHud = o.maskHud !== false;
  const hudRects = o.hudRects ?? HUD_RECTS;
  // Scaled to the frame, so the same call works on a 1280x800 still and on the
  // 640x400 screencast the live loop runs on. A figure at 50 m is about 10 px
  // tall at 1280 and 5 px at 640; the floor has to sit under both.
  const minCore = o.minCore ?? Math.max(4, Math.round(W / 220));
  const minPixels = o.minPixels ?? Math.max(10, Math.round(W / 90));
  const minAspect = o.minAspect ?? 0.7;

  const x0 = Math.round(ROI.x0 * W), x1 = Math.round(ROI.x1 * W);
  const y0 = Math.round(ROI.y0 * H), y1 = Math.round(ROI.y1 * H);

  const rects = maskHud ? hudRects.map(([a, b, c, e]) =>
    [a * W, b * H, c * W, e * H]) : [];
  const inHud = (x, y) => {
    for (const [a, b, c, e] of rects) if (x >= a && x <= c && y >= b && y <= e) return true;
    return false;
  };

  // 0 = no, 1 = halo, 2 = core
  const m = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (inHud(x, y)) continue;
      const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      if (isCore(r, g, b)) m[y * W + x] = 2;
      else if (isHalo(r, g, b)) m[y * W + x] = 1;
    }
  }

  // Flood fill from core pixels through halo — 8-connected, iterative, so a
  // figure whose legs are a pale smear still joins its torso.
  const seen = new Uint8Array(W * H);
  const blobs = [];
  const stack = new Int32Array(W * H);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p0 = y * W + x;
      if (m[p0] !== 2 || seen[p0]) continue;
      let sp = 0;
      stack[sp++] = p0;
      seen[p0] = 1;
      let n = 0, core = 0, sx = 0, sy = 0;
      let bx0 = x, bx1 = x, by0 = y, by1 = y;
      while (sp > 0) {
        const p = stack[--sp];
        const py = (p / W) | 0, px = p - py * W;
        n++; sx += px; sy += py;
        if (m[p] === 2) core++;
        if (px < bx0) bx0 = px; if (px > bx1) bx1 = px;
        if (py < by0) by0 = py; if (py > by1) by1 = py;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < y0 || ny >= y1) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            if (nx < x0 || nx >= x1) continue;
            const q = ny * W + nx;
            if (seen[q] || m[q] === 0) continue;
            seen[q] = 1;
            stack[sp++] = q;
          }
        }
      }
      if (core < minCore || n < minPixels) continue;
      const w = bx1 - bx0 + 1, h = by1 - by0 + 1;
      blobs.push({
        x: bx0, y: by0, w, h,
        cx: sx / n, cy: sy / n,
        n, core, fill: n / (w * h),
      });
    }
  }

  const cx = W / 2, cy = H / 2;
  return blobs.filter((b) => {
    // upright: text in the killfeed and the wave banner is wide and short
    if (b.h < minAspect * b.w) return false;
    // the hurt vignette: a diffuse wash across a large part of the frame
    if (b.w > 0.42 * (x1 - x0) || b.h > 0.7 * (y1 - y0)) return false;
    if (b.fill < 0.12) return false;
    // the crosshair: part of the HUD, so only where the HUD is being masked
    if (!maskHud) return true;
    const span = Math.max(b.w / W, b.h / H);
    const dist = Math.hypot(b.cx - cx, b.cy - cy) / W;
    if (span <= CROSSHAIR.maxSpan && dist <= CROSSHAIR.radius) return false;
    return true;
  }).sort((a, b) => b.n - a.n);
}

/**
 * Close up, one figure comes back as several blobs: the pale gap where a leg
 * meets the hip breaks connectivity, so head+torso, each leg and sometimes an
 * eye all arrive separately. Merge boxes that are within a quarter of a figure
 * height of each other, repeatedly, until nothing else joins.
 */
export function mergeBlobs(blobs, gap = 0.25) {
  const out = blobs.map((b) => ({ ...b }));
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const pad = Math.max(a.h, b.h) * gap;
        if (a.x - pad > b.x + b.w || b.x - pad > a.x + a.w) continue;
        if (a.y - pad > b.y + b.h || b.y - pad > a.y + a.h) continue;
        const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
        const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
        const n = a.n + b.n;
        out[i] = {
          x: x0, y: y0, w: x1 - x0, h: y1 - y0,
          cx: (a.cx * a.n + b.cx * b.n) / n,
          cy: (a.cy * a.n + b.cy * b.n) / n,
          n, core: a.core + b.core, fill: n / ((x1 - x0) * (y1 - y0)),
        };
        out.splice(j, 1);
        merged = true;
        break outer;
      }
    }
  }
  return out.sort((a, b) => b.n - a.n);
}

/**
 * Pick something to shoot: big and near the crosshair beats small and far. The
 * previous target gets a bonus so aim does not flick between two enemies of
 * the same size on either side of the screen.
 */
export function pickTarget(blobs, W, H, prev) {
  if (!blobs.length) return null;
  const cx = W / 2, cy = H / 2;
  let best = null, bestScore = -Infinity;
  for (const b of blobs) {
    const dist = Math.hypot(b.cx - cx, b.cy - cy);
    let score = b.n / (1 + dist / (W * 0.08));
    if (prev && Math.hypot(b.cx - prev.cx, b.cy - prev.cy) < W * 0.09) score *= 2.2;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}

// --- self-test --------------------------------------------------------------
// Run against the stills we already have: the detector has to find
// the figures a human can see in them and nothing else, BEFORE it is trusted
// with a live session.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const { PNG } = await import('pngjs');
  for (const f of process.argv.slice(2)) {
    const p = PNG.sync.read(readFileSync(f));
    const blobs = mergeBlobs(findBlobs({ w: p.width, h: p.height, d: p.data }));
    const list = blobs.slice(0, 6)
      .map((b) => `${Math.round(b.cx)},${Math.round(b.cy)} ${b.w}x${b.h} n=${b.n}`)
      .join(' | ');
    console.log(`${f.split('/').pop().padEnd(22)} ${String(blobs.length).padStart(2)} ${list}`);
  }
}
