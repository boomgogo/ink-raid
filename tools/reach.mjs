// Can you get there on foot?
//
// Random inaccessible platforms (no stairs leading up to them) shouldn't
// exist. On THE DESK every raised place was grapple-only, and nothing said so, because
// nothing asked. This asks, in node, against the real `buildDesk()` and the
// physics' own column test:
//
//   1. A WALK GRAPH. Every 0.5 m, every top a standing body fits on, asked
//      with the body's radius exactly as stepBody asks it. From each, the
//      neighbouring column: a step up of at most MOVE.stepUp with headroom, or
//      any drop. Ramps and ramp-stairs are just tops that rise a little per
//      column. Ladders link their foot to their top.
//   2. TIERS. On foot is the gate. Jump + mantle and double jump + mantle are
//      reported, not gated, with their reach MEASURED by running the real
//      Player at lips of every height, not typed in.
//   3. PLACES are declared, not inferred: `place: '...'` on a roof or a deck,
//      every sniper nest and every pickup spot. The top of a cover block is
//      not a place.
//   4. IT WALKS THE RESULT. Every staircase up and down and every ladder up and
//      down is replayed through the real Player, and a cutter is sent up every
//      ladder, so "reachable" means walked, not graph-connected.
//   5. GHOSTS in walkable space (tools/lib/ghosts.mjs), narrowed to surfaces
//      the walk graph reaches.
//   6. POCKETS: low ground with four ways out of sixteen or fewer, as area.
//      (And 4b: a hunting cutter comes over a hill the size of each one, and
//      chases across the desk arrive.)
//   7. LOW PLATFORMS: each is walked on to from at least two sides.
import * as THREE from 'three';
import { buildDesk } from '../src/world/map_desk.js';
import { Builder } from '../src/world/build.js';
import { bodyColliders, touchesColumn, floorAt, clearAbove } from '../src/core/physics.js';
import { Player, MOVE } from '../src/entities/player.js';
import { Enemies } from '../src/entities/enemies/manager.js';
import { ghostsInWalkableSpace } from './lib/ghosts.mjs';
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';

// `npm run reach -- --map file.png` also draws the walk graph and its pockets
const MAP = process.argv.includes('--map') ? process.argv[process.argv.indexOf('--map') + 1] : null;
// Low ground is under this, and pockets are measured on it (section 6).
const POCKET_LOW = 3;
// Pocket area on THE DESK before the hills went in, in m². The
// gate is half of it.
const POCKET_BASELINE = 366;

