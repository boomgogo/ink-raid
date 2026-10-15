// The bot's knowledge of the map: where a body can stand, and where it can
// walk to from there. A player learns this by playing the desk a few times.
//
// Built in node from the real buildDesk() with the physics' own column test,
// the same way tools/reach.mjs builds its walk graph (see section 1 there), at
// half a metre: every top a standing body fits on, joined to its neighbour when
// a step of at most MOVE.stepUp or any drop gets there, and ladders foot to
// top. Things that move (the train) are left out: they are somewhere else a
// second later, and the bot's feelers handle them.
//
// Out: a compact graph the page can take in one message. `xyz` is the nodes,
// flat; `off`/`to`/`cost` is the adjacency, CSR style; `col` maps a grid column
// to its first node, so the bot can find the node under its feet.
import * as THREE from 'three';
import { buildDesk } from '../../src/world/map_desk.js';
import { bodyColliders, touchesColumn } from '../../src/core/physics.js';
import { MOVE } from '../../src/entities/player.js';

export function buildNav(GRID = 0.5) {
  const EPS = 1e-4;
  const R = MOVE.bodyRadius, H = MOVE.bodyHeight, STEP = MOVE.stepUp;
  const moving = buildDesk(new THREE.Scene());
  const level = { ...moving, colliders: moving.colliders.filter((c) => !c.mover), ghosts: (moving.ghosts || []).filter((c) => !c.mover) };
  const cols = bodyColliders(level);
  const E = (level.edge ?? 39) + 0.5;
  const N = Math.round((2 * E) / GRID) + 1;
  const X = (i) => -E + i * GRID;

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
        if (s) ss.push({ lo: s.lo, hi: s.hi });
      }
      const ts = [];
      for (const s of ss) {
        const y = s.hi;
        if (ss.some((o) => o.lo < y + H - EPS && o.hi > y + EPS)) continue;
        if (!ts.some((t) => Math.abs(t.y - y) < 0.01)) ts.push({ y });
      }
      spans[i * N + k] = ss;
      tops[i * N + k] = ts;
    }
  }
  const walkInto = (y, j) => {
    let up = -Infinity;
    for (const s of spans[j]) {
      if (s.lo < y + H - EPS && s.hi > y + EPS) {
        if (s.hi - y > STEP) return null;
        if (s.hi > up) up = s.hi;
      }
    }
    let land = -Infinity;
    for (const t of tops[j]) {
      if (up > -Infinity) { if (Math.abs(t.y - up) < 0.01) return t; }
      else if (t.y <= y + EPS && t.y > land) land = t.y;
    }
    if (up > -Infinity) return null;
    return tops[j].find((t) => t.y === land) || null;
  };

  // number the tops
  const xyz = [];
  const col = new Int32Array(N * N).fill(-1);
  const ncol = [];
  for (let j = 0; j < N * N; j++) {
    const i = Math.floor(j / N), k = j % N;
    if (tops[j].length) col[j] = xyz.length / 3;
    for (const t of tops[j]) {
      t.id = xyz.length / 3;
      xyz.push(+X(i).toFixed(2), +t.y.toFixed(3), +X(k).toFixed(2));
      ncol.push(j);
    }
  }

  const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const adj = Array.from({ length: xyz.length / 3 }, () => []);
  for (let j = 0; j < N * N; j++) {
    const i = Math.floor(j / N), k = j % N;
    for (const t of tops[j]) {
      // a top beside a wall or a drop costs more to walk along, so a route
      // keeps off the very edge of a ramp or a book
      let edge = false;
      for (const [di, dk] of D8.slice(0, 4)) {
        const ii = i + di, kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= N || kk >= N) { edge = true; break; }
        const to = walkInto(t.y, ii * N + kk);
        if (!to || Math.abs(to.y - t.y) > STEP) { edge = true; break; }
      }
      for (const [di, dk] of D8) {
        const ii = i + di, kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= N || kk >= N) continue;
        const to = walkInto(t.y, ii * N + kk);
        if (!to) continue;
        if (di && dk) {
          // a diagonal only past two open sides, or it cuts a corner
          const a = walkInto(t.y, ii * N + k), b = walkInto(t.y, i * N + kk);
          if (!a || !b) continue;
        }
        const d = GRID * Math.hypot(di, dk);
        adj[t.id].push([to.id, +(d * (edge ? 2.5 : 1) + Math.max(0, to.y - t.y) * 0.5).toFixed(2)]);
      }
    }
  }
  // ladders: foot to top and back
  const colAt = (x, z) => {
    const i = Math.round((x + E) / GRID), k = Math.round((z + E) / GRID);
    return i >= 0 && k >= 0 && i < N && k < N ? i * N + k : -1;
  };
  const topNear = (j, y, tol = 0.6) => {
    let best = null;
    for (const t of j >= 0 ? tops[j] : []) if (Math.abs(t.y - y) < tol && (!best || Math.abs(t.y - y) < Math.abs(best.y - y))) best = t;
    return best;
  };
  let ladders = 0;
  for (const l of level.ladders) {
    const foot = topNear(colAt(l.foot.x + l.nx * l.rest, l.foot.z + l.nz * l.rest), l.foot.y);
    let top = null;
    for (let d = 0.25; d <= 1.5 && !top; d += GRID) top = topNear(colAt(l.foot.x - l.nx * d, l.foot.z - l.nz * d), l.top, 0.3);
    if (foot && top) {
      const len = Math.abs(top.y - foot.y) + 1;
      adj[foot.id].push([top.id, +(len * 1.5).toFixed(2)]);
      adj[top.id].push([foot.id, +(len * 1.5).toFixed(2)]);
      ladders++;
    }
  }

  const off = [0], to = [], cost = [];
  for (const a of adj) { for (const [t, c] of a) { to.push(t); cost.push(c); } off.push(to.length); }
  return { grid: GRID, E, N, xyz, off, to, cost, col: Array.from(col), ladders, nodes: xyz.length / 3 };
}
