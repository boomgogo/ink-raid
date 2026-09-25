// Do the toys move according to physics?
//
// A double pendulum and Newton's cradle that actually move according to
// physics. Said is not shown, so this checks the equations
// against what physics says they must do, in node, with no browser:
//
//   the pendulum conserves energy when nothing drives or slows it, at 60 fps
//     and at 20 — its step is fixed, so a slow phone runs the same physics;
//   it agrees with itself integrated at an eighth of the step;
//   a shot changes its angular momentum about the pivot by exactly r x p,
//     because the pivot's own push passes through the pivot;
//   the cradle: let one ball go and one leaves the far end, two in and two
//     out, and each impact keeps the row's momentum;
//   with their kickers on, both stay lively for ten minutes, the cradle's
//     middle balls stay still while its ends swing, and nothing goes NaN.
//
//   npm run toys
import * as THREE from 'three';
import { Pendulum, PENDULUM } from '../src/world/pendulum.js';
import { Cradle, CRADLE } from '../src/world/cradle.js';

let bad = 0;
const check = (name, ok, detail = '') => {
  if (!ok) bad++;
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
};
// a stand-in for Movers: the toys only draw into it and pose bodies
const movers = () => ({ body: (name, owner) => ({ name, owner, b: { box() {}, cyl() {}, sphere() {} } }), setPose() {} });
const frame = () => ({ pivot: new THREE.Vector3(0, PENDULUM.pivot, 0), t: new THREE.Vector3(1, 0, 0), n: new THREE.Vector3(0, 0, 1), facing: 0 });
const saved = { ...PENDULUM }, savedC = { ...CRADLE };
const restore = () => { Object.assign(PENDULUM, saved); Object.assign(CRADLE, savedC); };

// --- the double pendulum ----------------------------------------------------
{
  PENDULUM.friction = 0; PENDULUM.kick = 0;
  for (const fps of [60, 20]) {
    const p = new Pendulum(movers(), frame());
    const E0 = p.energy();
    let worst = 0;
    for (let i = 0; i < 60 * fps; i++) { p.update(1 / fps); worst = Math.max(worst, Math.abs(p.energy() - E0) / E0); }
    check(`pendulum keeps its energy, 60 s at ${fps} fps`, worst < 1e-3, `worst drift ${(worst * 100).toFixed(4)} %`);
  }
  {
    const a = new Pendulum(movers(), frame()), b = new Pendulum(movers(), frame());
    const h = PENDULUM.h;
    for (let i = 0; i < 3 / h; i++) a.step(h);
    for (let i = 0; i < (3 / h) * 8; i++) b.step(h / 8);
    const err = Math.max(Math.abs(a.q[0] - b.q[0]), Math.abs(a.q[1] - b.q[1]));
    check('pendulum agrees with itself at an eighth of the step', err < 1e-3, `${err.toExponential(2)} rad after 3 s`);
  }
  {
    // angular momentum about the pivot, in the swing plane (u along t, y up)
    const P = PENDULUM;
    const L = (p) => {
      const [q1, q2] = p.q, [w1, w2] = p.w;
      const c1 = [P.c1 * Math.sin(q1), -P.c1 * Math.cos(q1)], v1 = [P.c1 * Math.cos(q1) * w1, P.c1 * Math.sin(q1) * w1];
      const j = [P.l1 * Math.sin(q1), -P.l1 * Math.cos(q1)], vj = [P.l1 * Math.cos(q1) * w1, P.l1 * Math.sin(q1) * w1];
      const c2 = [j[0] + P.c2 * Math.sin(q2), j[1] - P.c2 * Math.cos(q2)];
      const v2 = [vj[0] + P.c2 * Math.cos(q2) * w2, vj[1] + P.c2 * Math.sin(q2) * w2];
      const cross = (r, v) => r[0] * v[1] - r[1] * v[0];
      return P.I1 * w1 + P.m1 * cross(c1, v1) + P.I2 * w2 + P.m2 * cross(c2, v2);
    };
    let worst = 0;
    for (const [k, s, dir] of [[1, 4.5, [1, 0, 0]], [1, 2, [0.6, 0.8, 0]], [0, 5, [-1, 0, 0]], [0, 1, [0.8, -0.6, 0]]]) {
      const p = new Pendulum(movers(), frame());
      p.q = [0.7, -1.2]; p.w = [0.4, -0.9];
      const from = k === 0 ? p.f.pivot.clone() : p.joint();
      const ang = p.q[k];
      const point = from.clone().add(new THREE.Vector3(Math.sin(ang) * s, -Math.cos(ang) * s, 0));
      const d = new THREE.Vector3(...dir).normalize();
      const J = 2.5;
      const before = L(p);
      p.hit(p.links[k], point, d, J);
      const r = [point.x - p.f.pivot.x, point.y - p.f.pivot.y];
      const want = r[0] * d.y * J - r[1] * d.x * J;
      worst = Math.max(worst, Math.abs(L(p) - before - want) / Math.abs(want));
    }
    check('a shot changes its angular momentum by r x p', worst < 0.01, `worst ${(worst * 100).toFixed(3)} % off, over four hits`);
  }
  restore();
}

