import * as THREE from 'three';
import { Builder } from './build.js';
import { touchesColumn } from '../core/physics.js';
import { INK, LOOK } from '../render/palette.js';
import { COSTUME, AUTHOR, SHEET } from './photo_author.js';
import { Track } from './track.js';
import { layTrack, Train, TRAIN } from './train.js';
import { Movers } from './movers.js';
import { Toys } from './toys.js';
import { layPendulum, Pendulum } from './pendulum.js';
import { layCradle, Cradle } from './cradle.js';

// THE DESK — "pens, books and a coffee ring".
//
// The drawings have climbed off the page onto the desk, and you are about four
// centimetres tall. Book stacks are the buildings, a ruler is the bridge, the
// pencil cup is the sniper tower, and the edge of the desk is the edge of the
// world.
//
// ---------------------------------------------------------------------------
// LAYOUT
//
// Two earlier passes failed in opposite directions: the first spread scenery
// thinly over a huge plain and read as nothing; the second packed it so tight
// you could not see across the arena. What was missing both times was not the
// amount of stuff but the SHAPE of the space between it. So this pass is laid
// out as a space first and decorated second:
//
//   * a PLAZA in the middle (the open notebook), low enough to walk straight
//     on to and open enough to see and be seen across;
//   * a RING of bare desk around it, the road, wide enough to run and dodge in;
//   * PERIMETER structures set back off the ring, each with its own way up
//     facing the plaza, so you never run into a blank face with nowhere to go;
//   * an UPPER route — ruler bridge, ledges, roofs — so height is a place you
//     travel through, not a dead end.
//
// Every structure obeys three rules learned from the failures:
//   1. it has a visible route up, from the side that faces the plaza;
//   2. it has a hole, an undercut or an overhang, because undersides are where
//      the ink pass gets its dark faces and a page of pure outline reads flat;
//   3. you can walk all the way round it.
//
// And one learned from a playtest, "platforms need to be more like hills so
// that enemies won't just surround you and trap you in":
//   4. no POCKETS. Falling costs nothing here, so height is not the trap; walls
//      are. Low ground boxed in on three sides, a corridor between a structure
//      and the edge of the desk, a low platform with one way up: each is a
//      place a crowd seals you into. `npm run reach` measures pocket area and
//      fails the map if it creeps back. Where a wall is low it becomes a slope
//      (b.mound, b.ramp); where it is tall, the corridor beside it is closed.
//
// ---------------------------------------------------------------------------
// SHADING
//
// Leave `lift` at 0 almost everywhere. The half-lambert against the fixed
// world light means faces pointing -x/-z shade and faces pointing +x/+z stay
// blank: a lit side and a shaded side on everything. A positive lift
// brightens a face out of the shading ramp entirely, so it is only for surfaces
// that should read as bare paper — the desk top, the open pages.
//
// INK
//
// The pen (INK.PEN, a black ballpoint) is the world. Orange, green, pink, blue
// and the heavy black are accents and must stay rare: one big orange object
// (the ruler), the pencils, the pens, and a scatter of small ones. Get this
// wrong and the page stops looking like one pen drew it. The world was blue
// biro until black was asked for, with blue kept as an accent.

// The desk needed to be a bit bigger to accommodate the train, the pendulum
// and the cradle. It was 80 m across. The
// arena inside the old edge is as it was, to the metre, and the new 12 m band
// all round it is where the track runs and the toys stand.
const DESK = 52;        // half-extent of the desk surface
const EDGE = DESK - 1;  // past this you are off the page
const OLD_EDGE = 40;    // where the desk ended before the band: the arena is inside it
const RING = 25;        // structures are set back to about here
// The train's loop: 46 m out, bends 20 m across, so the band between the old
// edge and the track is 4.5 m of open desk, and the corners outside the bends
// have room for the toys.
const TRACK = { half: 46, radius: 20 };

export function buildDesk(scene) {
  const b = new Builder();

  // --- the desk surface ----------------------------------------------------
  // Deliberately bright: the desk is bare paper, and seen at a grazing angle it
  // must draw NOTHING except where something sits on it. That is the outline
  // pass's hardest test, and the reason the floor is one enormous flat box.
  b.thing('desk');
  b.box(0, -3, 0, DESK * 2, 3, DESK * 2, { ink: INK.PEN, lift: 0.30, tag: 'desk' });
  deskItself(b);

  notebookPlaza(b);
  northStack(b);
  eastBinder(b);
  southDispenser(b);
  westMug(b);
  pencilCup(b);
  stapler(b);
  eraserSteps(b);
  bigPencil(b);
  rulerBridge(b);
  scatter(b);
  midGround(b);
  gluePillars(b);
  deskLamp(b);
  photoFrame(b);

  // --- the band round the old edge: the track, and the toys in its corners --
  const track = new Track(TRACK.half, TRACK.radius);
  const stations = layTrack(b, track);
  // Outside the two southern bends, each turned square to its corner's
  // diagonal so it swings along the corner and never out over the track.
  const toyAt = { pendulum: [-44.5, 44.5], cradle: [44.5, 44.5] };
  const pendulumFrame = layPendulum(b, ...toyAt.pendulum, (3 * Math.PI) / 4);
  const cradleFrame = layCradle(b, ...toyAt.cradle, Math.PI / 4);

  // --- spawns --------------------------------------------------------------
  // Asked for, not hand-placed: a fixed ring drifts into the furniture every
  // time the map moves, and an enemy that spawns inside a book stack is stuck.
  for (const p of b.openPoints(16, { radius: 34, pad: 2.2, minSep: 8 })) b.spawns.push(p);
  // The ring above is also where the establishing shots stand, so it stays put.
  // Enemies come in anywhere on open desk, 4 m apart: see WaveDirector.chooseEntry.
  // Not on the track, where the train would be through them, nor on a
  // platform's ramps.
  const clearOfTrack = (p) => track.distance(p.x, p.z) > TRAIN.width / 2 + 2.5
    && Object.values(toyAt).every(([x, z]) => Math.hypot(p.x - x, p.z - z) > 9);
  for (const p of b.openPoints(1000, { radius: 49, pad: 1.8, minSep: 4 })) if (clearOfTrack(p)) b.spawnPool.push(p);
  // Start on the ring road south of the plaza, looking up the arena. Verified
  // against the colliders rather than assumed, and falling back to the innermost
  // open ground if the map moves under it. Nothing lower than 10 m overhead: the
  // tape dispenser's lip is at 10.6, and from under it, looking up the arena,
  // it is out of the top of the frame.
  const wanted = new THREE.Vector3(0, 0.2, 15);
  const start = b.isOpen(wanted.x, wanted.z, 2.5, 3, 10)
    ? wanted
    : (b.openPoints(1, { radius: 18, pad: 2.5, prefer: 'inner', headroom: 14 })[0] || wanted);
  b.startPoint.copy(start).add(new THREE.Vector3(0, 0.1, 0));

  const level = b.finish(scene);

  // Then what moves. Its colliders go into the level after everything above
  // has asked the level where there is room, so nothing is placed round where
  // the train happens to be parked.
  const movers = new Movers();
  const train = new Train(movers, track, stations);
  const pendulum = new Pendulum(movers, pendulumFrame);
  const cradle = new Cradle(movers, cradleFrame);
  movers.finish(scene, level);
  level.movers = movers;
  level.toys = new Toys(movers, [train, pendulum, cradle]);
  level.pendulum = pendulum;
  level.cradle = cradle;
  level.track = track;
  level.train = train;
  level.stations = stations;
  level.edge = EDGE;
  level.killY = -18;
  // The menu camera's loop (world/flight.js): over the notebook, under the
  // north stack and out of its east side, up past the pencil cup, over the
  // ruler, down the west page, out past the double pendulum, along the south
  // of the desk over the train's track, past the Newton's cradle and back in.
  // `npm run collide` flies it, clear of everything the train and the toys
  // sweep through as well as everything that stands still.
  level.flight = [
    [0, 3.5, 17], [2, 3.4, 4], [0, 3.2, -14], [0, 3.0, -27], [6, 3.0, -34],
    [16.5, 4.5, -33], [15.5, 13, -39], [14.5, 20, -17], [8, 17, -6], [-8, 10, 3],
    [-17, 7.5, 11], [-28, 9, 26], [-30, 10, 40], [-12, 8, 48], [12, 8, 48],
    [30, 9, 40], [18, 6, 28], [6, 4.5, 24],
  ];
  level.name = 'THE DESK';
  level.blurb = 'pens, books and a coffee ring';
  return level;
}

