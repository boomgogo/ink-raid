import * as THREE from 'three';

// The world's gravity, m/s²: bodies, enemies, the toys and the paper planes
// all fall with it. Far more than 9.8, because you are a few centimetres tall
// on a desk and a jump has to be snappy; far less than true scale (about 430),
// which would make the toys a blur.
export const GRAVITY = 34;

// Static-world collision, for a body that is an upright box.
//
// The BODY is a box rather than a capsule: it never rotates, and axis-separated
// resolution is exact and cheap. It does not tunnel because no horizontal move
// is taken in one go that is longer than the body is wide (see stepBody). The
// WORLD is not boxes — it is whatever the pen drew, and every collider
// is the shape of the primitive that drew it (see Builder._solid).
//
// Two things make it feel like a shooter rather than a physics demo:
//   * step-up — walking into something shorter than `step` climbs it instead of
//     stopping, so kerbs, stair treads and book edges do not catch you.
//   * per-axis resolution — blocked on X still slides along Z, which is what
//     makes running along a wall feel smooth.

const EPS = 1e-4;

// The longest single horizontal move, as a fraction of the body's radius. A
// wall is at least a body wide to a moving box (its own thickness plus the
// body's), so a step shorter than that cannot hop from one side to the other.
// A dash-slash is 34 m/s, and on an entry phone at 30 fps that is 1.13 m a
// frame: straight through a 0.35 m sticky note, which is 1.05 m to a body.
const SUBSTEP = 0.8;
const MAX_SUBSTEPS = 32;

// The player's own body dimensions, in one place: `Player` builds its body
// from these (via MOVE.bodyRadius/bodyHeight/stepUp in entities/player.js,
// which are set equal to this table), and `newBody`'s own defaults read the
// same table, so the two cannot drift apart the way a literal default and a
// separately-tuned MOVE table used to.
export const PLAYER_BODY = {
  radius: 0.33,   // < the 0.36 m pin, and <= 0.45 m stairs / ladder-lane limits
  height: 1.8,     // well under the 3.2 m pencil-cup door
  step: 0.58,       // >= the ~0.52 m pin with a little room (clears the 0.5 m plaza step and the 0.4 m sub-steps), < 0.8 m so cover stays cover
};

export function newBody(pos, radius = PLAYER_BODY.radius, height = PLAYER_BODY.height, step = PLAYER_BODY.step) {
  return {
    pos: pos.clone(),
    vel: new THREE.Vector3(),
    radius,
    height,
    step,
    onGround: false,
    groundY: -Infinity,
    wallFacing: new THREE.Vector3(),
    touchingWall: false,
    ceiling: false,
    edgeGuard: false,      // crouched: refuse moves off an edge (see moveAxis)
    ground: null,          // the collider the feet are on, while onGround
  };
}

// --- collider shapes -------------------------------------------------------
//
// A collider IS the primitive that was drawn: a box, a cylinder or truncated
// cone, an ellipsoid, or a capsule — at the centre the geometry was translated
// to, under the rotations the geometry was given, in the order it was given
// them. `Builder` derives all of that from the same lines that build the mesh,
// so the two cannot drift apart. `npm run collide` checks they have not.
//
// Everything here works in the collider's own frame. `ex`/`ey`/`ez` are its
// local axes as world vectors, so world -> local is three dot products and
// local -> world is three scaled adds. `turned` is false for the great majority
// of a map, and skips both.
//
// The world AABB on every collider is the broad phase and nothing else.

let _lx = 0, _ly = 0, _lz = 0;
function toLocal(c, x, y, z) {
  const dx = x - c.c.x, dy = y - c.c.y, dz = z - c.c.z;
  if (!c.turned) { _lx = dx; _ly = dy; _lz = dz; return; }
  _lx = dx * c.ex.x + dy * c.ex.y + dz * c.ex.z;
  _ly = dx * c.ey.x + dy * c.ey.y + dz * c.ey.z;
  _lz = dx * c.ez.x + dy * c.ez.y + dz * c.ez.z;
}

let _ldx = 0, _ldy = 0, _ldz = 0;
function toLocalDir(c, x, y, z) {
  if (!c.turned) { _ldx = x; _ldy = y; _ldz = z; return; }
  _ldx = x * c.ex.x + y * c.ex.y + z * c.ex.z;
  _ldy = x * c.ey.x + y * c.ey.y + z * c.ey.z;
  _ldz = x * c.ez.x + y * c.ez.y + z * c.ez.z;
}

