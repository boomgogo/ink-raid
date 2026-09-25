import * as THREE from 'three';
import { INK, LOOK } from '../render/palette.js';

// The toy train moves around on a train track; both enemy and player can hop
// on and stand on it.
//
// THE TRACK is a wooden toy track, 2.4 m wide and 0.3 m tall — under the 0.55 m
// a body steps, so it is never a wall and you walk over it anywhere. It runs
// round the whole arena in the band the bigger desk added, so it is a way round
// the back of everything rather than a barrier through the middle. It collides
// as drawn: a box per straight and eight chords per bend (0.1 m off the true
// curve at worst). The grooves and the joints between pieces are paint.
//
// TWO STATIONS stand on the inside of the east and west straights, their
// platforms at the height of a wagon's floor, with a ramp at each end. The
// train stops at each for five seconds, lined up so the wagons are at the
// platform, and the easy way on is to walk on.
//
// THE TRAIN is four cars, drawn and collided as mover bodies (world/movers.js):
// a locomotive whose cab you can stand in and whose roof is a moving high
// point, a tender, an open wagon whose sides are waist-high cover, and a flat
// wagon. It never turns red — red is the enemies' colour, and what
// tools/figures.mjs looks for. Its wheels are solid black discs, so there is no
// spoke to be seen not turning.
//
// Each car sits on two bogies a metre in from its ends, both on the track, so
// on a bend the car is the chord between them and the train bends round it
// like coupled cars.

export const TRAIN = {
  cruise: 6,          // m/s on a straight: a body sprints at 10.1, so it can be caught
  bend: 5,            // and round a bend
  accel: 2.5,         // m/s² pulling away...
  brake: 2.5,         // ...and into a station
  dwell: 5,           // s at a platform
  bed: 0.3,           // the track's height
  deck: 0.8,          // a wagon's floor, and a platform's top
  width: 2.8,         // a car across
  gauge: 2.4,         // the track across
};

// the cars, front to back: length, and how they are drawn
const CARS = [
  { name: 'locomotive', len: 7, draw: loco },
  { name: 'tender', len: 4, draw: tender },
  { name: 'open wagon', len: 6, draw: openWagon },
  { name: 'flat wagon', len: 6, draw: flatWagon },
];
const GAP = 0.6;

const Y = new THREE.Vector3(0, 1, 0);
const _a = { x: 0, z: 0, dx: 0, dz: 0, bend: false };
const _b = { x: 0, z: 0, dx: 0, dz: 0, bend: false };
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();

/**
 * Lay the track and the stations on the desk, with the map's Builder. Returns
 * the stations: each { name, x0, x1, z0, z1, stop } — the platform's footprint
 * and where the front of the train stops there, in metres round the track.
 */