// ---------------------------------------------------------------------------
// The plaza: an open notebook, low enough to step straight on to (0.5 against a
// 0.55 step height), so the middle of the map is somewhere you fight rather
// than something you climb.
function notebookPlaza(b) {
  const w = 13, d = 22, y = 0.5;
  b.thing('notebook');
  for (const sx of [-1, 1]) {
    b.box(sx * (w / 2 + 1.1), 0, 0, w, y, d, { ink: INK.PEN, lift: 0.28, rotY: sx * 0.01, tag: 'page' });
    for (let i = -4; i <= 4; i++) {
      b.box(sx * (w / 2 + 1.1), y - 0.02, i * 2.3, w - 2, 0.04, 0.07,
        { ink: INK.PEN, look: LOOK.SOLID, solid: false });
    }
  }
  // the spine: a low ridge, cover in the middle of an otherwise open plaza.
  // It lies on the desk. It was a bar 2.2 m across sunk 0.8 m into it.
  b.cyl(0, 0.75, 0, 0.75, d, { axis: 'z', ink: INK.PEN, seg: 10, solid: true, tag: 'spine' });

  // the drawing that climbed off the page — the only red until the enemies come
  b.torus(-8, y + 0.06, -5, 2.2, 0.14, { axis: 'y', ink: INK.RED, look: LOOK.SOLID, solid: false });
  b.box(-8, y, -1.6, 0.26, 0.05, 3.6, { ink: INK.RED, look: LOOK.SOLID, solid: false });
  b.torus(7, y + 0.06, 6, 1.6, 0.12, { axis: 'y', ink: INK.RED, look: LOOK.SOLID, solid: false, arc: Math.PI * 1.4 });

  // four propped-open page corners: chest-high cover at the plaza's corners,
  // angled so they break the long diagonals without blocking the crossing
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.box(sx * 12, y, sz * 9, 5.5, 2.2, 1.0, { ink: INK.PEN, rotY: sx * sz * 0.5, tag: 'corner' });
  }
}

// ---------------------------------------------------------------------------
// North: the big stack. An open ground floor on pillars — you run through it,
// and its ceiling is the map's largest guaranteed dark face.
function northStack(b) {
  const cx = 0, cz = -RING - 6;
  const w = 30, d = 17;
  b.thing('north stack');

  // (its four legs are glue sticks: see gluePillars)
  b.box(cx, 5.5, cz, w, 1.4, d, { ink: INK.PEN, tag: 'book', place: 'north stack, first floor' });

  // The green book's covers stand proud of its pages, and they are what you
  // stand on. They were ghosts, so the ledge round the green book and the roof
  // both had you 0.4 m deep in the drawn cover, up to the shins.
  //
  // Both the second and third floor of the 3-storey structure should be free
  // to navigate; a solid block would not do. The pages
  // were two solid blocks. Now each is a storey: its pages are walls with gaps
  // in every side, so you run through a floor as you run under the ground
  // floor, and a crowd can't seal you in. You walk in at floor level: the
  // stairs land on the first floor's terrace, and the first ladder lands on
  // the ledge, which is the top storey's floor.
  const firstFloor = pageWalls(b, cx, cz, 6.9, 4.2, (w - 4) / 2, (d - 3) / 2, {
    front: [[-13, -9], [-4, 1], [7.6, 13]],   // the ladder to the ledge climbs x 9
    back: [[-13, -8], [-3, 3], [8, 13]],
    sides: [[-7, -2.5], [2.5, 7]],
  });
  cover(b, cx, 11.1, cz, w - 1, d, (d - 3) / 2, cx + 9, { ink: INK.GREEN, tag: 'cover', place: 'north stack, ledge' });
  pageWalls(b, cx, cz, 11.5, 3.6, (w - 6) / 2, (d - 5) / 2, {
    front: [[-12, -9], [-5, 1.5], [3.6, 8]],  // the ruler runs in at x -2; the roof ladder climbs x 5
    back: [[-12, -7], [-2, 2], [7, 12]],
    sides: [[-6, -2], [2, 6]],
  });
  cover(b, cx, 15.1, cz, w - 3, d - 2, (d - 5) / 2, cx + 5, { ink: INK.GREEN, tag: 'cover', place: 'north stack, roof' });
  // A pillar of pages in the middle of each floor, holding the cover up and
  // something to fight round. A bookmark lies on the first floor, where you
  // can walk to it; a bandage on the top floor, because climbing pays.
  for (const sx of [-1, 1]) {
    b.box(cx + sx * 5, 6.9, cz, 1.8, 4.2, 1.8, { ink: INK.PEN, tag: 'book' });
    b.box(cx + sx * 4, 11.5, cz - 1, 1.6, 3.6, 1.6, { ink: INK.PEN, tag: 'book' });
  }
  b.box(cx - 1, firstFloor, cz + 1.5, 1.1, 0.05, 5, { ink: INK.RED, look: LOOK.SOLID, rotY: 0.3, tag: 'bookmark', place: 'north stack, first floor, inside' });
  b.pickupSpot(cx + 8.5, 11.9, cz - 2, 'bandage', 'north stack, top floor, inside');

  // The way up, facing the plaza: stairs to the first floor, and a ladder up
  // each book face from there, through a notch in the cover above it. The
  // stairs used to stop at 5.5, a metre and a half under the floor they led
  // to, and a second flight stood in mid-air in front of the stack at 41
  // degrees. There is no room for a walkable flight of eight metres on a ledge
  // a metre and a half deep, so it is ladders.
  b.stairs(cx - 9, 0, cz + d / 2 + 4.5, '-z', 9, 6, 6.9);
  b.ladder(cx + 9, 6.9, cz + (d - 3) / 2, '+z', 4.6, { name: 'north stack, to the ledge' });
  b.ladder(cx + 5, 11.5, cz + (d - 5) / 2, '+z', 4.0, { name: 'north stack, to the roof' });

  b.box(cx + w / 2 - 0.3, 5.6, cz, 0.4, 1.2, d - 1, { ink: INK.PEN, lift: 0.22, solid: false });

  roofClutter(b, cx, cz, 15.5, 1.3, { on: 'the north stack' });
  b.sniperNest(cx, 15.5, cz);
  // A bandage at the top of every ladder tower: climbing pays.
  b.pickupSpot(cx - 9, 15.5, cz - 3, 'bandage', 'north stack roof');
  b.anchor(cx, 16.5, cz + 4);
}

/**
 * The pages of a book as the walls of a storey: `hw` by `hd` about (cx, cz),
 * from `y` up `h`, 0.6 m thick, standing only along the given spans — x spans
 * for the front and back, z spans (from cz) for both ends — so every side has
 * a way through it. Each span's outside is ruled with page edges. Returns the
 * floor's height.
 */
function pageWalls(b, cx, cz, y, h, hw, hd, { front, back, sides }) {
  const t = 0.6;
  const edges = (x, z, len, runX, out) => {
    for (let k = y + 0.45; k < y + h - 0.2; k += 0.55) {
      b.box(x + (runX ? 0 : out * 0.01), k, z + (runX ? out * 0.01 : 0), runX ? len - 0.3 : t, 0.03, runX ? t : len - 0.3,
        { ink: INK.PEN, look: LOOK.SOLID, solid: false, ghost: 'decor' });
    }
  };
  for (const [sz, spans] of [[1, front], [-1, back]]) {
    for (const [x0, x1] of spans) {
      const z = cz + sz * (hd - t / 2);
      b.box(cx + (x0 + x1) / 2, y, z, x1 - x0, h, t, { ink: INK.PEN, tag: 'book' });
      edges(cx + (x0 + x1) / 2, z, x1 - x0, true, sz);
    }
  }
  for (const sx of [-1, 1]) {
    for (const [z0, z1] of sides) {
      const x = cx + sx * (hw - t / 2);
      b.box(x, y, cz + (z0 + z1) / 2, t, h, z1 - z0, { ink: INK.PEN, tag: 'book' });
      edges(x, cz + (z0 + z1) / 2, z1 - z0, false, sx);
    }
  }
  return y;
}