function fromLocalDir(c, x, y, z, out) {
  if (!c.turned) return out.set(x, y, z);
  return out.set(
    x * c.ex.x + y * c.ey.x + z * c.ez.x,
    x * c.ex.y + y * c.ey.y + z * c.ez.y,
    x * c.ex.z + y * c.ey.z + z * c.ez.z,
  );
}

/**
 * Horizontal distance from (x,z) to the segment (ax,az)-(bx,bz), with the
 * closest point left in _segX / _segZ and how far along it in _segT.
 */
let _segT = 0, _segX = 0, _segZ = 0;
function distToSegXZ(x, z, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const len2 = vx * vx + vz * vz;
  let t = len2 > 1e-12 ? ((x - ax) * vx + (z - az) * vz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  _segT = t;
  _segX = ax + vx * t;
  _segZ = az + vz * t;
  const dx = x - _segX, dz = z - _segZ;
  return Math.sqrt(dx * dx + dz * dz);
}

// --- the column test (everything that walks) --------------------------------
//
// A body is an upright box that never rotates, so what movement needs from a
// collider is one question: over the column of radius `r` around (x,z), which
// heights does it occupy? One interval per collider, in world y.
//
// That replaces the old "footprint plus min.y..max.y", which could only ever
// describe an upright box. A ball, a cone and a bar lying on its side all have
// a top that MOVES as you walk across them, and answering per column is what
// lets you stand on the drawn surface of one instead of on its bounding box.

let _spanLo = 0, _spanHi = 0;

/**
 * Does this collider occupy any height in the column of radius `r` at (x,z)?
 * Writes the interval into _spanLo / _spanHi.
 *
 * `r` dilates the collider HORIZONTALLY only. Dilating in 3D would raise every
 * top by r and leave you standing a third of a metre above the ink.
 */
function columnSpan(c, x, z, r) {
  if (x + r <= c.min.x || x - r >= c.max.x) return false;
  if (z + r <= c.min.z || z - r >= c.max.z) return false;

  switch (c.shape) {
    case 'box': {
      if (c.upright) {
        // The whole of most maps: one rectangle at every height, so the cheap
        // path stays cheap.
        const dx = x - c.c.x, dz = z - c.c.z;
        const lx = c.turned ? dx * c.ex.x + dz * c.ex.z : dx;
        const lz = c.turned ? dx * c.ez.x + dz * c.ez.z : dz;
        if (Math.abs(lx) >= c.hx + r || Math.abs(lz) >= c.hz + r) return false;
        _spanLo = c.c.y - c.hy; _spanHi = c.c.y + c.hy;
        return true;
      }
      // Tipped: run the column itself through the box. A ramp IS a tipped box,
      // and this is what gives it a sloping top surface for free — the height
      // you stand at moves as you walk across it, which no footprint-plus-span
      // model can say.
      toLocal(c, x, 0, z);
      const ox = _lx, oy = _ly, oz = _lz;
      toLocalDir(c, 0, 1, 0);
      let t0 = -Infinity, t1 = Infinity;
      for (let a = 0; a < 3; a++) {
        const o = a === 0 ? ox : a === 1 ? oy : oz;
        const d = a === 0 ? _ldx : a === 1 ? _ldy : _ldz;
        // `r` widens the two axes that lie nearest the horizontal; widening the
        // upright one would lift every top by a body radius
        const h = (a === 0 ? c.hx : a === 1 ? c.hy : c.hz) + (c.wide[a] ? r : 0);
        if (d > -1e-9 && d < 1e-9) { if (o < -h || o > h) return false; continue; }
        const inv = 1 / d;
        let n = (-h - o) * inv, f = (h - o) * inv;
        if (n > f) { const t = n; n = f; f = t; }
        if (n > t0) t0 = n;
        if (f < t1) t1 = f;
        if (t0 > t1) return false;
      }
      _spanLo = t0; _spanHi = t1;
      return true;
    }
    case 'cyl': {
      // Step the column toward the axis by up to a body radius — the nearest
      // part of the body's own footprint to the shape — and then run the
      // column itself through the solid. For an upright cylinder that comes
      // out as d - r and for a bar on its side the same, and for a thing lying
      // at an angle it is still the right question. Dilating the SHAPE by r
      // instead would raise every top by a body radius.
      let px = x, pz = z;
      const d = distToSegXZ(x, z, c.aEnd.x, c.aEnd.z, c.bEnd.x, c.bEnd.z);
      if (r > 0 && d > 1e-9) {
        const k = Math.min(r, d) / d;
        px += (_segX - x) * k;
        pz += (_segZ - z) * k;
      }
      toLocal(c, px, 0, pz);
      toLocalDir(c, 0, 1, 0);
      // world y and local t are the same number: the direction is a unit
      // vector and a rotation does not change its length.
      //
      // Always with the caps. An open tube lets a BULLET into its mouth, but a
      // column dropped through an upright tube never crosses the side wall, so
      // without its lid it finds nothing at all: you walked straight through
      // the mug, and the sniper on its rim fell to the bottom of it.
      const n = cylCrossings(c, _lx, _ly, _lz, _ldx, _ldy, _ldz, true);
      if (n < 2) return false;
      _spanLo = Infinity; _spanHi = -Infinity;
      for (let i = 0; i < n; i++) {
        if (_cross[i] < _spanLo) _spanLo = _cross[i];
        if (_cross[i] > _spanHi) _spanHi = _cross[i];
      }
      return true;
    }
    case 'ball': {
      const d = Math.max(0, Math.hypot(x - c.c.x, z - c.c.z) - r);
      if (d >= c.hx) return false;
      const half = c.hy * Math.sqrt(1 - (d / c.hx) * (d / c.hx));
      _spanLo = c.c.y - half; _spanHi = c.c.y + half;
      if (c.cut !== undefined) {
        // a mound: nothing of it below the floor it stands on (see rayBall)
        const floor = c.c.y + c.cut;
        if (_spanHi <= floor) return false;
        if (_spanLo < floor) _spanLo = floor;
      }
      return true;
    }
    default: {                                  // capsule
      const d = Math.max(0, distToSegXZ(x, z, c.aEnd.x, c.aEnd.z, c.bEnd.x, c.bEnd.z) - r);
      if (d >= c.r) return false;
      const y = c.aEnd.y + (c.bEnd.y - c.aEnd.y) * _segT;
      const half = Math.sqrt(c.r * c.r - d * d);
      _spanLo = y - half; _spanHi = y + half;
      return true;
    }
  }
}

/**
 * Does the collider occupy any height in this column at all?
 *
 * Exported because the Builder's spawn-placement queries have to ask the same
 * question the physics does. They used to ask the bounding box, which is the
 * same thing for an upright box and nothing like it for a diagonal bar: the big
 * pencil's bounds are 27 x 24 m around a bar 3.8 m thick, so a quarter of the
 * south-west corner looked occupied and the spawn ring collapsed inwards.
 */
export function touchesColumn(c, x, z, r) {
  if (!columnSpan(c, x, z, r)) return null;
  return { lo: _spanLo, hi: _spanHi };
}

// --- roles ------------------------------------------------------------------
//
// A collider stops bodies, rays, or both: `hits` is 'bodies', 'rays' or unset
// (both). A staircase is the case that needs it. Its treads are drawn, so they
// stop bullets and sightlines, but feet walk on a smooth slope laid along them
// that nothing draws, so it must never stop a bullet (see Builder.stairs).
//
// The two lists are split once per level and cached against the array, so the
// loops below stay plain loops. The length check is for the Builder, which
// asks placement questions while it is still adding colliders.

const _roles = new WeakMap();
function roles(level) {
  const all = level.colliders;
  let r = _roles.get(all);
  if (r === undefined || r.n !== all.length) {
    r = { n: all.length, bodies: [], rays: [] };
    for (const c of all) {
      if (c.hits !== 'rays') r.bodies.push(c);
      if (c.hits !== 'bodies') r.rays.push(c);
    }
    _roles.set(all, r);
  }
  return r;
}

/** Every collider a body can touch: all of them less the ray-only ones. */
export const bodyColliders = (level) => roles(level).bodies;
/** Every collider a ray can hit: all of them less the body-only ones. */
export const rayColliders = (level) => roles(level).rays;

const overlapsXZ = (b, c, r) => columnSpan(c, b.pos.x, b.pos.z, r);

/** Height of the floor under (x,z), taking ramps into account. */
export function floorAt(level, x, z, fromY) {
  return floorUnder(level, x, z, fromY).y;
}

/** The floor under (x,z) below `fromY`: its height, and the collider it is. */
export function floorUnder(level, x, z, fromY) {
  let best = -Infinity, under = null;
  for (const c of bodyColliders(level)) {
    if (!columnSpan(c, x, z, 0)) continue;
    if (_spanHi <= fromY + 0.01 && _spanHi > best) { best = _spanHi; under = c; }
  }
  return { y: best, c: under };
}

/**
 * The highest ramp surface under the body.
 *
 * `level.ramps` holds the ramp colliders, which are ordinary tipped boxes and
 * are in `level.colliders` as well — this is not a second collision model, it
 * is a magnet. Walking DOWN a slope you would otherwise leave the surface every
 * frame and land again, and the footfalls make a smooth slope feel like stairs.
 */
let _rampC = null;
function rampTop(level, b) {
  let best = -Infinity;
  _rampC = null;
  for (const c of level.ramps || []) {
    if (!columnSpan(c, b.pos.x, b.pos.z, b.radius)) continue;
    if (_spanHi > best) { best = _spanHi; _rampC = c; }
  }
  return best;
}

/**
 * Advance the body by `vel * dt` against the level, resolving one axis at a
 * time. `pos` is the body's FEET.
 */
export function stepBody(level, b, dt) {
  const cols = bodyColliders(level);
  b.touchingWall = false;
  b.ceiling = false;

  // --- vertical -------------------------------------------------------------
  // Resolution is against where the feet WERE, not against a fixed tolerance
  // below the surface. A fixed tolerance has to be guessed, and whatever you
  // guess, a long enough fall steps straight through a thin platform in one
  // frame. Comparing previous and current position catches the crossing at any
  // speed.
  const prevY = b.pos.y;
  b.pos.y += b.vel.y * dt;
  const hadFloor = b.onGround;
  b.onGround = false;
  b.ground = null;

  for (const c of cols) {
    if (!overlapsXZ(b, c, b.radius)) continue;
    const cLo = _spanLo, cHi = _spanHi;
    if (b.vel.y <= 0) {
      // landed if we crossed the top going down (or are resting just inside it)
      if (prevY >= cHi - EPS && b.pos.y < cHi && b.pos.y + b.height > cLo) {
        b.pos.y = cHi;
        b.vel.y = 0;
        b.onGround = true;
        b.groundY = cHi;
        b.ground = c;
      }
    } else {
      const prevTop = prevY + b.height;
      const top = b.pos.y + b.height;
      if (prevTop <= cLo + EPS && top > cLo && b.pos.y < cHi) {
        b.pos.y = cLo - b.height;
        b.vel.y = 0;
        b.ceiling = true;
      }
    }
  }

  const rt = rampTop(level, b);
  if (rt > -Infinity && b.pos.y < rt && b.pos.y > rt - 1.5) {
    b.pos.y = rt;
    if (b.vel.y < 0) b.vel.y = 0;
    b.onGround = true;
    b.groundY = rt;
    b.ground = _rampC;
  }

  // --- horizontal, one axis at a time --------------------------------------
  // moveAxis only asks whether the END of a move overlaps something, so a move
  // longer than the body is wide can start on one side of a thin wall and end
  // on the other. Split it instead. Walking and sprinting at 60 fps is one
  // step, as before; a dash-slash at 20 fps is seven.
  const travel = Math.hypot(b.vel.x, b.vel.z) * dt;
  const n = Math.min(MAX_SUBSTEPS, Math.ceil(travel / (SUBSTEP * b.radius)) || 1);
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    moveAxis(cols, b, 'x', b.vel.x * h, hadFloor || b.onGround);
    moveAxis(cols, b, 'z', b.vel.z * h, hadFloor || b.onGround);
  }

  // --- keep to the ground going down ----------------------------------------
  // Step-up takes you UP a slope a little every frame. Nothing took you down
  // one: the ground fell away faster than the -2 m/s ground stick, so the body
  // left it, fell for a frame and landed again. Walking down a 37 degree slope
  // that was 4 frames in 80 on the ground and a landing on every one of them,
  // which is stairs, not a ramp. A body that was on the ground and is not
  // rising follows the ground down by up to a step, the same height it would
  // climb.
  if (hadFloor && !b.onGround && b.vel.y <= 0) {
    let below = -Infinity, under = null;
    for (const c of cols) {
      if (!overlapsXZ(b, c, b.radius)) continue;
      if (_spanHi <= b.pos.y + EPS && _spanHi > below) { below = _spanHi; under = c; }
    }
    if (below > b.pos.y - b.step) {
      b.pos.y = below;
      b.vel.y = 0;
      b.onGround = true;
      b.groundY = below;
      b.ground = under;
    }
  }

  if (!b.onGround) b.ground = null;
  return b;
}

