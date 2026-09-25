// Do two things on the desk occupy the same space?
//
// A pen lying on the table must not poke into the pencil holder: objects on
// the table must not overlap each other. Nothing asked
// before. Every primitive was checked against its own triangles, and nothing
// against anything else, so the pen ran half a metre into the pot and straight
// through an eraser on the ring road with every gate green.
//
// A collider is the shape that was drawn (see Builder), so the question can be
// asked of the colliders: for every pair of primitives from two different
// things whose bounds meet, is there a point inside both, and how deep? Each
// of the four shapes has a signed distance (negative inside), and a point is
// in the overlap when the larger of the two is below zero. The depth is how
// far the deepest shared point is from the nearer surface: a coin resting on a
// coin is 0, a coin sunk into a page is half the page it shares with it.
//
// Primitives are grouped into things by Builder.thing(); ghosts count, since a
// ghost is still drawn. What a body walks on and nothing draws (a staircase's
// slope) does not. Nor does a ramp against the desk top: a ramp is a tipped
// slab, and its low edge goes under the top so that its surface starts at the
// floor. That part is under the desk, where no eye goes.

/** Signed distance from world point p = [x, y, z] to collider c, in metres. */
export function sdf(c, p) {
  if (c.shape === 'capsule') {
    const a = c.aEnd, b = c.bEnd;
    const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
    const pax = p[0] - a.x, pay = p[1] - a.y, paz = p[2] - a.z;
    let h = (pax * bax + pay * bay + paz * baz) / Math.max(1e-9, bax * bax + bay * bay + baz * baz);
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - c.r;
  }
  const dx = p[0] - c.c.x, dy = p[1] - c.c.y, dz = p[2] - c.c.z;
  let x = dx, y = dy, z = dz;
  if (c.turned) {
    x = dx * c.ex.x + dy * c.ex.y + dz * c.ex.z;
    y = dx * c.ey.x + dy * c.ey.y + dz * c.ey.z;
    z = dx * c.ez.x + dy * c.ez.y + dz * c.ez.z;
  }
  if (c.shape === 'box') {
    const qx = Math.abs(x) - c.hx, qy = Math.abs(y) - c.hy, qz = Math.abs(z) - c.hz;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0);
  }
  if (c.shape === 'cyl') {
    const k = (c.rTop - c.rBot) / (2 * c.hy);
    const r = c.rBot + k * (Math.max(-c.hy, Math.min(c.hy, y)) + c.hy);
    const side = (Math.hypot(x, z) - r) / Math.sqrt(1 + k * k);
    return Math.max(side, Math.abs(y) - c.hy);
  }
  // an ellipsoid, maybe cut flat: close enough inside, which is all this asks
  const s = Math.min(c.hx, c.hy, c.hz);
  let d = (Math.hypot(x / c.hx, y / c.hy, z / c.hz) - 1) * s;
  if (c.cut !== undefined) d = Math.max(d, c.cut - y);
  return d;
}

/** Every drawn primitive of a built level, with the thing it belongs to. */
export function drawnPrimitives(level) {
  return [...level.colliders, ...(level.ghosts || [])].filter((c) => c.hits !== 'bodies');
}

/**
 * How deep do colliders a and b overlap? Samples an n^3 grid over the box
 * where their bounds meet. Returns { depth, at } or null.
 */
export function overlapDepth(a, b, n = 14) {
  const lo = [Math.max(a.min.x, b.min.x), Math.max(a.min.y, b.min.y), Math.max(a.min.z, b.min.z)];
  const hi = [Math.min(a.max.x, b.max.x), Math.min(a.max.y, b.max.y), Math.min(a.max.z, b.max.z)];
  if (lo[0] >= hi[0] || lo[1] >= hi[1] || lo[2] >= hi[2]) return null;
  let depth = 0, at = null;
  const p = [0, 0, 0];
  for (let i = 0; i <= n; i++) {
    p[0] = lo[0] + ((hi[0] - lo[0]) * i) / n;
    for (let j = 0; j <= n; j++) {
      p[1] = lo[1] + ((hi[1] - lo[1]) * j) / n;
      for (let k = 0; k <= n; k++) {
        p[2] = lo[2] + ((hi[2] - lo[2]) * k) / n;
        const d = Math.max(sdf(a, p), sdf(b, p));
        if (d < -depth) { depth = -d; at = p.slice(); }
      }
    }
  }
  return depth > 0 ? { depth, at } : null;
}