// --- the Newton's cradle ----------------------------------------------------
const cradle = () => new Cradle(movers(), { origin: new THREE.Vector3(), t: new THREE.Vector3(1, 0, 0), n: new THREE.Vector3(0, 0, 1), facing: 0, pitch: 2 * CRADLE.r + CRADLE.gap });
{
  CRADLE.kick = 0; CRADLE.air = 0;
  for (const k of [1, 2]) {
    const c = cradle();
    c.phi = [-0.45, -0.45, 0, 0, 0].map((v, i) => (i < k ? v : 0));
    c.phi[0] = -0.45; if (k === 2) c.phi[1] = -0.45;
    // swing in, and look just after the row has passed the impact on
    let stillIn = 0;
    const speed = (i) => Math.abs(c.w[i]) * CRADLE.L;
    const peak = new Array(CRADLE.n).fill(0);
    for (let i = 0; i < 480 * 0.75; i++) c.step(CRADLE.h);
    for (let i = 0; i < 480 * 0.25; i++) {
      c.step(CRADLE.h);
      for (let j = 0; j < CRADLE.n; j++) peak[j] = Math.max(peak[j], speed(j));
    }
    const vin = Math.sqrt(2 * CRADLE.g * CRADLE.L * (1 - Math.cos(0.45)));
    const out = [...Array(k)].map((_, i) => peak[CRADLE.n - 1 - i]);
    const rest = [...Array(CRADLE.n - k)].map((_, i) => speed(i));
    stillIn = Math.max(...rest) / vin;
    const outFrac = Math.min(...out) / vin;
    check(`cradle: ${k} in, ${k} out`, outFrac > 0.9 && stillIn < 0.05,
      `the far ${k} leave at ${(outFrac * 100).toFixed(0)} % of ${vin.toFixed(2)} m/s; the rest at ${(stillIn * 100).toFixed(1)} % or less`);
  }
  {
    // momentum along the row, just before and just after the first impact
    const c = cradle();
    c.phi = [-0.45, 0, 0, 0, 0];
    const p = () => c.w.reduce((a, w, i) => a + w * Math.cos(c.phi[i]), 0) * CRADLE.L;
    let before = 0, after = 0;
    for (let i = 0; i < 480 * 2; i++) {
      const pre = p(), wasMoving = c.w[CRADLE.n - 1];
      c.step(CRADLE.h);
      if (!wasMoving && c.w[CRADLE.n - 1] > 0.01) { before = pre; after = p(); break; }
    }
    check('cradle: an impact keeps the row\'s momentum', before > 0 && Math.abs(after - before) / before < 0.01,
      `${before.toFixed(3)} -> ${after.toFixed(3)}`);
  }
  restore();
}

// --- both, kicked, for ten minutes -------------------------------------------
{
  const p = new Pendulum(movers(), frame()), c = cradle();
  let pLow = Infinity, pHigh = 0, cLow = Infinity, mid = 0, ends = 0, nan = false;
  for (let i = 0; i < 60 * 600; i++) {
    p.update(1 / 60); c.update(1 / 60, null, []);
    if (i > 60 * 60) {
      const e = p.energy() / p.level;
      pLow = Math.min(pLow, e); pHigh = Math.max(pHigh, e);
      cLow = Math.min(cLow, c.energy());
      mid = Math.max(mid, Math.abs(c.phi[2]));
      ends = Math.max(ends, Math.abs(c.phi[0]), Math.abs(c.phi[CRADLE.n - 1]));
    }
    if (![...p.q, ...p.w, ...c.phi, ...c.w].every(Number.isFinite)) { nan = true; break; }
  }
  check('the pendulum stays lively for ten minutes', !nan && pLow > 0.9 && pHigh < 3,
    `energy ${pLow.toFixed(2)}-${pHigh.toFixed(2)} of lifting the arms level`);
  check('the cradle swings its ends and not its middle', !nan && ends > 0.25 && mid < 0.05,
    `ends out to ${(ends * 180 / Math.PI).toFixed(0)} deg, the middle ball ${(mid * 180 / Math.PI).toFixed(1)} deg`);
}

console.log(bad ? `\n  ${bad} FAILED\n` : '\n  the toys move as physics says they must\n');
process.exit(bad ? 1 : 0);