function moveAxis(cols, b, axis, amount, grounded) {
  if (amount === 0) return;
  const before = b.pos[axis];
  b.pos[axis] += amount;
  const r = b.radius;

  // Step up rather than stop, if everything in the way is low enough and there
  // is headroom over the highest of it. That is ONE step, to the highest top
  // in the way. It used to ask each collider in turn, and refuse at the first
  // one with no headroom over it — even when what was over it was the next
  // thing in the way, and low enough to step on. At the top of a ramp-stair the
  // slab under your feet found the flat top tread above it and stopped you dead
  // a step short of the landing.
  let stepTo = -Infinity, stepC = null;
  for (const c of cols) {
    if (!overlapsXZ(b, c, r)) continue;
    const top = b.pos.y + b.height;
    if (top <= _spanLo + EPS || b.pos.y >= _spanHi - EPS) continue;
    if (!grounded || _spanHi - b.pos.y > b.step) { stepTo = Infinity; break; }
    if (_spanHi > stepTo) { stepTo = _spanHi; stepC = c; }
  }
  if (stepTo === -Infinity) {
    // Crouched, you do not walk off an edge: a move that leaves nothing under
    // any part of the body within a step below is refused on this axis. You
    // can stand out to the edge, as far as your own footprint, but not over it.
    if (b.edgeGuard && grounded && !supported(cols, b)) {
      b.pos[axis] = before;
      b.vel[axis] = 0;
    }
    return;
  }
  if (stepTo < Infinity && headroom(cols, b, stepTo)) {
    b.pos.y = stepTo;
    b.onGround = true;
    b.groundY = stepTo;
    b.ground = stepC;
    return;
  }

  // blocked: back out on this axis only, so the other one still slides
  b.pos[axis] = before;
  b.vel[axis] = 0;
  b.touchingWall = true;
  b.wallFacing.set(0, 0, 0);
  b.wallFacing[axis] = amount > 0 ? -1 : 1;
}

