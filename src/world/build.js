import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surface } from '../render/surface.js';
import { INK, LOOK } from '../render/palette.js';
import { touchesColumn } from '../core/physics.js';

// Level construction. Every primitive is baked into a per-ink bucket and merged
// once at the end, so a whole map costs about one draw call per pen colour
// rather than one per object. Colliders are collected alongside.
//
// COLLIDERS ARE THE SHAPE THAT WAS DRAWN.
//
// Every primitive here emits a collider of its own kind — a box, a cylinder or
// truncated cone, an ellipsoid, a ring of capsules for a torus — at the centre
// the geometry was translated to, under the same rotations in the same order.
// The rotations are accumulated alongside the ones applied to the mesh, a line
// apart, so the two cannot drift.
//
// They used to be plain AABBs, and every rotated or round thing on the map got
// an axis-aligned box big enough to swallow it. That is invisible until you
// shoot: a bullet stops on the first collider it meets, so the map was full of
// invisible walls that ate shots and stamped an ink blot on thin air. The worst
// of them, measured:
//
//   the scatter blocks   4.6 x 3.0 drawn, up to 13.1 x 13.1 collided  (rotY ~ 90 deg)
//   the calibration wall 10.8 wide drawn, 74.2 collided               (rotY = -1.22)
//   the big pencil       34 m long, drawn diagonally, collided along +x
//   the mug              r = 8 circle, collided as a 16 x 16 square
//
// SOLID BY DEFAULT, everywhere. `box` always was and the rest were not, so a
// `cyl` whose author never thought about it silently collided nothing: the 22 m
// pen lying across the middle distance was a ghost you walked straight through.
// Now every primitive is solid unless it says `solid: false`, which the
// decoration — stains, tick marks, the coffee in the mug — already does.
//
// A `solid: false` primitive still gets its collider built, into `ghosts`
// rather than `colliders`, so the tools can ask what you would be walking
// through. Anything that is a ghost where a body can stand in it says why with
// `ghost: '...'` ('decor' for drawn detail); `npm run collide` fails on one that
// does not.
//
// Between the two, `solid: 'rays'` stops bullets and sightlines but not bodies,
// and `solid: 'bodies'` the reverse. A staircase is both at once: its treads are
// drawn and ray-only, and the slope feet walk on is body-only and drawn by
// nothing. A body-only collider must never stop a ray, or it is an invisible
// wall, so `npm run collide` asks rays of everything else.
//
// `place: 'name'` marks a top you are meant to be able to stand on — a roof, a
// deck, a rim. `npm run reach` proves every one of them can be walked to.
//
// THINGS. `b.thing('pencil cup')` says what the primitives after it are part
// of, and every collider and ghost carries the name as `obj`, so objects on
// the table can be checked for overlapping each other. Nothing could ask before this, because nothing knew
// where one object ended and the next began. `npm run collide` now fails on two
// things sharing space, unless one says it `squeezes` the other: putty pressed
// into a gap is the one thing on a desk that does.
//
// A round thing is DRAWN as a polygon, so its collider takes the INSCRIBED
// radius of that polygon: r * cos(pi/seg), a quarter of a metre on the big
// pencil, which is drawn with six sides. Inside the ink is honest; outside it
// is an invisible wall. `npm run collide` measures the result against the
// triangles these same calls produce.

const V = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Turn an indexed geometry inside out: its faces and normals point the other way. */
function flipFaces(g) {
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
}

