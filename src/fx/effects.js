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
// Grenades going off at once, each drawn whole (BLAST), and the scorches they leave.
const MAX_BLASTS = 4;
const MAX_SCORCHES = 8;

// A grenade going off, in the order it is seen: seconds, and metres.
//
//   flash   a star of uneven orange spikes round a black one, turned to the camera, as wide as
//           `size` by `grow`, gone by `life`
//   ring    a band round the blast that grows to its radius by `grow`, thinning from `height`
//           to nothing by `life`: how far it reached, which matters as much as how it looks
//   smoke   puffs, hatched and outlined like anything else on the page, that swell to between
//           `small` and `big` across by `swell`, rise, and shrink away by `life`
//   sparks, chunks   strokes thrown out: quick orange ones, then heavier black ones that fall
//   scorch  a splat on what it went off on, `scorch` across
export const BLAST = {
  flash: { grow: 0.06, life: 0.22, size: 2.4 },
  ring: { grow: 0.18, life: 0.3, height: 0.6 },
  smoke: { puffs: 7, swell: 0.35, life: 1.4, rise: 1.5, small: 0.6, big: 1.1, spread: 1.2 },
  sparks: 18,
  chunks: 24,
  scorch: 3.5,
};

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

    // grenades going off (blast): what is drawn of each, and the splats they leave
    this.blasts = [];
    this.blasted = 0;
    this.scorches = [];
    this.scorchHead = 0;
    this.flashMesh = instanced(star(9, 0.38, 0.6, 1), MAX_BLASTS * 2, INK.ORANGE, THREE.DoubleSide);
    this.ringMesh = instanced(new THREE.CylinderGeometry(1, 1, 1, 40, 1, true), MAX_BLASTS, INK.PEN, THREE.DoubleSide);
    this.smokeMesh = instanced(new THREE.SphereGeometry(1, 9, 6), MAX_BLASTS * BLAST.smoke.puffs);
    this.sMesh = instanced(star(14, 0.3, 0.38, 0.5), MAX_SCORCHES, INK.BLACK, THREE.DoubleSide);
    for (const m of [this.flashMesh, this.ringMesh, this.smokeMesh, this.sMesh]) {
      m.visible = false;
      ctx.scene.add(m);
    }
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
    const list = o.scorch ? this.scorches : this.decals;
    const head = o.scorch ? this.scorchHead : this.decalHead;
    const d = list[head] || {};
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
    list[head] = d;
    if (o.scorch) this.scorchHead = (head + 1) % MAX_SCORCHES;
    else this.decalHead = (head + 1) % MAX_DECALS;
  }

  /**
   * A grenade going off at `pos`, its blast `radius` across (see BLAST). `ground` is what it lay
   * on (a raycast hit: point, normal, the mover it is on), for the scorch, or null if it went off
   * in the air. All of it is drawn here, on every page that sees it.
   */
  blast(pos, radius, ground = null) {
    if (this.blasts.length >= MAX_BLASTS) this.blasts.shift();
    const S = BLAST.smoke;
    const puffs = [];
    for (let i = 0; i < S.puffs; i++) {
      puffs.push({
        off: rand3().clone().multiplyScalar(S.spread * (0.3 + 0.7 * Math.random())).setY(Math.random() * 0.6),
        r: (S.small + (S.big - S.small) * Math.random()) / 2,
        rise: S.rise * (0.6 + 0.6 * Math.random()),
      });
    }
    this.blasts.push({ pos: pos.clone(), radius, t: 0, rot: Math.random() * Math.PI, puffs });
    this.blasted++;
    this.burst(pos, _up, BLAST.sparks, { speed: 18, spread: 1.6, size: 0.06, life: 0.25, ink: INK.ORANGE, gravity: 4, drag: 3, stretch: 0.25 });
    this.burst(pos, _up, BLAST.chunks, { speed: 11, spread: 1.3, size: 0.1, life: 0.8, ink: INK.BLACK, gravity: 22, drag: 1.2, stretch: 0.08 });
    if (ground) this.decal(ground.point, ground.normal, { size: BLAST.scorch, ink: INK.BLACK, mover: ground.box?.mover, scorch: true });
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

    // the blasts: theirs on game time, as the strokes they throw are
    const bs = this.blasts;
    for (let i = bs.length - 1; i >= 0; i--) {
      bs[i].t += dt;
      if (bs[i].t > BLAST.smoke.life) bs.splice(i, 1);
    }
    writeBlasts(this, this.ctx.camera);
    for (const d of this.scorches) {
      if (!d.mover) continue;
      d.pos.copy(d.lpos).applyMatrix4(d.mover.matrix);
      d.normal.copy(d.lnormal).transformDirection(d.mover.matrix);
    }
    writeDecals(this.sMesh, this.scorches, this.time);
    this.sMesh.visible = this.sMesh.count > 0;

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

/**
 * A flat star facing +z, `points` spikes reaching between `inner` and an uneven `outer`..`tip`:
 * a blast's flash, or the splat it leaves. Its unevenness is fixed, so every one is the same
 * star, turned a different way.
 */
function star(points, inner, outer, tip) {
  const pos = [];
  const at = (a, r) => [Math.cos(a) * r, Math.sin(a) * r, 0];
  for (let i = 0; i < points; i++) {
    const a0 = (i / points) * Math.PI * 2, a1 = ((i + 0.5) / points) * Math.PI * 2, a2 = ((i + 1) / points) * Math.PI * 2;
    const reach = outer + (tip - outer) * (0.5 + 0.5 * Math.sin(i * 2.7 + 1.3));
    pos.push(0, 0, 0, ...at(a0, inner), ...at(a1, reach), 0, 0, 0, ...at(a1, reach), ...at(a2, inner));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

const ease = (u) => 1 - (1 - u) * (1 - u);
const _bq = new THREE.Quaternion();
const _bp = new THREE.Vector3();
const _fp = new THREE.Vector3();

/** Every blast's flash, ring and smoke, as instances; a mesh with none is not drawn at all. */
function writeBlasts(fx, camera) {
  const F = BLAST.flash, R = BLAST.ring, S = BLAST.smoke;
  let nf = 0, nr = 0, ns = 0;
  for (const b of fx.blasts) {
    const t = b.t;
    if (t < F.life) {
      // out fast, then gone: an orange star, and a black one a third smaller just in front of it
      const s = (F.size / 2) * Math.min(1, t / F.grow) * (1 - clamp((t - F.grow) / (F.life - F.grow), 0, 1) * 0.6);
      // centred a little above the grenade, which lies on the floor, or half the star is under it
      _bq.copy(camera.quaternion).multiply(_qz(b.rot));
      _fp.copy(b.pos).y += F.size * 0.15;
      _bp.copy(camera.position).sub(_fp).normalize().multiplyScalar(0.05).add(_fp);
      for (const [ink, k, p] of [[INK.ORANGE, 1, _fp], [INK.BLACK, 0.62, _bp]]) {
        _s.setScalar(s * k);
        _m.compose(p, _bq, _s);
        fx.flashMesh.setMatrixAt(nf, _m);
        fx.flashMesh.instanceColor.setXYZ(nf++, ink, LOOK.SOLID, 1);
      }
    }
    if (t < R.life) {
      const r = b.radius * ease(Math.min(1, t / R.grow));
      _s.set(r, R.height * (1 - t / R.life), r);
      _m.compose(b.pos, _bq.identity(), _s);
      fx.ringMesh.setMatrixAt(nr, _m);
      fx.ringMesh.instanceColor.setXYZ(nr++, INK.PEN, LOOK.LINE, 1);
    }
    const k = t / S.life;
    const swell = Math.min(1, t / S.swell);
    const shrink = 1 - clamp((k - 0.5) / 0.5, 0, 1);
    for (const p of b.puffs) {
      _bp.copy(p.off).multiplyScalar(0.3 + 0.7 * ease(swell)).add(b.pos);
      _bp.y += p.rise * ease(k);
      _s.setScalar(Math.max(1e-3, p.r * ease(swell) * shrink * shrink));
      _m.compose(_bp, _bq.identity(), _s);
      fx.smokeMesh.setMatrixAt(ns, _m);
      fx.smokeMesh.instanceColor.setXYZ(ns++, INK.PEN, LOOK.LINE, 1);
    }
  }
  for (const [m, n] of [[fx.flashMesh, nf], [fx.ringMesh, nr], [fx.smokeMesh, ns]]) {
    m.count = n;
    m.visible = n > 0;
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }
}

const _r = new THREE.Vector3();
function rand3() {
  return _r.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
}