/**
 * A book cover, `w` by `d` and 0.4 thick, centred on (cx, cz), overhanging the
 * pages under it at the front — whose face is `pages` in front of cz — less a
 * notch there, 2.2 m wide at `notchX`, where a ladder comes up the face.
 *
 * An overhang is a ceiling: nothing climbs up into one. It is also the dark
 * underside the ink pass draws the front of the stack with, and without both of
 * them the stack's establishing shot lost a tenth of its ink.
 */
function cover(b, cx, y, cz, w, d, pages, notchX, o) {
  const back = cz - d / 2, face = cz + pages, front = cz + d / 2;
  const x0 = cx - w / 2, x1 = cx + w / 2, n0 = notchX - 1.1, n1 = notchX + 1.1;
  b.box(cx, y, (back + face) / 2, w, 0.4, face - back, o);
  const { place, ...strip } = o;
  b.box((x0 + n0) / 2, y, (face + front) / 2, n0 - x0, 0.4, front - face, strip);
  b.box((n1 + x1) / 2, y, (face + front) / 2, x1 - n1, 0.4, front - face, strip);
}

// ---------------------------------------------------------------------------
// East: a ring binder stood on end, its rings standing out of its face.
function eastBinder(b) {
  const cx = RING + 6, cz = 0, DECK = 14.2;
  b.thing('binder');
  // As deep as a lever-arch file, back to where the desk used to end. At 4.5 m
  // there was a 6 m strip behind it with the desk edge on the other side:
  // somewhere to be cornered and nothing else. Since the desk grew,
  // what is behind it is the open band the train runs in.
  b.box(cx + 3, 0, cz, 10.5, 18, 26, { ink: INK.PEN, tag: 'binder' });
  // The deck is at 13.6, so the ruler bridge rests on it: at 14 the ruler ran
  // 0.4 m into it.
  b.box(cx - 7, 0, cz - 11, 4, DECK - 0.6, 4, { ink: INK.PEN });
  b.box(cx - 7, 0, cz + 11, 4, DECK - 0.6, 4, { ink: INK.PEN });
  b.box(cx - 7, DECK - 0.6, cz, 4, 0.6, 26, { ink: INK.PEN, tag: 'binderdeck', place: 'binder deck' });

  // The rings stand just off the binder's face, too close for anyone to get
  // behind them. They stood 1.75 m out, and the bottom of each one is a
  // knee-high bar: with the pillars in front, that was a slot behind the rings
  // and a row of stalls in front of them, each one only backed out of.
  for (const z of [-8, 0, 8]) {
    // standing on the desk, not 0.3 m into it
    b.torus(cx - 3.2, 4.85, cz + z, 4.4, 0.42, { ink: INK.BLACK, rotY: Math.PI / 2, seg: 20 });
    b.anchor(cx - 3.2, 9.65, cz + z);
  }

  // Up the outside of a pillar. There was a staircase here, 14 m high in 8 m of
  // run: 60 degrees, risers of 1.75 m, and its top tread under the deck it led
  // to. At 40 degrees 14.6 m needs 17.4 m of run, and there is not that much
  // room between the binder and the ring road.
  b.ladder(cx - 9, 0, cz - 11, '-x', DECK, { name: 'binder' });
  b.sniperNest(cx - 7, DECK, cz);
  b.pickupSpot(cx - 6.5, DECK, cz - 9, 'bandage', 'binder deck');
  // the deck is 4 m wide and 26 long, not a roof, so the clutter is laid out
  // along it; laid out as for a roof it floated off both sides
  roofClutter(b, cx - 7, cz, DECK, 2.6, { sx: 0.2, sz: 2.2, size: 0.55, on: 'the binder deck' });
}

// ---------------------------------------------------------------------------
// South: a tape dispenser. Its curve is a ramp you run up, which gives the map
// one route to height that needs no stairs and no grapple.
//
// The ramp used to finish in mid-air over the ring road, 5.5 m in front of the
// deck it was drawn to reach, and it began on top of the 2.2 m base, which
// nothing got you on to. So: a short ramp on to the base at its east end, and
// the deck is the dispenser's cutting lip, out at the top of the ramp and
// hanging over the road. The roll still stands across the middle of the ramp;
// you run up either side of it.
function southDispenser(b) {
  const cx = 0, cz = RING + 5;
  b.thing('tape dispenser');
  // The base runs back to where the desk used to end: the 1.5 m gap behind it
  // was a corridor with a drop on one side and a wall on the other. Now it is
  // the open band the train runs in.
  b.box(cx, 0, cz + 4.75, 22, 2.2, 10.5, { ink: INK.PEN, tag: 'base' });
  // On to the base from both ends, each surface starting at the desk and ending
  // level with the top: the whole east end, and at the west end as much of it
  // as the big pencil's tip leaves clear.
  b.ramp(cx + 13.5, -0.27, cz + 4.75, '-x', 5, 10.5, { rise: 0.44, ink: INK.PEN, thick: 0.5 });
  b.ramp(cx - 13.5, -0.27, cz + 8, '+x', 5, 4, { rise: 0.44, ink: INK.PEN, thick: 0.5 });
  b.ramp(cx, 2.2, cz - 3, '-z', 14, 9, { rise: 0.62, ink: INK.PEN, thick: 0.6 });
  // the lip, level with where the ramp's surface ends, overlapping it a little
  // so the one runs on to the other
  const ramp = b.ramps[b.ramps.length - 1];
  const back = cz - 10 + 0.3;
  const top = touchesColumn(ramp, cx, back + 0.05, 0).hi;
  b.box(cx, top - 0.5, back - 3.4, 10, 0.5, 6.8, { ink: INK.PEN, tag: 'tapedeck', place: 'tape dispenser lip' });
  // the roll itself: a big black torus, the one strong dark shape south. Its
  // foot is on the desk inside the base; it went 0.9 m through the desk.
  b.torus(cx, 8.45, cz + 5, 6.5, 1.9, { axis: 'x', ink: INK.BLACK, seg: 22, rseg: 8 });
  b.cyl(cx, 4.95, cz + 5, 2.2, 5, { axis: 'x', ink: INK.PEN, seg: 14, tag: 'hub' });
  b.sniperNest(cx, top, back - 3.4);
  b.pickupSpot(cx + 3.5, top, back - 3.4, 'bandage', 'tape dispenser lip');
  b.anchor(cx, top + 1.1, back - 3.4);
}

