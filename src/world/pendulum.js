import * as THREE from 'three';
import { INK, LOOK } from '../render/palette.js';
import { GRAVITY } from '../core/physics.js';

// The double pendulum. A double pendulum and Newton's cradle that actually
// move according to physics.
//
// It is two rigid links, not two point masses on strings, because the arms are
// drawn with mass: a flat bar with a weight at its end. Each link has a mass,
// the distance from its pivot to its centre of mass, and a moment of inertia
// about that centre. The Lagrangian of the pair gives the textbook equations,
//
//   M(q) q'' = -[ k sin(t1 - t2) t2'^2 + (m1 c1 + m2 l1) g sin t1 ,
//               -k sin(t1 - t2) t1'^2 + m2 c2 g sin t2 ]  - friction
//
//   M = [ m1 c1^2 + I1 + m2 l1^2    k cos(t1 - t2) ]      k = m2 l1 c2
//       [ k cos(t1 - t2)            m2 c2^2 + I2   ]
//
// with angles from straight down, stepped with fourth-order Runge-Kutta at a
// fixed 1/240 s, whatever the frame rate: a phone at 20 fps runs the same
// physics as a desktop at 144. `npm run toys` checks it conserves energy and
// agrees with itself at an eighth of the step.
//
// GRAVITY is the world's own (core/physics.js), the number every body here
// falls with. At true scale (you are 4 cm tall) it would be 430, and the arms
// would be a blur.
//
// KEPT GOING. A real "perpetual" desk toy hides an electromagnet in its base
// that kicks the first arm each time it swings past the bottom. This one does
// the same whenever its energy falls under a floor, drawn as a coil on the
// base, so it never runs down — and it has enough in it to throw the second
// arm over the top now and then, which is where the chaos shows.
//
// SHOT, it takes the round's momentum as an impulse at the point it was hit:
// the joint velocities change by M^-1 J^T p, where J is how that point moves
// with the two angles. Shoot the tip and it spins; shoot near the pivot and it
// barely notices.
//
// It swings in a vertical plane square to the corner's diagonal, 15 m up, so
// its ten metres of reach stay over its own corner of the desk and never over
// the track.

export const PENDULUM = {
  pivot: 15,              // m up
  l1: 5.5, l2: 4.5,       // pivot to joint, joint to tip
  m1: 3, c1: 3.4, I1: 7,  // the first arm with the joint's weight on it
  m2: 1.6, c2: 3.2, I2: 2.6,
  g: GRAVITY,
  friction: 0.02,         // per second, at each joint
  h: 1 / 240,             // the fixed step
  floor: 1.15,            // the kicker tops it up below this, in units of lifting the arms level
  kick: 9,                // its torque on the first arm
  maxSpeed: 6 * Math.PI,  // three turns a second
};

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);

/** The pendulum's base and post, drawn into the map's Builder. Returns its frame. */
export function layPendulum(b, x, z, facing) {
  const P = PENDULUM;
  // local +x along the swing plane, +z out of it (towards the arena), +y up
  const t = new THREE.Vector3(Math.cos(facing), 0, -Math.sin(facing));
  const n = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
  const at = (u, w) => new THREE.Vector3(x + t.x * u + n.x * w, 0, z + t.z * u + n.z * w);
  b.thing('double pendulum');
  const base = at(0, 0);
  b.box(base.x, 0, base.z, 6, 0.5, 3, { ink: INK.BLACK, look: LOOK.SOLID, rotY: facing, tag: 'pendulum base', place: 'on the pendulum base' });
  // the kicker's coil on the base, under where the first arm swings past
  const coil = at(0, 1.1);
  b.cyl(coil.x, 0.5, coil.z, 0.45, 0.6, { ink: INK.ORANGE, look: LOOK.WASH, seg: 12, tag: 'coil' });
  // the post, up the back of the base, and a bracket out to the pivot
  const post = at(0, -0.6);
  b.cyl(post.x, 0.5, post.z, 0.5, P.pivot - 0.5 + 0.6, { ink: INK.PEN, seg: 12, tag: 'post' });
  const arm = at(0, 0);
  b.box(arm.x, P.pivot - 0.35, arm.z, 0.7, 0.7, 1.4, { ink: INK.BLACK, look: LOOK.SOLID, rotY: facing, tag: 'bracket' });
  b.anchor(arm.x, P.pivot + 1, arm.z);
  const pivot = at(0, 0.9).setY(P.pivot);
  return { pivot, t, n, facing };
}

