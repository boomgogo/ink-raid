import * as THREE from 'three';
import { surface } from '../../render/surface.js';
import { INK, LOOK } from '../../render/palette.js';
import { raycast } from '../../core/physics.js';
import { grenadeGeometry } from './models.js';

// Grenades. Hold to cook and throw further, which is the whole decision: a
// short lob into cover, or a long throw that gives them time to walk out of it.

// Grouped by concern, with the working next to each number.
export const GRENADE = {
  carry: {
    max: 3,               // mid the 2-4 target; pinned >= 1
    restockSeconds: 15,   // mid the 12-18 s target
  },
  fuse: 2.1,               // mid the 1.8-2.5 s target: walkable out of on a long throw
  blast: {
    radius: 7.5,           // mid the 6-9 m target
    // solved against two targets at once: a "bruiser dies within a third of
    // the radius" kill (falloff there is 1 - 1/3 = 0.667, so damage*0.667
    // must clear the 100 hp bruiser) and "ground zero costs 35-50% of your
    // health" (damage*selfFrac against 120 hp medium): 160*0.667 = 106.7 >=
    // 100, and 160*0.35 = 56, inside 42-60 (35-50% of 120)
    damage: 160,
    selfFrac: 0.35,
    // unpinned: what a blast leaves scenery with, kept lighter than what it
    // costs you so a thrown grenade reads as a threat to YOU first
    toyFrac: 0.1,
    toyReach: 1.5,         // toys inside 1.5x the blast radius get shoved
  },
  // Speeds, m/s, plus a 2.6 m/s lift and 0.4 of your own speed. Where it first lands on flat
  // ground, thrown from the eye (1.6 m) under the grenade's own 32 m/s² gravity (fly):
  //
  //              level    20° up   the furthest (41°)
  //   min  8.5   4.0 m    4.8 m     5.0 m: a quick tap drops it inside its own blast
  //   max   28  11.9 m   23.8 m    29.9 m: was 25 (10.7, 20.0, 24.6 m), "a little further"
  //
  // The longest is 1.4 s in the air, well inside the fuse.
  throw: {
    min: 8.5,
    max: 28,
    chargeTime: 0.85,       // mid the 0.7-1.0 s target
  },
  // unpinned: wide enough to be heard well past the blast itself
  heard: 28,
};

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const ONE = new THREE.Vector3(1, 1, 1);
const DOWN = new THREE.Vector3(0, -1, 0);
/** How far off a friend's blast is still heard, metres: as far as the figures' own shots are. */
const HEARD = 60;

