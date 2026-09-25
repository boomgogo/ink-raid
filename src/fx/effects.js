import * as THREE from 'three';
import { surface } from '../render/surface.js';
import { INK, LOOK } from '../render/palette.js';
import { clamp } from '../core/spring.js';

// Everything that flies, sticks or shakes.
//
// All of it is instanced: one draw call for every particle in the game, one for
// every tracer, one for every decal. A shooter throws hundreds of these a second
// and a mesh each would eat the frame budget on draw calls alone.
//
// Particles are drawn as short boxes stretched along their velocity, which in
// ink reads as a pen stroke — so sparks, debris, shell casings and blots are all
// the same system with different numbers.

const MAX_PARTICLES = 420;
const MAX_TRACERS = 48;
const MAX_DECALS = 140;

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const UNIT_Z = new THREE.Vector3(0, 0, 1);

export class Effects {
  constructor(ctx) {
    this.ctx = ctx;
    this.time = 0;

    // --- screen state, read by the renderer each frame ---------------------
    this.shake = 0;
    this.hitstop = 0;
    this.freezeRate = 1;
    this.flash = 0;
    this.hurt = 0;
    this.slow = 0;
    this.shakeOffset = new THREE.Vector3();

    this.particles = [];
    this.pMesh = instanced(new THREE.BoxGeometry(1, 1, 1), MAX_PARTICLES);
    ctx.scene.add(this.pMesh);

    this.tracers = [];
    const tg = new THREE.BoxGeometry(1, 1, 1);
    tg.translate(0, 0, -0.5);            // pivot at the muzzle end
    this.tMesh = instanced(tg, MAX_TRACERS, INK.ORANGE);
    ctx.scene.add(this.tMesh);

    this.decals = [];
    this.decalHead = 0;
    const dg = new THREE.PlaneGeometry(1, 1);
    // seen from either side: a blot on a thin thing shows through
    this.dMesh = instanced(dg, MAX_DECALS, INK.PEN, THREE.DoubleSide);
    ctx.scene.add(this.dMesh);
  }

  // --- spawning -------------------------------------------------------------

  /**
   * @param {THREE.Vector3} pos
   * @param {THREE.Vector3} vel
   * @param {object} o  size, life, ink, look, gravity, drag, stretch, spin
   */
  particle(pos, vel, o = {}) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({
      pos: pos.clone(),
      vel: vel.clone(),
      life: o.life ?? 0.5,
      maxLife: o.life ?? 0.5,
      size: o.size ?? 0.05,
      ink: o.ink ?? INK.PEN,
      look: o.look ?? LOOK.SOLID,
      gravity: o.gravity ?? 0,
      drag: o.drag ?? 1.5,
      stretch: o.stretch ?? 0.1,
      spin: o.spin ?? 0,
      rot: Math.random() * Math.PI,
    });
  }

  /** A burst of strokes flying out of a point — the universal impact. */
  burst(pos, dir, n, o = {}) {
    const spread = o.spread ?? 0.9;
    const speed = o.speed ?? 6;
    for (let i = 0; i < n; i++) {
      _v.copy(dir)
        .addScaledVector(rand3(), spread)
        .normalize()
        .multiplyScalar(speed * (0.5 + Math.random()));
      this.particle(pos, _v, o);
    }
  }

  /** The line a bullet leaves. Short-lived; it is a suggestion, not a laser. */
  tracer(from, to, o = {}) {
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    this.tracers.push({
      from: from.clone(),
      to: to.clone(),
      life: o.life ?? 0.06,
      maxLife: o.life ?? 0.06,
      width: o.width ?? 0.02,
      ink: o.ink ?? INK.ORANGE,
    });
  }

  /**
   * An ink blot left where something hit. Ring buffer: oldest is overwritten.
   * On something that moves (`o.mover`, a Movers body) it is kept in that
   * body's frame and goes where it goes: left in the world, a blot on the train
   * would hang in the air once the train had gone.
   */
  decal(pos, normal, o = {}) {
    const d = this.decals[this.decalHead] || {};
    d.pos = (d.pos || new THREE.Vector3()).copy(pos).addScaledVector(normal, 0.02);
    d.normal = (d.normal || new THREE.Vector3()).copy(normal);
    d.mover = o.mover || null;
    if (d.mover) {
      _m.copy(d.mover.matrix).invert();
      d.lpos = (d.lpos || new THREE.Vector3()).copy(d.pos).applyMatrix4(_m);
      d.lnormal = (d.lnormal || new THREE.Vector3()).copy(normal).transformDirection(_m);
    }
    d.size = o.size ?? 0.22;
    d.ink = o.ink ?? INK.PEN;
    d.born = this.time;
    d.rot = Math.random() * Math.PI;
    this.decals[this.decalHead] = d;
    this.decalHead = (this.decalHead + 1) % MAX_DECALS;
  }

  /** Bullet hits a surface: a blot, a few strokes, a puff of dust. */
  impact(point, normal, ink = INK.PEN, mover = null) {
    this.decal(point, normal, { ink, size: 0.16 + Math.random() * 0.14, mover });
    this.burst(point, normal, 5, { speed: 5, size: 0.035, life: 0.28, ink, gravity: 9, drag: 3, stretch: 0.14 });
  }

  /** Something took damage: red strokes, thrown along the shot. */
  hit(point, dir, crit = false) {
    this.burst(point, dir, crit ? 12 : 7, {
      speed: crit ? 9 : 6, size: crit ? 0.07 : 0.05, life: 0.36,
      ink: INK.RED, gravity: 12, drag: 2.6, stretch: 0.2,
    });
  }

  /** A shell casing, tumbling out sideways. */
  shell(pos, dir, ink = INK.ORANGE, size = 0.02) {
    _v.copy(dir).multiplyScalar(2.4 + Math.random() * 1.6);
    _v.y += 1.6 + Math.random();
    this.particle(pos, _v, { size, life: 1.2, ink, gravity: 16, drag: 0.6, stretch: 1.8, spin: 14 });
  }

  // --- screen ---------------------------------------------------------------

  /** Freeze for a beat. The single biggest contributor to a hit feeling solid. */
  stop(duration = 0.06, scale = 0.08) {
    this.hitstop = Math.max(this.hitstop, duration);
    this.freezeRate = scale;
  }

  kick(amount) { this.shake = Math.min(1.6, this.shake + amount); }

  // --- update ---------------------------------------------------------------

  /** Returns the time scale the rest of the game should run at this frame. */
  timeScale(dt) {
    if (this.hitstop > 0) {
      this.hitstop -= dt;
      return this.freezeRate;
    }
    return 1;
  }

  update(dt, realDt) {
    this.time += dt;

    // particles
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.rot += p.spin * dt;
    }
    writeParticles(this.pMesh, ps);

    // tracers
    const ts = this.tracers;
    for (let i = ts.length - 1; i >= 0; i--) {
      ts[i].life -= realDt;
      if (ts[i].life <= 0) ts.splice(i, 1);
    }
    writeTracers(this.tMesh, ts);

    for (const d of this.decals) {
      if (!d.mover) continue;
      d.pos.copy(d.lpos).applyMatrix4(d.mover.matrix);
      d.normal.copy(d.lnormal).transformDirection(d.mover.matrix);
    }
    writeDecals(this.dMesh, this.decals, this.time);

    // screen shake decays fast; a long shake reads as a bug, not as impact
    this.shake = Math.max(0, this.shake - realDt * 4.2);
    const s = this.shake * this.shake * 0.22;
    this.shakeOffset.set(
      (Math.random() - 0.5) * s,
      (Math.random() - 0.5) * s,
      (Math.random() - 0.5) * s * 0.4,
    );

    this.flash = Math.max(0, this.flash - realDt * 5);
    this.hurt = Math.max(0, this.hurt - realDt * 1.6);
    this.slow = this.hitstop > 0 ? 1 : Math.max(0, this.slow - realDt * 4);
  }
}

