// Ghosts in walkable space: drawn things a body walks straight through.
//
// The Builder keeps what every `solid: false` primitive WOULD have collided in
// `level.ghosts`. Most of them are rightly ghosts: tick marks, stains, the
// lines on the page, the coffee in the mug, all flat or out of reach. The ones
// that matter are the ones you can stand inside: a coin stack that was a
// 0.42 m kerb with the rest of it drawn round your chest, a pencil eraser on
// the desk you ran through.
//
// A ghost is listed when it is wider than `minWidth` and some part of it sits
// between `clear` and `height` above a surface a body could stand on (a top
// with at least a crouch's worth of room over it). "Could stand on" is any
// surface, not a reachable one: that needs a walk graph, and `reach.mjs` can
// pass its own. Anything listed has to be made solid or say why it is not
// (`ghost: 'decor'`).

import { touchesColumn } from '../../src/core/physics.js';

const EPS = 1e-4;

/** How wide a collider is across its narrowest horizontal direction. */
export function ghostWidth(c) {
  switch (c.shape) {
    case 'capsule': return 2 * c.r;
    case 'ball': return 2 * Math.min(c.hx, c.hz);
    case 'cyl': return 2 * Math.max(c.rBot, c.rTop);
    default: {
      // the two local axes that lie nearest the horizontal, each as long as
      // it looks from above
      const axes = [[c.ex, c.hx], [c.ey, c.hy], [c.ez, c.hz]]
        .sort((a, b) => Math.abs(a[0].y) - Math.abs(b[0].y))
        .slice(0, 2)
        .map(([e, h]) => 2 * h * Math.hypot(e.x, e.z));
      return Math.min(...axes);
    }
  }
}

/**
 * Every ghost wider than `minWidth` with part of it in walkable space, as
 * { ghost, width, at: [x, floor, z] }, first such point found for each.
 */
export function ghostsInWalkableSpace(level, {
  minWidth = 0.5, clear = 0.1, height = 1.75, crouch = 1.05, grid = 0.25,
  edge = level.edge ?? Infinity, surface = () => true,
} = {}) {
  const out = [];
  const spans = [];
  for (const g of level.ghosts || []) {
    const width = ghostWidth(g);
    if (width <= minWidth) continue;
    const x0 = Math.max(g.min.x, -edge), x1 = Math.min(g.max.x, edge);
    const z0 = Math.max(g.min.z, -edge), z1 = Math.min(g.max.z, edge);
    let found = null;
    for (let x = x0 + grid / 2; x < x1 && !found; x += grid) {
      for (let z = z0 + grid / 2; z < z1 && !found; z += grid) {
        const gs = touchesColumn(g, x, z, 0);
        if (!gs) continue;
        spans.length = 0;
        for (const c of level.colliders) {
          const s = touchesColumn(c, x, z, 0);
          if (s) spans.push(s);
        }
        for (const s of spans) {
          const floor = s.hi;
          // the free space over this top runs up to the next thing above it
          let ceil = Infinity;
          for (const o of spans) {
            if (o === s) continue;
            if (o.hi > floor + EPS && o.lo < ceil) ceil = Math.max(o.lo, floor);
          }
          if (ceil - floor < crouch || !surface(x, floor, z)) continue;
          if (gs.hi > floor + clear && gs.lo < Math.min(ceil, floor + height)) {
            found = [x, floor, z];
            break;
          }
        }
      }
    }
    if (found) out.push({ ghost: g, width, at: found });
  }
  return out;
}