export function layTrack(b, track) {
  const T = TRAIN;
  const deco = { solid: false, ghost: 'decor' };
  b.thing('track');
  const bed = { ink: INK.PEN, lift: 0.22, tag: 'track' };
  // the bed: one box per straight, eight chords per bend
  for (const p of track.pieces) {
    if (p.kind === 'line') {
      const mx = (p.from[0] + p.to[0]) / 2, mz = (p.from[1] + p.to[1]) / 2;
      const runX = Math.abs(p.to[0] - p.from[0]) > Math.abs(p.to[1] - p.from[1]);
      b.box(mx, 0, mz, runX ? p.len : T.gauge, T.bed, runX ? T.gauge : p.len, bed);
    } else {
      const n = 8;
      for (let i = 0; i < n; i++) {
        const a0 = p.a0 + ((p.a1 - p.a0) * i) / n, a1 = p.a0 + ((p.a1 - p.a0) * (i + 1)) / n;
        const x0 = p.c[0] + Math.cos(a0) * track.radius, z0 = p.c[1] + Math.sin(a0) * track.radius;
        const x1 = p.c[0] + Math.cos(a1) * track.radius, z1 = p.c[1] + Math.sin(a1) * track.radius;
        const len = Math.hypot(x1 - x0, z1 - z0) + 0.12;          // a hair long, so chords meet
        b.box((x0 + x1) / 2, 0, (z0 + z1) / 2, len, T.bed, T.gauge, { ...bed, rotY: -Math.atan2(z1 - z0, x1 - x0) });
      }
    }
  }
  // the grooves the wheels run in, and a joint between every piece of track
  const up = new THREE.Vector3(0, 1, 0), O = new THREE.Vector3(0, T.bed, 0);
  const U = new THREE.Vector3(1, 0, 0), V = new THREE.Vector3(0, 0, 1);
  const grooves = [];
  for (const off of [-0.62, 0.62]) {
    const pts = [];
    for (let s = 0; s <= track.length + 0.01; s += 1) {
      track.at(s, _a);
      pts.push([_a.x - _a.dz * off, _a.z + _a.dx * off]);
    }
    grooves.push({ p: pts });
  }
  b.strokes(grooves, O, U, V, up, 0.16, { ink: INK.PEN, raise: 0.02 });
  const joints = [];
  for (let s = 0; s < track.length; s += 6.3) {
    track.at(s, _a);
    const nx = -_a.dz, nz = _a.dx;
    joints.push({ p: [[_a.x - nx * 1.15, _a.z - nz * 1.15], [_a.x + nx * 1.15, _a.z + nz * 1.15]], w: 0.5 });
  }
  b.strokes(joints, O, U, V, up, 0.12, { ink: INK.PEN, raise: 0.02 });

  // the stations: where the front of the train stops, and the platform beside
  // the wagons then. The open wagon's middle is 15.2 m behind the front.
  const openBack = CARS[0].len + GAP + CARS[1].len + GAP + CARS[2].len / 2;
  const stations = [];
  for (const [name, side, z0, z1] of [['east station', 1, 14, 26], ['west station', -1, -26, -14]]) {
    const x = side * track.half, inner = x - side * (T.width / 2 + 0.15);
    const x0 = Math.min(inner, inner - side * 3), x1 = Math.max(inner, inner - side * 3);
    // heading -z on the east side and +z on the west: the open wagon at the
    // platform's middle-but-one metre, the flat wagon at its far end
    const zOpen = side > 0 ? z0 + 3.2 : z1 - 3.2;
    const zHead = zOpen - side * openBack;
    let stop = 0, best = Infinity;
    for (let s = 0; s < track.length; s += 0.05) {
      track.at(s, _a);
      const d = Math.hypot(_a.x - x, _a.z - zHead) + (Math.sign(_a.dz) === -side ? 0 : 99);
      if (d < best) { best = d; stop = s; }
    }
    b.thing(name);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    b.box(mx, 0, mz, x1 - x0, T.deck, z1 - z0, { ink: INK.PEN, tag: 'platform', place: name });
    // its edge, painted, and a ramp up at each end
    b.box(inner - side * 0.25, T.deck, mz, 0.3, 0.02, z1 - z0 - 0.3, { ...deco, ink: INK.ORANGE, look: LOOK.SOLID });
    // a slab 0.4 thick tipped 20 degrees: sunk by its own half-thickness so
    // its top starts at the desk and finishes level with the platform
    const sink = 0.2 / Math.cos(Math.atan2(T.deck, 2.2));
    b.ramp(mx, -sink, z1 + 1.1, '-z', 2.2, x1 - x0, { rise: T.deck / 2.2, ink: INK.PEN, thick: 0.4 });
    b.ramp(mx, -sink, z0 - 1.1, '+z', 2.2, x1 - x0, { rise: T.deck / 2.2, ink: INK.PEN, thick: 0.4 });
    // a board with the station's name on it: a post and a sign, as paint and wire
    const px = x0 === inner ? x1 - 0.3 : x0 + 0.3;
    b.box(px, T.deck, mz, 0.18, 3.2, 0.18, { ink: INK.BLACK, look: LOOK.SOLID, tag: 'sign' });
    b.box(px, T.deck + 3.2, mz, 0.12, 0.9, 3.4, { ink: INK.PEN, lift: 0.3, tag: 'sign' });
    stations.push({ name, x0, x1, z0: z0 - 2.2, z1: z1 + 2.2, stop });
  }
  return stations;
}