// ---------------------------------------------------------------------------
// West: the mug. A landmark and a grapple destination, with sugar cubes to
// climb so it is not grapple-only. It stood at the very edge of the desk: 2 m
// in from it, the gap behind was a corridor with a 13 m wall on one side and a
// fall off the page on the other. The desk has grown since, and behind it is
// the open band the train runs in.
function westMug(b) {
  const cx = -RING - 7, cz = 0;
  b.thing('mug');
  b.cyl(cx, 0, cz, 8, 13, { ink: INK.PEN, seg: 22, open: true, solid: true, tag: 'mug', place: 'mug rim' });
  b.cyl(cx, 12.4, cz, 7.9, 0.5, { ink: INK.BLACK, seg: 22, solid: false });      // the coffee
  // The handle: half a ring standing out of the wall, both ends in it. It was a
  // tilted ring with both open ends hanging in the air, and a bullet that went
  // into one stopped on nothing drawn.
  b.torus(cx + 7.95, 7, cz, 4, 0.7, { ink: INK.PEN, arc: Math.PI, rotZ: -Math.PI / 2 });
  b.anchor(cx, 14.5, cz);
  b.anchor(cx + 11, 8, cz);
  b.sniperNest(cx, 13.2, cz);
  b.pickupSpot(cx + 3, 13.2, cz - 3, 'bandage', 'mug rim');

  // A ladder up its side, facing the plaza, clear of the handle. The sugar
  // cubes stay: they are the quick way up for anyone who can jump.
  const up = 0.61;                                  // facing, from +z toward +x
  const rim = 8 * Math.cos(Math.PI / 22);
  b.ladder(cx + Math.sin(up) * rim, 0, cz + Math.cos(up) * rim, up, 13, { name: 'mug' });

  // The coffee ring it has left on the desk: paint, a flat stroke round the
  // foot of the mug. It was a torus half a metre thick, a kerb of solid
  // orange that the sharpener on the ring road stood in.
  const ring = Array.from({ length: 49 }, (_, i) => {
    const t = (i / 48) * Math.PI * 2, r = 10.5 + Math.sin(t * 3) * 0.15;
    return [cx + Math.cos(t) * r, cz + Math.sin(t) * r];
  });
  b.strokes([{ p: ring }], new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0), 1.0, { ink: INK.ORANGE, raise: 0.02 });
  // Each stands on the one below, its top where it always was: they were all
  // 2.4 m tall, stood 2.2 m apart, so each went 0.2 m into the one under it.
  const cubes = [[6, -9, 0, 2.4], [4.5, -12, 2.4, 2.2], [3.2, -14.5, 4.6, 2.2], [2.4, -16, 6.8, 2.2]];
  cubes.forEach(([s, dz, y, h], i) => {
    b.thing(`sugar cube ${i + 1}`);
    b.box(cx + 9, y, cz + dz, s, h, s, { ink: INK.PEN, rotY: dz * 0.1 });
  });
  // A blob of putty squeezed between the mug and the first cube: it fills the
  // crack between them, and walks you up on to the cube from the mug side.
  b.thing('putty by the mug', { squeezes: ['mug', 'sugar cube 1'] });
  b.mound(cx + 6.26, cz - 6.83, 6, 2.05, { ink: INK.PEN });
}

// ---------------------------------------------------------------------------
// North-east: the pencil cup. Tall and narrow: the one spot on the map that
// costs you something to reach.
//
// The player can walk on the top rim and fall inside, and there's a small
// opening at the bottom for people to go in or out. It was a solid column 12 m
// across with pencils standing up out of its lid. Now it is a pot: a rim 1.2 m
// wide to walk round, 16 m of drop inside, and a doorway at the foot facing the
// plaza. Falling costs nothing here, so the drop is a way down, not a trap, and
// the pencils in it are what you shelter behind up on the rim.
function pencilCup(b) {
  const cx = 24, cz = -24, h = 16, seg = 16;
  b.thing('pencil cup');
  const cup = b.tube(cx, 0, cz, 6, 1.2, h, {
    seg, door: { at: -Math.PI / 4, h: 3.2 }, ink: INK.PEN, tag: 'cup', place: 'pencil cup rim',
  });
  // One small door makes the inside a pocket by rule 4, on purpose.
  b.room(cx, cz, cup.ai, 'inside the pencil cup');
  // Still the one spot that costs you something: 3.5 s on a ladder in the
  // open. Up the middle of a side, a side and a half round from the door.
  const up = 0.5 * (Math.PI * 2 / seg);
  b.ladder(cx + Math.sin(up) * cup.ao, 0, cz + Math.cos(up) * cup.ao, up, h, { name: 'pencil cup' });

  // Two pencils and a pen, standing on the floor inside, their points 4-6 m
  // over the rim. They lean on each other in the middle, not on the rim: laid
  // against the rim, each one lay across the walk round it at chest height.
  // Each leans toward a spot 117 degrees round from its foot rather than
  // straight across, or all three pass through the middle at one height; this
  // way the closest two axes are 2.5 m apart.
  const lean = [[0.4, 16, false], [2.494, 17.6, false], [4.589, 18.4, true]];
  lean.forEach(([phi, len, pen], i) => {
    b.thing(`${pen ? 'pen' : 'pencil'} in the cup ${i + 1}`);
    const psi = phi + Math.PI - 1.1;
    const base = new THREE.Vector3(cx + Math.sin(phi) * 3.3, 0.35, cz + Math.cos(phi) * 3.3);
    const toward = new THREE.Vector3(cx + Math.sin(psi) * 2.5, 19, cz + Math.cos(psi) * 2.5);
    b.pencil(base, toward.sub(base), len, pen ? 0.62 : 0.75, pen ? { pen: true, ink: INK.BLUE } : {});
  });
  // A hill of putty in front of the cup. Two blocks stood here, 3.5 and 6.5 m,
  // and with the pen, a sticky note and a page corner round them they made the
  // largest pocket on the map: 72 m² of floor with four ways out or fewer.
  // Clear of both ladder feet, the cup's and the binder's. The cup's door
  // opens on to its slope. It was bigger, and ran into the notebook, a sticky
  // note, the pen and an eraser on the ring road; this is as big as it gets
  // and touches nothing but the desk.
  b.thing('putty by the cup');
  b.mound(cx - 6, cz + 8.5, 4.5, 1.4, { ink: INK.PEN });
  // on the rim, clear of the ladder's top
  const mid = (cup.ao + cup.ai) / 2;
  const onRim = (a) => [cx + Math.sin(a) * mid, h + 0.4, cz + Math.cos(a) * mid];
  b.sniperNest(...onRim(2.4));
  b.pickupSpot(...onRim(4.45), 'bandage', 'pencil cup rim');
  b.anchor(cx, h + 1, cz);
}

// ---------------------------------------------------------------------------
// North-west: the stapler. Low, black, and the only thing on the map you shoot
// over rather than round.
function stapler(b) {
  const cx = -24, cz = -24, a = 0.35;
  const L = local(cx, cz, a);
  b.thing('stapler');
  // A stapler, not two black boxes: a low base plate, the steel magazine on
  // it, the arm over both with a rounded nose, the hinge at the back and the
  // anvil the staples fold on, out in front of the magazine. It is as tall as
  // it was, so it is still the one thing you shoot over rather than round.
  b.box(cx, 0, cz, 13, 1.0, 5.2, { ink: INK.BLACK, rotY: a });
  b.box(...at(L(0.4, 0), 1.0), 11.2, 1.4, 3.4, { ink: INK.PEN, rotY: a, tag: 'magazine' });
  b.box(cx - 0.6, 2.4, cz, 11, 2.0, 4.4, { ink: INK.BLACK, rotY: a, rotZ: 0.05 });
  b.cyl(...at(L(-6.1, 0), 3.35), 1.0, 4.4, { axis: 'z', ink: INK.BLACK, seg: 10, rotY: a, tag: 'nose' });
  b.box(...at(L(-5.3, 0), 1.0), 1.8, 0.1, 2.4, { ink: INK.PEN, look: LOOK.SOLID, rotY: a, solid: false, ghost: 'decor' });
  b.cyl(cx + 5.6, 1.2, cz - 2, 1.2, 4.6, { axis: 'z', ink: INK.BLACK, seg: 10, rotY: a, tag: 'hinge' });
  // three spent staples on the desk in front of it
  for (const [dx, dz] of [[-8, 5], [-5, 7], [-10, 8]]) {
    b.box(cx + dx, 0, cz + dz, 1.2, 0.5, 0.22, { ink: INK.BLACK, look: LOOK.SOLID, solid: false, rotY: dx * 0.3 });
  }
}

/** (u, w) in the frame of something turned `a` about y at (cx, cz), as world [x, z]. */
function local(cx, cz, a) {
  const c = Math.cos(a), s = Math.sin(a);
  return (u, w) => [cx + u * c + w * s, cz - u * s + w * c];
}
/** [x, z] and a height as the x, y, z a primitive takes. */
const at = ([x, z], y) => [x, y, z];