/** Is there a top under the body's footprint, no more than a step below its feet? */
function supported(cols, b) {
  for (const c of cols) {
    if (!overlapsXZ(b, c, b.radius)) continue;
    if (_spanHi <= b.pos.y + 0.05 && _spanHi >= b.pos.y - b.step) return true;
  }
  return false;
}

function headroom(cols, b, atY, height = b.height) {
  for (const c of cols) {
    if (!overlapsXZ(b, c, b.radius)) continue;
    if (_spanLo < atY + height - EPS && _spanHi > atY + EPS) return false;
  }
  return true;
}

/**
 * Could the body be `height` tall where it stands?
 *
 * Asked before standing up out of a crouch. A body that grows into a ceiling is
 * never pushed out of it — the vertical pass only catches a head that crosses a
 * ceiling on the way UP — and every horizontal move after that overlaps the
 * ceiling and is refused, in both directions. Same tolerances as moveAxis, so
 * "room to stand" and "free to move once standing" are the same answer.
 */
export function roomToStand(level, b, height) {
  return headroom(bodyColliders(level), b, b.pos.y, height);
}

/**
 * Push a body sideways by (dx, dz) through the world, the way something that
 * moves pushes it: in steps no longer than a body is wide, stepping up what a
 * walk would, stopped by a wall. `skip(c)` names colliders that do not block
 * it — whatever is doing the pushing. Its velocity is left as it was.
 */