const GRID = 0.25;
const EPS = 1e-4;
const R = MOVE.bodyRadius, H = MOVE.bodyHeight, STEP = MOVE.stepUp;
const t0 = performance.now();

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(40)} ${detail}`);
};

// --- a Player you can drive from node ---------------------------------------
function driven(level, at, yaw) {
  level.startPoint = at;
  const p = new Player({ level, camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() });
  p.yaw = yaw;
  const held = new Set(), taps = new Set();
  const input = { look: () => ({ yaw: 0, pitch: 0 }), down: (k) => held.has(k), pressed: (k) => taps.has(k) };
  const step = () => { p.update(1 / 60, input); taps.clear(); };
  return { p, held, taps, step };
}
/** The yaw that looks along (dx, dz): forward is (-sin yaw, 0, -cos yaw). */
const yawOf = (dx, dz) => Math.atan2(-dx, -dz);

// --- 2. how high a jump gets you, measured -----------------------------------
function lipReach(double) {
  let best = 0;
  for (let h = 0.6; h <= 4.01; h += 0.05) {
    const b = new Builder();
    b.box(0, -1, 0, 60, 1, 60);
    b.box(0, 0, -22, 20, h, 40);                     // a lip at z = -2
    const lv = b.finish(new THREE.Scene());
    lv.killY = -20;
    const { p, held, taps, step } = driven(lv, new THREE.Vector3(0, 0.05, 3.5), 0);
    held.add('forward');
    let ok = false, jumpedAt = -1;
    for (let i = 0; i < 150 && !ok; i++) {
      // a running jump from 1.4 m out, and the second one on the way up
      if (jumpedAt < 0 && p.body.pos.z < -2 + R + 1.4) { taps.add('jump'); jumpedAt = i; }
      if (double && jumpedAt >= 0 && i === jumpedAt + 14) taps.add('jump');
      step();
      ok = p.body.onGround && p.body.pos.y > h - 0.05;
    }
    if (ok) best = h; else if (best) break;
  }
  return best;
}
const JUMP = lipReach(false);
const DOUBLE = Math.max(JUMP, lipReach(true));
const TIERS = [
  { name: 'on foot', reach: STEP },
  { name: `+ jump and mantle (${JUMP.toFixed(2)} m)`, reach: JUMP },
  { name: `+ double jump and mantle (${DOUBLE.toFixed(2)} m)`, reach: DOUBLE },
];

// --- 1. the walk graph --------------------------------------------------------
// The desk as it stands still. Things that move (the train) are somewhere
// else a second later, so the walk graph, places and pockets are the map's
// own; section 8 rides the train with everything in.
const moving = buildDesk(new THREE.Scene());
const level = { ...moving, colliders: moving.colliders.filter((c) => !c.mover), ghosts: (moving.ghosts || []).filter((c) => !c.mover) };
const cols = bodyColliders(level);
const E = (level.edge ?? 39) + 0.5;
const N = Math.round((2 * E) / GRID) + 1;
const X = (i) => -E + i * GRID;

// every top in every column that a standing body fits on
const spans = new Array(N * N);
const tops = new Array(N * N);
for (let i = 0; i < N; i++) {
  const x = X(i);
  const row = cols.filter((c) => c.min.x - R < x && c.max.x + R > x);
  for (let k = 0; k < N; k++) {
    const z = X(k);
    const ss = [];
    for (const c of row) {
      if (c.min.z - R >= z || c.max.z + R <= z) continue;
      const s = touchesColumn(c, x, z, R);
      if (s) ss.push({ lo: s.lo, hi: s.hi, c });
    }
    const ts = [];
    for (const s of ss) {
      const y = s.hi;
      if (ss.some((o) => o.lo < y + H - EPS && o.hi > y + EPS)) continue;
      const same = ts.find((t) => Math.abs(t.y - y) < 0.01);
      if (same) same.sup.push(s.c);
      else ts.push({ y, sup: [s.c], tier: Infinity });
    }
    spans[i * N + k] = ss;
    tops[i * N + k] = ts;
  }
}

/** Walk a body with its feet at `y` into column `j`: the top it ends on, or null. */
function walkInto(y, j) {
  let up = -Infinity;
  for (const s of spans[j]) {
    if (s.lo < y + H - EPS && s.hi > y + EPS) {
      if (s.hi - y > STEP) return null;              // a wall
      if (s.hi > up) up = s.hi;                      // stepped on to
    }
  }
  let land = -Infinity;
  for (const t of tops[j]) {
    if (up > -Infinity) { if (Math.abs(t.y - up) < 0.01) return t; }
    else if (t.y <= y + EPS && t.y > land) land = t.y;
  }
  if (up > -Infinity) return null;                   // stepped up into no headroom
  return tops[j].find((t) => t.y === land) || null;  // fell, or walked level
}

/** Is column j clear from `lo` to `hi`? A body jumping in place needs it. */
const clearBetween = (j, lo, hi) => !spans[j].some((s) => s.lo < hi - EPS && s.hi > lo + EPS);

const colAt = (x, z) => {
  const i = Math.round((x + E) / GRID), k = Math.round((z + E) / GRID);
  return i >= 0 && k >= 0 && i < N && k < N ? i * N + k : -1;
};
const topNear = (j, y, tol = 0.6) => {
  let best = null;
  for (const t of j >= 0 ? tops[j] : []) if (Math.abs(t.y - y) < tol && (!best || Math.abs(t.y - y) < Math.abs(best.y - y))) best = t;
  return best;
};

// ladders link foot to top, both ways
const ladderLinks = new Map();
const linkLadder = (a, b) => { if (!ladderLinks.has(a)) ladderLinks.set(a, []); ladderLinks.get(a).push(b); };
const ladderEnds = [];
for (const l of level.ladders) {
  const fj = colAt(l.foot.x + l.nx * l.rest, l.foot.z + l.nz * l.rest);
  const foot = topNear(fj, l.foot.y);
  // the first column over the top, behind the wall, that a body fits in
  let tj = -1, top = null;
  for (let d = 0.25; d <= 1.5 && !top; d += GRID) {
    tj = colAt(l.foot.x - l.nx * d, l.foot.z - l.nz * d);
    top = topNear(tj, l.top, 0.3);
  }
  ladderEnds.push({ l, foot, top });
  if (foot && top) {
    linkLadder(foot, { j: tj, t: top, l });
    linkLadder(top, { j: fj, t: foot, l });
  }
}

const start = colAt(level.startPoint.x, level.startPoint.z);
const startTop = topNear(start, level.startPoint.y, 1);
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

for (let tier = TIERS.length - 1; tier >= 0; tier--) {
  // a node reached at a lower tier is also reached at this one; searching the
  // most generous tier first and then relaxing downward would be wrong, so
  // each tier is its own search and a node keeps the lowest tier that got it
  const seen = new Set();
  const queue = [[start, startTop]];
  seen.add(startTop);
  for (let q = 0; q < queue.length; q++) {
    const [j, t] = queue[q];
    if (tier < t.tier) t.tier = tier;
    const i = Math.floor(j / N), k = j % N;
    const visit = (jj, tt) => {
      if (!tt || seen.has(tt)) return;
      seen.add(tt);
      queue.push([jj, tt]);
    };
    for (const [di, dk] of D4) {
      const ii = i + di, kk = k + dk;
      if (ii < 0 || kk < 0 || ii >= N || kk >= N) continue;
      const jj = ii * N + kk;
      visit(jj, walkInto(t.y, jj));
      if (tier > 0) {
        // a vault: a top up to `reach` higher, one or two columns ahead, with
        // room to jump for it
        const reach = TIERS[tier].reach;
        for (let n = 1; n <= 2; n++) {
          const ji = i + di * n, jk = k + dk * n;
          if (ji < 0 || jk < 0 || ji >= N || jk >= N) break;
          const jn = ji * N + jk;
          for (const up of tops[jn]) {
            if (up.y <= t.y + STEP || up.y > t.y + reach) continue;
            if (!clearBetween(j, t.y, up.y + H) || (n === 2 && !clearBetween(jj, up.y, up.y + H))) continue;
            visit(jn, up);
          }
        }
      }
    }
    for (const to of ladderLinks.get(t) || []) visit(to.j, to.t);
  }
}

// The route to each top on foot, for section 4 to walk. Shortest, but a step
// along an EDGE — a top with a wall or a drop beside it — costs five: the
// shortest path on a grid hugs every edge it can, down to the last centimetre
// of a ramp's side, and a body following it falls off.
{
  const edge = (j, t) => {
    const i = Math.floor(j / N), k = j % N;
    for (const [di, dk] of D4) {
      const ii = i + di, kk = k + dk;
      if (ii < 0 || kk < 0 || ii >= N || kk >= N) return true;
      const to = walkInto(t.y, ii * N + kk);
      if (!to || Math.abs(to.y - t.y) > STEP) return true;
    }
    return false;
  };
  const buckets = [[[start, startTop]]];
  startTop.dist = 0;
  for (let cost = 0; cost < buckets.length; cost++) {
    for (const [j, t] of buckets[cost] || []) {
      if (t.dist !== cost) continue;                  // a cheaper way got here first
      const i = Math.floor(j / N), k = j % N;
      const relax = (jj, tt, l = null) => {
        if (!tt) return;
        const c = cost + (l ? 1 : edge(jj, tt) ? 5 : 1);
        if (tt.dist !== undefined && tt.dist <= c) return;
        tt.dist = c;
        tt.from = [j, t, l];
        (buckets[c] ||= []).push([jj, tt]);
      };
      for (const [di, dk] of D4) {
        const ii = i + di, kk = k + dk;
        if (ii >= 0 && kk >= 0 && ii < N && kk < N) relax(ii * N + kk, walkInto(t.y, ii * N + kk));
      }
      for (const to of ladderLinks.get(t) || []) relax(to.j, to.t, to.l);
    }
  }
}

// --- 3. places ------------------------------------------------------------------
// Each place gets the lowest tier any of its tops was reached at, and the
// nearest top reached on foot, to walk to.
function judge(tops_) {
  let tier = Infinity, goal = null;
  for (const [j, t] of tops_) {
    if (t.tier < tier) tier = t.tier;
    if (t.tier === 0 && (!goal || t.dist < goal[1].dist)) goal = [j, t];
  }
  return { tier, goal };
}
const onCollider = (c) => {
  const out = [];
  for (let j = 0; j < N * N; j++) for (const t of tops[j]) if (t.sup.includes(c)) out.push([j, t]);
  return out;
};
const nearPoint = (p, dxz = 1.5, dy = 1.0) => {
  const out = [];
  for (let i = Math.floor((p.x - dxz + E) / GRID); i <= Math.ceil((p.x + dxz + E) / GRID); i++) {
    for (let k = Math.floor((p.z - dxz + E) / GRID); k <= Math.ceil((p.z + dxz + E) / GRID); k++) {
      if (i < 0 || k < 0 || i >= N || k >= N) continue;
      for (const t of tops[i * N + k]) if (Math.abs(t.y - p.y) <= dy) out.push([i * N + k, t]);
    }
  }
  return out;
};

const places = [
  ...level.places.map(({ name, collider: c }) => ({ name, y: c.max.y, ...judge(onCollider(c)) })),
  ...level.snipers.map((n, i) => ({ name: `sniper nest ${i + 1} (${n.x.toFixed(0)}, ${n.z.toFixed(0)})`, y: n.y, ...judge(nearPoint(n)) })),
  // every item on the map: a bandage nobody can walk to is not there
  ...(level.pickupSpots || []).map((s) => ({ name: `${s.item}, ${s.name}`, y: s.pos.y, ...judge(nearPoint(s.pos, 1.0)) })),
];
console.log(`\n  a jump and mantle gets you on to ${JUMP.toFixed(2)} m, a double jump and mantle ${DOUBLE.toFixed(2)} m (measured)`);
console.log(`  ${places.length} places, from the player start at (${level.startPoint.x.toFixed(0)}, ${level.startPoint.z.toFixed(0)})\n`);
console.log('    place                                  height   reached');
for (const p of places) {
  const how = p.tier === Infinity ? 'NOT without the grapple' : TIERS[p.tier].name;
  console.log(`    ${p.name.padEnd(38)} ${p.y.toFixed(1).padStart(6)}   ${how}`);
}
const unreached = places.filter((p) => p.tier !== 0);
check('every place reachable on foot', unreached.length === 0,
  unreached.length ? unreached.map((p) => p.name).join('; ') : `${places.length} of ${places.length}, no jumping and no grapple`);
let walkable = 0, reached = 0;
for (let j = 0; j < N * N; j++) for (const t of tops[j]) { walkable++; if (t.tier === 0) reached++; }
console.log(`         ${reached} of ${walkable} standable tops reached on foot (${((reached / walkable) * 100).toFixed(0)}%)`);

// every ladder is wired into the graph at both ends
for (const { l, foot, top } of ladderEnds) {
  if (!foot || !top) check(`ladder ${l.name || ''} joins the graph`, false, `foot ${!!foot}, top ${!!top} at ${l.foot.x.toFixed(1)}, ${l.foot.z.toFixed(1)}`);
}

// --- 4. walk it -------------------------------------------------------------------
//
// First the route to every place, from the player start, through the real
// Player: aim a few cells down the graph's own path and hold forward, and at a
// ladder, face the wall and hold forward (or back, going down). No jumping.
console.log('');
function walkRoute(place) {
  const path = [];
  for (let cur = place.goal; cur; cur = cur[1].from ? [cur[1].from[0], cur[1].from[1]] : null) {
    const [j, t] = cur;
    path.push({ x: X(Math.floor(j / N)), z: X(j % N), y: t.y, via: t.from ? t.from[2] : null });
  }
  path.reverse();
  const { p, held, step } = driven(level, level.startPoint.clone(), Math.PI);
  // the ladders on the route: where each one is, and which way it is taken
  const climbs = [];
  for (let k = 1; k < path.length; k++) if (path[k].via) climbs.push({ k, l: path[k].via, up: path[k].y > path[k - 1].y });
  const AHEAD = Math.round(1.5 / GRID);
  let idx = 0, bestIdx = 0, lastProgress = 0;
  const end = path[path.length - 1];
  for (let f = 0; f < 90 * 60; f++) {
    const b = p.body;
    // where on the route we are: the nearest of the next stretch of it
    let bd = Infinity;
    for (let k = idx, n = Math.min(path.length, idx + AHEAD * 2); k < n; k++) {
      const d = Math.hypot(path[k].x - b.pos.x, path[k].z - b.pos.z) + Math.abs(path[k].y - b.pos.y) * 2;
      if (d < bd) { bd = d; idx = k; }
    }
    if (idx > bestIdx || p.ladder) { bestIdx = Math.max(bestIdx, idx); lastProgress = f; }
    if (f - lastProgress > 6 * 60) {
      return { ok: false, detail: `stuck at ${b.pos.toArray().map((n) => n.toFixed(1)).join(', ')}, ${bestIdx} of ${path.length} steps` };
    }
    if (b.onGround && Math.hypot(end.x - b.pos.x, end.z - b.pos.z) < 0.8 && Math.abs(end.y - b.pos.y) < 0.3) {
      return { ok: true, detail: `${path.length} steps, ${(f / 60).toFixed(1)} s` };
    }
    held.clear();
    const c = climbs.find((q) => q.k > idx);
    if (p.ladder && c) {
      p.yaw = yawOf(-c.l.nx, -c.l.nz);
      held.add(c.up ? 'forward' : 'back');
    } else if (c && c.k - idx <= AHEAD) {
      // go to where the ladder is taken from, slowly at the end, then face it
      const l = c.l;
      const gx = c.up ? l.foot.x + l.nx * l.rest : l.foot.x - l.nx * 0.3;
      const gz = c.up ? l.foot.z + l.nz * l.rest : l.foot.z - l.nz * 0.3;
      const d = Math.hypot(gx - b.pos.x, gz - b.pos.z);
      if (d < 0.3) {
        p.yaw = yawOf(-l.nx, -l.nz);
        held.add(c.up ? 'forward' : 'back');
      } else {
        p.yaw = yawOf(gx - b.pos.x, gz - b.pos.z);
        held.add('forward');
        if (d < 1.2) held.add('crouch');
      }
    } else {
      // look down the route, but not past a step up: cutting the corner on to
      // a kerb meets its side where it is too tall to step
      let a = idx;
      while (a < Math.min(path.length - 1, idx + AHEAD) && path[a + 1].y - path[a].y < 0.25) a++;
      if (a === idx) a = Math.min(path.length - 1, idx + 1);
      const aim = path[a];
      p.yaw = yawOf(aim.x - b.pos.x, aim.z - b.pos.z);
      held.add('forward');
    }
    step();
  }
  return { ok: false, detail: 'out of time' };
}
for (const pl of places) {
  if (!pl.goal) continue;
  const r = walkRoute(pl);
  check(`walked to: ${pl.name}`, r.ok, r.detail);
}
console.log('');
for (const f of level.flights) {
  const [ux, uz] = f.up;
  const run = Math.hypot(f.top.x - f.foot.x, f.top.z - f.foot.z);
  const name = `${f.risers} x ${f.riser.toFixed(2)} m at ${f.slope.toFixed(0)} deg`;
  {
    const { p, held, step } = driven(level, new THREE.Vector3(f.foot.x - ux * 1.2, f.foot.y + 0.05, f.foot.z - uz * 1.2), yawOf(ux, uz));
    held.add('forward');
    let top = -Infinity;
    for (let i = 0; i < (run / MOVE.walkSpeed + 2) * 60; i++) { step(); top = Math.max(top, p.body.pos.y); }
    check(`stairs up: ${name}`, p.body.onGround && p.body.pos.y > f.top.y - 0.05,
      `from ${f.foot.y.toFixed(1)} to ${p.body.pos.y.toFixed(2)} (the top is ${f.top.y.toFixed(1)})`);
  }
  {
    const { p, held, step } = driven(level, new THREE.Vector3(f.top.x + ux * 0.1, f.top.y + 0.05, f.top.z + uz * 0.1), yawOf(-ux, -uz));
    for (let i = 0; i < 20; i++) step();
    held.add('forward');
    let landings = 0, was = true, frames = 0;
    for (let i = 0; i < (run / MOVE.walkSpeed + 2) * 60; i++) {
      step();
      const on = p.body.pos.y > f.foot.y + 0.05;
      if (on) { frames++; if (p.body.onGround && !was) landings++; }
      was = p.body.onGround;
      // stop a stride past the foot, before walking on to whatever is next
      if ((p.body.pos.x - f.foot.x) * ux + (p.body.pos.z - f.foot.z) * uz < -0.8) break;
    }
    check(`stairs down: ${name}`, p.body.pos.y < f.foot.y + 0.05 && landings === 0,
      `to ${p.body.pos.y.toFixed(2)}, ${landings} landings in ${frames} frames on the flight`);
  }
}

const figureCtx = () => {
  const noop = () => {};
  return {
    scene: new THREE.Scene(),
    level,
    effects: { burst: noop, hit: noop, decal: noop, kick: noop, stop: noop, impact: noop, hurt: 0 },
    audio: null,
    hud: null,
  };
};

for (const { l } of ladderEnds) {
  const name = `${l.name || 'ladder'} (${l.height.toFixed(1)} m)`;
  const face = yawOf(-l.nx, -l.nz);
  {
    // the whole width of the climb is clear, not just the middle of it
    let hit = null;
    for (let u = -0.45; u <= 0.451 && !hit; u += 0.15) {
      const x = l.foot.x + l.nx * l.rest + l.tx * u, z = l.foot.z + l.nz * l.rest + l.tz * u;
      for (let h = 0.3; h <= l.height && !hit; h += 0.25) {
        if (!clearAbove(level, x, z, l.foot.y + h, H, R)) hit = [u, h];
      }
    }
    check(`ladder lane clear: ${name}`, !hit, hit ? `blocked ${hit[1].toFixed(2)} m up, ${hit[0].toFixed(2)} m to the side` : '');
  }
  {
    const { p, held, step } = driven(level, new THREE.Vector3(l.foot.x + l.nx * 1.6, l.foot.y + 0.05, l.foot.z + l.nz * 1.6), face);
    held.add('forward');
    let climbed = false, t = 0;
    for (let i = 0; i < (l.height / 4.5 + 3) * 60; i++) {
      step();
      if (p.ladder) climbed = true;
      if (climbed && !p.ladder && p.body.onGround && p.body.pos.y > l.top - 0.05) { t = i / 60; break; }
    }
    const v = (p.body.pos.x - l.foot.x) * l.nx + (p.body.pos.z - l.foot.z) * l.nz;
    check(`ladder up: ${name}`, climbed && p.body.onGround && p.body.pos.y > l.top - 0.05 && v < 0,
      `on it: ${climbed}, off at y ${p.body.pos.y.toFixed(2)} (top ${l.top.toFixed(1)})${t ? `, ${t.toFixed(1)} s` : ''}`);
  }
  {
    // from the top: face the wall and back off the edge
    const { p, held, step } = driven(level, new THREE.Vector3(l.foot.x - l.nx * 0.6, l.top + 0.05, l.foot.z - l.nz * 0.6), face);
    for (let i = 0; i < 20; i++) step();
    held.add('back');
    let climbed = false;
    for (let i = 0; i < (l.height / 4.5 + 3) * 60; i++) {
      step();
      if (p.ladder) climbed = true;
      if (climbed && !p.ladder && p.body.onGround) break;       // off at the bottom
    }
    check(`ladder down: ${name}`, climbed && p.body.onGround && Math.abs(p.body.pos.y - l.foot.y) < 0.1,
      `on it: ${climbed}, ended at y ${p.body.pos.y.toFixed(2)} (foot ${l.foot.y.toFixed(1)})`);
  }
  {
    // a cutter, with you standing at the top
    const ctx = figureCtx();
    const you = driven(level, new THREE.Vector3(l.foot.x - l.nx * 2.5, l.top + 0.05, l.foot.z - l.nz * 2.5), face).p;
    for (let i = 0; i < 20; i++) you.update(1 / 60, { look: () => ({ yaw: 0, pitch: 0 }), down: () => false, pressed: () => false });
    ctx.player = you;
    you.damage = () => {};
    const E = new Enemies(ctx);
    // on open floor near the foot, on the same floor as the ladder
    let at = null;
    for (const [dn, dt] of [[0.9, 3], [0.9, -3], [3, 0], [3, 3], [3, -3], [5, 0], [1.5, 1.5], [1.5, -1.5]]) {
      const x = l.foot.x + l.nx * dn + l.tx * dt, z = l.foot.z + l.nz * dn + l.tz * dt;
      if (Math.abs(floorAt(level, x, z, l.foot.y + 0.3) - l.foot.y) < 0.05 && clearAbove(level, x, z, l.foot.y, 2, 0.4)) { at = new THREE.Vector3(x, l.foot.y + 0.05, z); break; }
    }
    // hunting from the start: this is about the ladder, not about noticing you
    const e = E.spawn('cutter', at, { mind: 'hunt' });
    let climbed = false, t = 0;
    for (let i = 0; i < 15 * 60; i++) {
      E.update(1 / 60);
      if (e.ladder) climbed = true;
      if (e.body.onGround && e.body.pos.y > l.top - 0.1) { t = i / 60; break; }
    }
    check(`a cutter follows you up: ${name}`, climbed && e.body.pos.y > l.top - 0.1,
      `climbed: ${climbed}, got to y ${e.body.pos.y.toFixed(2)}${t ? ` in ${t.toFixed(1)} s` : ''}`);
  }
}

// --- 4b. enemies over the hills, and across the desk ------------------------------
// The hills are only worth having if what chases you can follow you over
// them, and none of it is worth much if a chase stalls on the furniture.
//
// First the hill on its own: a bare floor and a mound the size of each one on
// the desk, you on one side and a hunting cutter on the other. Every hill on
// THE DESK was put against something to fill a pocket, so no line over one
// there is clear of everything else; this asks only whether the AI climbs one.
{
  const mounds = level.ramps.filter((c) => c.shape === 'ball' && c.cut !== undefined);
  for (const m of mounds) {
    const floor = m.c.y + m.cut, height = m.c.y + m.hy - floor;
    const rim = m.hx * Math.sqrt(Math.max(0, 1 - (m.cut / m.hy) ** 2));
    const b = new Builder();
    b.box(0, -1, 0, 80, 1, 80);
    b.mound(0, 0, rim, height);
    const lv = b.finish(new THREE.Scene());
    lv.killY = -20;
    const ctx = figureCtx();
    ctx.level = lv;
    const you = driven(lv, new THREE.Vector3(rim + 3, 0.05, 0), yawOf(-1, 0)).p;
    for (let i = 0; i < 20; i++) you.update(1 / 60, { look: () => ({ yaw: 0, pitch: 0 }), down: () => false, pressed: () => false });
    you.damage = () => {};
    ctx.player = you;
    const E = new Enemies(ctx);
    const e = E.spawn('cutter', new THREE.Vector3(-rim - 3, 0.05, 0), { mind: 'hunt' });
    e.cool = 99;
    let peak = 0, t = 0;
    for (let i = 0; i < 6 * 60; i++) {
      E.update(1 / 60);
      peak = Math.max(peak, e.body.pos.y);
      if (Math.hypot(e.body.pos.x - you.body.pos.x, e.body.pos.z - you.body.pos.z) < 2.5) { t = i / 60; break; }
    }
    check(`a cutter comes over a ${height.toFixed(1)} m hill`, t > 0 && peak > 0.8 * height,
      `the size of the one at (${m.c.x.toFixed(0)}, ${m.c.z.toFixed(0)}): ${t ? `reached you in ${t.toFixed(1)} s` : 'never reached you'}, ${peak.toFixed(2)} m up it`);
  }
}
// Then THE DESK as it is: sixty chases between random open points 20-40 m
// apart, a hunting cutter after you standing still. With the speed fix alone,
// 38 arrived within 12 s, standing still 2.8 s a chase against walls it
// was flanking along; unsticking took that to 45, and flanking hard only round
// what it has just walked into to 48 and 0.7 s.
{
  const CHASES = 60, pool = level.spawnPool;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pairs = [];
  while (pairs.length < CHASES) {
    const a = pool[Math.floor(rnd() * pool.length)], q = pool[Math.floor(rnd() * pool.length)];
    const d = Math.hypot(a.x - q.x, a.z - q.z);
    if (d > 20 && d < 40) pairs.push([a, q]);
  }
  // The AI rolls dice (which way round, when to hop): seeded, so this is the
  // same number every run rather than 45-50.
  const random = Math.random;
  Math.random = rnd;
  let arrived = 0, total = 0, still = 0;
  for (const [a, q] of pairs) {
    const ctx = figureCtx();
    const you = driven(level, new THREE.Vector3(q.x, q.y + 0.05, q.z), 0).p;
    for (let i = 0; i < 20; i++) you.update(1 / 60, { look: () => ({ yaw: 0, pitch: 0 }), down: () => false, pressed: () => false });
    you.damage = () => {};
    ctx.player = you;
    const E = new Enemies(ctx);
    E.alwaysHunts = () => true;              // the chase, not the giving up after 4 s blind
    const e = E.spawn('cutter', new THREE.Vector3(a.x, a.y + 0.05, a.z), { mind: 'hunt' });
    e.cool = 99;
    for (let i = 0; i < 12 * 60; i++) {
      E.update(1 / 60);
      if (Math.hypot(e.body.vel.x, e.body.vel.z) < 0.5) still += 1 / 60;
      if (Math.hypot(e.body.pos.x - you.body.pos.x, e.body.pos.z - you.body.pos.z) < 3) { arrived++; total += i / 60; break; }
    }
  }
  Math.random = random;
  check('chases across the desk arrive', arrived >= CHASES * 0.7,
    `${arrived} of ${CHASES} within 12 s (at least ${Math.ceil(CHASES * 0.7)}), mean ${(total / Math.max(1, arrived)).toFixed(1)} s, ${(still / CHASES).toFixed(1)} s a chase standing still`);
}

// --- 5. ghosts --------------------------------------------------------------------
{
  const surface = (x, y, z) => {
    const j = colAt(x, z);
    return j >= 0 && tops[j].some((t) => t.tier <= 2 && t.y >= y - 0.05 && t.y <= y + 0.6);
  };
  const listed = ghostsInWalkableSpace(level, { surface });
  const untagged = listed.filter((g) => !g.ghost.ghost);
  check('no untagged ghost where you can get to', untagged.length === 0,
    untagged.length
      ? untagged.slice(0, 4).map(({ ghost: g, at }) => `${g.shape} ${g.tag || ''} at ${at.map((n) => n.toFixed(1)).join(', ')}`).join('; ')
      : `${listed.length} listed, all tagged`);
}

// --- 5b. rims -----------------------------------------------------------------
//
// The player can walk on the top rim and fall inside. Every metre
// round a hollow thing's rim has to be a top reached on foot, or something on
// the rim (a pencil, a ladder rail, a nest) has cut the walk round it.
for (const t of level.tubes || []) {
  const mid = (t.r + t.ri) / 2 * Math.cos(Math.PI / 16);
  const n = Math.ceil((Math.PI * 2 * mid) / 1);
  let gaps = 0;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const i = Math.round((t.x + Math.sin(a) * mid + E) / GRID), j = Math.round((t.z + Math.cos(a) * mid + E) / GRID);
    const ok = tops[i * N + j]?.some((q) => q.tier === 0 && Math.abs(q.y - (t.y + t.h)) < 0.3);
    if (!ok) gaps++;
  }
  check(`walk all the way round the rim at (${t.x}, ${t.z})`, gaps === 0, `${n - gaps} of ${n} metres reached on foot`);
}

// --- 6. pockets -------------------------------------------------------------------
//
// Platforms need to be more like hills so that enemies won't just surround
// you and trap you in. Falling costs nothing on this map, so height
// is not the trap; walls are. A POCKET is low ground you can only leave the
// way you came in: from the cell, walk each of 16 compass directions for 6 m
// through the walk graph (up a step, down anything), and a cell with at most 4
// ways out is in one. Low ground is anything reached on foot under 3 m, so a
// mound laid over a pocket is measured as ground, not taken out of the count.
{
  const OUT = 6, DIRS = 16, POCKET = 4, SHOW = MAP ? 40 : 8;
  /** From column j, top t: can a body walk `OUT` metres at angle `ang`? */
  const freeWay = (j, t, ang) => {
    const dx = Math.cos(ang), dz = Math.sin(ang);
    let i = Math.floor(j / N), k = j % N;
    const x0 = X(i), z0 = X(k);
    for (let s = GRID / 4; s <= OUT; s += GRID / 4) {
      const ii = Math.round((x0 + dx * s + E) / GRID), kk = Math.round((z0 + dz * s + E) / GRID);
      if (ii === i && kk === k) continue;
      if (ii < 0 || kk < 0 || ii >= N || kk >= N) return false;
      let to = null;
      if (ii !== i && kk !== k) {
        // a diagonal corner: round either side of it
        const a = walkInto(t.y, ii * N + k);
        if (a) to = walkInto(a.y, ii * N + kk);
        if (!to) { const b = walkInto(t.y, i * N + kk); if (b) to = walkInto(b.y, ii * N + kk); }
      } else {
        to = walkInto(t.y, ii * N + kk);
      }
      if (!to) return false;
      i = ii; k = kk; t = to;
    }
    return true;
  };

  let low = 0;
  const pockets = [];
  // A room the map declares (b.room) is walled in on purpose, and is reported
  // on its own rather than counted: the gate is for pockets nobody meant.
  const rooms = (level.rooms || []).map((r) => ({ ...r, cells: 0 }));
  const roomOf = (x, z) => rooms.find((r) => Math.hypot(x - r.x, z - r.z) < r.r);
  for (let j = 0; j < N * N; j++) {
    for (const t of tops[j]) {
      if (t.tier !== 0 || t.y >= POCKET_LOW) continue;
      const room = roomOf(X(Math.floor(j / N)), X(j % N));
      if (room) { room.cells++; continue; }
      low++;
      let free = 0;
      // stops counting at one more than a pocket has: that is all it needs
      for (let d = 0; d < DIRS && free <= POCKET; d++) if (freeWay(j, t, (d / DIRS) * Math.PI * 2)) free++;
      t.free = free;
      if (free <= POCKET) pockets.push([j, t]);
    }
  }

  // join them up, so each can be named by where it is
  const inPocket = new Set(pockets.map(([, t]) => t));
  const groups = [];
  const done = new Set();
  for (const [j0, t0] of pockets) {
    if (done.has(t0)) continue;
    const g = { cells: [], x: 0, z: 0, y: 0 };
    const stack = [[j0, t0]];
    done.add(t0);
    while (stack.length) {
      const [j, t] = stack.pop();
      g.cells.push([j, t]);
      g.x += X(Math.floor(j / N)); g.z += X(j % N); g.y += t.y;
      const i = Math.floor(j / N), k = j % N;
      for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
        const ii = i + di, kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= N || kk >= N) continue;
        for (const o of tops[ii * N + kk]) {
          if (!inPocket.has(o) || done.has(o) || Math.abs(o.y - t.y) > STEP) continue;
          done.add(o);
          stack.push([ii * N + kk, o]);
        }
      }
    }
    const n = g.cells.length;
    g.x /= n; g.z /= n; g.y /= n;
    g.area = n * GRID * GRID;
    groups.push(g);
  }
  groups.sort((a, b) => b.area - a.area);
  const area = pockets.length * GRID * GRID;
  console.log(`\n  pockets: ${area.toFixed(0)} m² of ${(low * GRID * GRID).toFixed(0)} m² of low ground `
    + `(${((area / Math.max(1, low * GRID * GRID)) * 100).toFixed(1)}%) has ${POCKET} ways out of ${DIRS} or fewer, in ${groups.length} pockets`);
  for (const g of groups.filter((q) => q.area >= 2).slice(0, SHOW)) {
    console.log(`    ${g.area.toFixed(1).padStart(6)} m²  at ${g.x.toFixed(1)}, ${g.z.toFixed(1)}  y ${g.y.toFixed(1)}`);
  }
  for (const r of rooms) {
    console.log(`    room: ${r.name}, ${(r.cells * GRID * GRID).toFixed(0)} m² walked to on foot, not counted`);
    check(`a way into ${r.name}`, r.cells > 0, r.cells ? '' : 'nothing inside it was reached on foot');
  }

  if (MAP) {
    // x runs right and z down, so north is at the top as the map is laid out.
    // Low ground is paper (greyer with something over it), pockets red (deeper
    // for fewer ways out), higher tops blue if walked to and grey if only
    // jumped to, darker the higher they are; a line every 5 m, heavier every 10.
    const S = 4;
    const png = new PNG({ width: N * S, height: N * S });
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < N; k++) {
        const ts = tops[i * N + k];
        const low = ts.find((q) => q.tier === 0 && q.y < POCKET_LOW);
        const high = ts.reduce((a, q) => (!a || q.y > a.y ? q : a), null);
        let rgb = [25, 25, 30];
        if (low && low.free <= POCKET) rgb = [235, 30 + low.free * 35, 30 + low.free * 35];
        else if (low) {
          const s = 250 - low.y * 25;
          rgb = high !== low ? [s * 0.82, s * 0.82, s * 0.86] : [s, s * 0.98, s * 0.9];
        } else if (high) {
          const s = Math.max(40, 215 - high.y * 9);
          rgb = high.tier === 0 ? [s * 0.55, s * 0.65, s] : [s * 0.7, s * 0.7, s * 0.7];
        }
        const x = X(i), z = X(k);
        for (let u = 0; u < S; u++) for (let v = 0; v < S; v++) {
          const o = ((k * S + v) * N * S + (i * S + u)) * 4;
          let c = rgb;
          const onX = Math.abs(x / 5 - Math.round(x / 5)) < 1e-6 && u === 0;
          const onZ = Math.abs(z / 5 - Math.round(z / 5)) < 1e-6 && v === 0;
          if (onX || onZ) {
            const heavy = (onX && Math.round(x) % 10 === 0) || (onZ && Math.round(z) % 10 === 0);
            c = rgb.map((q) => q * (heavy ? 0.55 : 0.8));
          }
          png.data[o] = c[0]; png.data[o + 1] = c[1]; png.data[o + 2] = c[2]; png.data[o + 3] = 255;
        }
      }
    }
    writeFileSync(MAP, PNG.sync.write(png));
    console.log(`    map: ${MAP}`);
  }
  check('pocket area at most half of before', area <= POCKET_BASELINE / 2,
    `${area.toFixed(0)} m², was ${POCKET_BASELINE} (${((1 - area / POCKET_BASELINE) * 100).toFixed(0)}% less)`);
}

// --- 7. low platforms ----------------------------------------------------------
//
// The other half of "more like hills": a low platform you can stand on is part
// of the ground only if you can walk on to it, and back up on to it, from more
// than one side. With one way up, whoever holds that side holds the platform.
// A platform is a flat-topped box under 3 m with room to fight on (25 m² of
// top a body can stand on, which leaves out cover blocks and the page corners).
// A side is a face of the box, and it counts once a metre of it walks up.
{
  const MIN_AREA = 25, MIN_WIDTH = 1;
  const plats = new Map();
  for (let j = 0; j < N * N; j++) {
    for (const t of tops[j]) {
      if (t.y < 1 || t.y >= POCKET_LOW) continue;
      for (const c of t.sup) {
        if (c.shape !== 'box' || !c.upright || level.ramps.includes(c) || c.hits) continue;
        if (!plats.has(c)) plats.set(c, []);
        plats.get(c).push([j, t]);
      }
    }
  }
  console.log('');
  for (const [c, cells] of plats) {
    if (cells.length * GRID * GRID < MIN_AREA) continue;
    const sides = new Map();
    for (const [j, t] of cells) {
      const i = Math.floor(j / N), k = j % N;
      for (const [di, dk] of D4) {
        const ii = i + di, kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= N || kk >= N) continue;
        for (const a of tops[ii * N + kk]) {
          if (a.tier !== 0 || a.sup.includes(c) || a.y > t.y - 0.02 || walkInto(a.y, j) !== t) continue;
          // which face it came over, in the box's own frame
          const dx = X(ii) - c.c.x, dz = X(kk) - c.c.z;
          const u = (dx * c.ex.x + dz * c.ex.z) / c.hx, v = (dx * c.ez.x + dz * c.ez.z) / c.hz;
          const side = Math.abs(u) > Math.abs(v) ? (u > 0 ? '+x' : '-x') : (v > 0 ? '+z' : '-z');
          sides.set(side, (sides.get(side) || 0) + 1);
        }
      }
    }
    const ways = [...sides].filter(([, n]) => n * GRID >= MIN_WIDTH).map(([s]) => s);
    check(`low platform walked on to from 2 sides: ${c.tag || 'box'} (${c.c.x.toFixed(0)}, ${c.c.z.toFixed(0)}) ${c.max.y.toFixed(1)} m`,
      ways.length >= 2, ways.length ? `from ${ways.join(', ')}` : 'no way up on foot');
  }
}

// --- 8. the train ----------------------------------------------------------------
//
// A toy train that both enemy and player can hop on and stand on.
// With everything in, the real Player and a real cutter, stepped at 60 Hz with
// the toys run first each frame as Game runs them: walk on at each station,
// ride a whole lap standing still, jump on while it moves, jump off and keep
// its speed, an enemy that follows you aboard stays aboard, and one standing
// on the track in front of it is pushed clear, never through it.
if (moving.train) {
  console.log('');
  const L = moving, train = L.train, toys = L.toys, DT = 1 / 60;
  const reset = (i, dwell, s = null, v = 0) => {
    train.next = i; train.s = s ?? train.stops[i]; train.v = v; train.dwell = dwell;
    train.place(); toys.movers.step(DT, L, []); toys.movers.step(DT, L, []);
  };
  const onTrain = (b) => !!(b.onGround && b.ground && b.ground.mover);
  const car = (name) => train.cars.find((c) => c.name === name);
  const rider = (at, yaw) => {
    const d = driven(L, at, yaw);
    toys.movers.onTurn = (b, dyaw) => { if (b === d.p.body) d.p.yaw += dyaw; };
    d.tick = (extra = []) => { toys.update(DT, L, [d.p.body, ...extra]); d.step(); };
    return d;
  };

  // walk on at each station, off the platform on to the flat wagon
  for (const [i, st] of L.stations.entries()) {
    reset(i, 1e9);
    const side = Math.sign(st.x0 + st.x1);
    const flat = car('flat wagon').body.pos;
    const d = rider(new THREE.Vector3((st.x0 + st.x1) / 2, 0.85, flat.z), yawOf(side, 0));
    d.held.add('forward');
    let ok = false;
    for (let k = 0; k < 90 && !ok; k++) { d.tick(); ok = onTrain(d.p.body); }
    check(`walk on to the train: ${st.name}`, ok, ok ? `on the ${d.p.body.ground.mover.name}` : `ended at ${d.p.body.pos.toArray().map((n) => n.toFixed(1))}`);
  }

  // ride a whole lap, standing still on the flat wagon
  {
    reset(0, 1e9);
    const flat = car('flat wagon').body.pos;
    const st = L.stations[0];
    const d = rider(new THREE.Vector3((st.x0 + st.x1) / 2, 0.85, flat.z), yawOf(1, 0));
    d.held.add('forward');
    for (let k = 0; k < 90 && !onTrain(d.p.body); k++) d.tick();
    d.held.clear();
    for (let k = 0; k < 30; k++) d.tick();
    train.dwell = 0.5;
    let off = 0, low = Infinity, arrivals = 0, wasDwell = true, frames = 0;
    for (; frames < 150 * 60 && arrivals < 2; frames++) {
      d.tick();
      if (!onTrain(d.p.body)) off++;
      low = Math.min(low, d.p.body.pos.y);
      const dwell = train.dwell > 0;
      if (dwell && !wasDwell) arrivals++;
      wasDwell = dwell;
    }
    check('ride a whole lap standing still', arrivals === 2 && off < 30 && onTrain(d.p.body) && low > 0.7,
      `${(frames / 60).toFixed(0)} s, both stations, ${off} frames not on it, lowest ${low.toFixed(2)} m`);
  }

  // jump on as it goes by: the north straight, heading west at full speed
  {
    const flatBack = car('flat wagon').back;
    // the flat wagon's middle 14 m east of you, coming your way
    let s0 = 0;
    for (let s = 0; s < train.track.length; s += 0.05) {
      const q = train.track.at(s);
      if (Math.abs(q.z + train.track.half) < 0.01 && Math.abs(q.x - 14) < 0.03 && q.dx < 0) { s0 = s; break; }
    }
    reset(1, 0, s0 + flatBack, 6);
    const d = rider(new THREE.Vector3(0, 0.05, -train.track.half + 2.8), yawOf(0, -1));
    let ok = false, t = 0;
    for (let k = 0; k < 6 * 60 && !ok; k++) {
      const fx = car('flat wagon').body.pos.x;
      if (fx < 1.6 && fx > 0) { d.held.add('forward'); if (!t) { d.taps.add('jump'); t = k; } }
      if (t && k === t + 16) d.taps.add('jump');           // and again at the top
      d.tick();
      ok = onTrain(d.p.body);
    }
    check('jump on to it while it moves', ok, ok ? `on the ${d.p.body.ground.mover.name}` : `ended at ${d.p.body.pos.toArray().map((n) => n.toFixed(1))}`);
    d.held.clear();

    // then off the far side, and it keeps the train's speed while it flies
    if (ok) {
      for (let k = 0; k < 40; k++) d.tick();
      d.held.clear();
      d.p.yaw = yawOf(0, 1);
      const x0 = d.p.body.pos.x;
      d.held.add('forward'); d.taps.add('jump');
      let air = 0;
      for (let k = 0; k < 120; k++) {
        d.tick();
        if (!d.p.body.onGround) air++;
        else if (air > 3 && !onTrain(d.p.body)) break;
      }
      const dx = d.p.body.pos.x - x0, carried = 6 * air * DT;
      check('jump off and keep its speed', dx < -0.6 * carried && !onTrain(d.p.body),
        `${(-dx).toFixed(1)} m on along the track in ${(air * DT).toFixed(2)} s of flight (the train went ${carried.toFixed(1)})`);
    }
  }

  // an enemy that follows you aboard is still aboard at the next station
  {
    reset(0, 3);
    const flat = car('flat wagon').body.pos;
    const st = L.stations[0];
    const d = rider(new THREE.Vector3((st.x0 + st.x1) / 2, 0.85, flat.z), yawOf(1, 0));
    d.held.add('forward');
    for (let k = 0; k < 90 && !onTrain(d.p.body); k++) d.tick();
    d.held.clear();
    const ctx = figureCtx();
    ctx.level = L;
    ctx.player = d.p;
    d.p.damage = () => {};
    const E = new Enemies(ctx);
    const e = E.spawn('cutter', new THREE.Vector3((st.x0 + st.x1) / 2, 0.85, st.z0 + 3.5), { mind: 'hunt' });
    e.cool = 1e9;
    let boarded = false, arrived = false;
    for (let k = 0; k < 70 * 60 && !arrived; k++) {
      toys.update(DT, L, [d.p.body, e.body]);
      d.step();
      E.update(DT);
      if (onTrain(e.body)) boarded = true;
      if (boarded && train.next === 1 && train.dwell > 0) arrived = true;
    }
    check('an enemy boards and rides to the next station', boarded && arrived && onTrain(e.body),
      `boarded ${boarded}, at the west station ${arrived}, aboard ${onTrain(e.body)} on the ${e.body.ground?.mover?.name || 'desk'}`);
  }

  // one standing on the track in front of it is pushed clear, never through it
  {
    reset(1, 0, null, 0);
    train.dwell = 0;
    const ahead = train.track.at(train.s + 12);
    const d = rider(new THREE.Vector3(ahead.x, 0.35, ahead.z), 0);
    let inside = 0, worst = 0, frames = 0;
    for (; frames < 12 * 60; frames++) {
      d.tick();
      for (const c of L.colliders) {
        if (!c.mover || c.hits === 'rays') continue;
        const b = d.p.body;
        if (b.pos.y + b.height < c.min.y || b.pos.y > c.max.y) continue;
        const span = touchesColumn(c, b.pos.x, b.pos.z, 0);
        if (span && span.lo < b.pos.y + b.height - 0.05 && span.hi > b.pos.y + 0.05) {
          inside++;
          worst = Math.max(worst, span.hi - b.pos.y);
        }
      }
    }
    const clear = train.track.distance(d.p.body.pos.x, d.p.body.pos.z);
    check('in the way of it: pushed clear, never through it', inside === 0,
      `${inside} frames with its middle inside a car, ended ${clear.toFixed(1)} m from the track${onTrain(d.p.body) ? ', riding it' : ''}`);
  }
}

console.log(`\n  ${N * N} columns at ${GRID} m, ${cols.length} body colliders, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(bad ? `\n  ${bad} FAILED\n` : '\n  every place on the map can be walked to\n');
process.exit(bad ? 1 : 0);
