import * as THREE from 'three';
import { INK, LOOK } from '../render/palette.js';
import { GRAVITY } from '../core/physics.js';

// The Newton's cradle. A double pendulum and Newton's cradle that actually
// move according to physics.
//
// Five steel balls, each its own pendulum hung by a V of two strings from two
// top bars — bifilar, which is what keeps a real one's balls swinging in one
// plane. Each ball's angle is integrated on its own, under the world's gravity
// (GRAVITY, as everything here falls; see pendulum.js), at a fixed 1/480 s.
//
// Where two neighbours meet, an impulse along the line between their centres,
// with a restitution of 0.992: steel on steel. Within a step the impacts are
// resolved ONE AFTER ANOTHER, in the order the wave travels along the row, and
// swept again until no pair is still closing. That order is the whole trick —
// resolve the row all at once and the balls move off together in a lump — and
// it gives the real behaviour: let one go and one leaves the far end, two in
// and two out. `npm run toys` lets them go and counts.
//
// Losses are the restitution, air and the strings' pivots, so left to itself
// it runs down in half a minute, as a real one does. Those same losses are
// what keep the middle balls still: with a restitution short of 1, every
// impact leaves them a trace of speed, and without the drag to take it away
// the row drifts into swinging together in a lump within a minute. It is not left to itself: the same
// hidden kicker as the pendulum's sits under the end ball, and when the
// cradle's energy falls under a floor it draws that ball out as it swings away
// and lets it go.
//
// A ball that meets someone standing in its way bounces off them — you are
// planted on the desk, and a ball swinging into you stops short — and the
// movers push you out of it. Shot, a ball takes the round's momentum along its
// swing: shoot an end ball and the far one leaves.

export const CRADLE = {
  n: 5,
  r: 1.0,                 // a ball's radius
  L: 6,                   // pivot to ball centre
  bar: 8.8,               // the top bars' height
  spread: 1.3,            // each string's anchor out from the plane
  gap: 0.004,             // between balls at rest
  g: GRAVITY,
  e: 0.992,               // restitution, steel on steel
  air: 0.12,              // per second: air, and the strings' pivots
  h: 1 / 480,
  amp: 0.5,               // the kicker keeps an end ball swinging about this far (rad)...
  floor: 0.75,            // ...topping it up below this fraction of that energy
  kick: 2.2,              // rad/s² it draws the end ball out with
  maxSpeed: 3,            // rad/s: about 80 degrees of swing
  bounce: 0.3,            // off a body in the way
};

const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);
const _p = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** The cradle's base, frame and top bars, into the map's Builder. Returns its frame. */
export function layCradle(b, x, z, facing) {
  const C = CRADLE;
  const t = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
  const n = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
  const at = (u, w, y = 0) => new THREE.Vector3(x + t.x * u + n.x * w, y, z + t.z * u + n.z * w);
  b.thing("Newton's cradle");
  b.box(x, 0, z, 11, 0.5, 5, { ink: INK.BLACK, look: LOOK.SOLID, rotY: facing, tag: 'cradle base', place: 'on the cradle base' });
  // the kicker's coil, under where the first ball rests
  const pitch = 2 * C.r + C.gap;
  const coil = at(-2 * pitch, 0, 0.5);
  b.cyl(coil.x, 0.5, coil.z, 0.5, 0.5, { ink: INK.ORANGE, look: LOOK.WASH, seg: 12, tag: 'coil' });
  // two A-frames, and the two bars along the top
  const rod = { ink: INK.PEN, look: LOOK.WRAP, seg: 8, tag: 'cradle frame' };
  for (const u of [-4.9, 4.9]) {
    for (const w of [-1, 1]) {
      const foot = at(u, w * 2.1, 0.5), top = at(u, w * C.spread, C.bar);
      const d = top.clone().sub(foot);
      const m = foot.clone().addScaledVector(d, 0.5);
      b.cyl(m.x, m.y, m.z, 0.18, d.length(), { ...rod, dir: d.normalize() });
    }
  }
  for (const w of [-1, 1]) {
    const c = at(0, w * C.spread, C.bar);
    b.cyl(c.x, c.y, c.z, 0.2, 10.2, { ...rod, dir: t });
  }
  for (const u of [-4.9, 4.9]) b.anchor(...at(u, 0, C.bar + 0.5).toArray());
  return { origin: new THREE.Vector3(x, 0, z), t, n, facing, pitch };
}

