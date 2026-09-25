import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surface } from '../render/surface.js';
import { INK, LOOK } from '../render/palette.js';
import { floorUnder, rayCapsule, GRAVITY } from '../core/physics.js';
import { difficulty } from '../core/difficulty.js';

// Paper aeroplanes fly in the sky above the desk in circles: shoot them down
// and you'll get weapon or health — there's something flying today but they
// are too far away to see clearly.
//
// The ones that were there were scenery in the sky, 105-150 m out and 42-86 m
// up: specks. These fly over the arena, 22-28 m up on circles 13-24 m across
// the middle of the desk, so from the plaza they are 25-40 m away, and six
// metres nose to tail. Each banks into its turn by as much as a real turn at
// that speed and radius takes, atan(v² / g r), and rides a gentle swell.
//
// What a plane carries is drawn on its keel before you shoot it: the
// bandage's red cross, or a black staple for the staple gun. One hit brings it
// down — it is paper — and it noses over into a tightening spiral, drifting in
// towards the middle of the desk, and where it lands is the drop. Another
// glides in from beyond the edge to its circle a while later. Enemies take no
// notice of them.
//
// All of it is two draw calls: every plane is one instance of one mesh, and
// every marking one instance of another.

export const PLANES = {
  count: 3,
  circles: [                    // centre angle and radius, height, speed
    { at: 0.4, r: 13, y: 22, v: 7.5 },
    { at: 2.5, r: 19, y: 25, v: 8.5 },
    { at: 4.6, r: 24, y: 28, v: 8 },
  ],
  offset: 6,                    // circle centres this far from the middle of the desk
  g: GRAVITY,
  length: 6, span: 4.5,
  fall: 2.5,                    // seconds from being hit to the desk, about
  respawn: 25,                  // before the next one glides in
  drop: 45,                     // seconds its drop lies there
  score: 50,
  weapon: 0.5,                  // the chance a plane carries the staple gun
};