export class Pendulum {
  constructor(movers, frame, seed = 1) {
    this.f = frame;
    this.movers = movers;
    const P = PENDULUM;
    this.seed = seed;
    this.links = [movers.body('pendulum arm 1', this), movers.body('pendulum arm 2', this)];
    // Each link drawn hanging straight down its own -y from its pivot, in the
    // swing plane (x) and flat across it (z).
    const [a, c] = this.links;
    const bar = { ink: INK.BLACK, look: LOOK.SOLID, tag: 'pendulum arm' };
    a.b.box(0, -P.l1 - 0.25, 0, 0.55, P.l1 + 0.5, 0.25, bar);
    a.b.cyl(0, -P.l1, 0.25, 0.75, 0.3, { axis: 'z', ink: INK.ORANGE, look: LOOK.WASH, seg: 14, tag: 'weight' });
    a.b.cyl(0, 0, 0.12, 0.4, 0.26, { axis: 'z', ink: INK.PEN, lift: 0.1, seg: 10, tag: 'hub' });
    c.b.box(0, -P.l2 - 0.2, 0.5, 0.45, P.l2 + 0.4, 0.22, bar);
    c.b.cyl(0, -P.l2, 0.72, 0.85, 0.3, { axis: 'z', ink: INK.ORANGE, look: LOOK.WASH, seg: 14, tag: 'weight' });
    this.reset();
  }

  /** Held well up, a little off straight, so it goes chaotic at once. */
  reset() {
    this.q = [2.2 + 0.1 * this.seed, 2.9];
    this.w = [0, 0];
    this.acc = 0;
    this.place();
  }

  mass(q, out) {
    const P = PENDULUM, k = P.m2 * P.l1 * P.c2;
    out[0] = P.m1 * P.c1 * P.c1 + P.I1 + P.m2 * P.l1 * P.l1;
    out[1] = k * Math.cos(q[0] - q[1]);
    out[2] = P.m2 * P.c2 * P.c2 + P.I2;
    return out;
  }

  /** Angular accelerations at state (q, w), with an extra torque `tau` on the first joint. */
  accel(q, w, tau = 0, out = [0, 0]) {
    const P = PENDULUM, k = P.m2 * P.l1 * P.c2;
    const [a, b, d] = this.mass(q, this._M || (this._M = [0, 0, 0]));
    const s = Math.sin(q[0] - q[1]);
    const f1 = -(k * s * w[1] * w[1] + (P.m1 * P.c1 + P.m2 * P.l1) * P.g * Math.sin(q[0])) - P.friction * w[0] + tau;
    const f2 = -(-k * s * w[0] * w[0] + P.m2 * P.c2 * P.g * Math.sin(q[1])) - P.friction * (w[1] - w[0]);
    const det = a * d - b * b;
    out[0] = (d * f1 - b * f2) / det;
    out[1] = (a * f2 - b * f1) / det;
    return out;
  }

  /** Kinetic plus potential, with the potential 0 hanging straight down. */
  energy() {
    const P = PENDULUM;
    const [a, b, d] = this.mass(this.q, [0, 0, 0]);
    const [w1, w2] = this.w;
    const T = 0.5 * (a * w1 * w1 + 2 * b * w1 * w2 + d * w2 * w2);
    const V = (P.m1 * P.c1 + P.m2 * P.l1) * P.g * (1 - Math.cos(this.q[0])) + P.m2 * P.c2 * P.g * (1 - Math.cos(this.q[1]));
    return T + V;
  }

  /** The energy that lifts both arms out level: the scale the kicker's floor is in. */
  get level() {
    const P = PENDULUM;
    return (P.m1 * P.c1 + P.m2 * P.l1) * P.g + P.m2 * P.c2 * P.g;
  }