export class Grenades {
  constructor(ctx, player) {
    this.ctx = ctx;
    this.player = player;
    this.count = GRENADE.carry.max;
    this.charge = 0;
    this.held = false;
    this.restock = 0;
    this.live = [];
    // a friend's, on their way (net/crew.js): drawn, and harmless
    this.shown = [];

    // The grenade in the air: a green body and its black fittings (weapons/models.js), eight at
    // most, tumbling as they fly.
    const geo = grenadeGeometry();
    this.meshes = [
      new THREE.InstancedMesh(geo.body, surface({ ink: INK.GREEN, look: LOOK.WASH }), 8),
      new THREE.InstancedMesh(geo.fittings, surface({ ink: INK.BLACK, look: LOOK.SOLID }), 8),
    ];
    for (const m of this.meshes) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      ctx.scene.add(m);
    }
    this._m = new THREE.Matrix4();
  }

  /** None in the air: a run left behind. */
  clear() {
    this.live.length = 0;
    this.place();
  }

  update(dt, input) {
    // restock slowly, so grenades are a resource rather than a rotation
    if (this.count < GRENADE.carry.max) {
      this.restock += dt;
      if (this.restock >= GRENADE.carry.restockSeconds) { this.restock = 0; this.count++; }
    }

    if (input.down('grenade') && this.count > 0) {
      this.held = true;
      this.charge = Math.min(1, this.charge + dt / GRENADE.throw.chargeTime);
    } else if (this.held) {
      this.held = false;
      this.throw();
      this.charge = 0;
    }

    this.fly(this.live, dt, false);
    this.place();
  }

  /**
   * A friend's grenade (net/crew.js): it flies and goes off here as it does on their page, and is
   * only drawn. Their page did the real blast, and sent what it hit to whoever runs the figures.
   */
  show(pos, vel) {
    this.shown.push(spinning({ pos, vel, fuse: GRENADE.fuse }));
  }

  /** In a room, every frame, whatever this page is doing: the friends' grenades. */
  tickShown(dt) {
    this.fly(this.shown, dt, true);
    this.place();
  }

  fly(list, dt, shown) {
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i];
      g.fuse -= dt;
      g.vel.y -= 32 * dt;
      _v.copy(g.vel).multiplyScalar(dt);
      const step = _v.length();
      if (step > 1e-5) {
        _d.copy(_v).multiplyScalar(1 / step);
        const hit = raycast(this.ctx.level, g.pos, _d, step + 0.18);
        if (hit) {
          // bounce, losing most of the energy so they settle instead of pinballing
          g.pos.copy(hit.point).addScaledVector(hit.normal, 0.19);
          const along = g.vel.dot(hit.normal);
          g.vel.addScaledVector(hit.normal, -2 * along).multiplyScalar(0.38);
          g.spin *= 0.5;
        } else {
          g.pos.add(_v);
        }
      }
      g.rot.premultiply(_q.setFromAxisAngle(g.axis, g.spin * dt));
      if (g.pos.y < this.ctx.level.killY) { list.splice(i, 1); continue; }
      if (g.fuse <= 0) {
        if (shown) this.blot(g.pos);
        else this.explode(g.pos);
        list.splice(i, 1);
      }
    }
  }

  /** Eight on the desk at most, yours first. */
  place() {
    const mine = this.live.length;
    const n = Math.min(mine + this.shown.length, 8);
    for (let i = 0; i < n; i++) {
      const g = i < mine ? this.live[i] : this.shown[i - mine];
      this._m.compose(g.pos, g.rot, ONE);
      for (const m of this.meshes) m.setMatrixAt(i, this._m);
    }
    for (const m of this.meshes) {
      m.count = n;
      m.visible = n > 0;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  throw() {
    if (this.count <= 0) return;
    this.count--;
    const p = this.player;
    _d.set(0, 0, -1).applyEuler(p.camera.rotation);
    const speed = GRENADE.throw.min + (GRENADE.throw.max - GRENADE.throw.min) * this.charge;
    this.live.push(spinning({
      pos: p.eye.clone().addScaledVector(_d, 0.5),
      vel: _d.clone().multiplyScalar(speed).add(new THREE.Vector3(0, 2.6, 0)).add(p.body.vel.clone().multiplyScalar(0.4)),
      fuse: GRENADE.fuse,
    }));
    const g = this.live[this.live.length - 1];
    this.ctx.tell?.threw(g.pos, g.vel);
    this.ctx.audio?.throwNade();
  }

  /**
   * What a blast leaves to see and hear (fx/effects.js `blast`), and a scorch on what it went
   * off on, so the page remembers. A grenade rests 0.19 m above the surface it lies on, so the
   * surface is found under it: the scorch was once stamped at the grenade's own middle, a hand
   * above the floor. One that goes off in the air leaves none. `near`: how loud, 0 to 1.
   */
  mark(pos, near = 1) {
    const ctx = this.ctx;
    const ground = raycast(ctx.level, pos, DOWN, 0.6);
    ctx.effects.blast(pos, GRENADE.blast.radius, ground);
    ctx.audio?.explosion(near);
  }

  /** A friend's grenade going off: seen and heard, and nothing more. */
  blot(pos) {
    this.mark(pos, Math.max(0, 1 - pos.distanceTo(this.ctx.camera.position) / HEARD));
  }

  explode(pos) {
    const ctx = this.ctx;
    this.mark(pos);
    // the jolt is for a blast near you: all of it at the blast, none from 20 m
    const near = Math.max(0, 1 - pos.distanceTo(ctx.camera.position) / 20);
    if (near > 0) {
      ctx.effects.kick(0.8 * near);
      ctx.effects.stop(0.05 * near, 0.2);
    }
    // Heard across the desk, but a bang is not where YOU are: what hears it
    // goes to look (whatever it hurts is hunting you anyway).
    ctx.enemies?.noise(pos, GRENADE.heard, 'bang');

    // and the toys in reach get shoved, and a paper plane in it comes down
    ctx.level.toys?.blast(pos, GRENADE.blast.radius * GRENADE.blast.toyReach, GRENADE.blast.damage * GRENADE.blast.toyFrac);
    ctx.planes?.blast(pos, GRENADE.blast.radius);

    if (ctx.enemies) {
      for (const e of ctx.enemies.list) {
        if (!e.alive) continue;
        const d = e.center.distanceTo(pos);
        if (d > GRENADE.blast.radius) continue;
        const falloff = 1 - d / GRENADE.blast.radius;
        ctx.enemies.damage(e, GRENADE.blast.damage * falloff, {
          point: e.center.clone(), dir: _v.copy(e.center).sub(pos).normalize(), part: 'torso', crit: false,
        });
      }
    }

    // and it hurts you too, which is the only thing that makes cooking risky
    const p = this.player;
    const dp = p.center.distanceTo(pos);
    if (dp < GRENADE.blast.radius) {
      p.damage(GRENADE.blast.damage * GRENADE.blast.selfFrac * (1 - dp / GRENADE.blast.radius));
      ctx.effects.hurt = 1;
    }
  }
}

/** A grenade turns over as it flies: about a random axis, 7-11 turns of a radian a second, halved by each bounce. */
function spinning(g) {
  g.rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
  g.axis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
  g.spin = 7 + Math.random() * 4;
  return g;
}