/** One flat quad through four corners, facing `n`, indexed like the built-in geometries. */
function quad(a, b, c, d, n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([...n, ...n, ...n, ...n], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  const e1 = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
  const e2 = new THREE.Vector3(...c).sub(new THREE.Vector3(...a));
  const out = e1.cross(e2).dot(new THREE.Vector3(...n)) > 0;
  g.setIndex(out ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
  return g;
}

const UNIT = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _mB = new THREE.Matrix4();

/**
 * The rotations a piece of geometry was given, as the collider's local axes in
 * world space. Same list, same order: BufferGeometry.rotateX(a) applies its
 * matrix to vertices that already carry everything before it, so the rotations
 * accumulate by PREmultiplying.
 *
 * `turned` is false when there were none, and both the ray and the column test
 * skip the change of frame entirely — which is most of a map.
 */
function basisOf(rots) {
  _qA.identity();
  let turned = false;
  for (const [axis, ang] of rots) {
    if (!ang) continue;
    // ['q', quaternion] is a whole rotation at once: see `dir` on cyl()
    if (axis === 'q') _qB.copy(ang);
    else _qB.setFromAxisAngle(UNIT[axis], ang);
    _qA.premultiply(_qB);
    turned = true;
  }
  if (!turned) return { turned: false, ex: UNIT.x, ey: UNIT.y, ez: UNIT.z };
  _mB.makeRotationFromQuaternion(_qA);
  const e = _mB.elements;
  return {
    turned: true,
    ex: new THREE.Vector3(e[0], e[1], e[2]),
    ey: new THREE.Vector3(e[4], e[5], e[6]),
    ez: new THREE.Vector3(e[8], e[9], e[10]),
  };
}

/** The local up of geometry turned by `rots`: the axis a WRAP surface's lines go round. */
function axisOf(rots) {
  return basisOf(rots).ey.clone();
}

/** Walk `dist` of arc length off the front of a polyline, in place. */
function trimEnd(pts, dist) {
  let left = dist;
  while (pts.length > 2) {
    const step = pts[0].distanceTo(pts[1]);
    if (step > left) { pts[0].lerp(pts[1], left / step); return; }
    left -= step;
    pts.shift();
  }
  pts[0].lerp(pts[1], Math.min(0.49, left / Math.max(1e-6, pts[0].distanceTo(pts[1]))));
}

/** `solid: 'rays' | 'bodies'` as a collider's `hits`; anything else collides for both. */
function roleOf(o) {
  return o.solid === 'rays' || o.solid === 'bodies' ? o.solid : undefined;
}

/** A facing — '+x' | '-x' | '+z' | '-z', or an angle in radians from +z toward +x — as a unit [x, z]. */
function facingOf(f) {
  if (typeof f === 'number') return [Math.sin(f), Math.cos(f)];
  return { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[f];
}

// Stairs. A riser no taller than this keeps feet within half of it — 0.23 m —
// of a drawn tread, and no flight steeper than this is written at all.
// `bodyR` is the widest body that walks them: a heavy is 0.41.
export const STAIR = { riser: 0.45, maxSlope: 40, bodyR: 0.45 };

/** The tight world AABB of a collider — the broad phase, and nothing else. */
export function bounds(c) {
  const X = c.ex, Y = c.ey, Z = c.ez;
  let ax, ay, az;
  if (c.shape === 'capsule') {
    c.min.set(Math.min(c.aEnd.x, c.bEnd.x) - c.r, Math.min(c.aEnd.y, c.bEnd.y) - c.r, Math.min(c.aEnd.z, c.bEnd.z) - c.r);
    c.max.set(Math.max(c.aEnd.x, c.bEnd.x) + c.r, Math.max(c.aEnd.y, c.bEnd.y) + c.r, Math.max(c.aEnd.z, c.bEnd.z) + c.r);
    return;
  }
  if (c.shape === 'box') {
    ax = c.hx * Math.abs(X.x) + c.hy * Math.abs(Y.x) + c.hz * Math.abs(Z.x);
    ay = c.hx * Math.abs(X.y) + c.hy * Math.abs(Y.y) + c.hz * Math.abs(Z.y);
    az = c.hx * Math.abs(X.z) + c.hy * Math.abs(Y.z) + c.hz * Math.abs(Z.z);
  } else if (c.shape === 'cyl') {
    const r = Math.max(c.rBot, c.rTop);
    ax = c.hy * Math.abs(Y.x) + r * Math.hypot(X.x, Z.x);
    ay = c.hy * Math.abs(Y.y) + r * Math.hypot(X.y, Z.y);
    az = c.hy * Math.abs(Y.z) + r * Math.hypot(X.z, Z.z);
  } else {
    ax = Math.hypot(c.hx * X.x, c.hy * Y.x, c.hz * Z.x);
    ay = Math.hypot(c.hx * X.y, c.hy * Y.y, c.hz * Z.y);
    az = Math.hypot(c.hx * X.z, c.hy * Y.z, c.hz * Z.z);
  }
  c.min.set(c.c.x - ax, c.c.y - ay, c.c.z - az);
  c.max.set(c.c.x + ax, c.c.y + ay, c.c.z + az);
  if (c.cut !== undefined) {
    // a cut ball: its footprint is the circle where the cut meets it
    c.min.y = c.c.y + c.cut;
    const w = c.cut > 0 ? c.hx * Math.sqrt(Math.max(0, 1 - (c.cut / c.hy) ** 2)) : c.hx;
    c.min.x = c.c.x - w; c.max.x = c.c.x + w;
    c.min.z = c.c.z - w; c.max.z = c.c.z + w;
  }
}

export class Builder {
  constructor() {
    this.buckets = new Map();   // key -> { opts, geos: [] }
    this.colliders = [];        // see collide(): AABB bounds + oriented footprint
    this.ghosts = [];           // what `solid: false` would have collided; see _solid()
    this.ramps = [];            // ramp colliders, also in `colliders`; see ramp()
    this.ladders = [];          // climbable volumes; see ladder()
    this.flights = [];          // each staircase's foot and top; see stairs()
    this.places = [];           // tops meant to be reachable; see `place`
    this.anchors = [];          // grapple points
    this.spawns = [];           // the ring the establishing shots are taken from
    this.spawnPool = [];        // every open point enemies may come in at
    this.snipers = [];
    this.pickupSpots = [];      // an item lying here at the start, back a while after it is taken
    this.tubes = [];            // hollow walls you can fall into; see tube()
    this.rooms = [];            // walled-in low ground on purpose; see room()
    this.things = new Map();    // name -> { name, squeezes }; see thing()
    this.current = null;        // the thing being drawn
    this.startPoint = new THREE.Vector3(0, 2, 0);
  }

  /**
   * Everything drawn after this, until the next call, is part of `name`.
   * `squeezes` lists the things it is allowed to share space with: putty.
   */
  thing(name, o = {}) {
    const t = this.things.get(name) || { name, squeezes: [] };
    for (const s of o.squeezes || []) if (!t.squeezes.includes(s)) t.squeezes.push(s);
    this.things.set(name, t);
    this.current = name;
    return this;
  }

  _look(o) {
    return o.look ?? LOOK.LINE;
  }

  _wraps(o) { return this._look(o) === LOOK.WRAP; }

  _key(o) {
    return `${o.ink ?? INK.PEN}|${this._look(o)}|${o.contrast ?? 1}|${o.lift ?? 0}`;
  }

  /**
   * Into its bucket. `axis` is the direction a WRAP surface's lines run round
   * (a cylinder's own axis, a box's own up); it goes on every vertex as
   * `aAxis`, unless the geometry carries its own per-vertex axis already, as a
   * bent wire does. Only WRAP buckets carry the attribute, and every geometry
   * in one does, so a bucket still merges.
   */
  _push(geo, o, axis = UNIT.y) {
    const k = this._key(o);
    let b = this.buckets.get(k);
    if (!b) {
      b = {
        geos: [],
        opts: {
          ink: o.ink ?? INK.PEN,
          look: this._look(o),
          contrast: o.contrast ?? 1,
          lift: o.lift ?? 0,
          side: o.side,
        },
      };
      this.buckets.set(k, b);
    }
    if (b.opts.look === LOOK.WRAP && !geo.attributes.aAxis) {
      const n = geo.attributes.position.count;
      const a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = axis.x; a[i * 3 + 1] = axis.y; a[i * 3 + 2] = axis.z; }
      geo.setAttribute('aAxis', new THREE.BufferAttribute(a, 3));
    }
    b.geos.push(geo);
  }

  /** Axis-aligned-ish box. x,y,z is the CENTRE of the footprint at its BASE. */
  box(x, y, z, w, h, d, o = {}) {
    if (o.quat) {
      // turned whole by a quaternion, and x,y,z is its CENTRE: for things
      // built in their own frame and then stood somewhere, like the photo frame
      const g = new THREE.BoxGeometry(w, h, d);
      g.applyQuaternion(o.quat);
      g.translate(x, y, z);
      this._push(g, o, this._wraps(o) && axisOf([['q', o.quat]]));
      this._solid('box', x, y, z, [['q', o.quat]], { hx: w / 2, hy: h / 2, hz: d / 2 }, o);
      return this;
    }
    const g = new THREE.BoxGeometry(w, h, d);
    if (o.rotY) g.rotateY(o.rotY);
    if (o.rotZ) g.rotateZ(o.rotZ);
    if (o.rotX) g.rotateX(o.rotX);
    g.translate(x, y + h / 2, z);
    this._push(g, o, this._wraps(o) && axisOf([['y', o.rotY], ['z', o.rotZ], ['x', o.rotX]]));
    this._solid('box', x, y + h / 2, z,
      [['y', o.rotY], ['z', o.rotZ], ['x', o.rotX]],
      { hx: w / 2, hy: h / 2, hz: d / 2 }, o);
    return this;
  }

  /** Collider only, no geometry: an upright box, base-centred at x,y,z. */
  collide(x, y, z, w, h, d, o = {}) {
    this._solid('box', x, y + h / 2, z, [['y', o.yaw]],
      { hx: w / 2, hy: h / 2, hz: d / 2 }, o);
    return this;
  }

  /**
   * Register a collider of shape `shape`, centred at (cx,cy,cz), under `rots`.
   *
   * `rots` is the list of rotations the geometry was given, IN THE ORDER it was
   * given them. BufferGeometry.rotateX(a) applies its matrix to vertices that
   * already carry everything before it, so they accumulate by premultiplying —
   * which is what basisOf does, and why passing the same list keeps the
   * collider on the drawing.
   *
   *   'box'     dims hx, hy, hz
   *   'cyl'     dims hy, rBot, rTop — a cylinder, a cone (rTop 0) or a taper,
   *             about its own local y, exactly as three.js builds one
   *   'ball'    dims hx, hy, hz — a sphere, or one squashed on an axis
   *   'capsule' dims aEnd, bEnd, r in WORLD space; a torus is a ring of them
   *
   * With `solid: false` it goes into `ghosts` instead: nothing in the game reads
   * that list, but a tool can put a body through it and see what it misses.
   * With `solid: 'rays'` or `'bodies'` it collides for that one only.
   */
  _solid(shape, cx, cy, cz, rots, dims, o = {}) {
    const c = {
      shape,
      c: new THREE.Vector3(cx, cy, cz),
      ...basisOf(rots),
      ...dims,
      openEnds: !!o.open,
      tag: o.tag,
      obj: this.current,
      ghost: o.ghost,
      hits: roleOf(o),
      min: new THREE.Vector3(),
      max: new THREE.Vector3(),
    };
    if (shape === 'cyl') {
      // the axis as a segment, which is what the column test steps towards
      c.aEnd = c.c.clone().addScaledVector(c.ey, -c.hy);
      c.bEnd = c.c.clone().addScaledVector(c.ey, c.hy);
    }
    if (shape === 'box') {
      c.upright = Math.abs(c.ey.y) > 0.9999;
      // Which two local axes a body's radius widens: the pair nearest the
      // horizontal. Widening the upright one would lift every surface in the
      // map by a body radius.
      const ups = [Math.abs(c.ex.y), Math.abs(c.ey.y), Math.abs(c.ez.y)];
      const most = ups.indexOf(Math.max(...ups));
      c.wide = [most !== 0, most !== 1, most !== 2];
    }
    bounds(c);
    (o.solid === false ? this.ghosts : this.colliders).push(c);
    if (o.place && o.solid !== false) this.places.push({ name: o.place, collider: c });
    return c;
  }

  /**
   * A cylinder, or a taper with `rTop`. Base-centred at x,y,z when upright;
   * centred when laid along `axis` 'x' or 'z'.
   *
   * With `dir`, a unit vector, its own +y is turned on to `dir` in one
   * rotation and x,y,z is its CENTRE. That is what pencil() builds from: every
   * part of a pencil is placed along one vector, so no part can drift off the
   * axis the way the cup's tips did when each was positioned with its own
   * trigonometry.
   */
  cyl(x, y, z, r, h, o = {}) {
    if (o.dir) return this._along('cyl', x, y, z, r, h, o);
    const g = new THREE.CylinderGeometry(o.rTop ?? r, r, h, o.seg ?? 12, 1, !!o.open);
    if (o.axis === 'x') g.rotateZ(Math.PI / 2);
    else if (o.axis === 'z') g.rotateX(Math.PI / 2);
    if (o.rotY) g.rotateY(o.rotY);
    if (o.tilt) g.rotateZ(o.tilt);
    const cy = y + (o.axis && o.axis !== 'y' ? 0 : h / 2);
    g.translate(x, cy, z);
    const rots = [
      ['z', o.axis === 'x' ? Math.PI / 2 : 0],
      ['x', o.axis === 'z' ? Math.PI / 2 : 0],
      ['y', o.rotY], ['z', o.tilt],
    ];
    this._push(g, o, this._wraps(o) && axisOf(rots));
    const ins = Math.cos(Math.PI / (o.seg ?? 12));
    this._solid('cyl', x, cy, z, rots, { hy: h / 2, rBot: r * ins, rTop: (o.rTop ?? r) * ins }, o);
    return this;
  }

  /**
   * A cone, apex up (or along `axis`, or `dir` as for cyl()). Its rotations
   * are applied in the same order as a cylinder's — rotY, then tilt. They used
   * to be the other way round, so a cone given both came off a cylinder given
   * the same two.
   */
  cone(x, y, z, r, h, o = {}) {
    if (o.dir) return this._along('cone', x, y, z, r, h, o);
    const g = new THREE.ConeGeometry(r, h, o.seg ?? 10);
    if (o.axis === 'x') g.rotateZ(-Math.PI / 2);
    else if (o.axis === 'z') g.rotateX(Math.PI / 2);
    if (o.rotY) g.rotateY(o.rotY);
    if (o.tilt) g.rotateZ(o.tilt);
    const cy = y + (o.axis && o.axis !== 'y' ? 0 : h / 2);
    g.translate(x, cy, z);
    const rots = [
      ['z', o.axis === 'x' ? -Math.PI / 2 : 0],
      ['x', o.axis === 'z' ? Math.PI / 2 : 0],
      ['y', o.rotY], ['z', o.tilt],
    ];
    this._push(g, o, this._wraps(o) && axisOf(rots));
    // a cone is a cylinder whose top radius is nothing
    this._solid('cyl', x, cy, z, rots, { hy: h / 2, rBot: r * Math.cos(Math.PI / (o.seg ?? 10)), rTop: 0 }, o);
    return this;
  }

  /** cyl() or cone() turned on to `o.dir`, centred on x,y,z. */
  _along(kind, x, y, z, r, h, o) {
    const seg = o.seg ?? (kind === 'cone' ? 10 : 12);
    const rTop = kind === 'cone' ? 0 : (o.rTop ?? r);
    const g = new THREE.CylinderGeometry(rTop, r, h, seg, 1, !!o.open);
    // `spin` turns the section about its own axis first, so a hexagonal
    // barrel and its sharpened end can be lined up face to face
    if (o.spin) g.rotateY(o.spin);
    // `inside` turns it inside out, to be seen from within: a lampshade's lining
    if (o.inside) flipFaces(g);
    const q = new THREE.Quaternion().setFromUnitVectors(UNIT.y, o.dir);
    g.applyQuaternion(q);
    g.translate(x, y, z);
    this._push(g, o, o.dir);
    const ins = Math.cos(Math.PI / seg);
    this._solid('cyl', x, y, z, [['y', o.spin], ['q', q]], { hy: h / 2, rBot: r * ins, rTop: rTop * ins }, o);
    return this;
  }

  /**
   * A pencil, whole: from its back end at `base`, pointing along `dir`, a
   * barrel `len` long and `r` across the flats' corners, then the sharpened
   * wood and the graphite, and an eraser in a ferrule at the back unless
   * `eraser: false`. Or, with `pen: true`, a biro: a round barrel, a tapered
   * grip and a nib, and a plug at the back.
   *
   * "Lots of pens or pencils don't have a tip, and some that do: the tips are
   * separated from the body." Both were true. The cup's tips were placed with
   * their own trigonometry and landed metres off the barrel, and every tip on
   * the map was a cone in the world pen, which reads as more barrel, not as a
   * point. Here the whole thing is laid out as distances along one vector,
   * and the point is drawn as a point: bare wood coming to black graphite.
   *
   * Returns the tip, so a caller can hang something off it.
   */
  pencil(base, dir, len, r, o = {}) {
    const d = dir.clone().normalize();
    const at = (s) => base.clone().addScaledVector(d, s);
    const { ink = INK.ORANGE, tag = o.pen ? 'pen' : 'pencil', solid, look, ghost } = o;
    // `spin` turns every section about the axis alike: a pencil lying on the
    // desk wants a corner of its hexagon down (see bigPencil)
    const common = { dir: d, tag, solid, ghost, spin: o.spin };
    let s = 0;
    const part = (kind, h, rr, extra) => {
      const c = at(s + h / 2);
      this[kind](c.x, c.y, c.z, rr, h, { ...common, ...extra });
      s += h;
    };
    if (o.pen) {
      const seg = 10;
      part('cyl', r * 0.9, r * 0.8, { ink, look: LOOK.SOLID, seg });                 // the plug
      part('cyl', len, r, { ink, look, seg });
      part('cyl', r * 2.4, r, { rTop: r * 0.42, ink: INK.PEN, look: LOOK.WRAP, seg });
      part('cone', r * 1.3, r * 0.42, { ink: INK.BLACK, look: LOOK.SOLID, seg: 8 });   // the nib
      return at(s);
    }
    const seg = 6;
    if (o.eraser !== false) {
      part('cyl', r * 1.3, r * 0.93, { ink: INK.PINK, seg: 10 });
      part('cyl', r * 1.5, r * 1.02, { ink: INK.BLACK, seg: 10 });   // the ferrule
    }
    part('cyl', len, r, { ink, look, seg });
    // The sharpened wood: bare, so the point is the one dark thing at the end.
    // Its hexagon lines up with the barrel's, both being cut with six sides
    // from the same starting angle.
    part('cyl', r * 2.6, r, { rTop: r * 0.34, ink: INK.PEN, lift: 0.3, seg });
    part('cone', r * 0.95, r * 0.34, { ink: INK.BLACK, look: LOOK.SOLID, seg });
    return at(s);
  }

  /**
   * A ring. Collides as the chain of capsules it is drawn as — which is not an
   * approximation of a torus but a better description of one: three.js builds
   * it from `seg` straight tube sections, and capsules through the same
   * vertices sit inside the same ink.
   *
   * It matters that this leaves the HOLE open. The binder's rings are "arches
   * you can run and shoot through", and a ring that collided as its bounding
   * box would be a wall.
   */
  torus(x, y, z, r, tube, o = {}) {
    const seg = o.seg ?? 20;
    const rseg = o.rseg ?? 6;
    const arc = o.arc ?? Math.PI * 2;
    const g = new THREE.TorusGeometry(r, tube, rseg, seg, arc);
    if (o.axis === 'y') g.rotateX(Math.PI / 2);
    else if (o.axis === 'x') g.rotateY(Math.PI / 2);
    if (o.rotZ) g.rotateZ(o.rotZ);
    if (o.rotY) g.rotateY(o.rotY);
    g.translate(x, y, z);
    this._push(g, o);
    const b = basisOf([
      ['x', o.axis === 'y' ? Math.PI / 2 : 0],
      ['y', o.axis === 'x' ? Math.PI / 2 : 0],
      ['z', o.rotZ], ['y', o.rotY],
    ]);
    const rr = tube * Math.cos(Math.PI / rseg);
    const ring = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * arc;
      ring.push(new THREE.Vector3(x, y, z)
        .addScaledVector(b.ex, Math.cos(a) * r)
        .addScaledVector(b.ey, Math.sin(a) * r));
    }
    // An arc that does not close is drawn with OPEN ends — three.js puts no
    // cap on them — so the ring is shortened by a tube radius at each end, or
    // the round end of the last capsule bulges out past the last of the ink.
    // A radius can be several segments' worth when the ring is finely cut, so
    // this walks the arc rather than nudging one vertex.
    if (arc < Math.PI * 2 - 1e-6) { trimEnd(ring, rr); ring.reverse(); trimEnd(ring, rr); }
    for (let i = 1; i < ring.length; i++) {
      const c = { shape: 'capsule', c: ring[i - 1].clone().lerp(ring[i], 0.5),
        aEnd: ring[i - 1], bEnd: ring[i], r: rr,
        turned: false, ex: UNIT.x, ey: UNIT.y, ez: UNIT.z, openEnds: false, tag: o.tag, obj: this.current,
        ghost: o.ghost, hits: roleOf(o), min: new THREE.Vector3(), max: new THREE.Vector3() };
      bounds(c);
      (o.solid === false ? this.ghosts : this.colliders).push(c);
    }
    return this;
  }

  /**
   * A hollow round wall: a pot, a cup. Base-centred on x,y,z, `r` to the
   * corners of its outside, walls `thick` deep, `h` tall, cut with `seg` sides.
   * You can stand on its rim, fall in, and walk out through `door`, if it has
   * one: `{ at, h }`, the angle from +z toward +x the doorway faces and how
   * tall it is. A door is one side of the polygon wide.
   *
   * Drawn as an outside, an inside turned to face in, a flat rim and a lintel,
   * so the curve shades smoothly as the cylinders always did. It collides as
   * one box per side, each the trapezoid of wall behind that side less its
   * outer corners: inside the ink, and a body is far too wide to get into the
   * wedge between two of them.
   */
  tube(x, y, z, r, thick, h, o = {}) {
    const seg = o.seg ?? 16;
    const step = (Math.PI * 2) / seg;
    const ri = r - thick / Math.cos(step / 2);           // inner corners, walls `thick` deep
    const door = o.door;
    // the side the door is in: the one whose middle is nearest `door.at`
    const di = door ? ((Math.round(door.at / step - 0.5) % seg) + seg) % seg : -1;
    const geos = [];
    const wall = (rad, y0, hh, from, n, inward) => {
      const g = new THREE.CylinderGeometry(rad, rad, hh, n, 1, true, from, n * step);
      if (inward) flipFaces(g);
      g.translate(0, y0 + hh / 2, 0);
      geos.push(g);
    };
    for (const inward of [false, true]) {
      const rad = inward ? ri : r;
      if (di < 0) wall(rad, 0, h, 0, seg, inward);
      else {
        wall(rad, 0, h, (di + 1) * step, seg - 1, inward);
        wall(rad, door.h, h - door.h, di * step, 1, inward);
      }
    }
    // A RingGeometry's k-th corner sits a quarter turn behind a cylinder's,
    // so starting it at -90 degrees puts the rim's corners on the walls'.
    const rim = new THREE.RingGeometry(ri, r, seg, 1, -Math.PI / 2, Math.PI * 2);
    rim.rotateX(-Math.PI / 2);
    rim.translate(0, h, 0);
    geos.push(rim);
    if (di >= 0) {
      // the door's two sides: the wall's thickness, seen through the doorway
      for (const [a, sgn] of [[di * step, 1], [(di + 1) * step, -1]]) {
        const s = Math.sin(a), c = Math.cos(a);
        geos.push(quad(
          [s * ri, 0, c * ri], [s * r, 0, c * r], [s * r, door.h, c * r], [s * ri, door.h, c * ri],
          [c * sgn, 0, -s * sgn]));
      }
      const lintel = new THREE.RingGeometry(ri, r, 1, 1, Math.PI / 2 - (di + 1) * step, step);
      lintel.rotateX(Math.PI / 2);
      lintel.translate(0, door.h, 0);
      geos.push(lintel);
    }
    for (const g of geos) g.translate(x, y, z);
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    this._push(merged, o);

    // One box per side, as described above. Its outer face is the side's own
    // face, its inner face the inner wall's, and it is as wide as the inner
    // face: the outer corners it leaves out are slivers too narrow for a body.
    const ao = r * Math.cos(step / 2), ai = ri * Math.cos(step / 2);
    const half = ai * Math.tan(step / 2);
    const { place, ...rest } = o;
    let rimSide = null;
    for (let i = 0; i < seg; i++) {
      const a = (i + 0.5) * step;                        // the side's middle, from +z toward +x
      const m = (ao + ai) / 2;
      const y0 = i === di ? door.h : 0;
      const c = this._solid('box', x + Math.sin(a) * m, y + (y0 + h) / 2, z + Math.cos(a) * m, [['y', a]],
        { hx: half, hy: (h - y0) / 2, hz: (ao - ai) / 2 }, rest);
      if (i !== di && !rimSide) rimSide = c;
    }
    // `reach` walks to a place's top; the rim's is any full side's, so it names one
    if (place && o.solid !== false) this.places.push({ name: place, collider: rimSide });
    this.tubes.push({ x, y, z, r, ri, h, door: di >= 0 ? { at: (di + 0.5) * step, h: door.h } : null });
    return { ri, ao, ai, doorAt: di >= 0 ? (di + 0.5) * step : null };
  }

  /**
   * A bent wire through `pts` (Vector3s): a paperclip, a spring. Drawn as one
   * tube along the polyline; collides, unless it is a ghost, as a capsule per
   * straight run, which is what it is drawn as.
   */
  wire(pts, r, o = {}) {
    const path = new THREE.CurvePath();
    for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    const g = new THREE.TubeGeometry(path, Math.max(2, (pts.length - 1) * (o.sub ?? 1)), r, o.rseg ?? 5, false);
    if (this._wraps(o)) {
      // round the wire: each ring of the tube takes the tangent of its path
      // point, so the lines go round the bends as well as the straights
      const rs = (o.rseg ?? 5) + 1;
      const a = new Float32Array(g.attributes.position.count * 3);
      g.tangents.forEach((t, i) => { for (let j = 0; j < rs; j++) a.set([t.x, t.y, t.z], (i * rs + j) * 3); });
      g.setAttribute('aAxis', new THREE.BufferAttribute(a, 3));
    }
    this._push(g, o);
    for (let i = 1; i < pts.length; i++) {
      const c = { shape: 'capsule', c: pts[i - 1].clone().lerp(pts[i], 0.5),
        aEnd: pts[i - 1].clone(), bEnd: pts[i].clone(), r: r * Math.cos(Math.PI / (o.rseg ?? 5)),
        turned: false, ex: UNIT.x, ey: UNIT.y, ez: UNIT.z, openEnds: false, tag: o.tag, obj: this.current,
        ghost: o.ghost, hits: roleOf(o), min: new THREE.Vector3(), max: new THREE.Vector3() };
      bounds(c);
      (o.solid === false ? this.ghosts : this.colliders).push(c);
    }
    return this;
  }

  /**
   * Flat strokes of ink on a plane: a drawing on something. `strokes` is a list
   * of 2-D polylines in the plane's own units, `origin` the plane's lower-left
   * corner, `u` and `v` its right and up (Vector3s, as long as one unit), `n`
   * the way it faces. Each stroke is a ribbon `width` wide raised `raise` off
   * the plane, so the drawing is the same pens and the same outline pass as
   * the rest of the map, not a texture. Never collides.
   */
  strokes(strokes, origin, u, v, n, width, o = {}) {
    const pos = [], idx = [];
    const P = (x, y, s) => new THREE.Vector3().copy(origin).addScaledVector(u, x).addScaledVector(v, y).addScaledVector(n, s);
    const lift = o.raise ?? 0.03;
    for (const st of strokes) {
      const w = (st.w ?? 1) * width;
      for (let i = 1; i < st.p.length; i++) {
        const [x0, y0] = st.p[i - 1], [x1, y1] = st.p[i];
        let dx = x1 - x0, dy = y1 - y0;
        const L = Math.hypot(dx, dy) || 1;
        dx /= L; dy /= L;
        // a square cap each end, half a width out, so strokes join at corners
        const ex = dx * w / 2, ey = dy * w / 2, px = -dy * w / 2, py = dx * w / 2;
        const a = P(x0 - ex + px, y0 - ey + py, lift), b = P(x0 - ex - px, y0 - ey - py, lift);
        const c = P(x1 + ex - px, y1 + ey - py, lift), d = P(x1 + ex + px, y1 + ey + py, lift);
        // wound so the quad faces `n`: the pass culls back faces
        const k = pos.length / 3;
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
        const face = V.subVectors(b, a).cross(_s.subVectors(c, a)).dot(n) > 0;
        idx.push(...(face ? [k, k + 1, k + 2, k, k + 2, k + 3] : [k, k + 2, k + 1, k, k + 3, k + 2]));
      }
    }
    // Indexed, with normals and uvs, like every other primitive: a bucket is
    // merged in one go and mergeGeometries wants them all alike.
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const nrm = new Float32Array(pos.length);
    for (let i = 0; i < nrm.length; i += 3) { nrm[i] = n.x; nrm[i + 1] = n.y; nrm[i + 2] = n.z; }
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
    g.setIndex(idx);
    const { raise, ...pen } = o;
    this._push(g, { look: LOOK.SOLID, ...pen });
    return this;
  }

  /**
   * Low ground with walls round it on purpose — the inside of the pencil cup,
   * which you fall into and walk out of by its one small door. `npm run reach`
   * reports it by name and leaves it out of the pocket gate, which is for
   * pockets nobody meant.
   */
  room(x, z, r, name) { this.rooms.push({ x, z, r, name }); return this; }

  sphere(x, y, z, r, o = {}) {
    const seg = o.seg ?? 12, seg2 = o.seg2 ?? 8;
    const g = new THREE.SphereGeometry(r, seg, seg2);
    if (o.squash) g.scale(1, o.squash, 1);
    g.translate(x, y, z);
    this._push(g, o);
    // the deepest a quad of the drawn hull sits inside the true sphere
    const ins = Math.cos(Math.PI / Math.min(seg, seg2 * 2));
    this._solid('ball', x, y, z, [],
      { hx: r * ins, hy: r * (o.squash ?? 1) * ins, hz: r * ins }, o);
    return this;
  }

  /**
   * A hill: a squashed ellipsoid sunk into the floor, so what shows is a dome
   * `radius` across at its foot and `height` tall, meeting the floor at `y`
   * (default 0) no steeper than `slope` degrees (default 35).
   *
   * Platforms need to be more like hills so that enemies won't just surround
   * you and trap you in. A box is a wall you go round; this is ground
   * you walk up and over from any side, and so can whatever is chasing you.
   *
   * It needs no new physics. An ellipsoid is already an exact collider, so
   * feet and bullets both land on the ink, and it is in `ramps`, so walking
   * down it keeps you on it. The steepest point of a sunken ellipsoid is where
   * it meets the floor, and sinking it deeper makes that shallower, so the sink
   * is solved for: a rim at `slope` needs `height * height / (radius * tan -
   * 2 * height)`. That has an answer only while `height` is under
   * `radius * tan / 2` — 0.35 of the radius at 35 degrees — and a taller one
   * throws, as a steep staircase does.
   *
   * Only the cap above the floor is drawn, so every row of the mesh is spent
   * where it can be seen.
   */
  mound(x, z, radius, height, o = {}) {
    const y = o.y ?? 0;
    const tan = Math.tan(((o.slope ?? 35) * Math.PI) / 180);
    if (radius * tan <= 2 * height) {
      throw new Error(`mound at ${x}, ${z}: ${height} m is too tall for ${radius} m across at ${o.slope ?? 35} degrees`);
    }
    const sink = (height * height) / (radius * tan - 2 * height);
    const c = height + sink;                                        // vertical semi-axis
    const a = (radius * c) / Math.sqrt(height * (height + 2 * sink)); // horizontal
    const seg = o.seg ?? 28, seg2 = o.seg2 ?? 10;
    const cap = Math.acos(sink / c);
    const g = new THREE.SphereGeometry(1, seg, seg2, 0, Math.PI * 2, 0, cap);
    g.scale(a, c, a);
    g.translate(x, y - sink, z);
    // A dome no steeper than 35 degrees faces the light almost everywhere, so
    // on the plain hatch ramp it comes out as a bare outline on the desk, and
    // from above it reads as a circle drawn on the page, not a hill. Its shade
    // only spans about 0.69 to 1, so the ramp is stretched over that: bare on
    // the lit side, cross-hatched down the side away from the light.
    this._push(g, { contrast: 2, lift: -1.15, ...o });
    // The deepest a quad of the drawn cap sits inside the true surface, as a
    // fraction of the ellipsoid: half a row down, and half a column across
    // the widest ring of the cap, which is the rim.
    const ins = Math.cos(cap / (2 * seg2)) * Math.cos((Math.sin(cap) * Math.PI) / seg);
    // cut flat at the floor: only the cap is drawn, so only the cap is solid
    const col = this._solid('ball', x, y - sink, z, [], { hx: a * ins, hy: c * ins, hz: a * ins, cut: sink }, o);
    if (col.hits !== 'rays' && o.solid !== false) this.ramps.push(col);
    return this;
  }

  /**
   * A walkable slope. `dir` is '+x' | '-x' | '+z' | '-z' (the uphill direction).
   * Length is along dir, width across it.
   *
   * There is no ramp collision model: a ramp is a box tipped about a horizontal
   * axis, and the column test runs the body's own column through it, so the
   * height you stand at follows the slope exactly. `this.ramps` keeps a
   * REFERENCE to that same collider, purely so stepBody can magnet you to it
   * while walking downhill.
   *
   * Every one of the four rotation signs used to be inverted, so the slab was
   * drawn sloping the opposite way to the surface the body walked on; both
   * ramps on THE DESK were mirrored about their own midpoint. And `len` is the
   * FOOTPRINT, which is what every height lookup means by it, so the slab has
   * to be its own hypotenuse long or its horizontal projection falls a metre
   * short at each end.
   */
  ramp(x, y, z, dir, len, width, o = {}) {
    const rise = o.rise ?? 0.4;
    const h = len * rise;
    const thick = o.thick ?? 0.5;
    const along = dir === '+x' || dir === '-x';
    const slope = Math.hypot(len, h);
    const g = new THREE.BoxGeometry(along ? slope : width, thick, along ? width : slope);
    const ang = Math.atan2(h, len);
    const rz = along ? (dir === '+x' ? ang : -ang) : 0;
    const rx = along ? 0 : (dir === '+z' ? -ang : ang);
    if (along) g.rotateZ(rz); else g.rotateX(rx);
    g.translate(x, y + h / 2, z);
    this._push(g, o);
    const c = this._solid('box', x, y + h / 2, z, [['z', rz], ['x', rx]], {
      hx: (along ? slope : width) / 2, hy: thick / 2, hz: (along ? width : slope) / 2,
    }, o);
    if (c.hits !== 'rays' && o.solid !== false) this.ramps.push(c);
    return this;
  }

  /**
   * A flight of stairs that walks like a ramp. `dir` is the uphill direction as
   * in ramp(); `len` is the run and `rise` the height it climbs.
   *
   * Drawn stairs used to be what you walked on, and no staircase on THE DESK
   * could be walked up: nothing checked the riser against the 0.55 m a body
   * steps, and the binder's were 1.75 m. Even a legal riser walks badly — the
   * eye jumps up a tread at a time, and going down you leave the ground at
   * every one.
   *
   * So the two jobs are split (see `solid` above):
   *   * the TREADS are drawn, and ray-only: they still stop bullets and
   *     sightlines exactly where the ink is;
   *   * FEET walk on one body-only slab laid along the treads' midline, with a
   *     flat half tread at the top. The midline is half a riser from every
   *     tread, and the riser count is derived so that is never more than
   *     0.23 m. The slab is in `ramps`, so going down keeps you on it;
   *   * under the slab, a body-only block per tread, so you cannot walk into the
   *     side of the flight under a slab a few centimetres thick. Each is sunk
   *     below the slab by a body's radius of slope: the column test widens a
   *     tipped box along its own tilt, so under a body's centre the slab is
   *     that much lower than the top of an upright block its edge already
   *     touches — and a block that stood higher than the slab refused the step
   *     on to it, for want of headroom.
   *
   * A flight steeper than 40 degrees throws: there is no riser count that
   * makes a ladder walk.
   */
  stairs(x, y, z, dir, len, width, rise, o = {}) {
    const deg = (Math.atan2(rise, len) * 180) / Math.PI;
    if (deg > STAIR.maxSlope) {
      throw new Error(`stairs at ${x}, ${y}, ${z}: ${deg.toFixed(1)} degrees is steeper than ${STAIR.maxSlope}`);
    }
    const n = Math.max(1, Math.ceil(rise / STAIR.riser - 1e-9));
    const sl = len / n, sh = rise / n;
    const along = dir === '+x' || dir === '-x';
    const sign = dir === '-x' || dir === '-z' ? -1 : 1;
    // `a` is the distance along the flight from its foot
    const wx = (a) => (along ? x + sign * (a - len / 2) : x);
    const wz = (a) => (along ? z : z + sign * (a - len / 2));
    const dims = (run, hy) => (along ? { hx: run / 2, hy, hz: width / 2 } : { hx: width / 2, hy, hz: run / 2 });
    const { place, ...pen } = o;          // a flight is a way to a place, not one
    const tag = o.tag ?? 'stairs';

    for (let i = 0; i < n; i++) {
      const a = sl * (i + 0.5);
      this.box(wx(a), y, wz(a), along ? sl : width, sh * (i + 1), along ? width : sl, { ...pen, tag, solid: 'rays' });
    }

    // the slab: its TOP runs from half a riser up at the foot to the full rise
    // over the middle of the last tread
    const ang = Math.atan2(sh, sl);
    const run = len - sl / 2;
    const slope = Math.hypot(run, rise - sh / 2);
    const sink = STAIR.bodyR * Math.tan(ang);
    const thick = (sh + sink) * Math.cos(ang) + 0.05;   // no gap down to the blocks
    const ac = run / 2 + (thick / 2) * Math.sin(ang);
    const yc = y + sh / 2 + (rise - sh / 2) / 2 - (thick / 2) * Math.cos(ang);
    const rz = along ? (dir === '+x' ? ang : -ang) : 0;
    const rx = along ? 0 : (dir === '+z' ? -ang : ang);
    const slab = this._solid('box', wx(ac), yc, wz(ac), [['z', rz], ['x', rx]],
      dims(slope, thick / 2), { solid: 'bodies', tag });
    this.ramps.push(slab);
    this._solid('box', wx(len - sl / 4), y + rise - sh / 2, wz(len - sl / 4), [],
      dims(sl / 2, sh / 2), { solid: 'bodies', tag });
    for (let i = 0; i < n; i++) {
      const h = (i + 0.5) * sh - sink;
      if (h < 0.02) continue;
      this._solid('box', wx(sl * (i + 0.5)), y + h / 2, wz(sl * (i + 0.5)), [], dims(sl, h / 2), { solid: 'bodies', tag });
    }

    this.flights.push({
      foot: new THREE.Vector3(wx(0), y, wz(0)),
      top: new THREE.Vector3(wx(len), y + rise, wz(len)),
      up: along ? [sign, 0] : [0, sign],
      width, risers: n, riser: sh, slope: deg,
    });
    return this;
  }

  /**
   * A ladder up a wall. (x, y, z) is its foot, ON the face of the wall;
   * `facing` is the way the ladder faces, out from the wall toward whoever
   * climbs it — '+x' | '-x' | '+z' | '-z', or an angle from +z toward +x for a
   * round wall. `height` is the climb, from the foot to the top you get off on.
   *
   * Drawn as two rails and rungs in ink the map already uses, so a ladder
   * costs no draw calls. The rails are ray-only — a bullet stops on them and a
   * body climbs past them — and the rungs are too thin to matter to either.
   * The rails stand 0.7 m proud of the top, so you can see from up there where
   * a ladder comes up.
   *
   * What it registers is a volume in front of the wall, in `ladders`, which
   * Player and Enemies read. Nothing here collides with a body.
   */
  ladder(x, y, z, facing, height, o = {}) {
    const [nx, nz] = facingOf(facing);
    const tx = -nz, tz = nx;
    const w = o.width ?? 1.1;
    const rotY = Math.atan2(-nx, -nz);        // turns a box's local +x onto the tangent
    const pen = { ink: o.ink ?? INK.PEN, look: LOOK.SOLID, rotY, tag: 'ladder' };
    const off = 0.08;
    const tall = height + 0.7;
    for (const s of [-1, 1]) {
      this.box(x + tx * s * w / 2 + nx * off, y, z + tz * s * w / 2 + nz * off, 0.12, tall, 0.14,
        { ...pen, solid: 'rays' });
    }
    for (let h = 0.38; h < tall - 0.15; h += 0.42) {
      this.box(x + nx * off, y + h, z + nz * off, w, 0.07, 0.07, { ...pen, solid: false, ghost: 'ladder' });
    }
    this.ladders.push({
      foot: new THREE.Vector3(x, y, z), height, top: y + height,
      nx, nz, tx, tz,
      halfWidth: w / 2 + 0.2,       // how far along the wall from its middle you can still hold on
      rest: 0.5,                // a climber's feet sit this far out from the wall
      depth: 1.1,               // and it lets go past this
      name: o.name,
    });
    return this;
  }

  /**
   * Is (x,z) clear of every collider, with `pad` metres to spare?
   * `headroom` also rejects anywhere with something directly overhead — a spot
   * can be perfectly walkable and still be a bad place to start, because you
   * spawn looking at the underside of a bridge.
   */
  isOpen(x, z, pad = 1.2, maxY = 3, headroom = 0) {
    for (const c of this.colliders) {
      const span = touchesColumn(c, x, z, pad);
      if (!span) continue;
      if (span.hi >= 0.2 && span.lo <= maxY) return false;
      if (headroom && span.lo > maxY && span.lo < headroom) return false;
    }
    return true;
  }

  /**
   * Points on genuinely open ground, spread out. Hand-placed spawn rings drift
   * into the furniture as a map changes — this asks the colliders instead, which
   * is the difference between spawning on the desk and spawning inside a book.
   */
  openPoints(count, { radius = 30, pad = 2.0, minSep = 8, y = 0.2, prefer = 'outer', headroom = 0 } = {}) {
    const cand = [];
    const step = 2;
    for (let x = -radius; x <= radius; x += step) {
      for (let z = -radius; z <= radius; z += step) {
        if (Math.hypot(x, z) > radius) continue;
        if (this.isOpen(x, z, pad, 3, headroom)) cand.push([x, z]);
      }
    }
    // 'outer' rings the arena, which is what enemy spawns want. 'inner' hugs the
    // middle, which is what the player start wants — sorting outward put the
    // player in the far corner of the open ground, nose against a structure.
    const r2 = (p) => p[0] * p[0] + p[1] * p[1];
    cand.sort((a, b) => (prefer === 'inner' ? r2(a) - r2(b) : r2(b) - r2(a)));
    const out = [];
    for (const [x, z] of cand) {
      if (out.length >= count) break;
      if (out.some((p) => Math.hypot(p.x - x, p.z - z) < minSep)) continue;
      out.push(new THREE.Vector3(x, y, z));
    }
    return out;
  }

  anchor(x, y, z) { this.anchors.push(new THREE.Vector3(x, y, z)); return this; }
  spawn(x, y, z) { this.spawns.push(new THREE.Vector3(x, y, z)); return this; }
  sniperNest(x, y, z) { this.snipers.push(new THREE.Vector3(x, y, z)); return this; }
  /** An item on the map. `name` says where, for `npm run reach`, which walks to every one. */
  pickupSpot(x, y, z, item, name) { this.pickupSpots.push({ pos: new THREE.Vector3(x, y, z), item, name }); return this; }

  /** Merge every bucket into one mesh each and add them to the scene. */
  finish(scene) {
    const meshes = [];
    for (const b of this.buckets.values()) {
      if (!b.geos.length) continue;
      const merged = mergeGeometries(b.geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, surface(b.opts));
      mesh.frustumCulled = true;
      scene.add(mesh);
      meshes.push(mesh);
      for (const g of b.geos) g.dispose();
    }
    this.buckets.clear();
    return {
      meshes,
      colliders: this.colliders,
      ghosts: this.ghosts,
      ramps: this.ramps,
      ladders: this.ladders,
      flights: this.flights,
      places: this.places,
      anchors: this.anchors,
      spawns: this.spawns,
      spawnPool: this.spawnPool,
      snipers: this.snipers,
      pickupSpots: this.pickupSpots,
      tubes: this.tubes,
      rooms: this.rooms,
      things: this.things,
      startPoint: this.startPoint,
      drawCalls: meshes.length,
    };
  }
}

export { INK, V };