// ---------------------------------------------------------------------------
// South-east: a staircase of erasers. No stairs, no grapple — just a climb,
// with cover the whole way up.
function eraserSteps(b) {
  const cx = 24, cz = 24;
  const steps = [[0, 0, 2.6], [-4, 2.6, 2.4], [-7.5, 5.0, 2.2], [-10.5, 7.2, 2.0], [-13, 9.2, 1.8]];
  steps.forEach(([dx, y, h], i) => {
    // the first eraser pink, the third a blue ink eraser, the rest plain
    b.thing(`eraser step ${i + 1}`);
    b.box(cx + dx, y, cz + dx * 0.35, 6.5, h, 4.6, { ink: dx === 0 ? INK.PINK : dx === -7.5 ? INK.BLUE : INK.PEN, rotY: dx * 0.03 });
  });
  // The first eraser stuck in a blob of putty at its corner, so its top is
  // walked on to from two sides. The rest of the stack is still a climb.
  b.thing('putty by the erasers', { squeezes: ['eraser step 1'] });
  b.mound(cx + 3.25, cz + 2.3, 7.5, 2.6, { ink: INK.PEN });
  b.thing('sticky note on the erasers');
  b.box(cx - 13, 11.0, cz - 4.6, 8, 0.3, 8, { ink: INK.ORANGE, lift: 0.3, rotY: 0.2, tag: 'note', place: 'sticky note on the erasers' });
  b.box(cx - 13, 11.3, cz - 2.0, 6.6, 0.06, 0.12, { ink: INK.PEN, look: LOOK.SOLID, solid: false, rotY: 0.2 });

  // The way up for anyone who cannot make the climb: a pad of sticky notes
  // stood on end under the west edge of the one on top, flush with it, with a
  // ladder up its face. No eraser has a face that runs to the ground — each
  // sits on the one below, offset — and the ground round the stack is taken
  // (a sticky note on edge to the north, a scatter block to the south), so it
  // is narrow, and it also holds up the top eraser's hanging corner.
  const nx = cx - 13, nz = cz - 4.6, ang = 0.2;
  const ax = [Math.cos(ang), -Math.sin(ang)], az = [Math.sin(ang), Math.cos(ang)];   // the note's own axes
  const at = (u, v) => [nx + ax[0] * u + az[0] * v, nz + ax[1] * u + az[1] * v];
  const [px, pz] = at(-3.4, -2.6);
  b.thing('sticky pad under the note');
  b.box(px, 0, pz, 1.2, 11.0, 2.0, { ink: INK.PEN, rotY: ang, tag: 'pad' });
  const [lx, lz] = at(-4, -2.6);
  b.ladder(lx, 0, lz, ang - Math.PI / 2, 11.3, { name: 'eraser steps' });
  b.sniperNest(cx - 13, 11.4, cz - 4.6);
  b.pickupSpot(cx - 10.6, 11.4, cz - 5.5, 'bandage', 'sticky note on the erasers');
  b.anchor(cx - 13, 12.5, cz - 4.6);
}

// ---------------------------------------------------------------------------
// South-west: a pencil lying across the corner. A long shallow ramp that gets
// you to first-floor height from open ground.
//
// It was 34 m, from the tape dispenser to beside the mug, and closed the corner
// off into a room whose back door was a slot between the eraser, the mug and
// the edge of the desk. At 26 m the corner is open at that end. The tip stays
// where it was, against the dispenser, and the tip and eraser are on the
// pencil's axis: they were drawn 1.4 m and 3.8 m off it.
function bigPencil(b) {
  const len = 26, r = 1.9, ang = -0.72;
  const ux = Math.cos(ang), uz = -Math.sin(ang);          // along the pencil, toward the tip
  const tx = -24 + ux * 17, tz = 22 + uz * 17;            // where the barrel meets the tip
  const cx = tx - ux * len / 2, cz = tz - uz * len / 2;
  // Built whole by b.pencil, which lays out the eraser, the barrel and the
  // sharpened point along one axis. The ends stay where they were: the point
  // 4.2 m past the barrel, against the dispenser, and the eraser end 3.9 m
  // behind it. `spin` puts a corner of the hexagon down, so it lies on the desk
  // on an edge as the old barrel did, rather than floating a flat's depth up.
  const dir = new THREE.Vector3(ux, 0, uz);
  const back = new THREE.Vector3(cx - ux * (len / 2 + 3.9), r, cz - uz * (len / 2 + 3.9));
  const lie = { spin: Math.atan2(ux, uz), tag: 'pencil' };
  b.thing('big pencil');
  // Everything but the barrel — eraser, ferrule, wood and graphite — is 6.35 r.
  // The point was 4.2 m past where the barrel met it. At that length the
  // barrel's side ran 0.6 m into the corner of the dispenser's base, which it
  // meets at a slant, so it is 3.7 m shorter and its point now just touches.
  b.pencil(back, dir, len + 3.9 + 4.2 - 6.35 * r - 3.7, r, lie);
  // The way up on to the pencil.
  //
  // It used to sit at x -17 — tucked just clear of the pencil's collider, which
  // at the time was a 34 m box running due east while the pencil itself was
  // drawn diagonally across the corner. Now that the bar collides where it is
  // drawn, that spot is underneath it: you ran up the ramp and stopped dead
  // against the side of a pencil at waist height.
  //
  // Moved out to where the ramp is clear of the bar for its whole length and
  // still finishes beside it. The constraint is arithmetic, so here it is: with
  // the axis through (-24, 22) at `ang`, a point is inside the bar within
  // 1.645 + 0.35 m of it (inscribed radius plus the body), the ramp's surface
  // only clears the bar's top over its last 1.2 m, and the whole footprint has
  // to stay outside that. Width 2.5 rather than 5 because the bar is diagonal:
  // every extra metre across costs 0.38 m of clearance, and at width 5 there is
  // no placement that both clears the bar and reaches it.
  b.thing('wedge by the big pencil');
  b.ramp(-10, 0, 27, '-x', 9, 2.5, { rise: 0.42, ink: INK.PEN, thick: 0.5 });
}

// ---------------------------------------------------------------------------
// The ruler: the upper route, north stack roof to binder walkway. Exposed the
// whole way, which is the point.
function rulerBridge(b) {
  const ax = 0, az = -RING - 6 + 8;
  const bx = RING + 6 - 7, bz = 0;
  const ang = Math.atan2(bz - az, bx - ax);
  // Past the binder deck by 3 m, and at the north stack by only as much as
  // puts its square end's far corner against the top storey's page wall: at
  // 3 m it ran 0.4 m into the wall.
  const over = [0.85, 3];
  const dist = Math.hypot(bx - ax, bz - az), len = dist + over[0] + over[1];
  const s0 = (dist + over[1] - over[0]) / 2;               // from a, along the ruler, to its middle
  const mx = ax + Math.cos(ang) * s0, mz = az + Math.sin(ang) * s0;
  b.thing('ruler');
  b.box(mx, 14.2, mz, len, 0.5, 4.2, { ink: INK.ORANGE, rotY: -ang, tag: 'ruler', place: 'ruler bridge' });
  for (let i = 1; i < 15; i++) {
    const t = i / 15 - 0.5;
    b.box(mx + t * len * Math.cos(ang), 14.7, mz + t * len * Math.sin(ang), 0.15, 0.04,
      i % 5 === 0 ? 2.4 : 1.2, { ink: INK.BLACK, look: LOOK.SOLID, solid: false, rotY: -ang });
  }
  b.anchor(mx, 14.2, mz);

  // Where the ruler runs in under the roof's overhang, the roof is 0.8 m above
  // it: a single jump is 0.78. A block on the ruler in front of the overhang
  // makes it two steps of 0.4, so the upper route walks end to end.
  const edge = -RING - 6 + 7.5;                  // the front edge of the roof, z
  b.box(ax - 0.65, 14.7, edge + 0.6, 2.7, 0.4, 1.2, { ink: INK.PEN, tag: 'ruler step' });
}

// ---------------------------------------------------------------------------
// Cover in the open, placed around the ring road at intervals rather than dotted
// at random: you should always have somewhere to break line of sight within a
// second's run, and never much more than that.
function scatter(b) {
  // Each block on the ring road is something you would find on a desk. They
  // were plain boxes, and a playtester said the desk looked like "some random
  // geometric shapes". Same footprints and heights, so nothing about moving
  // round them changed: only what they are.
  const ring = [
    [0.5, 21, INK.PEN, 'sleeved'], [1.3, 22, INK.PEN, 'matchbox'], [2.1, 20, INK.PINK, 'eraser'],
    [2.9, 22, INK.PEN, 'sharpener'], [3.7, 20.5, INK.PEN, 'notepad'], [4.56, 23, INK.PEN, 'domino'],
    [5.3, 20, INK.PEN, 'sleeved'], [6.1, 19, INK.PINK, 'eraser'],   // 19, not 22: out there it walled in
  ];                                                               // the gap by the binder's north pillar
  ring.forEach(([a, r, ink, kind], i) => {
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    b.thing(`${kind} ${i + 1}`);
    b.box(x, 0, z, 4.6, 2.3, 3.0, { ink, rotY: a, tag: kind });
    deskThing(b, kind, x, z, a, i);
  });
  // Dice: pips on every face you can see, opposite faces adding up to seven.
  [[-14.3, -14.2, 0.8], [15, 13, 0.2]].forEach(([x, z, r], i) => { b.thing(`die ${i + 1}`); die(b, x, z, r, 3.2); });
  // Two pairs of half-rings used to stand here, "arches", and a playtester
  // asked what the half circles floating in the sky were. They were these:
  // a half torus is centred on its middle, so both legs ended 6 m up in the
  // air, and they were not anything you would find on a desk. Gone.
}