export class Train {
  /**
   * @param {Movers} movers
   * @param {Track} track
   * @param {{ stop: number }[]} stations  in the order the train reaches them
   */
  constructor(movers, track, stations) {
    this.track = track;
    this.stops = stations.map((s) => s.stop);
    this.cars = [];
    let back = 0;
    for (const def of CARS) {
      const body = movers.body(def.name, this);
      body.pushAside = true;
      def.draw(body.b, def.len);
      this.cars.push({ ...def, back: back + def.len / 2, body });
      back += def.len + GAP;
    }
    this.length = back - GAP;
    this.movers = movers;
    this.reset();
  }

  /** Parked at the first station, half-way through its stop. */
  reset() {
    this.next = 0;
    this.s = this.stops[0];
    this.v = 0;
    this.dwell = TRAIN.dwell * 0.5;
    this.place();
  }

  /** Metres from s to the next stop, going forwards. */
  ahead(s) {
    const L = this.track.length;
    return (((this.stops[this.next] - s) % L) + L) % L;
  }

  update(dt, toys) {
    const T = TRAIN;
    if (this.dwell > 0) {
      this.dwell -= dt;
      if (this.dwell <= 0) {
        this.next = (this.next + 1) % this.stops.length;
        toys?.emit('whistle', this.cars[0].body.pos);
      }
    } else {
      const d = this.ahead(this.s);
      const cruise = this.track.at(this.s, _a).bend ? T.bend : T.cruise;
      const want = Math.min(cruise, Math.sqrt(2 * T.brake * d));
      this.v += THREE.MathUtils.clamp(want - this.v, -T.brake * 2 * dt, T.accel * dt);
      if (this.v * dt >= d || (d < 0.05 && this.v < 0.3)) {
        this.s = this.stops[this.next];
        this.v = 0;
        this.dwell = T.dwell;
      } else {
        this.s = (this.s + this.v * dt) % this.track.length;
      }
    }
    this.place();
  }

  /** Every car on the track under the front at `this.s`. */
  place() {
    for (const car of this.cars) {
      const sc = this.s - car.back, h = car.len / 2 - 1;
      this.track.at(sc + h, _a);
      this.track.at(sc - h, _b);
      _pos.set((_a.x + _b.x) / 2, 0, (_a.z + _b.z) / 2);
      _quat.setFromAxisAngle(Y, Math.atan2(-(_a.z - _b.z), _a.x - _b.x));
      this.movers.setPose(car.body, _pos, _quat);
    }
  }

  /** The train takes no notice of being shot. */
  hit() {}
}

// --- the cars, each in its own frame: +x forwards, y up from the desk, z across

const W = TRAIN.width;
const chassis = (b, len, o = {}) => b.box(0, 0.45, 0, len, 0.35, W - 0.2, { ink: INK.BLACK, look: LOOK.SOLID, tag: 'chassis', ...o });
// Moving things draw in a handful of calls only if they share their pens: the
// whole train, the pendulum and the cradle use five (ink, style, shade)
// combinations between them — black fill, green, orange and blue panels, and
// one pen hatch at a shade bias of 0.1.
const deckTop = (b, len) => b.box(0, TRAIN.deck - 0.01, 0, len - 0.2, 0.02, W - 0.4,
  { ink: INK.PEN, lift: 0.1, solid: false, ghost: 'decor' });
function wheels(b, xs, r = 0.4) {
  for (const x of xs) {
    for (const z of [-W / 2 + 0.12, W / 2 - 0.12]) {
      b.cyl(x, TRAIN.bed + r, z, r, 0.14, { axis: 'z', ink: INK.BLACK, look: LOOK.SOLID, seg: 12, solid: false, ghost: 'decor' });
    }
  }
}
function couplings(b, len) {
  for (const s of [-1, 1]) {
    b.box(s * (len / 2 + 0.15), 0.52, 0, 0.3, 0.16, 0.5, { ink: INK.BLACK, look: LOOK.SOLID, solid: false, ghost: 'decor' });
  }
}