/**
 * Every pair of different things that overlap by more than `tol`, deepest
 * first, one row per pair of things. Pairs a thing declared it `squeezes`
 * (putty pressed into a gap) are left out and listed apart.
 */
export function thingOverlaps(level, { tol = 0.03 } = {}) {
  const prims = drawnPrimitives(level).filter((c) => c.obj);
  const things = level.things || new Map();
  const ramps = new Set(level.ramps || []);
  const underTop = (a, b) => (a.obj === 'desk' && ramps.has(b)) || (b.obj === 'desk' && ramps.has(a));
  const allowed = (a, b) => {
    const ta = things.get(a), tb = things.get(b);
    return !!(ta?.squeezes?.includes(b) || tb?.squeezes?.includes(a));
  };
  const worst = new Map();
  const squeezed = new Map();
  for (let i = 0; i < prims.length; i++) {
    const a = prims[i];
    for (let j = i + 1; j < prims.length; j++) {
      const b = prims[j];
      if (a.obj === b.obj || underTop(a, b)) continue;
      if (a.max.x <= b.min.x || b.max.x <= a.min.x || a.max.y <= b.min.y || b.max.y <= a.min.y
        || a.max.z <= b.min.z || b.max.z <= a.min.z) continue;
      const o = overlapDepth(a, b);
      if (!o || o.depth <= tol) continue;
      const key = [a.obj, b.obj].sort().join(' | ');
      const into = allowed(a.obj, b.obj) ? squeezed : worst;
      const prev = into.get(key);
      if (!prev || o.depth > prev.depth) into.set(key, { a: a.obj, b: b.obj, ...o });
    }
  }
  const byDepth = (m) => [...m.values()].sort((x, y) => y.depth - x.depth);
  return { overlaps: byDepth(worst), squeezed: byDepth(squeezed) };
}

/** Drawn primitives that belong to no thing: the check cannot vouch for them. */
export function unowned(level) {
  return drawnPrimitives(level).filter((c) => !c.obj);
}

/**
 * Things sunk into the desk top: any primitive whose lowest point is below
 * y 0 by more than `tol`, except the desk itself and a mound (cut flat at the
 * floor, so nothing below it is drawn).
 */
export function sunk(level, { tol = 0.03, desk = 'desk' } = {}) {
  const out = new Map();
  const ramps = new Set(level.ramps || []);
  for (const c of drawnPrimitives(level)) {
    if (!c.obj || c.obj === desk || c.cut !== undefined || ramps.has(c)) continue;
    if (c.min.y >= -tol) continue;
    // the bounds of a turned shape are loose; ask the shape itself
    const lowest = lowestPoint(c);
    if (lowest < -tol && (!out.has(c.obj) || lowest < out.get(c.obj))) out.set(c.obj, lowest);
  }
  return [...out.entries()].map(([obj, y]) => ({ obj, y })).sort((a, b) => a.y - b.y);
}

function lowestPoint(c) {
  // walk down from the bounds' floor until the point is outside, on a grid
  const n = 10;
  let low = Infinity;
  for (let i = 0; i <= n; i++) {
    for (let k = 0; k <= n; k++) {
      const x = c.min.x + ((c.max.x - c.min.x) * i) / n, z = c.min.z + ((c.max.z - c.min.z) * k) / n;
      for (let y = c.min.y; y < Math.min(c.max.y, 0); y += 0.01) {
        if (sdf(c, [x, y, z]) < 0) { low = Math.min(low, y); break; }
      }
    }
  }
  return low;
}