// ---------------------------------------------------------------------------

// Every instance says its own ink and look in instanceColor, as (ink, look, 1):
// the surface program reads it in place of the material's.
function instanced(geo, max, ink = INK.PEN, side = THREE.FrontSide) {
  const m = new THREE.InstancedMesh(geo, surface({ ink, look: LOOK.SOLID, side }), max);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  return m;
}

function writeParticles(mesh, ps) {
  const n = Math.min(ps.length, mesh.instanceMatrix.count);
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    const t = p.life / p.maxLife;
    const speed = p.vel.length();
    // stretch along the direction of travel: a moving mark is a stroke
    const len = p.size * (1 + speed * p.stretch);
    if (speed > 0.001) {
      _v.copy(p.vel).normalize();
      _q.setFromUnitVectors(UNIT_Z, _v);
    } else {
      _q.identity();
    }
    _s.set(p.size * t, p.size * t, len);
    _m.compose(p.pos, _q, _s);
    mesh.setMatrixAt(i, _m);
    mesh.instanceColor.setXYZ(i, p.ink, p.look, 1);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}

function writeTracers(mesh, ts) {
  const n = Math.min(ts.length, mesh.instanceMatrix.count);
  for (let i = 0; i < n; i++) {
    const t = ts[i];
    _v.copy(t.to).sub(t.from);
    const len = _v.length();
    if (len < 1e-4) { mesh.setMatrixAt(i, _m.identity()); continue; }
    _v.multiplyScalar(1 / len);
    _q.setFromUnitVectors(UNIT_Z, _v);
    const fade = t.life / t.maxLife;
    _s.set(t.width * fade, t.width * fade, -len);
    _m.compose(t.from, _q, _s);
    mesh.setMatrixAt(i, _m);
    mesh.instanceColor.setXYZ(i, t.ink, LOOK.SOLID, 1);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}

function writeDecals(mesh, ds, time) {
  let n = 0;
  for (const d of ds) {
    if (!d || !d.pos) continue;
    const age = time - d.born;
    const grow = clamp(age * 14, 0, 1);          // blots spread for a moment
    const fade = clamp(1 - (age - 14) / 4, 0, 1); // then dry up and vanish
    if (fade <= 0) continue;
    _q.setFromUnitVectors(UNIT_Z, d.normal);
    _q.multiply(_qz(d.rot));
    _s.set(d.size * grow * fade, d.size * grow * fade, 1);
    _m.compose(d.pos, _q, _s);
    mesh.setMatrixAt(n, _m);
    mesh.instanceColor.setXYZ(n, d.ink, LOOK.SOLID, 1);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
}

const _tmpQ = new THREE.Quaternion();
function _qz(a) { return _tmpQ.setFromAxisAngle(UNIT_Z, a); }

const _r = new THREE.Vector3();
function rand3() {
  return _r.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
}