function loco(b, len) {
  chassis(b, len);
  wheels(b, [-2.3, 0.2, 2.2], 0.5);
  couplings(b, len);
  const green = { ink: INK.GREEN, look: LOOK.WASH, tag: 'loco' };
  const black = { ink: INK.BLACK, look: LOOK.SOLID, tag: 'loco' };
  // the boiler, the smokebox on its front and the chimney and dome on top
  b.cyl(1.05, 1.85, 0, 1.05, 4.6, { axis: 'x', seg: 14, ...green });
  b.cyl(3.45, 1.85, 0, 1.08, 0.2, { axis: 'x', seg: 14, ...black });
  b.cyl(2.6, 2.85, 0, 0.36, 1.0, { seg: 10, ...black });
  b.cyl(2.6, 3.85, 0, 0.48, 0.22, { seg: 10, ...black });
  b.sphere(0.6, 2.85, 0, 0.45, { seg: 10, seg2: 6, ...green });
  // the cab: a front plate behind the boiler, a post at each back corner, a
  // side panel over each doorway, and the roof. The doorways are 1.85 m high:
  // you walk in off the tender or the platform side.
  b.box(-1.35, TRAIN.deck, 0, 0.2, 2.7, W - 0.2, green);
  for (const z of [-1, 1]) {
    b.box(-3.35, TRAIN.deck, z * (W / 2 - 0.2), 0.2, 2.7, 0.2, black);
    b.box(-2.35, 2.65, z * (W / 2 - 0.2), 2.0, 0.85, 0.2, green);
  }
  b.box(-2.35, 3.5, 0, 2.5, 0.2, W, { ink: INK.BLACK, look: LOOK.SOLID, tag: 'cab roof' });
  // buffers on the front
  for (const z of [-0.8, 0.8]) b.cyl(len / 2 + 0.15, 0.62, z, 0.16, 0.3, { axis: 'x', seg: 8, ...black, solid: false, ghost: 'decor' });
  deckTop(b, len);
}

function tender(b, len) {
  chassis(b, len);
  wheels(b, [-1.1, 1.1]);
  couplings(b, len);
  b.box(0, TRAIN.deck, 0, len - 0.2, 1.6, W - 0.2, { ink: INK.GREEN, look: LOOK.WASH, tag: 'tender' });
  // coal heaped on top
  b.box(0, TRAIN.deck + 1.6, 0, len - 0.8, 0.3, W - 0.8, { ink: INK.BLACK, look: LOOK.SOLID, tag: 'coal' });
}

function openWagon(b, len) {
  chassis(b, len);
  wheels(b, [-1.9, 1.9]);
  couplings(b, len);
  deckTop(b, len);
  const side = { ink: INK.ORANGE, look: LOOK.WASH, tag: 'wagon side' };
  const h = 1.1, t = 0.2;
  for (const x of [-1, 1]) b.box(x * (len / 2 - t / 2), TRAIN.deck, 0, t, h, W - 0.2, side);
  // each long side has a door in the middle, 1.6 m wide, so you walk in
  const seg = (len - 1.6) / 2;
  for (const z of [-1, 1]) {
    for (const x of [-1, 1]) {
      b.box(x * (0.8 + seg / 2), TRAIN.deck, z * (W / 2 - 0.1 - t / 2), seg, h, t, side);
    }
  }
}

function flatWagon(b, len) {
  chassis(b, len, { ink: INK.BLUE, look: LOOK.WASH });
  wheels(b, [-1.9, 1.9]);
  couplings(b, len);
  deckTop(b, len);
  // a stake at each corner
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    b.box(x * (len / 2 - 0.3), TRAIN.deck, z * (W / 2 - 0.3), 0.16, 0.7, 0.16, { ink: INK.BLUE, look: LOOK.WASH, solid: false, ghost: 'decor' });
  }
}
