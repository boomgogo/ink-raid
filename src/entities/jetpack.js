import * as THREE from 'three';
import { GRAVITY } from '../core/physics.js';
import { clamp, ease } from '../core/spring.js';
import { INK } from '../render/palette.js';

// The jetpack. Hold to fly; let go and it refuels.
//
// The thrust is throttled to hold a climb speed rather than added flat, so a
// long burn rises at a steady rate instead of ever faster, and it is the tank,
// not the speed, that says how high one burn goes. Fuel is what stops it
// becoming the only way anyone moves. It refuels in the air as well as on the
// ground, as long as it is not burning: gliding down between bursts is the
// skill, and it cannot keep you up for good (see `refill`).

export const JET = {
  // Beats gravity's 34 by 14 m/s²: from standing, 0.28 m up and climbing at
  // 2.8 m/s after 0.2 s, a lift-off you see at once.
  thrust: 48,
  climbMax: 9,          // above the jump's 7.4 m/s, so a burn reads as flight, not a long jump
  airControl: 1.5,      // x MOVE.airControl while it burns: a reversal of walk speed in 0.33 s, not 0.5
  // Fastest across the desk while it burns: above sprint (8.8) and the cutter's
  // 10.5, so a burn gets you away from a charge, and under half a dash (24).
  airCap: 12,
  tank: 1,
  // 2.1 s of burn from full. Straight up from standing that is 0.64 s to reach
  // 9 m/s (2.9 m), 1.44 s at 9 m/s (13 m), and 1.2 m of coasting after: about
  // 17 m, a metre over the highest place on the desk (the pencil cup's rim,
  // 16 m). With a jump first, about 20 m: still 8 m under the lamp, the tallest
  // thing on it, so one tank never takes you out over the top of the map.
  // tools/feel.mjs measures all three.
  burn: 0.48,
  // 3 s from empty. Holding a height takes thrust 34/48 = 71% of the time, at
  // `burn` a second, and refuelling gives back 0.34 a second only after
  // `refillWait`: so it stretches a glide, and cannot keep you up.
  refill: 0.34,
  refillWait: 0.5,      // after a burn, before it refills, so feathering the key does not refuel for free
  minIgnite: 0.12,      // will not light under this, so an empty tank can't flicker
  puffRate: 36,         // ink puffs a second while it burns
  hissEvery: 0.08,      // a burst of hiss this often, each a little longer, so they overlap
};

const _at = new THREE.Vector3();
const _vel = new THREE.Vector3();

/**
 * Ink puffs falling out of a pack worn at `body`, facing `yaw`, for `dt` of
 * burn. Used for this page's player and for friends' figures alike: `carry` is
 * the part of a second of puffs not yet drawn, returned for the next frame.
 */
export function jetPuffs(effects, body, yaw, dt, carry = 0) {
  if (!effects) return 0;
  let n = carry + JET.puffRate * dt;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);       // forward
  while (n >= 1) {
    n -= 1;
    const side = Math.random() < 0.5 ? -1 : 1;
    // two nozzles, between the shoulder blades and the waist
    _at.set(
      body.pos.x - fx * 0.32 + fz * side * 0.16,
      body.pos.y + 0.95 + Math.random() * 0.15,
      body.pos.z - fz * 0.32 - fx * side * 0.16,
    );
    _vel.set(
      body.vel.x * 0.5 + (Math.random() - 0.5) * 1.6,
      Math.min(body.vel.y, 0) * 0.5 - 7 - Math.random() * 3,
      body.vel.z * 0.5 + (Math.random() - 0.5) * 1.6,
    );
    effects.particle(_at, _vel, {
      size: 0.05 + Math.random() * 0.05, life: 0.45 + Math.random() * 0.2, ink: INK.PEN,
      gravity: 4, drag: 3.2, stretch: 0.25, spin: (Math.random() - 0.5) * 8,
    });
  }
  return n;
}

export class Jetpack {
  constructor(ctx, player) {
    this.ctx = ctx;
    this.player = player;
    this.burning = false;
    this.fuel = JET.tank;
    this.fuelShown = JET.tank;
    this.wait = 0;              // seconds until it starts refuelling
    this._puff = 0;
    this._hiss = 0;
  }

  /** Off, now: out of fuel, on to a ladder, dead or respawned. */
  cut() {
    if (!this.burning) return;
    this.burning = false;
    this.wait = JET.refillWait;
  }

  /** A fresh run: a full tank. */
  reset() {
    this.burning = false;
    this.fuel = this.fuelShown = JET.tank;
    this.wait = 0;
  }

  update(dt, input) {
    const p = this.player;
    const b = p.body;
    // on a ladder too: lighting it lets go of the ladder (Player.update)
    const want = input.down('jet') && p.alive;
    if (want && !this.burning && this.fuel >= JET.minIgnite) this.burning = true;
    if (!want) this.cut();

    if (this.burning) {
      this.fuel = Math.max(0, this.fuel - JET.burn * dt);
      if (this.fuel <= 0) this.cut();
    } else {
      this.wait = Math.max(0, this.wait - dt);
      if (this.wait <= 0) this.fuel = Math.min(JET.tank, this.fuel + JET.refill * dt);
    }

    if (this.burning && dt > 0) {
      // whatever brings you to `climbMax` once gravity (applied after this)
      // has had its share, up to the full thrust
      const lift = clamp((JET.climbMax - b.vel.y) / dt + GRAVITY, 0, JET.thrust);
      b.vel.y += lift * dt;
      b.onGround = false;
      this._puff = jetPuffs(this.ctx.effects, b, p.yaw, dt, this._puff);
      this._hiss -= dt;
      if (this._hiss <= 0) {
        this._hiss = JET.hissEvery;
        this.ctx.audio?.jet();
      }
    } else {
      this._hiss = 0;
    }

    this.fuelShown = ease(this.fuelShown, this.fuel, 12, dt);
  }
}