export class Cradle {
  constructor(movers, frame) {
    const C = CRADLE;
    this.f = frame;
    this.movers = movers;
    this.balls = [];
    for (let i = 0; i < C.n; i++) {
      const body = movers.body(`cradle ball ${i + 1}`, this);
      body.index2 = i;
      // drawn hanging from its pivot: the ball, and a string up to each bar
      body.b.sphere(0, -C.L, 0, C.r, { ink: INK.PEN, lift: 0.1, seg: 16, seg2: 10, tag: 'ball' });
      const top = new THREE.Vector3(0, -C.L + C.r, 0);
      for (const w of [-1, 1]) {
        const anchor = new THREE.Vector3(0, 0, w * C.spread);
        const d = anchor.clone().sub(top);
        const m = top.clone().addScaledVector(d, 0.5);
        body.b.cyl(m.x, m.y, m.z, 0.035, d.length(), { ink: INK.BLACK, look: LOOK.SOLID, seg: 5, dir: d.normalize(), solid: false, ghost: 'decor' });
      }
      this.balls.push(body);
    }
    this.reset();
  }

  /** At rest but for the first ball, drawn back and ready to go. */
  reset() {
    this.phi = new Array(CRADLE.n).fill(0);
    this.w = new Array(CRADLE.n).fill(0);
    this.phi[0] = -0.5;
    this.acc = 0;
    this.place();
  }

  /** A ball's pivot's distance along the row, from the middle. */
  row(i) { return (i - (CRADLE.n - 1) / 2) * this.f.pitch; }

  /** Kinetic plus potential, per unit ball mass, 0 at rest. */
  energy() {
    const C = CRADLE;
    let E = 0;
    for (let i = 0; i < C.n; i++) E += 0.5 * (C.L * this.w[i]) ** 2 + C.g * C.L * (1 - Math.cos(this.phi[i]));
    return E;
  }

  /** One fixed step: swing, then settle every impact in the order it travels. */
  step(h, events) {
    const C = CRADLE;
    const target = C.g * C.L * (1 - Math.cos(C.amp));
    const E = this.energy();
    for (let i = 0; i < C.n; i++) {
      let a = -(C.g / C.L) * Math.sin(this.phi[i]) - C.air * this.w[i];
      // the kicker, under the first ball: out the way it is swinging away
      if (i === 0 && E < C.floor * target && this.phi[0] < -0.02 && this.w[0] < 0) a -= C.kick;
      this.w[i] += a * h;
      this.phi[i] += this.w[i] * h;
    }
    // at rest entirely, it nudges the first ball out to start again
    if (E < 0.01 * target && Math.abs(this.w[0]) < 0.02) this.w[0] = -0.6;

    const x = (i) => this.row(i) + C.L * Math.sin(this.phi[i]);
    const y = (i) => -C.L * Math.cos(this.phi[i]);
    const touch = 2 * C.r + 1.5 * C.gap;
    for (let sweep = 0; sweep < 8; sweep++) {
      let any = false;
      for (let k = 0; k < C.n - 1; k++) {
        const i = sweep % 2 ? C.n - 2 - k : k, j = i + 1;
        const dx = x(j) - x(i), dy = y(j) - y(i), dist = Math.hypot(dx, dy);
        if (dist >= touch) continue;
        const nx = dx / dist, ny = dy / dist;
        // each ball moves along its swing, (cos phi, sin phi)
        const ti = nx * Math.cos(this.phi[i]) + ny * Math.sin(this.phi[i]);
        const tj = nx * Math.cos(this.phi[j]) + ny * Math.sin(this.phi[j]);
        const closing = C.L * (this.w[i] * ti - this.w[j] * tj);
        if (dist < 2 * C.r - 1e-3) {
          // sunk into each other by a step's worth: part them along the row
          const over = (2 * C.r - dist) / (2 * C.L);
          this.phi[i] -= over; this.phi[j] += over;
        }
        if (closing <= 1e-6) continue;
        const J = ((1 + C.e) * closing) / (ti * ti + tj * tj);
        this.w[i] -= (J * ti) / C.L;
        this.w[j] += (J * tj) / C.L;
        any = true;
        if (events && closing > events.hardest) { events.hardest = closing; events.at = i; }
      }
      if (!any) break;
    }
    for (let i = 0; i < C.n; i++) this.w[i] = THREE.MathUtils.clamp(this.w[i], -C.maxSpeed, C.maxSpeed);
  }

