import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surface } from '../render/surface.js';
import { INK, LOOK } from '../render/palette.js';
import { floorUnder } from '../core/physics.js';
import { difficulty } from '../core/difficulty.js';

// Things lying on the desk that you walk over to take.
//
// Healing bandages are the first pickup; the backlog wants explosives and
// allies dropped by kills too, each on its own chance. So this is a table of
// items and a table of drop rows, and bandages are the only item in either so
// far. A new item is a row in each and a way to carry it (Game.take).
//
// A kill's drop settles on the floor under it, bobs, and blinks out after
// PICKUP.life. A map spot (Builder.pickupSpot) is there from the start of a
// run and comes back PICKUP.respawn after it was taken. Every roll on the desk
// is one instanced mesh and every red cross another: two draw calls.

export const ITEMS = {
  bandage: { name: 'BANDAGE', max: 3, start: 1, heal: 50, wrap: 1.0 },
  // what a paper plane drops besides a bandage: a staple gun, 30 staples
  // (Game.take puts it on key 5)
  stapler: { name: 'STAPLE GUN', staples: 30 },
};

// What a kill may drop. Each row is rolled on its own.
export const DROPS = [
  // a type that `drops` (TAPE) and bosses always leave one; anything else on difficulty's chance
  { item: 'bandage', chance: (e) => (e.t.drops || e.t.role?.boss ? 1 : difficulty.bandageDrop) },
];

export const PICKUP = {
  reach: 1.5,        // this close to your feet, across the floor...
  reachY: 1.6,       // ...and up or down, and it is yours
  life: 25,          // a kill's drop is gone after this
  blink: 5,          // and blinks for the last of it
  respawn: 40,       // a map spot comes back after this
  max: 24,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();

export class Pickups {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];            // { item, pos, age, life (Infinity for a spot), spot }
    this.spots = (ctx.level.pickupSpots || []).map((s) => ({ ...s, pos: this.settle(s.pos)?.pos || s.pos.clone(), takenT: 0, here: null }));
    // Take one: return true if it was taken. Game sets this.
    this.onTouch = null;

    // A rolled bandage lying on its side, and a red cross on each end.
    const roll = new THREE.CylinderGeometry(0.3, 0.3, 0.46, 12);
    roll.rotateZ(Math.PI / 2);
    const bars = [];
    for (const sx of [-1, 1]) {
      const a = new THREE.BoxGeometry(0.03, 0.34, 0.1);
      const b = new THREE.BoxGeometry(0.03, 0.1, 0.34);
      a.translate(sx * 0.24, 0, 0);
      b.translate(sx * 0.24, 0, 0);
      bars.push(a, b);
    }
    const cross = mergeGeometries(bars, false);
    this.rolls = instanced(roll, surface({ ink: INK.PEN, lift: 0.25 }));
    this.crosses = instanced(cross, surface({ ink: INK.RED, look: LOOK.SOLID }));
    // A staple gun lying on the desk: a body on a grip, black, with an orange
    // grip so it reads as a thing to pick up and not a shadow.
    const body = new THREE.BoxGeometry(0.62, 0.26, 0.2);
    body.translate(0, 0.08, 0);
    const lever = new THREE.BoxGeometry(0.56, 0.06, 0.12);
    lever.translate(0, 0.24, 0);
    const gun = mergeGeometries([body, lever], false);
    const grip = new THREE.BoxGeometry(0.16, 0.28, 0.16);
    grip.rotateZ(0.2);
    grip.translate(0.2, -0.16, 0);
    this.guns = instanced(gun, surface({ ink: INK.BLACK, look: LOOK.SOLID }));
    this.grips = instanced(grip, surface({ ink: INK.ORANGE, look: LOOK.WASH }));
    ctx.scene.add(this.rolls, this.crosses, this.guns, this.grips);
    this.reset();
  }

  /** A fresh run: no drops, every spot stocked. */
  reset() {
    this.list.length = 0;
    for (const s of this.spots) {
      s.takenT = 0;
      s.here = { item: s.item, pos: s.pos, age: Math.random() * 5, life: Infinity, spot: s };
      this.list.push(s.here);
    }
    this.draw(0);
  }

  /**
   * The floor under `pos`, as a new point on it and the mover it is on (if it
   * landed on the train, it rides the train), or null over nothing.
   */
  settle(pos) {
    const { y, c } = floorUnder(this.ctx.level, pos.x, pos.z, pos.y + 1);
    if (!(y > this.ctx.level.killY)) return null;
    const at = new THREE.Vector3(pos.x, y, pos.z);
    const mover = c?.mover || null;
    return { pos: at, mover, lpos: mover ? at.clone().applyMatrix4(_m.copy(mover.matrix).invert()) : null };
  }

  /** Roll a kill's drops. */
  onFoeDown(e) {
    for (const row of DROPS) {
      if (Math.random() < row.chance(e)) this.drop(row.item, e.body.pos);
    }
  }

  drop(item, at, o = {}) {
    const under = this.settle(at);
    if (!under) return null;
    const pos = under.pos;
    if (this.list.length >= PICKUP.max) {
      const old = this.list.findIndex((q) => !q.spot);
      if (old < 0) return null;
      this.list.splice(old, 1);
    }
    const q = { item, pos, age: 0, life: o.life ?? PICKUP.life, spot: null, mover: under.mover, lpos: under.lpos };
    this.list.push(q);
    return q;
  }

  update(dt, player) {
    const b = player.body;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const q = this.list[i];
      q.age += dt;
      if (q.mover) q.pos.copy(q.lpos).applyMatrix4(q.mover.matrix);
      if (q.age >= q.life) { this.list.splice(i, 1); continue; }
      if (!player.alive) continue;
      if (Math.hypot(q.pos.x - b.pos.x, q.pos.z - b.pos.z) > PICKUP.reach) continue;
      if (Math.abs(q.pos.y - b.pos.y) > PICKUP.reachY) continue;
      if (!this.onTouch?.(q.item)) continue;              // full up: it stays
      this.list.splice(i, 1);
      if (q.spot) { q.spot.here = null; q.spot.takenT = 0; }
    }
    for (const s of this.spots) {
      if (s.here) continue;
      s.takenT += dt;
      if (s.takenT >= PICKUP.respawn) {
        s.here = { item: s.item, pos: s.pos, age: 0, life: Infinity, spot: s };
        this.list.push(s.here);
      }
    }
    this.draw(dt);
  }

  draw() {
    let n = 0, k = 0;
    for (const q of this.list) {
      const left = q.life - q.age;
      // blinking out: on and off, faster as it goes
      if (left < PICKUP.blink && Math.sin(q.age * (10 + (PICKUP.blink - left) * 4)) < 0) continue;
      _p.set(q.pos.x, q.pos.y + 0.45 + Math.sin(q.age * 2.6) * 0.12, q.pos.z);
      _q.setFromEuler(_e.set(0, q.age * 1.4, 0.25));
      _m.compose(_p, _q, _s);
      if (q.item === 'stapler') {
        this.guns.setMatrixAt(k, _m);
        this.grips.setMatrixAt(k, _m);
        k++;
      } else {
        this.rolls.setMatrixAt(n, _m);
        this.crosses.setMatrixAt(n, _m);
        n++;
      }
    }
    for (const [mesh, c] of [[this.rolls, n], [this.crosses, n], [this.guns, k], [this.grips, k]]) {
      mesh.count = c;
      mesh.visible = c > 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

function instanced(geo, mat) {
  const m = new THREE.InstancedMesh(geo, mat, PICKUP.max);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  m.count = 0;
  return m;
}