export function shove(level, b, dx, dz, skip = null) {
  const cols = skip ? bodyColliders(level).filter((c) => !skip(c)) : bodyColliders(level);
  const vx = b.vel.x, vz = b.vel.z;
  const n = Math.min(MAX_SUBSTEPS, Math.ceil(Math.hypot(dx, dz) / (SUBSTEP * b.radius)) || 1);
  for (let i = 0; i < n; i++) {
    moveAxis(cols, b, 'x', dx / n, true);
    moveAxis(cols, b, 'z', dz / n, true);
  }
  b.vel.x = vx; b.vel.z = vz;
  return b;
}

/** Is there room to stand at (x,z) with feet at `y`? */
export function clearAbove(level, x, z, y, height, radius = 0.35) {
  for (const c of bodyColliders(level)) {
    if (!columnSpan(c, x, z, radius)) continue;
    if (_spanLo < y + height - 0.05 && _spanHi > y + 0.05) return false;
  }
  return true;
}

// --- ladders ------------------------------------------------------------------
//
// A ladder is not a collider. It is a volume in front of a wall, and a body
// inside it that means to climb is moved by whoever owns it (Player, Enemies)
// instead of by gravity. See Builder.ladder for the fields.

/** Where the feet `p` are in a ladder's frame: along it, out from the wall, up it. */
export function ladderLocal(l, p, out = { u: 0, v: 0, h: 0 }) {
  const dx = p.x - l.foot.x, dz = p.z - l.foot.z;
  out.u = dx * l.tx + dz * l.tz;
  out.v = dx * l.nx + dz * l.nz;
  out.h = p.y - l.foot.y;
  return out;
}