const MAX = PLANES.count;
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const X = new THREE.Vector3(1, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _zero = new THREE.Vector3(0, 0, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

function paperDart() {
  const L = PLANES.length / 2, S = PLANES.span / 2;
  const g = new THREE.BufferGeometry();
  const nose = [0, 0, -L], tail = [0, 0, L];
  const v = [
    ...nose, -S, 0.4, L - 0.3, ...tail,        // left wing
    ...nose, ...tail, S, 0.4, L - 0.3,         // right wing
    ...nose, 0, -0.85, L, ...tail,             // the keel, folded down under them
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

// The marks are painted under the wings, where you see a plane from: each
// lies just below its wing, tipped by the wings' dihedral.
const DIHEDRAL = Math.atan2(0.4, PLANES.span / 2);
function underWings(parts) {
  const geos = [];
  for (const sx of [-1, 1]) {
    for (const [w, h, d, x, z] of parts) {
      const g = new THREE.BoxGeometry(w, 0.03, d);
      g.translate(x, 0, z);
      g.rotateZ(-sx * DIHEDRAL);
      g.translate(sx * 0.95, 0.95 * Math.tan(DIHEDRAL) - 0.05, 0);
      geos.push(g);
    }
  }
  return mergeGeometries(geos, false);
}
// the bandage's red cross
const crossMark = () => underWings([[0.95, 0, 0.3, 0, 1.1], [0.3, 0, 0.95, 0, 1.1]]);
// a staple: its crown and its two legs
const stapleMark = () => underWings([[0.18, 0, 1.2, 0.18, 1.1], [0.5, 0, 0.18, -0.07, 0.6], [0.5, 0, 0.18, -0.07, 1.6]]);

function instanced(geo, mat) {
  const m = new THREE.InstancedMesh(geo, mat, MAX);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = MAX;
  return m;
}

export class Planes {
  constructor(ctx) {
    this.ctx = ctx;
    this.onDown = null;          // (plane) => void: shot down, for the killfeed
    this.mesh = instanced(paperDart(), surface({ ink: INK.PEN, lift: 0.22, side: THREE.DoubleSide }));
    this.crosses = instanced(crossMark(), surface({ ink: INK.RED, look: LOOK.SOLID }));
    this.staples = instanced(stapleMark(), surface({ ink: INK.BLACK, look: LOOK.SOLID }));
    ctx.scene.add(this.mesh, this.crosses, this.staples);
    this.list = PLANES.circles.slice(0, MAX).map((c, i) => ({
      i, circle: c, dir: i % 2 ? -1 : 1,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), quat: new THREE.Quaternion(),
      mode: 'fly', a: 0, t: 0, carry: 'bandage', gone: 0, spin: 0, pitch: 0,
    }));
    this.reset();
  }

  /** Every plane on its circle, the same way every time: a pinned shot is the same frame. */
  reset() {
    for (const p of this.list) {
      p.mode = 'fly';
      p.a = p.i * 2.1;
      p.t = p.i * 1.7;
      p.carry = p.i % 2 ? 'stapler' : 'bandage';
      this.fly(p, 0);
    }
    this.draw();
  }

  centre(p, out) {
    const c = p.circle;
    return out.set(Math.cos(c.at) * PLANES.offset, c.y, Math.sin(c.at) * PLANES.offset);
  }

  /** Along its circle: position, heading, and a coordinated turn's bank. */
  fly(p, dt) {
    const c = p.circle;
    p.a += (p.dir * c.v * dt) / c.r;
    p.t += dt;
    this.centre(p, _c);
    const ca = Math.cos(p.a), sa = Math.sin(p.a);
    p.pos.set(_c.x + ca * c.r, c.y + Math.sin(p.t * 0.7 + p.i) * 0.9, _c.z + sa * c.r);
    const hx = -sa * p.dir, hz = ca * p.dir;
    p.vel.set(hx * c.v, 0, hz * c.v);
    const yaw = Math.atan2(-hx, -hz);
    const bank = Math.atan((c.v * c.v) / (PLANES.g * c.r));
    // the centre is on its left when heading x (up) is (centre - pos): turn into it
    const left = (hx * (_c.z - p.pos.z) - hz * (_c.x - p.pos.x)) > 0 ? -1 : 1;
    p.quat.setFromAxisAngle(Y, yaw).multiply(_q.setFromAxisAngle(Z, left * bank));
  }

  update(dt) {
    for (const p of this.list) {
      if (p.mode === 'fly') this.fly(p, dt);
      else if (p.mode === 'fall') this.fall(p, dt);
      else if (p.mode === 'gone') {
        p.gone -= dt;
        if (p.gone <= 0) this.enter(p);
      } else if (p.mode === 'enter') {
        // glide in to where its circle starts, then fly it
        this.centre(p, _c);
        _a.set(_c.x + Math.cos(p.a) * p.circle.r, p.circle.y, _c.z + Math.sin(p.a) * p.circle.r);
        _d.copy(_a).sub(p.pos);
        const dist = _d.length();
        if (dist < p.circle.v * dt * 1.5) { p.mode = 'fly'; this.fly(p, 0); continue; }
        _d.multiplyScalar(1 / dist);
        p.pos.addScaledVector(_d, p.circle.v * dt);
        p.quat.setFromAxisAngle(Y, Math.atan2(-_d.x, -_d.z)).multiply(_q.setFromAxisAngle(X, Math.asin(THREE.MathUtils.clamp(_d.y, -1, 1))));
      }
    }
    this.draw();
  }

  /** In from beyond the edge of the desk, towards its circle. */
  enter(p) {
    p.mode = 'enter';
    p.a = Math.random() * Math.PI * 2;
    p.carry = Math.random() < PLANES.weapon ? 'stapler' : 'bandage';
    this.centre(p, _c);
    const out = 80;
    p.pos.set(Math.cos(p.a) * out, p.circle.y + 8, Math.sin(p.a) * out);
  }

  /** A grenade going off: any plane in reach of it comes down. */
  blast(center, radius) {
    for (const p of this.list) {
      if ((p.mode === 'fly' || p.mode === 'enter') && p.pos.distanceTo(center) < radius + PLANES.length / 2) this.down(p);
    }
  }

  /** Shot: it noses over into a tightening spiral, in towards the middle. */
  down(p) {
    p.mode = 'fall';
    p.spin = (Math.random() < 0.5 ? -1 : 1) * 2.4;
    p.pitch = 0;
    p.vel.multiplyScalar(0.8).setY(-2);
    p.yaw = Math.atan2(-p.vel.x, -p.vel.z);
    this.onDown?.(p);
  }

  fall(p, dt) {
    const level = this.ctx.level;
    p.vel.y = Math.max(-11, p.vel.y - 8 * dt);
    p.vel.x *= 1 - 0.8 * dt; p.vel.z *= 1 - 0.8 * dt;
    // drifting in towards the middle of the desk, so it comes down on it
    p.vel.x -= Math.sign(p.pos.x) * Math.min(1, Math.abs(p.pos.x) / 30) * 3 * dt;
    p.vel.z -= Math.sign(p.pos.z) * Math.min(1, Math.abs(p.pos.z) / 30) * 3 * dt;
    p.pos.addScaledVector(p.vel, dt);
    p.yaw += p.spin * dt;
    p.pitch = Math.min(1.1, p.pitch + 0.9 * dt);
    p.quat.setFromAxisAngle(Y, p.yaw).multiply(_q.setFromAxisAngle(X, -p.pitch)).multiply(_q2.setFromAxisAngle(Z, p.spin * 0.25));
    const { y } = floorUnder(level, p.pos.x, p.pos.z, p.pos.y + 0.5);
    if (p.pos.y - 0.4 <= y || p.pos.y < level.killY) this.land(p);
  }

  land(p) {
    const level = this.ctx.level, edge = (level.edge ?? 40) - 2;
    const at = p.pos.clone();
    at.x = THREE.MathUtils.clamp(at.x, -edge, edge);
    at.z = THREE.MathUtils.clamp(at.z, -edge, edge);
    at.y = Math.max(at.y, 0) + 1;
    this.ctx.pickups?.drop(p.carry, at, { life: PLANES.drop });
    p.mode = 'gone';
    p.gone = PLANES.respawn;
  }

  /**
   * The nearest plane a ray hits within `maxDist`: { plane, dist, point }, or
   * null. Its keel, nose to tail, and a bar across the back of its wings, each
   * a capsule, widened as the enemies' are.
   */
  raycast(origin, dir, maxDist) {
    let best = null;
    const m = difficulty.aimMargin;
    for (const p of this.list) {
      if (p.mode !== 'fly' && p.mode !== 'enter') continue;
      if (p.pos.distanceTo(origin) > maxDist + PLANES.length) continue;
      const L = PLANES.length / 2, S = PLANES.span / 2;
      for (const [a, b, r] of [[[0, -0.2, -L], [0, -0.2, L], 0.75], [[-S, 0.3, L - 0.6], [S, 0.3, L - 0.6], 0.55]]) {
        _a.set(...a).applyQuaternion(p.quat).add(p.pos);
        _b.set(...b).applyQuaternion(p.quat).add(p.pos);
        const t = rayCapsule(origin, dir, _a, _b, r * m);
        if (t === null || t <= 0 || t > maxDist) continue;
        if (!best || t < best.dist) best = { plane: p, dist: t, point: origin.clone().addScaledVector(dir, t) };
      }
    }
    return best;
  }

  draw() {
    for (const p of this.list) {
      const shown = p.mode !== 'gone';
      _m.compose(p.pos, p.quat, shown ? _s : _zero);
      this.mesh.setMatrixAt(p.i, _m);
      _m.compose(p.pos, p.quat, shown && p.carry === 'bandage' ? _s : _zero);
      this.crosses.setMatrixAt(p.i, _m);
      _m.compose(p.pos, p.quat, shown && p.carry === 'stapler' ? _s : _zero);
      this.staples.setMatrixAt(p.i, _m);
    }
    for (const m of [this.mesh, this.crosses, this.staples]) m.instanceMatrix.needsUpdate = true;
  }
}
