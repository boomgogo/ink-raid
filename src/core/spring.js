// A damped spring driven by velocity impulses. Every kick in the game (recoil,
// landing dip, FOV punch, weapon sway) is one of these, because a spring
// settles the way a real thing does and a tween does not.
//
// x'' = -k x - c x' is solved exactly over each frame rather than stepped, so a
// long frame can neither blow it up nor change how it settles: the state after
// two 8 ms frames is the state after one 16 ms frame. Every spring names its
// own stiffness and damping, derived from a settle time and a damping ratio
// where it is made (player.js, entities/weapons/index.js).
export class Wobble {
  constructor(stiffness, damping) {
    this.k = stiffness;
    this.c = damping;
    this.value = 0;
    this.rate = 0;
  }

  kick(impulse) { this.rate += impulse; return this; }
  set(to) { this.value = to; this.rate = 0; return this; }

  update(dt) {
    const x0 = this.value, v0 = this.rate;
    if (dt <= 0 || (x0 === 0 && v0 === 0)) return x0;
    const a = this.c / 2;                    // decay rate
    const disc = this.k - a * a;             // > 0: it rings; < 0: it creeps back
    const fade = Math.exp(-a * dt);
    let x, v;
    if (disc > 1e-9) {
      const w = Math.sqrt(disc);
      const cs = Math.cos(w * dt), sn = Math.sin(w * dt);
      const b = (v0 + a * x0) / w;
      x = fade * (x0 * cs + b * sn);
      v = fade * (v0 * cs - (a * b + w * x0) * sn);
    } else if (disc < -1e-9) {
      const g = Math.sqrt(-disc);
      const r1 = -a + g, r2 = -a - g;        // two real decay rates
      const p = (v0 - r2 * x0) / (r1 - r2), q = x0 - p;
      const e1 = Math.exp(r1 * dt), e2 = Math.exp(r2 * dt);
      x = p * e1 + q * e2;
      v = p * r1 * e1 + q * r2 * e2;
    } else {
      const b = v0 + a * x0;                 // critically damped
      x = (x0 + b * dt) * fade;
      v = (b - a * (x0 + b * dt)) * fade;
    }
    this.value = Math.abs(x) < 1e-7 && Math.abs(v) < 1e-6 ? 0 : x;
    this.rate = this.value === 0 ? 0 : v;
    return this.value;
  }
}

// Three of them, for a position or a rotation.
export class Wobble3 {
  constructor(stiffness, damping) {
    this.axes = [new Wobble(stiffness, damping), new Wobble(stiffness, damping), new Wobble(stiffness, damping)];
    [this.x, this.y, this.z] = this.axes;
  }
  kick(ix, iy, iz) { this.x.kick(ix); this.y.kick(iy); this.z.kick(iz); return this; }
  update(dt) { for (const s of this.axes) s.update(dt); return this; }
  get vx() { return this.x.value; }
  get vy() { return this.y.value; }
  get vz() { return this.z.value; }
}

// Move `from` toward `to` at a rate that does not depend on the frame rate.
export function ease(from, to, rate, dt) {
  return to + (from - to) * Math.exp(-rate * dt);
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}