const _ll = { u: 0, v: 0, h: 0 };
/** Is the body's feet `p` inside ladder `l`'s volume? */
export function onLadder(l, p) {
  ladderLocal(l, p, _ll);
  return Math.abs(_ll.u) <= l.halfWidth && _ll.v >= -0.2 && _ll.v <= l.depth
    && _ll.h >= -0.3 && _ll.h <= l.height + 0.35;
}

/** The ladder whose volume holds the feet `p`, or null. */
export function ladderAt(level, p) {
  for (const l of level.ladders || []) if (onLadder(l, p)) return l;
  return null;
}

// --- rays -------------------------------------------------------------------
//
// Everything is tested in the collider's own frame against the canonical shape
// the primitive draws, so a bullet stops on the ink and nowhere else.
//
// A ray that STARTS inside a collider counts as a miss, deliberately: the
// shooter's own eye is regularly inside the desk's kerb or a step, and stopping
// every shot at zero range would be worse than letting it out.

// the entry point of the last successful rayCollider, in that collider's frame
let _px = 0, _py = 0, _pz = 0;

/** Nearest entry into the local box |p| <= (hx,hy,hz), or -1. */
function rayBox(c, ox, oy, oz, dx, dy, dz, maxT) {
  let t0 = 0, t1 = maxT;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz;
    const d = a === 0 ? dx : a === 1 ? dy : dz;
    const h = a === 0 ? c.hx : a === 1 ? c.hy : c.hz;
    if (d > -1e-8 && d < 1e-8) { if (o < -h || o > h) return -1; continue; }
    const inv = 1 / d;
    let n = (-h - o) * inv, f = (h - o) * inv;
    if (n > f) { const t = n; n = f; f = t; }
    if (n > t0) t0 = n;
    if (f < t1) t1 = f;
    if (t0 > t1) return -1;
  }
  return t0 > 0 ? t0 : -1;
}

/**
 * Where a ray crosses the surface of the local cylinder or truncated cone.
 *
 * Radius runs from rBot at y = -hy to rTop at y = +hy, so one routine covers a
 * cylinder (equal radii), a cone (rTop 0) and a pencil (tapered). Rather than
 * intersecting intervals — which a cone's quadratic does not give cleanly,
 * because the untruncated surface is two nappes — it gathers the up to four
 * crossings and lets the caller pick. Shooting wants the nearest ahead of it;
 * standing on the thing wants the first and the last.
 *
 * Returns how many it wrote into _cross.
 */
const _cross = [0, 0, 0, 0];
function cylCrossings(c, ox, oy, oz, dx, dy, dz, caps) {
  const hy = c.hy, rBot = c.rBot, rTop = c.rTop;
  const k = (rTop - rBot) / (2 * hy);
  let n = 0;

  // the side
  const r0 = rBot + k * (oy + hy);
  const qa = dx * dx + dz * dz - k * k * dy * dy;
  const qb = ox * dx + oz * dz - k * dy * r0;
  const qc = ox * ox + oz * oz - r0 * r0;
  if (qa > 1e-12 || qa < -1e-12) {
    const disc = qb * qb - qa * qc;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (let i = 0; i < 2; i++) {
        const t = (-qb + (i ? sq : -sq)) / qa;
        const y = oy + dy * t;
        if (y < -hy || y > hy) continue;
        if (rBot + k * (y + hy) < 0) continue;      // the far nappe of the cone
        _cross[n++] = t;
      }
    }
  } else if (qb > 1e-12 || qb < -1e-12) {           // grazing: the linear case
    const t = -qc / (2 * qb);
    const y = oy + dy * t;
    if (y >= -hy && y <= hy) _cross[n++] = t;
  }

  // the caps. An open cylinder is drawn as a TUBE — the mug and the pencil cup
  // have no lid on them — and a bullet has to go in the top, because there is
  // nothing there to stop it. The lid stays solid to WALK on: both are sniper
  // nests, and without it you would drop through the mug. So rays pass
  // `!openEnds` and the column test always passes true.
  if (caps && (dy > 1e-8 || dy < -1e-8)) {
    for (let i = 0; i < 2; i++) {
      const y = i ? hy : -hy;
      const t = (y - oy) / dy;
      const rr = i ? rTop : rBot;
      const px = ox + dx * t, pz = oz + dz * t;
      if (px * px + pz * pz <= rr * rr) _cross[n++] = t;
    }
  }
  return n;
}