/** What makes a 4.6 x 2.3 x 3 block on the ring road into a thing. Drawn detail only. */
function deskThing(b, kind, x, z, a, i) {
  const L = local(x, z, a);
  const deco = { solid: false, ghost: 'decor', rotY: a };
  if (kind === 'sleeved') {
    // an eraser in its card sleeve; the first sleeve is blue
    b.box(x, -0.02, z, 2.6, 2.4, 3.1, i === 0 ? { ...deco, ink: INK.BLUE, look: LOOK.WASH } : { ...deco, ink: INK.PEN });
  } else if (kind === 'matchbox') {
    // its tray pushed half out of one end, and a striker down each side
    b.box(...at(L(-2.9, 0), 0.15), 1.4, 1.8, 2.6, { ink: INK.PEN, rotY: a, tag: 'matchbox' });
    for (const sw of [-1, 1]) b.box(...at(L(0, sw * 1.52), 0.6), 3.8, 1.1, 0.04, { ...deco, ink: INK.BLACK, look: LOOK.SOLID });
  } else if (kind === 'eraser') {
    // a maker's squiggle on top
    const [ox, oz] = L(-1.4, -0.3);
    b.strokes([{ p: [[0, 0], [0.4, 0.5], [0.8, 0], [1.2, 0.5], [1.6, 0], [2.0, 0.4], [2.6, 0.1]] }],
      new THREE.Vector3(ox, 2.3, oz), new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)),
      new THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)), new THREE.Vector3(0, 1, 0), 0.12, { ink: INK.PEN });
  } else if (kind === 'sharpener') {
    // the hole in one end, and the blade across the top
    const [hx, hz] = L(-2.32, 0);
    b.torus(hx, 1.2, hz, 0.75, 0.16, { ...deco, ink: INK.BLACK, look: LOOK.SOLID, rotY: a + Math.PI / 2, seg: 14, rotZ: 0 });
    b.cyl(hx, 1.2, hz, 0.6, 0.06, { ...deco, ink: INK.BLACK, look: LOOK.SOLID, dir: new THREE.Vector3(Math.cos(a), 0, -Math.sin(a)), seg: 12 });
    b.box(...at(L(-0.9, 0), 2.3), 2.4, 0.1, 1.8, { ...deco, ink: INK.PEN, look: LOOK.WRAP });
    b.cyl(...at(L(-0.9, 0), 2.4), 0.22, 0.08, { ...deco, ink: INK.BLACK, look: LOOK.SOLID, seg: 8 });
  } else if (kind === 'notepad') {
    // a pad of sticky notes: the orange top sheet, the edges of the rest
    b.box(x, 2.3, z, 4.6, 0.06, 3.0, { ...deco, ink: INK.ORANGE, look: LOOK.WASH });
    for (let k = 0.35; k < 2.2; k += 0.4) {
      for (const sw of [-1, 1]) b.box(...at(L(0, sw * 1.51), k), 4.3, 0.04, 0.03, { ...deco, ink: INK.PEN, look: LOOK.SOLID });
    }
  } else if (kind === 'domino') {
    // two and five, and the bar between
    b.box(x, 2.3, z, 0.1, 0.03, 2.6, { ...deco, ink: INK.PEN, look: LOOK.SOLID });
    const pips = [[-1.2, -0.6], [-1.2 + 0.2, 0.6], [1.2, 0], [0.7, -0.8], [0.7, 0.8], [1.7, -0.8], [1.7, 0.8]];
    pips.forEach(([u, w], k) => b.cyl(...at(L(k === 1 ? -0.6 : u, w), 2.3), 0.28, 0.05, { ...deco, ink: INK.PEN, look: LOOK.SOLID, seg: 10 }));
  }
}

/** A die `s` on a side at (x, z), turned `r`: 3 on top, and pips on the four sides. */
function die(b, x, z, r, s) {
  b.box(x, 0, z, s, s, s, { ink: INK.PEN, rotY: r, tag: 'die' });
  const L = local(x, z, r);
  const q = s * 0.27, h = s / 2 + 0.01;
  const grid = { 1: [[0, 0]], 2: [[-q, -q], [q, q]], 3: [[-q, -q], [0, 0], [q, q]],
    5: [[-q, -q], [-q, q], [0, 0], [q, -q], [q, q]], 6: [[-q, -q], [-q, 0], [-q, q], [q, -q], [q, 0], [q, q]] };
  const pip = { ink: INK.BLUE, look: LOOK.SOLID, seg: 10, solid: false, ghost: 'decor' };
  for (const [a, c] of grid[3]) b.cyl(...at(L(a, c), s), 0.3, 0.05, pip);
  // each side: its outward axis in the die's frame, and its number
  for (const [nu, nw, n] of [[1, 0, 1], [-1, 0, 6], [0, 1, 2], [0, -1, 5]]) {
    const [dx, dz] = L(nu, nw), dir = new THREE.Vector3(dx - x, 0, dz - z);
    for (const [a, c] of grid[n]) {
      const [px, pz] = L(nu * h + nw * a, nw * h + nu * a);
      b.cyl(px, s / 2 + c, pz, 0.3, 0.05, { ...pip, dir });
    }
  }
}

// ---------------------------------------------------------------------------
// The middle distance.
//
// Every ground-level establishing shot came out the same way: a huge blank
// diagonal in the foreground (the ruler, or the pencil), a thin band of level
// in the far distance, and nothing whatever in between. A shot like that works
// when it is LAYERED — something near, buildings at mid distance, a sightline
// to a far facade — and reading depth off a drawing needs those layers, since
// there is no colour or shadow to carry it.
//
// This is also where the new material vocabulary earns its keep, because it is
// the first place on the map with more than one kind of surface in frame:
// sticky notes are flat colour (PANEL), wire and round stock take contour lines
// that wrap the form (CONTOUR), and everything structural stays cross-hatched.
function midGround(b) {
  // Sticky notes, stood on edge and leaning — chest-high cover at mid range,
  // and the one thing on the desk that is a painted surface rather than a drawn
  // one.
  const notes = [[-12.5, 14, 0.5, INK.PINK], [12, -12.75, -0.4, INK.ORANGE],
                 [-15.4, -7.0, 1.9, INK.GREEN], [8, 16, 2.6, INK.BLUE]];
  notes.forEach(([x, z, rot, ink], i) => {
    b.thing(`sticky note ${i + 1}`);
    b.box(x, 0, z, 5.4, 5.0, 0.35, { ink, look: LOOK.WASH, rotY: rot });
    b.box(x + Math.sin(rot) * 0.3, 0, z + Math.cos(rot) * 0.3, 5.4, 0.5, 0.5,
      { ink, look: LOOK.WASH, rotY: rot, solid: false });
  });

  // Paperclips, lying flat as paperclips do. They were half-rings stood on
  // end with their legs 4.4 m up in the air, which from the ground were loops
  // floating against the sky. Jumbo clips, so they read from across the desk:
  // one on the desk, one on the ring road, one on the edge of a page.
  // Round wire, so contour lines; decoration you step over, so ghosts.
  b.thing('paperclip 1'); paperclip(b, -1.5, 0, -17.5, 0.6, 5.5);
  b.thing('paperclip 2'); paperclip(b, 17, 0, 4.5, -1.1, 5);
  b.thing('paperclip 3'); paperclip(b, -13.2, 0.5, 4, 0.15, 4.5);

  // Coin stacks: small, round, and they break up the empty floor between the
  // ring road and the plaza. Every coin is solid. Only the bottom one used to
  // be, so a 2.1 m stack was a 0.42 m kerb with the rest of it drawn round
  // your chest.
  // Three stand on the notebook's pages, one on the desk: they used to start
  // on the desk with their bottom coin inside the page.
  for (const [x, z, n, y] of [[5, 9, 4, 0.5], [-8, 6, 3, 0.5], [12.5, -3, 5, 0.5], [-3, -13.2, 3, 0]]) {
    b.thing(`coins at ${x}, ${z}`);
    for (let i = 0; i < n; i++) {
      b.cyl(x, y + i * 0.42, z, 1.5, 0.42, { ink: INK.PEN, look: LOOK.WRAP, seg: 14, tag: 'coins' });
    }
  }

  // A pen lying on the open notebook, where a pen gets put down: something
  // with a long axis to carry the eye into the frame rather than across it,
  // and low cover on the right-hand page. A pen lying on the table used to
  // poke into the pencil holder: it lay on the desk out past the
  // notebook, its nib end half a metre into the pot's wall and its barrel
  // straight through the sleeved eraser on the ring road.
  const tail = new THREE.Vector3(10, 0.5 + 0.7, 4), nib = new THREE.Vector3(3.2, 0.5 + 0.7, -8.8);
  const pu = nib.clone().sub(tail).normalize();
  b.thing('pen');
  b.pencil(tail, pu, tail.distanceTo(nib) - 0.7 * 4.6, 0.7, { pen: true, ink: INK.BLUE });
}

