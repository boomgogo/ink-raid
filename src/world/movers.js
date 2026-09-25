import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Builder, bounds } from './build.js';
import { surface } from '../render/surface.js';
import { touchesColumn, shove, clearAbove } from '../core/physics.js';

// Things that move: the train, the pendulum, the cradle.
//
// The map is baked. Builder merges every primitive into one mesh per ink, and
// every collider it makes is a constant, so nothing on the desk could move.
// This is the layer that lets something move without giving up either:
//
// DRAWING. A mover is a set of rigid BODIES, each drawn with its own Builder in
// its own frame — the same box, cyl and pencil calls as the map, so each of its
// colliders is still the shape that was drawn. At finish() every body's
// geometry is merged per ink, as the map's is, with one more vertex attribute:
// the index of the body it belongs to. Each frame the bodies' transforms go
// into a float texture four texels wide and one row per body, and the ink
// material looks its row up (USE_BODIES). The train, the pendulum and the
// cradle together draw in a handful of calls, where a mesh per part would have
// been dozens, and the phone is at 120 in a fight already.
//
// COLLIDERS. Each body's colliders are copied into level.colliders, marked
// `mover`, and rewritten IN PLACE from the body's pose every frame: centre,
// axes, ends and bounds. So every query that already exists — walking,
// bullets, sight lines, grenades — sees them with nothing new to learn, and the
// roles cache keeps pointing at the same objects.
//
// RIDING. stepBody records the collider under the feet (`b.ground`). Before
// anything walks, every body standing on a mover is carried by that mover's
// change of pose, turned as well as moved: you ride the train round a bend.
// Its velocity stays its own. Step off, jump off or get knocked off and the
// mover's velocity at the feet is added once, so you land where the momentum
// says, not a car behind.
//
// PUSHING. After the movers move, any body inside one it is not riding is
// resolved: lifted on to it if its top is within a step and there is room,
// otherwise shoved out through the world the way the mover was going, stopped
// by walls like a walk, and given the mover's speed as it goes.
//
// None of it is in `places`, `anchors` or the spawn pool: those are asked of
// the map at build time, and a mover is somewhere else a second later.

const ONE = new THREE.Vector3(1, 1, 1);
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _quat = new THREE.Quaternion();

export class Movers {
  constructor() {
    this.bodies = [];
    this.meshes = [];
    this.texture = null;
    this.dt = 1 / 60;
    // Game sets this, to turn the player's view with a mover it is riding
    this.onTurn = null;
  }

  /**
   * A new rigid body. Draw it with `body.b`, a Builder, in the body's own
   * frame; move it with setPose(). `owner` hears about hits (see hit()).
   */
  body(name, owner = null) {
    const b = new Builder();
    b.thing(name);
    const body = {
      name, owner, index: this.bodies.length, b,
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      matrix: new THREE.Matrix4(),
      prev: new THREE.Matrix4(),
      delta: new THREE.Matrix4(),        // this frame's change of pose, world to world
      yawDelta: 0,
      colliders: [],                     // { local, world }
      ghosts: [],
    };
    this.bodies.push(body);
    return body;
  }

  setPose(body, pos, quat) {
    body.pos.copy(pos);
    body.quat.copy(quat);
  }