/** Nearest entry into the local cylinder or truncated cone, or -1. */
function rayCyl(c, ox, oy, oz, dx, dy, dz, maxT) {
  const n = cylCrossings(c, ox, oy, oz, dx, dy, dz, !c.openEnds);
  let best = maxT;
  for (let i = 0; i < n; i++) if (_cross[i] > 0 && _cross[i] < best) best = _cross[i];
  return best < maxT ? best : -1;
}

/**
 * Nearest entry into the local ellipsoid with radii (hx,hy,hz), or -1.
 *
 * `cut`, when set, slices it flat at local y = cut and keeps only what is
 * above. A mound is an ellipsoid sunk tens of metres into the desk so that its
 * rim is a gentle slope, and only the cap above the desk is drawn. Uncut, the
 * rest of it was solid under the desk — out past the desk's edge, for a mound
 * near it, where a body falling off the page landed on nothing drawn.
 */
function rayBall(c, ox, oy, oz, dx, dy, dz, maxT) {
  const sx = 1 / c.hx, sy = 1 / c.hy, sz = 1 / c.hz;
  const ax = ox * sx, ay = oy * sy, az = oz * sz;
  const bx = dx * sx, by = dy * sy, bz = dz * sz;
  const qa = bx * bx + by * by + bz * bz;
  const qb = ax * bx + ay * by + az * bz;
  const qc = ax * ax + ay * ay + az * az - 1;
  const disc = qb * qb - qa * qc;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t0 = (-qb - sq) / qa, t1 = (-qb + sq) / qa;
  if (c.cut !== undefined) {
    if (dy > 1e-12 || dy < -1e-12) {
      const tp = (c.cut - oy) / dy;
      if (dy > 0) { if (tp > t0) t0 = tp; } else if (tp < t1) t1 = tp;
      if (t0 > t1) return -1;
    } else if (oy < c.cut) return -1;
  }
  return t0 > 0 && t0 < maxT ? t0 : -1;
}

const _ba = new THREE.Vector3();
const _oa = new THREE.Vector3();

/**
 * Ray against a capsule: the segment a-b thickened by r.
 *
 * The body of it is a quadratic in the plane square to the segment; anything
 * that lands off either end falls back to that end's cap sphere. Returns the
 * entry distance, 0 if the ray starts inside, or null. Exported because the
 * enemies are made of these too.
 */