/**
 * A Gem paperclip lying flat, its long axis at `rot` about y, base at (x, y, z),
 * `len` long: three U-bends of wire, the innermost loop inside the outer one.
 */
function paperclip(b, x, y, z, rot, len) {
  const arc = (cu, cv, r, a0, a1, n = 8) => Array.from({ length: n + 1 },
    (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cu + Math.cos(a) * r, cv + Math.sin(a) * r]; });
  const P = Math.PI / 2;
  // in units where the clip is 3.5 long and 1 wide
  const path = [
    [1.0, 0.25], ...arc(3.0, 0.5, 0.25, -P, P), ...arc(0.5, 0.375, 0.375, P, 3 * P),
    ...arc(3.5, 0.5, 0.5, -P, P), [1.5, 1.0],
  ];
  const s = len / 3.5, wr = 0.11, c = Math.cos(rot), sn = Math.sin(rot);
  const pts = path.map(([u, v]) => {
    const lu = (u - 1.75) * s, lv = (v - 0.5) * s;
    return new THREE.Vector3(x + lu * c + lv * sn, y + wr, z - lu * sn + lv * c);
  });
  b.wire(pts, wr, { ink: INK.PEN, look: LOOK.WRAP, solid: false, ghost: 'decor', tag: 'clip' });
}

// ---------------------------------------------------------------------------
// The desk as a piece of furniture, made to look more like a desk rather than
// some random geometric shapes. Until now it
// was a top and nothing else, a sheet of paper in space. So:
//
//   * a rounded front edge all round, and an apron under the top;
//   * legs, and a pedestal of drawers under the east end, going down into the
//     distance fade: you see them when you look over the edge;
//   * grain in the top, a few long strokes, sparse and thin, so the desk still
//     draws almost nothing at a grazing angle.
//
// None of it collides. It is all outside the edge of the page, or under the
// top, or painted on it.
function deskItself(b) {
  const ghost = { solid: false, ghost: 'decor' };
  const E = DESK;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    // the rounded edge: half a round bar along each side of the top
    b.cyl(dx * E, -1.5, dz * E, 1.5, E * 2, { ...ghost, ink: INK.PEN, axis: dx ? 'z' : 'x', seg: 12, lift: 0.3 });
    // the apron under the top, set back from the edge
    b.box(dx * (E - 3), -7, dz * (E - 3), dx ? 1 : E * 2 - 6, 4, dz ? 1 : E * 2 - 6, { ...ghost, ink: INK.PEN });
  }
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.sphere(sx * E, -1.5, sz * E, 1.5, { ...ghost, ink: INK.PEN, lift: 0.3, seg: 10, seg2: 6 });
  // two legs at the west end, the pedestal under the east
  for (const sz of [-1, 1]) b.box(-(E - 5), -100, sz * (E - 5), 4, 97, 4, { ...ghost, ink: INK.PEN });
  const px = E - 13, pw = 20, top = -7;
  b.box(px, -100, 0, pw, 100 + top, E * 2 - 8, { ...ghost, ink: INK.PEN, tag: 'pedestal' });
  // its drawers, facing the chair side (+z): three fronts, each with a handle
  const face = E - 4 + 0.02;
  for (const [y0, h] of [[top - 12, 11], [top - 26, 13], [top - 48, 21]]) {
    b.box(px, y0 + 0.5, face, pw - 2, h - 1, 0.3, { ...ghost, ink: INK.PEN });
    b.box(px, y0 + h - 3.5, face + 0.3, 5, 0.8, 0.8, { ...ghost, ink: INK.BLACK });
  }
  // the grain: long, faintly wavy strokes across the top, and two knots
  const grain = [];
  for (let k = 0; k < 11; k++) {
    const z0 = -E + 4 + k * 7.1 + Math.sin(k * 2.3) * 1.5;
    const from = -E + 3 + ((k * 13) % 17), to = E - 3 - ((k * 7) % 11);
    const p = [];
    for (let x = from; x <= to; x += 2) p.push([x, z0 + Math.sin(x * 0.09 + k) * 0.9 + Math.sin(x * 0.31 + k * 1.7) * 0.25]);
    grain.push({ p });
  }
  for (const [kx, kz] of [[-22, 9], [27, -12]]) {
    grain.push({ p: Array.from({ length: 15 }, (_, i) => [kx + Math.cos(i / 14 * Math.PI * 2) * 1.6, kz + Math.sin(i / 14 * Math.PI * 2) * 0.6]) });
  }
  b.strokes(grain, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(0, 1, 0), 0.07, { ink: INK.PEN, raise: 0.01 });
}

// The north stack stands on four glue sticks, capped, where it stood on four
// square pillars that were not anything.
function gluePillars(b) {
  const cx = 0, cz = -RING - 6;
  for (const [px, pz] of [[-11, -6], [11, -6], [-11, 6], [11, 6]]) {
    b.thing(`glue stick at ${px}, ${pz}`);
    b.cyl(cx + px, 0, cz + pz, 1.35, 3.9, { ink: INK.PEN, seg: 14, tag: 'glue' });
    b.cyl(cx + px, 3.9, cz + pz, 1.45, 1.6, { ink: INK.PEN, seg: 14, tag: 'glue' });            // the cap
    b.cyl(cx + px, 1.2, cz + pz, 1.37, 1.4, { ink: INK.ORANGE, look: LOOK.WASH, seg: 14, solid: false, ghost: 'decor' });   // the label
  }
}