  /** One fixed step of RK4. */
  step(h, tau = 0) {
    const q = this.q, w = this.w;
    const k1 = this.accel(q, w, tau, [0, 0]);
    const q2 = [q[0] + w[0] * h / 2, q[1] + w[1] * h / 2], w2 = [w[0] + k1[0] * h / 2, w[1] + k1[1] * h / 2];
    const k2 = this.accel(q2, w2, tau, [0, 0]);
    const q3 = [q[0] + w2[0] * h / 2, q[1] + w2[1] * h / 2], w3 = [w[0] + k2[0] * h / 2, w[1] + k2[1] * h / 2];
    const k3 = this.accel(q3, w3, tau, [0, 0]);
    const q4 = [q[0] + w3[0] * h, q[1] + w3[1] * h], w4 = [w[0] + k3[0] * h, w[1] + k3[1] * h];
    const k4 = this.accel(q4, w4, tau, [0, 0]);
    for (let i = 0; i < 2; i++) {
      q[i] += (h / 6) * (w[i] + 2 * w2[i] + 2 * w3[i] + w4[i]);
      w[i] += (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
    }
  }

  /** The kicker: a push on the first arm, the way it is going, as it passes the bottom. */
  drive() {
    const P = PENDULUM;
    if (this.energy() >= P.floor * this.level) return 0;
    const a = ((this.q[0] + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    if (Math.abs(a) > 0.35) return 0;
    return P.kick * (this.w[0] >= 0 ? 1 : -1);
  }

  update(dt) {
    const P = PENDULUM;
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= P.h) {
      this.step(P.h, this.drive());
      for (let i = 0; i < 2; i++) this.w[i] = THREE.MathUtils.clamp(this.w[i], -P.maxSpeed, P.maxSpeed);
      this.acc -= P.h;
    }
    this.place();
  }

  /** Where the joint is, in the world. */
  joint(out = new THREE.Vector3()) {
    const P = PENDULUM, f = this.f;
    const u = Math.sin(this.q[0]) * P.l1, y = -Math.cos(this.q[0]) * P.l1;
    return out.copy(f.pivot).addScaledVector(f.t, u).setY(f.pivot.y + y);
  }

  place() {
    const f = this.f;
    // the plane's own frame: turn +x on to t, then swing about +z
    _qa.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.facing);
    for (let i = 0; i < 2; i++) {
      _q.setFromAxisAngle(_z, this.q[i]);
      const at = i === 0 ? f.pivot : this.joint(_v);
      this.movers.setPose(this.links[i], at, _qa.clone().multiply(_q));
    }
  }

  /** A round (impulse `j` along `dir`) hit link `body` at `point`. */
  hit(body, point, dir, j) {
    const P = PENDULUM, f = this.f;
    const k = this.links.indexOf(body);
    if (k < 0) return;
    // the impulse in the swing plane: along t, and up
    const pu = dir.dot(f.t) * j, py = dir.y * j;
    // how the hit point moves with each angle: a point s along link 1, or s
    // along link 2 past the joint
    const from = k === 0 ? f.pivot : this.joint(_v.clone());
    const s = Math.min(k === 0 ? P.l1 : P.l2, Math.hypot(point.x - from.x, point.y - from.y, point.z - from.z));
    const J = [[0, 0], [0, 0]];                       // J[row: u, y][col: q1, q2]
    const [q1, q2] = this.q;
    if (k === 0) { J[0][0] = s * Math.cos(q1); J[1][0] = s * Math.sin(q1); }
    else {
      J[0][0] = P.l1 * Math.cos(q1); J[1][0] = P.l1 * Math.sin(q1);
      J[0][1] = s * Math.cos(q2); J[1][1] = s * Math.sin(q2);
    }
    const Q1 = J[0][0] * pu + J[1][0] * py, Q2 = J[0][1] * pu + J[1][1] * py;
    const [a, b, d] = this.mass(this.q, [0, 0, 0]);
    const det = a * d - b * b;
    this.w[0] += (d * Q1 - b * Q2) / det;
    this.w[1] += (a * Q2 - b * Q1) / det;
    for (let i = 0; i < 2; i++) this.w[i] = THREE.MathUtils.clamp(this.w[i], -P.maxSpeed, P.maxSpeed);
  }

  /** A blast pushes the end of each arm away from it. */
  blast(center, radius, strength) {
    for (const [body, end] of [[this.links[0], this.joint()], [this.links[1], this.tip()]]) {
      const d = end.distanceTo(center);
      if (d > radius) continue;
      this.hit(body, end, end.clone().sub(center).normalize(), strength * (1 - d / radius));
    }
  }

  /** Where the tip of the second arm is. */
  tip(out = new THREE.Vector3()) {
    const P = PENDULUM, f = this.f;
    const j = this.joint(out);
    return j.addScaledVector(f.t, Math.sin(this.q[1]) * P.l2).setY(j.y - Math.cos(this.q[1]) * P.l2);
  }
}
