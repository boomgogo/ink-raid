import * as THREE from 'three';

// The toy train's track, as a path: a rounded rectangle of straights and
// quarter-circle bends, measured by arc length.
//
// One definition, used twice. The track drawn on the desk is laid along it,
// and the train drives along it, so the two cannot disagree about where the
// rails are. `at(s)` answers "where is the point s metres round, and which way
// is it going", wrapping round the loop in either direction.
//
// It runs anticlockwise seen from above with north up: up the east side
// (towards −z), across the north, down the west side, and back along the south.

export class Track {
  /**
   * @param {number} half    distance from the middle of the desk to each straight
   * @param {number} radius  of the bends
   */
  constructor(half, radius) {
    this.half = half;
    this.radius = radius;
    const k = half - radius;               // where each straight ends
    const H = Math.PI / 2;
    // each piece: a straight from a to b, or an arc about c from angle a0 to a1
    // (angles in the x-z plane, from +x towards +z)
    this.pieces = [
      { kind: 'line', from: [half, 0], to: [half, -k] },
      { kind: 'arc', c: [k, -k], a0: 0, a1: -H },
      { kind: 'line', from: [k, -half], to: [-k, -half] },
      { kind: 'arc', c: [-k, -k], a0: -H, a1: -2 * H },
      { kind: 'line', from: [-half, -k], to: [-half, k] },
      { kind: 'arc', c: [-k, k], a0: -2 * H, a1: -3 * H },
      { kind: 'line', from: [-k, half], to: [k, half] },
      { kind: 'arc', c: [k, k], a0: H, a1: 0 },
      { kind: 'line', from: [half, k], to: [half, 0] },
    ];
    let s = 0;
    for (const p of this.pieces) {
      p.s0 = s;
      p.len = p.kind === 'line'
        ? Math.hypot(p.to[0] - p.from[0], p.to[1] - p.from[1])
        : Math.abs(p.a1 - p.a0) * radius;
      s += p.len;
    }
    this.length = s;
  }

  /** The piece s metres round, and how far into it. */
  piece(s) {
    s = ((s % this.length) + this.length) % this.length;
    for (const p of this.pieces) if (s < p.s0 + p.len || p === this.pieces[this.pieces.length - 1]) return [p, s - p.s0];
    return [this.pieces[0], 0];
  }

  /**
   * Where the track is s metres round: `out` gets x, z and the heading as a
   * unit (dx, dz). Returns out.
   */
  at(s, out = { x: 0, z: 0, dx: 0, dz: 0, bend: false }) {
    const [p, u] = this.piece(s);
    if (p.kind === 'line') {
      const t = u / p.len;
      out.x = p.from[0] + (p.to[0] - p.from[0]) * t;
      out.z = p.from[1] + (p.to[1] - p.from[1]) * t;
      out.dx = (p.to[0] - p.from[0]) / p.len;
      out.dz = (p.to[1] - p.from[1]) / p.len;
      out.bend = false;
    } else {
      const sgn = Math.sign(p.a1 - p.a0);
      const a = p.a0 + sgn * (u / this.radius);
      out.x = p.c[0] + Math.cos(a) * this.radius;
      out.z = p.c[1] + Math.sin(a) * this.radius;
      out.dx = -Math.sin(a) * sgn;
      out.dz = Math.cos(a) * sgn;
      out.bend = true;
    }
    return out;
  }

  /** The point s metres round as a Vector3 at height y. */
  point(s, y = 0, out = new THREE.Vector3()) {
    const q = this.at(s);
    return out.set(q.x, y, q.z);
  }

  /** How far (x, z) is from the track's centre line, roughly: sampled every metre. */
  distance(x, z) {
    let best = Infinity;
    const q = { x: 0, z: 0, dx: 0, dz: 0 };
    for (let s = 0; s < this.length; s += 1) {
      this.at(s, q);
      const d = Math.hypot(x - q.x, z - q.z);
      if (d < best) best = d;
    }
    return best;
  }
}