// ---------------------------------------------------------------------------
// An anglepoise lamp in the north-east corner of the old desk, reaching out
// over the pencil cup. Its base is a low dome you walk over (no corner to be
// trapped in), and its arms and shade are the highest things on the map to
// grapple: the arches that used to be grappled in the middle distance are gone.
function deskLamp(b) {
  const B = new THREE.Vector3(33, 0, -33);
  b.thing('lamp');
  b.mound(B.x, B.z, 4.6, 1.4, { ink: INK.BLACK });
  const foot = new THREE.Vector3(B.x, 1.2, B.z);
  const elbow = new THREE.Vector3(36, 21, -36);
  const head = new THREE.Vector3(27.5, 27, -27.5);
  b.cyl(foot.x, 0.8, foot.z, 0.7, 1.6, { ink: INK.BLACK, seg: 10, tag: 'lamp' });
  for (const [p, q] of [[foot.clone().setY(2.2), elbow], [elbow, head]]) {
    const d = q.clone().sub(p), len = d.length();
    d.normalize();
    // two rods side by side, and a spring down the middle of the first
    const side = new THREE.Vector3(-d.z, 0, d.x).normalize().multiplyScalar(0.45);
    for (const s of [-1, 1]) {
      const m = p.clone().add(q).multiplyScalar(0.5).addScaledVector(side, s);
      b.cyl(m.x, m.y, m.z, 0.26, len, { ink: INK.PEN, look: LOOK.WRAP, seg: 6, dir: d, tag: 'lamp' });
    }
    if (p !== elbow) {
      const u = side.clone().normalize(), v = d.clone().cross(u).normalize(), coil = [];
      for (let t = 0.3; t <= 0.7; t += 0.008) {
        const a = t * 250;
        coil.push(p.clone().addScaledVector(d, len * t).addScaledVector(u, Math.cos(a) * 0.3).addScaledVector(v, Math.sin(a) * 0.3));
      }
      b.wire(coil, 0.06, { ink: INK.PEN, look: LOOK.SOLID, solid: false, ghost: 'decor' });
    }
  }
  b.sphere(elbow.x, elbow.y, elbow.z, 0.75, { ink: INK.BLACK, seg: 10, seg2: 6, tag: 'lamp' });
  b.sphere(head.x, head.y, head.z, 0.75, { ink: INK.BLACK, seg: 10, seg2: 6, tag: 'lamp' });
  // The shade: a cone opening down and out toward the plaza, blue inside, and
  // a bulb in it.
  const down = new THREE.Vector3(-0.35, -1, 0.35).normalize();
  const sh = 4.4, sc = head.clone().addScaledVector(down, sh / 2 + 0.3);
  const up = down.clone().negate();
  b.cyl(sc.x, sc.y, sc.z, 3.8, sh, { rTop: 0.9, open: true, ink: INK.PEN, seg: 18, dir: up, tag: 'lamp' });
  b.cyl(sc.x, sc.y, sc.z, 3.72, sh * 0.98, { rTop: 0.85, open: true, inside: true, ink: INK.BLUE, look: LOOK.WASH, seg: 18, dir: up, solid: false, ghost: 'decor' });
  const bulb = head.clone().addScaledVector(down, sh * 0.72);
  b.sphere(bulb.x, bulb.y, bulb.z, 1.1, { ink: INK.PEN, lift: 0.3, seg: 10, seg2: 6, solid: false, ghost: 'decor' });
  b.anchor(elbow.x, elbow.y, elbow.z);
  b.anchor(head.x, head.y, head.z);
}

// ---------------------------------------------------------------------------
// A photo in a frame, stood on its easel in the north-west corner of the old
// desk and turned to the plaza: a photo frame with an ink drawing of one enemy
// boss with a chicken costume. It is THE AUTHOR, crown and rifle and
// all, drawn in photo_author.js as strokes, in the same pens as the rest of the
// desk.
function photoFrame(b) {
  // Lifted a hair: leaning back, the bottom of the moulding's back edge went
  // under the desk top. And 2 m in from where it stood when this corner was
  // the edge of the desk: its strut came within a hand of the train's bend.
  const base = new THREE.Vector3(-34.9, 0.07, -35.5);
  const W = 7.2, H = 9.4, M = 0.8, D = 0.6, lean = 0.2;
  b.thing('photo frame');
  const facing = Math.atan2(-base.x, -base.z);                   // toward the middle of the desk
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-lean, facing, 0, 'YXZ'));
  const P = (u, v, w) => new THREE.Vector3(u, v, w).applyQuaternion(q).add(base);
  const part = (u, v, w, sx, sy, sz, o) => { const c = P(u, v, w); b.box(c.x, c.y, c.z, sx, sy, sz, { quat: q, ...o }); };
  // the moulding, then the picture a little back inside it
  const frame = { ink: INK.BLACK, tag: 'frame' };
  part(0, M / 2, 0, W, M, D, frame);
  part(0, H - M / 2, 0, W, M, D, frame);
  for (const s of [-1, 1]) part(s * (W - M) / 2, H / 2, 0, M, H - 2 * M, D, frame);
  part(0, H / 2, -0.12, W - 2 * M + 0.1, H - 2 * M + 0.1, 0.2, { ink: INK.PEN, lift: 0.3, tag: 'photo' });
  // the easel strut behind, from the back of the frame to the desk
  const strutTop = P(0, H * 0.62, -D / 2), strutFoot = base.clone().add(new THREE.Vector3(-Math.sin(facing), 0, -Math.cos(facing)).multiplyScalar(3.4));
  strutFoot.y = 0.14;                                               // its bottom edge on the desk
  const sd = strutTop.clone().sub(strutFoot), sm = strutTop.clone().add(strutFoot).multiplyScalar(0.5);
  const sq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), sd.clone().normalize());
  b.box(sm.x, sm.y, sm.z, 1.4, sd.length(), 0.25, { quat: sq, ink: INK.BLACK, solid: false, ghost: 'decor' });
  // the drawing, on the face of the picture
  const pw = W - 2 * M, ph = H - 2 * M, k = Math.min(pw / SHEET.w, ph / SHEET.h);
  const u = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(k);
  const v = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(k);
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const origin = P(-SHEET.w * k / 2, H / 2 - SHEET.h * k / 2, -0.02);
  b.strokes(COSTUME, origin, u, v, n, 0.11, { ink: INK.PEN, raise: 0.02 });
  b.strokes(AUTHOR, origin, u, v, n, 0.11, { ink: INK.RED, raise: 0.02 });
  b.anchor(...P(0, H, 0).toArray());
}

// Waist-high junk on a roof: cover for a rooftop fight, and it stops the
// silhouette against the sky being a bare rectangle.
function roofClutter(b, cx, cz, y, seed, { sx = 1, sz = 1, size = 1, on } = {}) {
  // A box of staples, a spool of thread, a rubber stamp and a stack of index
  // cards: waist-high things you would find on a book, not four blocks.
  const items = [[-5, -3, 2.8, 2.4, 'staples'], [4, -2, 2.2, 3.0, 'spool'],
                 [-2, 4, 3.0, 2.0, 'stamp'], [5, 3, 2.0, 2.4, 'cards']];
  items.forEach(([dx, dz, w, h, kind], i) => {
    const x = cx + dx * sx, z = cz + dz * sz, rot = Math.sin(seed + i * 2.1) * 0.4;
    const W = w * size, D = w * 0.8 * size;
    const deco = { solid: false, ghost: 'decor', rotY: rot };
    b.thing(`${kind} on ${on}`);
    if (kind === 'spool') {
      const r = Math.min(W, D) / 2;
      b.cyl(x, y + 0.25, z, r * 0.7, h - 0.5, { ink: INK.PINK, seg: 14, tag: 'spool' });
      for (const fy of [y, y + h - 0.25]) b.cyl(x, fy, z, r, 0.25, { ink: INK.PEN, seg: 14, tag: 'spool' });
    } else if (kind === 'stamp') {
      b.box(x, y, z, W, h * 0.4, D, { ink: INK.PEN, rotY: rot, tag: 'stamp' });
      b.cyl(x, y + h * 0.4, z, W * 0.16, h * 0.45, { ink: INK.PEN, seg: 10, tag: 'stamp' });
      b.sphere(x, y + h * 0.85 + W * 0.1, z, W * 0.22, { ink: INK.PINK, seg: 10, seg2: 6, tag: 'stamp' });
    } else {
      b.box(x, y, z, W, h, D, { ink: INK.PEN, rotY: rot, tag: kind });
      const L = local(x, z, rot);
      if (kind === 'staples') {
        // where the lid meets the box, and the label on it
        b.box(x, y + h * 0.72, z, W + 0.04, 0.05, D + 0.04, { ...deco, ink: INK.PEN, look: LOOK.SOLID });
        b.box(x, y + h, z, W * 0.6, 0.03, D * 0.5, { ...deco, ink: INK.RED, look: LOOK.SOLID });
      } else {
        for (let k = 0.3; k < h - 0.1; k += 0.3) {
          for (const sw of [-1, 1]) b.box(...at(L(0, sw * (D / 2 + 0.01)), y + k), W - 0.2, 0.03, 0.02, { ...deco, ink: INK.PEN, look: LOOK.SOLID });
        }
      }
    }
  });
}

export { DESK, EDGE, OLD_EDGE };