  /** Merge the bodies' drawing, add their colliders to `level`, and pose them. */
  finish(scene, level) {
    const buckets = new Map();
    for (const body of this.bodies) {
      for (const [key, bk] of body.b.buckets) {
        let dst = buckets.get(key);
        if (!dst) buckets.set(key, (dst = { opts: bk.opts, geos: [] }));
        for (const g of bk.geos) {
          const n = g.attributes.position.count;
          g.setAttribute('aBody', new THREE.BufferAttribute(new Float32Array(n).fill(body.index), 1));
          dst.geos.push(g);
        }
      }
      body.b.buckets.clear();
    }
    const rows = Math.max(1, this.bodies.length);
    this.texture = new THREE.DataTexture(new Float32Array(16 * rows), 4, rows, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    for (const bk of buckets.values()) {
      const merged = mergeGeometries(bk.geos, false);
      for (const g of bk.geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, surface({ ...bk.opts, bodies: this.texture }));
      mesh.frustumCulled = false;          // it is wherever its bodies are
      mesh.userData.mover = true;
      scene.add(mesh);
      this.meshes.push(mesh);
    }

    for (const body of this.bodies) {
      const copy = (local) => {
        const w = {
          ...local,
          c: local.c.clone(), ex: local.ex.clone(), ey: local.ey.clone(), ez: local.ez.clone(),
          min: new THREE.Vector3(), max: new THREE.Vector3(), mover: body, turned: true,
        };
        if (local.aEnd) { w.aEnd = local.aEnd.clone(); w.bEnd = local.bEnd.clone(); }
        return w;
      };
      for (const local of body.b.colliders) {
        const world = copy(local);
        body.colliders.push({ local, world });
        level.colliders.push(world);
      }
      for (const local of body.b.ghosts) {
        const world = copy(local);
        body.ghosts.push({ local, world });
        (level.ghosts ||= []).push(world);
      }
      if (level.things) for (const [k, t] of body.b.things) level.things.set(k, t);
      body.matrix.compose(body.pos, body.quat, ONE);
      body.prev.copy(body.matrix);
    }
    this.place();
    return this;
  }

  /** Every mover collider's world copy, from its body's current matrix. */
  place() {
    const data = this.texture.image.data;
    for (const body of this.bodies) {
      data.set(body.matrix.elements, body.index * 16);
      const m = body.matrix;
      _quat.setFromRotationMatrix(m);
      for (const list of [body.colliders, body.ghosts]) {
        for (const { local, world } of list) {
          world.c.copy(local.c).applyMatrix4(m);
          world.ex.copy(local.ex).applyQuaternion(_quat);
          world.ey.copy(local.ey).applyQuaternion(_quat);
          world.ez.copy(local.ez).applyQuaternion(_quat);
          if (local.aEnd) { world.aEnd.copy(local.aEnd).applyMatrix4(m); world.bEnd.copy(local.bEnd).applyMatrix4(m); }
          if (world.shape === 'box') {
            world.upright = Math.abs(world.ey.y) > 0.9999;
            const ups = [Math.abs(world.ex.y), Math.abs(world.ey.y), Math.abs(world.ez.y)];
            const most = ups.indexOf(Math.max(...ups));
            world.wide = [most !== 0, most !== 1, most !== 2];
          }
          bounds(world);
        }
      }
    }
    this.texture.needsUpdate = true;
  }

  /**
   * Move everything to the poses set this frame, carrying riders and pushing
   * whatever is in the way. `bodies` is every walking body in the world.
   */
  step(dt, level, bodies) {
    this.dt = Math.max(1e-4, dt);
    for (const body of this.bodies) {
      body.prev.copy(body.matrix);
      body.matrix.compose(body.pos, body.quat, ONE);
      body.delta.copy(body.matrix).multiply(_inv.copy(body.prev).invert());
      // how far it turned about the vertical, for a rider's view
      _e.setFromRotationMatrix(body.delta);
      body.yawDelta = _e.y;
    }

    // --- riders first, while the colliders are still where they stood on them
    for (const b of bodies) {
      const on = b.onGround && b.ground && b.ground.mover;
      if (on) {
        const body = b.ground.mover;
        _p.copy(b.pos).applyMatrix4(body.delta);
        const dx = _p.x - b.pos.x, dz = _p.z - b.pos.z;
        (b.rideVel ||= new THREE.Vector3()).set(dx, _p.y - b.pos.y, dz).multiplyScalar(1 / this.dt);
        b.pos.y = _p.y;
        if (dx || dz) shove(level, b, dx, dz, (c) => c.mover === body);
        if (body.yawDelta) this.onTurn?.(b, body.yawDelta);
        b.riding = body;
      } else if (b.riding) {
        // off it: keep the speed it was carrying you at, once
        if (b.rideVel) { b.vel.x += b.rideVel.x; b.vel.z += b.rideVel.z; b.vel.y += Math.max(0, b.rideVel.y); }
        b.riding = null;
      }
    }

    this.place();

    // --- then anything the moved colliders now overlap
    for (const b of bodies) this.push(level, b);
  }

  /** Resolve a body left inside a mover. */
  push(level, b) {
    for (const body of this.bodies) {
      for (const { world: c } of body.colliders) {
        if (c.hits === 'rays') continue;
        const span = touchesColumn(c, b.pos.x, b.pos.z, b.radius);
        if (!span || span.lo >= b.pos.y + b.height - 1e-3 || span.hi <= b.pos.y + 1e-3) continue;
        // Something that sweeps (the train) puts you to one side of it rather
        // than scooping you up: across it, to the side you are on, or to the
        // arena side if you stood square in its way, with a hop. Not if you are
        // riding it already: standing across the gap between two cars on a
        // bend, the next car only nudges you.
        if (body.pushAside && b.pos.y < span.hi - 0.1 && !b.riding?.pushAside) {
          const e = body.matrix.elements;
          const lat = _d.set(e[8], 0, e[10]).normalize().clone();
          let side = (b.pos.x - body.pos.x) * lat.x + (b.pos.z - body.pos.z) * lat.z;
          if (Math.abs(side) < 0.2) side = -(body.pos.x * lat.x + body.pos.z * lat.z);
          if (side < 0) lat.negate();
          const out = this.clearance(c, b, lat);
          if (out < Infinity) {
            shove(level, b, lat.x * out, lat.z * out, (k) => k.mover === body);
            b.vel.x = lat.x * 4; b.vel.z = lat.z * 4;
            b.vel.y = Math.max(b.vel.y, 4); b.onGround = false; b.ground = null;
            continue;
          }
        }
        // its top is within a step and there is room: stand on it
        if (span.hi - b.pos.y <= b.step + 0.05 && clearAbove(level, b.pos.x, b.pos.z, span.hi, b.height, b.radius)) {
          b.pos.y = span.hi;
          if (b.vel.y < 0) b.vel.y = 0;
          b.onGround = true;
          b.ground = c;
          b.groundY = span.hi;
          continue;
        }
        // otherwise out of its way: along the way it moved at this height
        _p.set(b.pos.x, Math.min(span.hi, b.pos.y + b.height / 2), b.pos.z);
        _q.copy(_p).applyMatrix4(_inv.copy(body.delta).invert());
        _d.subVectors(_p, _q).setY(0);                  // how that point of it moved this frame
        let dir = _d.clone();
        if (dir.lengthSq() < 1e-8) dir.set(b.pos.x - c.c.x, 0, b.pos.z - c.c.z);
        if (dir.lengthSq() < 1e-8) dir.set(1, 0, 0);
        dir.normalize();
        const out = this.clearance(c, b, dir);
        if (out < Infinity) {
          const x0 = b.pos.x, z0 = b.pos.z;
          shove(level, b, dir.x * out, dir.z * out, (k) => k.mover === body);
          const moved = Math.hypot(b.pos.x - x0, b.pos.z - z0);
          const sp = _d.length() / this.dt;
          b.vel.x += dir.x * Math.min(sp, 12); b.vel.z += dir.z * Math.min(sp, 12);
          if (moved > out - 0.02) continue;
        }
        // blocked: on top of it, if there is headroom there
        if (clearAbove(level, b.pos.x, b.pos.z, span.hi, b.height, b.radius)) {
          b.pos.y = span.hi; b.vel.y = Math.max(0, b.vel.y); b.onGround = true; b.ground = c; b.groundY = span.hi;
        }
      }
    }
  }

  /** How far along `dir` the body must go to be clear of collider c (Infinity if not within 6 m). */
  clearance(c, b, dir) {
    for (let s = 0.05; s <= 6; s += 0.05) {
      const span = touchesColumn(c, b.pos.x + dir.x * s, b.pos.z + dir.z * s, b.radius);
      if (!span || span.lo >= b.pos.y + b.height - 1e-3 || span.hi <= b.pos.y + 1e-3) return s + 0.02;
    }
    return Infinity;
  }

  /** A point in the world, in a body's own frame now (for things stuck to it). */
  toLocal(body, p, out = new THREE.Vector3()) {
    return out.copy(p).applyMatrix4(_m.copy(body.matrix).invert());
  }

  /** A point in a body's frame, where it is in the world now. */
  toWorld(body, p, out = new THREE.Vector3()) {
    return out.copy(p).applyMatrix4(body.matrix);
  }
}