  update(dt, toys, bodies = []) {
    const C = CRADLE;
    const events = { hardest: 0, at: -1 };
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= C.h) {
      this.step(C.h, events);
      this.acc -= C.h;
    }
    // someone in the way: the ball stops short against them, and bounces
    for (let i = 0; i < C.n && bodies.length; i++) {
      const c = this.center(i, _p);
      const v = this.w[i];
      if (Math.abs(v) < 1e-3) continue;
      const along = this.f.t.clone().multiplyScalar(Math.cos(this.phi[i]) * Math.sign(v));
      for (const b of bodies) {
        const dx = b.pos.x - c.x, dz = b.pos.z - c.z;
        if (Math.hypot(dx, dz) - b.radius > C.r) continue;
        if (c.y + C.r < b.pos.y || c.y - C.r > b.pos.y + b.height) continue;
        if (dx * along.x + dz * along.z <= 0) continue;           // swinging away from them
        this.w[i] = -this.w[i] * C.bounce;
      }
    }
    if (events.hardest > 0.25) toys?.emit('click', this.center(events.at, new THREE.Vector3()), Math.min(1, events.hardest / 3));
    this.place();
  }

  /** Ball i's centre in the world. */
  center(i, out = new THREE.Vector3()) {
    const C = CRADLE, f = this.f;
    return out.copy(f.origin)
      .addScaledVector(f.t, this.row(i) + C.L * Math.sin(this.phi[i]))
      .setY(C.bar - C.L * Math.cos(this.phi[i]));
  }

  place() {
    const C = CRADLE, f = this.f;
    _qa.setFromAxisAngle(UP, f.facing);
    for (let i = 0; i < C.n; i++) {
      _p.copy(f.origin).addScaledVector(f.t, this.row(i)).setY(C.bar);
      _q.setFromAxisAngle(_z, this.phi[i]);
      this.movers.setPose(this.balls[i], _p, _qa.clone().multiply(_q));
    }
  }

  /** A round with momentum `j` along `dir` hit ball `body`. */
  hit(body, point, dir, j) {
    const C = CRADLE, i = this.balls.indexOf(body);
    if (i < 0) return;
    // along its swing: (cos phi along the row, sin phi up)
    const along = dir.dot(this.f.t) * Math.cos(this.phi[i]) + dir.y * Math.sin(this.phi[i]);
    this.w[i] = THREE.MathUtils.clamp(this.w[i] + (j * along) / C.L, -C.maxSpeed, C.maxSpeed);
  }

  blast(center, radius, strength) {
    for (let i = 0; i < CRADLE.n; i++) {
      const c = this.center(i);
      const d = c.distanceTo(center);
      if (d > radius) continue;
      this.hit(this.balls[i], c, c.clone().sub(center).normalize(), strength * (1 - d / radius));
    }
  }
}