export function rayCapsule(origin, dir, a, b, r) {
  _ba.copy(b).sub(a);
  _oa.copy(origin).sub(a);
  const baba = _ba.dot(_ba);
  const bard = _ba.dot(dir);
  const baoa = _ba.dot(_oa);
  const rdoa = dir.dot(_oa);
  const qa = baba - bard * bard;
  const qb = baba * rdoa - baoa * bard;
  const qc = baba * (_oa.dot(_oa) - r * r) - baoa * baoa;
  const h = qb * qb - qa * qc;
  if (h >= 0 && qa > 1e-12) {
    const t = (-qb - Math.sqrt(h)) / qa;
    const y = baoa + t * bard;
    if (y > 0 && y < baba) return t > 0 ? t : 0;
  }
  let best = null;
  for (let i = 0; i < 2; i++) {
    const t = raySphere(origin, dir, i === 0 ? a : b, r);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

const _rs = new THREE.Vector3();
export function raySphere(origin, dir, centre, r) {
  _rs.copy(centre).sub(origin);
  const c = _rs.lengthSq() - r * r;
  if (c <= 0) return 0;                     // already inside it
  const b = _rs.dot(dir);
  if (b <= 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  return b - Math.sqrt(disc);
}

/** Distance at which the ray enters this collider, or -1. */
function rayCollider(c, origin, dir, maxT) {
  if (c.shape === 'capsule') {
    const t = rayCapsule(origin, dir, c.aEnd, c.bEnd, c.r);
    return t !== null && t > 0 && t < maxT ? t : -1;
  }
  toLocal(c, origin.x, origin.y, origin.z);
  const ox = _lx, oy = _ly, oz = _lz;
  toLocalDir(c, dir.x, dir.y, dir.z);
  const dx = _ldx, dy = _ldy, dz = _ldz;

  const t = c.shape === 'box' ? rayBox(c, ox, oy, oz, dx, dy, dz, maxT)
    : c.shape === 'cyl' ? rayCyl(c, ox, oy, oz, dx, dy, dz, maxT)
      : rayBall(c, ox, oy, oz, dx, dy, dz, maxT);
  if (t < 0) return -1;
  _px = ox + dx * t; _py = oy + dy * t; _pz = oz + dz * t;
  return t;
}

/** Outward normal at the last rayCollider entry point, into `out`. */
const _cn = new THREE.Vector3();
function colliderNormal(c, origin, dir, t, out) {
  if (c.shape === 'capsule') {
    // the point, less its own closest point on the spine
    _cn.copy(origin).addScaledVector(dir, t);
    _ba.copy(c.bEnd).sub(c.aEnd);
    const len2 = _ba.dot(_ba);
    _oa.copy(_cn).sub(c.aEnd);
    let u = len2 > 1e-12 ? _oa.dot(_ba) / len2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    return out.copy(_cn).sub(c.aEnd).addScaledVector(_ba, -u).normalize();
  }
  let nx = 0, ny = 0, nz = 0;
  if (c.shape === 'box') {
    const ax = Math.abs(_px) / c.hx, ay = Math.abs(_py) / c.hy, az = Math.abs(_pz) / c.hz;
    if (ax >= ay && ax >= az) nx = _px < 0 ? -1 : 1;
    else if (ay >= az) ny = _py < 0 ? -1 : 1;
    else nz = _pz < 0 ? -1 : 1;
  } else if (c.shape === 'cyl') {
    const k = (c.rTop - c.rBot) / (2 * c.hy);
    const rad = Math.hypot(_px, _pz);
    const want = c.rBot + k * (_py + c.hy);
    // a cap if the point sits on one, otherwise the sloped side: the gradient
    // of x^2 + z^2 - r(y)^2 is (2x, -2 r k, 2z)
    if (!c.openEnds && Math.abs(Math.abs(_py) - c.hy) < 1e-4 && rad < want - 1e-4) {
      ny = _py < 0 ? -1 : 1;
    } else {
      nx = _px / (rad || 1); nz = _pz / (rad || 1); ny = -k;
    }
  } else {
    if (c.cut !== undefined && _py < c.cut + 1e-6) ny = -1;       // the flat underside
    else { nx = _px / (c.hx * c.hx); ny = _py / (c.hy * c.hy); nz = _pz / (c.hz * c.hz); }
  }
  fromLocalDir(c, nx, ny, nz, out);
  return out.normalize();
}

/** Nearest hit of a ray against the level, or null. */
export function raycast(level, origin, dir, maxDist = 100) {
  let bestT = maxDist;
  let bestBox = null;

  for (const c of rayColliders(level)) {
    // the broad phase, and the only thing the world AABB is for
    if (!slabHit(c, origin, dir, bestT)) continue;
    const t = rayCollider(c, origin, dir, bestT);
    if (t < 0) continue;
    bestT = t;
    bestBox = c;
  }
  if (!bestBox) return null;
  // re-enter, so the local point belongs to the collider we kept
  const normal = new THREE.Vector3();
  rayCollider(bestBox, origin, dir, bestT + 1e-3);
  colliderNormal(bestBox, origin, dir, bestT, normal);
  return {
    dist: bestT,
    box: bestBox,
    point: origin.clone().addScaledVector(dir, bestT),
    normal,
  };
}

/** Cheap reject: does the ray reach the collider's world AABB at all? */
function slabHit(c, o, d, maxT) {
  let t0 = 0, t1 = maxT;
  for (let a = 0; a < 3; a++) {
    const k = a === 0 ? 'x' : a === 1 ? 'y' : 'z';
    const dd = d[k];
    if (dd > -1e-8 && dd < 1e-8) { if (o[k] < c.min[k] || o[k] > c.max[k]) return false; continue; }
    const inv = 1 / dd;
    let n = (c.min[k] - o[k]) * inv, f = (c.max[k] - o[k]) * inv;
    if (n > f) { const t = n; n = f; f = t; }
    if (n > t0) t0 = n;
    if (f < t1) t1 = f;
    if (t0 > t1) return false;
  }
  return true;
}
