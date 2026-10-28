import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surface } from '../../render/surface.js';
import { INK, LOOK } from '../../render/palette.js';

// Viewmodels, drawn the same way the world is: boxes, cylinders and one
// blade built face by face, with no texture, letting the ink pass do the rest. The held
// weapon is patterned in its own frame (render/surface.js), so its strokes ride
// with it rather than crawling across it as it bobs and recoils.
//
// Each model is a handful of meshes, one per ink and look, and one more per
// part that moves: the rifle's magazine, the shotgun's pump, the sniper's bolt,
// the staple gun's lever. Round parts are drawn in WRAP, ringed round their own
// axis like the desk's pencils. Every model says where:
//
//   sight   the height the eye looks along when aiming (Gun drops the model by
//           exactly that), and a part named 'sight' that sits on that line
//   muzzle  where a round leaves, and the flash
//   eject   where a spent case comes out
//   grip    where the right hand holds, for a friend's figure (buildProp)
//
// What must not move when a model changes: the sight line, and how far behind
// the grip the model reaches, which GUNS.aiming.aimZ is worked out against.
//
//   rifle 0.43, shotgun 0.47, sniper 0.54, staple gun 0.11 model units behind
//   the grip, and nothing in front of a sight above the line from the eye
//   through the bottom of its window.

const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/**
 * A capped cylinder, or a cone cut short, along the axis the caller names.
 *
 * `r` is its radius at the + end of that axis, `r2` at the − end, so a bell
 * that widens towards the muzzle is `{ r: small, r2: big, axis: 'z' }`. Its
 * axis goes with it (`userData.axis`), for WRAP to ring it.
 */
function cyl({ r, r2 = r, len, at, axis = 'y', seg = 8 }) {
  const g = new THREE.CylinderGeometry(r, r2, len, seg, 1, false);
  if (axis === 'x') g.rotateZ(-Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  const [x, y, z] = at;
  g.translate(x, y, z);
  g.userData.axis = axis === 'x' ? X : axis === 'z' ? Z : Y;
  return g;
}

/** The same value of `aAxis` on every vertex: the axis WRAP rings a part round. */
function withAxis(g, axis) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(axis, i * 3);
  g.setAttribute('aAxis', new THREE.BufferAttribute(a, 3));
  return g;
}

/**
 * One mesh of one ink and look. A WRAP part's pieces carry their own axes; an
 * extruded piece has no index, so then none of them keeps one, or they would not
 * merge.
 */
function part(geos, opts, name) {
  if (opts.look === LOOK.WRAP) for (const g of geos) if (!g.attributes.aAxis) withAxis(g, g.userData.axis || Z);
  if (geos.some((g) => !g.index)) {
    for (let i = 0; i < geos.length; i++) {
      if (!geos[i].index) continue;
      const flat = geos[i].toNonIndexed();
      geos[i].dispose();
      geos[i] = flat;
    }
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  const m = new THREE.Mesh(merged, surface(opts));
  if (name) m.name = name;
  return m;
}

const PEN = { ink: INK.PEN };
const BLACK = { ink: INK.BLACK };
const ROUND = { ink: INK.BLACK, look: LOOK.WRAP };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
/** 0 before `a`, up to 1 by `b`, held, and back to 0 from `c` to `d`: a part's way out and back. */
function bump(t, a, b, c, d) {
  const s = (u) => u * u * (3 - 2 * u);
  if (t <= a || t >= d) return 0;
  if (t < b) return s((t - a) / (b - a));
  if (t <= c) return 1;
  return s(1 - (t - c) / (d - c));
}
/** How far through its cadence a gun is since its last shot: 0 as it fires, 1 once it can again. */
const sinceShot = (gun) => 1 - clamp01(gun.cooldown / gun.stats.cadence.interval);

/**
 * Rifle: a carbine on a flat-top receiver. A ribbed handguard, a curved
 * magazine that drops out on a reload, a flash hider, an adjustable stock with a
 * cheek rest, and the reflex sight on its rail.
 */
export function buildRifle() {
  const root = new THREE.Group();
  root.add(part([
    box(0.10, 0.075, 0.62, 0, 0.03, -0.24),            // upper receiver
    box(0.09, 0.06, 0.40, 0, -0.035, -0.17),            // lower receiver
    box(0.09, 0.095, 0.40, 0, 0.012, -0.76),            // handguard
    ...[-0.62, -0.70, -0.78, -0.86, -0.94].map((z) => box(0.098, 0.103, 0.022, 0, 0.012, z)),  // its ribs
    box(0.075, 0.19, 0.11, 0, -0.15, 0.0, 0.25),        // pistol grip, raked back
    box(0.08, 0.13, 0.20, 0, -0.03, 0.30),              // stock
    box(0.07, 0.03, 0.16, 0, 0.045, 0.29),              // cheek rest
  ], PEN));
  root.add(part([
    box(0.05, 0.02, 0.48, 0, 0.0775, -0.21),            // the rail under the sight
    // its slots, from the sight forward: nearer the eye they loom like steps
    ...[-0.16, -0.24, -0.32, -0.40].map((z) => box(0.056, 0.006, 0.012, 0, 0.087, z)),
    box(0.05, 0.022, 0.04, 0, 0.068, 0.085),            // charging handle
    box(0.03, 0.012, 0.13, 0, -0.105, -0.10),           // trigger guard
    box(0.03, 0.05, 0.012, 0, -0.08, -0.165),
    box(0.012, 0.04, 0.012, 0, -0.085, -0.11, -0.3),    // trigger
    box(0.006, 0.014, 0.04, -0.048, -0.012, -0.03, 0.6),  // selector, on the side you see
    box(0.006, 0.02, 0.02, -0.048, -0.04, -0.23),       // magazine release
    box(0.045, 0.05, 0.045, 0, 0.012, -1.0),            // gas block
    box(0.085, 0.15, 0.03, 0, -0.03, 0.415),            // butt pad
    // The reflex sight is a built housing, not a red sticker on the rail: a hood,
    // a base bar, two walls and a mount, with the red dot floating in the middle
    // of an OPEN window. A flat coloured rectangle reads as a decal at any
    // distance and is one of the first things that gives a viewmodel away as
    // unfinished — but the window has to be open and it has to be big, because
    // aiming parks this housing exactly on the crosshair. A small solid one puts
    // a block of hatching precisely where the thing you are shooting has to be.
    // The carry handle that used to sit under it is gone for the same reason: it
    // stood in the bottom half of the sight picture.
    box(0.040, 0.045, 0.06, 0, 0.062, -0.30),          // mount
    box(0.150, 0.018, 0.06, 0, 0.221, -0.30),          // hood
    box(0.150, 0.018, 0.06, 0, 0.089, -0.30),          // base bar
    box(0.018, 0.114, 0.06, -0.066, 0.155, -0.30),     // left wall
    box(0.018, 0.114, 0.06, 0.066, 0.155, -0.30),      // right wall
    // the flash hider's prongs, round its open end
    ...[0, 1, 2, 3].map((i) => {
      const a = (i + 0.5) * Math.PI / 2;
      return box(0.012, 0.012, 0.04, Math.cos(a) * 0.019, 0.012 + Math.sin(a) * 0.019, -1.485);
    }),
  ], BLACK));
  root.add(part([
    cyl({ r: 0.02, len: 0.42, at: [0, 0.012, -1.17], axis: 'z', seg: 10 }),     // barrel
    cyl({ r: 0.026, len: 0.09, at: [0, 0.012, -1.42], axis: 'z', seg: 10 }),    // flash hider
    cyl({ r: 0.026, len: 0.20, at: [0, 0.03, 0.17], axis: 'z', seg: 10 }),      // buffer tube, into the stock
  ], ROUND));
  // The magazine hangs from a pivot at the magazine well, so it can drop out and
  // come back on a reload (tick). Two boxes, the lower raked further forward:
  // the curve a 5.56 magazine has.
  const mag = new THREE.Group();
  mag.position.set(0, -0.065, -0.29);
  mag.add(part([
    box(0.062, 0.13, 0.11, 0, -0.055, -0.01, 0.12),
    box(0.062, 0.11, 0.10, 0, -0.17, -0.045, 0.32),
    box(0.068, 0.02, 0.105, 0, -0.225, -0.065, 0.32),  // its base plate
  ], PEN));
  root.add(mag);
  root.add(part([box(0.016, 0.016, 0.008, 0, 0.155, -0.30)], { ink: INK.RED, look: LOOK.SOLID }, 'sight'));
  return {
    root, mag, sight: 0.155,
    muzzle: new THREE.Vector3(0, 0.012, -1.50), eject: new THREE.Vector3(0.07, 0.035, -0.12),
    grip: new THREE.Vector3(0, -0.15, 0.0),
    // A reload: the magazine drops away, is out of sight while the next goes in, and comes
    // back up into the well.
    tick(gun) {
      const t = gun.reloading > 0 ? 1 - gun.reloading / gun.stats.cadence.reloadTime : 0;
      const k = bump(t, 0.04, 0.28, 0.62, 0.88);
      mag.position.y = -0.065 - 0.45 * k;
      mag.rotation.x = 0.35 * k;
    },
  };
}

/**
 * Shotgun: a pump gun. A ribbed fore-end that racks back and forward after
 * every shot, a vented heat shield with the sighting rib on it, the magazine
 * tube under the barrel, and spare shells in a saddle on the side you see, as
 * many as you have left, up to four.
 */
export function buildShotgun() {
  const root = new THREE.Group();
  root.add(part([
    box(0.11, 0.14, 0.50, 0, 0.005, -0.12),             // receiver
    box(0.085, 0.19, 0.12, 0, -0.15, 0.06, 0.3),        // grip
    box(0.10, 0.14, 0.26, 0, -0.03, 0.28),              // stock
    box(0.095, 0.06, 0.20, 0, -0.10, 0.30, -0.2),       // its comb, sloping down to the pad
    box(0.09, 0.022, 0.46, 0, 0.068, -0.66),            // heat shield
  ], PEN));
  root.add(part([
    box(0.03, 0.012, 0.12, 0, -0.105, -0.0),            // trigger guard
    box(0.03, 0.05, 0.012, 0, -0.08, -0.06),
    box(0.012, 0.04, 0.012, 0, -0.085, -0.02, -0.3),    // trigger
    box(0.004, 0.04, 0.12, 0.056, 0.03, -0.14),         // ejection port
    box(0.012, 0.008, 0.5, 0, 0.083, -0.68),            // sighting rib
    ...[-0.50, -0.58, -0.66, -0.74, -0.82].map((z) => box(0.05, 0.004, 0.03, 0, 0.081, z)),  // the shield's vents
    box(0.08, 0.12, 0.025, 0, -0.012, -0.98),           // the band that holds barrel and tube
    box(0.014, 0.035, 0.014, 0, 0.105, -1.08),          // front post
    box(0.105, 0.16, 0.05, 0, -0.035, 0.44),            // recoil pad
    box(0.006, 0.06, 0.18, -0.058, 0.0, -0.10),         // the saddle's plate
  ], BLACK));
  root.add(part([
    cyl({ r: 0.036, len: 0.78, at: [0, 0.03, -0.76], axis: 'z', seg: 10 }),     // barrel
    cyl({ r: 0.028, len: 0.62, at: [0, -0.06, -0.68], axis: 'z', seg: 9 }),     // magazine tube
    cyl({ r: 0.032, len: 0.04, at: [0, -0.06, -1.01], axis: 'z', seg: 9 }),     // its cap
  ], ROUND));
  // the pump, with raised bands to grip
  const pump = part([
    box(0.10, 0.09, 0.24, 0, -0.06, -0.58),
    ...[-0.49, -0.54, -0.59, -0.64, -0.69].map((z) => box(0.108, 0.098, 0.014, 0, -0.06, z)),
  ], PEN);
  root.add(pump);
  // Spare shells in the saddle: one mesh, drawn as far as the reserve goes (tick), so the side of
  // the gun says what is left to load.
  const shells = part([0, 1, 2, 3].map((i) => cyl({ r: 0.013, len: 0.055, at: [-0.071, 0.0, -0.04 - i * 0.04], axis: 'y', seg: 8 })),
    { ink: INK.ORANGE, look: LOOK.WASH });
  const perShell = shells.geometry.index.count / 4;
  root.add(shells);
  // The bead. Without it the shotgun aimed at nothing: a smooth tube with no
  // sight anywhere on it, so ADS had no line to put on the crosshair and the
  // pose was guesswork. It sits high enough on its post that the receiver
  // clears the sight picture rather than crowding it.
  root.add(part([box(0.020, 0.020, 0.012, 0, 0.132, -1.08)], { ink: INK.RED, look: LOOK.SOLID }, 'sight'));
  return {
    root, pump, shells, sight: 0.132,
    muzzle: new THREE.Vector3(0, 0.03, -1.16), eject: new THREE.Vector3(0.08, 0.03, -0.14),
    grip: new THREE.Vector3(0, -0.15, 0.06),
    // racked after each shot: back, and forward again before the next can go
    tick(gun) {
      pump.position.z = 0.13 * bump(sinceShot(gun), 0.12, 0.38, 0.45, 0.72);
      shells.geometry.setDrawRange(0, perShell * Math.max(0, Math.min(4, gun.reserveLeft)));
    },
  };
}

/**
 * Sniper: a bolt gun on a long stock. A stepped barrel and a ported brake, a
 * bipod folded under the fore-end, the scope with its turrets and bells, and a
 * bolt that is worked after every shot.
 */
export function buildSniper() {
  const root = new THREE.Group();
  root.add(part([
    box(0.085, 0.08, 0.55, 0, -0.03, -0.62),            // fore-end
    box(0.09, 0.10, 0.30, 0, -0.01, -0.17),             // the action's bed
    box(0.075, 0.18, 0.11, 0, -0.14, 0.05, 0.35),       // grip
    box(0.09, 0.12, 0.34, 0, -0.03, 0.32),              // stock
    box(0.085, 0.05, 0.22, 0, -0.105, 0.36, -0.15),     // its underside
    box(0.075, 0.035, 0.18, 0, 0.045, 0.30),            // cheek riser
  ], PEN));
  root.add(part([
    box(0.06, 0.07, 0.10, 0, -0.08, -0.15),             // box magazine
    box(0.03, 0.012, 0.12, 0, -0.085, 0.0),             // trigger guard
    box(0.012, 0.04, 0.012, 0, -0.07, -0.01, -0.3),     // trigger
    box(0.095, 0.16, 0.04, 0, -0.04, 0.51),             // butt pad
    box(0.03, 0.06, 0.03, 0, 0.08, -0.18),              // scope rings
    box(0.03, 0.06, 0.03, 0, 0.08, -0.42),
    // the bipod, folded: its mount, two legs along the fore-end, their feet
    box(0.05, 0.03, 0.04, 0, -0.085, -0.86),
    box(0.012, 0.012, 0.30, -0.03, -0.085, -0.70),
    box(0.012, 0.012, 0.30, 0.03, -0.085, -0.70),
    box(0.02, 0.016, 0.03, -0.03, -0.085, -0.54),
    box(0.02, 0.016, 0.03, 0.03, -0.085, -0.54),
    // the brake: four plates on a core, the gaps between them its ports
    ...[-1.46, -1.49, -1.52, -1.55].map((z) => box(0.06, 0.05, 0.02, 0, 0.005, z)),
  ], BLACK));
  root.add(part([
    cyl({ r: 0.04, len: 0.36, at: [0, 0.03, -0.17], axis: 'z', seg: 10 }),      // receiver
    cyl({ r: 0.03, len: 0.05, at: [0, 0.03, 0.03], axis: 'z', seg: 10 }),       // bolt shroud
    cyl({ r: 0.026, len: 0.36, at: [0, 0.005, -0.52], axis: 'z', seg: 9 }),     // barrel, heavy at the chamber
    cyl({ r: 0.02, len: 0.78, at: [0, 0.005, -1.09], axis: 'z', seg: 9 }),      // and lighter on
    cyl({ r: 0.016, len: 0.13, at: [0, 0.005, -1.505], axis: 'z', seg: 8 }),    // the brake's core
    cyl({ r: 0.04, len: 0.40, at: [0, 0.13, -0.30], axis: 'z', seg: 12 }),      // scope tube
    cyl({ r: 0.04, r2: 0.05, len: 0.10, at: [0, 0.13, -0.04], axis: 'z', seg: 12 }),    // eyepiece
    cyl({ r: 0.04, r2: 0.062, len: 0.09, at: [0, 0.13, -0.545], axis: 'z', seg: 12 }),  // objective bell
    cyl({ r: 0.062, len: 0.04, at: [0, 0.13, -0.61], axis: 'z', seg: 12 }),
    cyl({ r: 0.022, len: 0.045, at: [0, 0.19, -0.30], axis: 'y', seg: 10 }),    // elevation turret
    cyl({ r: 0.022, len: 0.045, at: [0.06, 0.13, -0.30], axis: 'x', seg: 10 }), // windage
    cyl({ r: 0.02, len: 0.04, at: [-0.058, 0.13, -0.30], axis: 'x', seg: 10 }), // parallax, on the side you see
  ], ROUND));
  // The bolt turns about the bore to unlock, and draws back: a group on the bore's axis, the
  // handle out to the right with its ball knob.
  const bolt = new THREE.Group();
  bolt.position.set(0, 0.03, -0.08);
  bolt.add(part([
    cyl({ r: 0.011, len: 0.09, at: [0.075, 0.0, 0.0], axis: 'x', seg: 6 }),
    new THREE.SphereGeometry(0.02, 8, 6).translate(0.125, -0.012, 0.0),
  ], BLACK));
  root.add(bolt);
  // the lens, on the scope's axis: the sight line runs through it
  root.add(part([cyl({ r: 0.052, len: 0.006, at: [0, 0.13, -0.633], axis: 'z', seg: 12 })], { ink: INK.BLACK, look: LOOK.SOLID }, 'sight'));
  return {
    root, bolt, sight: 0.13,                     // the scope axis is the sight line
    muzzle: new THREE.Vector3(0, 0.005, -1.58), eject: new THREE.Vector3(0.08, 0.05, -0.10),
    grip: new THREE.Vector3(0, -0.14, 0.05),
    // up, back, forward and down after each shot
    tick(gun) {
      const t = sinceShot(gun);
      bolt.rotation.z = 1.15 * bump(t, 0.08, 0.2, 0.72, 0.84);
      bolt.position.z = -0.08 + 0.11 * bump(t, 0.2, 0.38, 0.52, 0.7);
    },
  };
}

/**
 * Staple gun: what a paper plane drops. The striker lever along the top snaps
 * down with every staple, over the spring that drives it, showing on the side
 * you see. Staples ride in a track along the bottom and come out of the nose.
 * A rubber grip, and a bead and a notch to aim with.
 */
export function buildStapleGun() {
  const root = new THREE.Group();
  root.add(part([
    box(0.12, 0.17, 0.56, 0, 0.0, -0.26),               // body
    cyl({ r: 0.085, len: 0.12, at: [0, 0.0, 0.02], axis: 'x', seg: 10 }),     // its rounded back
  ], PEN));
  root.add(part([
    box(0.004, 0.13, 0.46, -0.062, -0.01, -0.28),       // side plates
    box(0.004, 0.13, 0.46, 0.062, -0.01, -0.28),
    ...[-0.12, -0.44].map((z) => cyl({ r: 0.011, len: 0.132, at: [0, -0.04, z], axis: 'x', seg: 6 })),   // rivets
    box(0.12, 0.12, 0.09, 0, -0.04, -0.585),            // the nose
    box(0.13, 0.02, 0.12, 0, -0.105, -0.57),            // its plate, where the staples come out
    box(0.10, 0.03, 0.44, 0, -0.10, -0.33),             // the staple track
    // the staples, a strip of them showing along the track
    ...Array.from({ length: 10 }, (_, i) => box(0.006, 0.022, 0.006, -0.051, -0.098, -0.16 - i * 0.032)),
    box(0.03, 0.012, 0.11, 0, -0.12, -0.08),            // trigger guard
    box(0.012, 0.04, 0.012, 0, -0.10, -0.10, -0.3),     // trigger
    box(0.014, 0.05, 0.014, 0, 0.11, -0.53),            // front post
    box(0.02, 0.075, 0.02, -0.025, 0.1225, 0.0),        // the rear notch: the bead sits in its gap
    box(0.02, 0.075, 0.02, 0.025, 0.1225, 0.0),
  ], BLACK));
  // the drive spring, ringed so it reads as a coil
  root.add(part([cyl({ r: 0.026, len: 0.26, at: [-0.05, 0.035, -0.26], axis: 'z', seg: 10 })], ROUND));
  root.add(part([box(0.10, 0.22, 0.13, 0, -0.17, -0.04, 0.18)], { ink: INK.ORANGE, look: LOOK.WASH }));
  // The lever is hinged at the front, and its back end snaps down with every staple (tick).
  const lever = new THREE.Group();
  lever.position.set(0, 0.105, -0.48);
  lever.add(part([
    box(0.08, 0.04, 0.46, 0, 0.0, 0.23),
    cyl({ r: 0.03, len: 0.10, at: [0, 0.0, 0.0], axis: 'x', seg: 8 }),       // the hinge
  ], BLACK));
  root.add(lever);
  root.add(part([box(0.02, 0.02, 0.012, 0, 0.15, -0.53)], { ink: INK.RED, look: LOOK.SOLID }, 'sight'));
  return {
    root, lever, sight: 0.15,
    muzzle: new THREE.Vector3(0, -0.10, -0.64), eject: new THREE.Vector3(0.07, 0.02, -0.22),
    grip: new THREE.Vector3(0, -0.17, -0.04),
    // down with the shot, and up again over the rest of the click
    tick(gun) {
      const t = sinceShot(gun);
      lever.rotation.x = gun.cooldown > 0 ? 0.13 * (1 - t) * (1 - t) : 0;
    },
  };
}

/**
 * The katana's blade, built face by face: stations along its length, each a
 * cross-section of six points (spine, ridge and edge on either flat), joined
 * into strips, and run out to the point. It rises towards the tip as a katana
 * curves and narrows a little; the flats meet at a real crease, the ridge line
 * (shinogi), which the outline pass draws as the line that says "katana" before
 * the guard does; and it thins to its edge.
 */
function bladeGeometry() {
  const L = 1.22, rise = (s) => 0.05 * (s / L) * (s / L), h = (s) => 0.085 - 0.02 * (s / L);
  const at = (s) => -0.03 - s;
  // spine, ridge, edge on the far flat, then edge, ridge, spine on the near: round the section
  const station = (s, k = 1, lift = 0) => {
    const ys = rise(s) + h(s) / 2, ye = rise(s) - h(s) / 2 + lift, yr = ye + 0.68 * (ys - ye);
    return [[-0.010, ys], [-0.016, yr], [-0.0015, ye], [0.0015, ye], [0.016, yr], [0.010, ys]]
      .map(([x, y]) => new THREE.Vector3(x * k, y, at(s)));
  };
  const rings = [];
  for (let i = 0; i <= 10; i++) rings.push(station((L * i) / 10));
  rings.push(station(L + 0.07, 0.7, 0.035));        // the edge sweeping up into the point
  const tip = new THREE.Vector3(0, rise(L) + h(L) * 0.3, at(L + 0.14));
  const tri = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1];
    for (let j = 0; j < 6; j++) { const k = (j + 1) % 6; tri.push(A[j], B[j], B[k], A[j], B[k], A[k]); }
  }
  const last = rings[rings.length - 1], first = rings[0];
  for (let j = 0; j < 6; j++) tri.push(last[j], tip, last[(j + 1) % 6]);
  for (let j = 1; j < 5; j++) tri.push(first[0], first[j], first[j + 1]);    // the end, under the collar
  // Every face wound to face out: away from a point on the blade's middle line, level with it
  // along the blade, held back from the two ends so the end faces are judged too.
  const pos = new Float32Array(tri.length * 3);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), c = new THREE.Vector3(), mid = new THREE.Vector3();
  for (let t = 0; t < tri.length; t += 3) {
    let [a, b, d] = [tri[t], tri[t + 1], tri[t + 2]];
    c.copy(a).add(b).add(d).multiplyScalar(1 / 3);
    const s = Math.max(0.05, Math.min(L, -0.03 - c.z));
    mid.set(0, rise(s), at(s));
    e1.subVectors(b, a).cross(e2.subVectors(d, a));
    if (e1.dot(c.sub(mid)) < 0) [b, d] = [d, b];
    a.toArray(pos, t * 3); b.toArray(pos, t * 3 + 3); d.toArray(pos, t * 3 + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return { geometry: g, tip };
}

/**
 * Katana: the curved blade, a collar, a disc guard, and the hilt in its
 * diamond wrap with an end cap. Held across the view, not down it.
 */
export function buildKatana() {
  const root = new THREE.Group();
  const blade = bladeGeometry();
  root.add(part([
    blade.geometry,
    cyl({ r: 0.028, len: 0.30, at: [0, 0, 0.20], axis: 'z', seg: 8 }),         // the hilt, under its wrap
  ], PEN));
  root.add(part([
    box(0.045, 0.105, 0.05, 0, 0.0, -0.035),            // collar
    cyl({ r: 0.075, len: 0.018, at: [0, 0, 0.0], axis: 'z', seg: 8 }),         // guard
    cyl({ r: 0.05, len: 0.006, at: [0, 0, 0.013], axis: 'z', seg: 8 }),        // its washer
    cyl({ r: 0.031, len: 0.03, at: [0, 0, 0.365], axis: 'z', seg: 8 }),        // end cap
  ], BLACK));
  // The wrap: thin straps crossing one way and back on each of the hilt's four sides, which
  // leaves the row of diamonds a katana's hilt is known by.
  const wraps = [];
  for (let i = 0; i < 6; i++) {
    const z = 0.085 + i * 0.048;
    for (const a of [-0.62, 0.62]) {
      for (const side of [-1, 1]) {
        wraps.push(box(0.004, 0.011, 0.068, side * 0.029, 0, z, a));
        wraps.push(box(0.011, 0.004, 0.068, 0, side * 0.029, z, 0, a));
      }
    }
  }
  root.add(part(wraps, { ink: INK.BLACK, look: LOOK.SOLID }));
  return {
    root, muzzle: blade.tip.clone(), eject: new THREE.Vector3(0, 0, 0),
    grip: new THREE.Vector3(0, 0, 0.2),
  };
}

/**
 * How the katana moves, the same in your hands (weapons/index.js) and in a friend's (rig.js):
 *
 *   the slash   raised on the right, the tip up, and cut diagonally down to the left, edge first
 *   the guard   the blade held level across the front of the body, edge out
 *   the rest    low on the right, the tip forward and a little in, as your own is held
 *
 * Directions are in the holder's frame: x to their right, y up, −z the way they face. Each
 * says where the blade points (the model's −z) and where its spine is (its +y). Where the
 * hands are is the drawer's to say (slashHands): your eye and a figure's shoulders are not in
 * the same place.
 *
 * In the slash the hands go from up on the right down to the left, and the blade turns with
 * them through the plane of `up` and `across`: at angle `a` it points sin(a) up and cos(a)
 * across, from up (`from`) round through up-and-left to down-and-left (`to`). That plane is
 * nearly square to the way they face, so the blade is seen along its length through the whole
 * cut, from behind it (your own eyes) and from in front (a friend's). A cut in the plane of
 * `up` and straight ahead is what a sword does, but from the eye that swings it the blade then
 * points away down the line of sight, and all that is seen go by is the hilt.
 *
 * It is wound up by `raised` of its time, cut by `cut`, and brought back to the rest by the end.
 * The blow lands at 0.4 (Katana.update), as the blade crosses in front.
 */
const SLASH_UP = new THREE.Vector3(0.75, 1, 0).normalize();
export const KATANA_MOVES = {
  up: SLASH_UP,                         // up, and to the right
  // across to the left, and a little ahead (squared to `up`)
  across: new THREE.Vector3(-1, 0, -0.45).projectOnPlane(SLASH_UP).normalize(),
  from: 1.3,            // the tip up, a little to the right
  to: -1.35,            // down and to the left: the other way along the diagonal from `up`
  raised: 0.2,
  cut: 0.65,
  guard: { dir: new THREE.Vector3(-1, 0.12, -0.25).normalize(), spine: new THREE.Vector3(0, 0, 1) },
  rest: { dir: new THREE.Vector3(-0.34, 0.05, -0.94).normalize(), spine: new THREE.Vector3(0, 1, 0) },
};

/**
 * Where the slash is at `t` (0-1 of its time): the angle `a` the blade is at, `k` how far through
 * the cut the hands are (0-1), and `w`, how far they are into the slash from where they were.
 */
export function slashAt(t, out = {}) {
  const M = KATANA_MOVES;
  const s = (u) => u * u * (3 - 2 * u);
  if (t < M.raised) {
    out.w = s(t / M.raised);
    out.k = 0;
  } else if (t < M.cut) {
    out.w = 1;
    out.k = s((t - M.raised) / (M.cut - M.raised));
  } else {
    out.w = s(1 - (t - M.cut) / (1 - M.cut));
    out.k = 1;
  }
  out.a = M.from + (M.to - M.from) * out.k;
  return out;
}

/** The blade at angle `a` of the slash: where it points, and its spine, behind the edge that leads. */
export function slashBlade(a, dir, spine) {
  const M = KATANA_MOVES;
  dir.copy(M.across).multiplyScalar(Math.cos(a)).addScaledVector(M.up, Math.sin(a));
  spine.copy(M.up).multiplyScalar(Math.cos(a)).addScaledVector(M.across, -Math.sin(a));
}

/**
 * Where the hands are `k` of the way through the cut: from `hands.from` to `hands.to`, and out
 * ahead by up to `hands.bulge` in the middle, as arms reach through a cut.
 */
export function slashHands(k, hands, out) {
  return out.copy(hands.from).lerp(hands.to, k).setZ(out.z - hands.bulge * Math.sin(Math.PI * k));
}

const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3(), _bm = new THREE.Matrix4();
/** The katana's turn, pointing along `dir` with its spine towards `spine` (squared to it), into `q`. */
export function bladeTurn(dir, spine, q) {
  _bz.copy(dir).normalize().negate();
  _by.copy(spine).addScaledVector(_bz, -spine.dot(_bz)).normalize();
  _bx.crossVectors(_by, _bz);
  return q.setFromRotationMatrix(_bm.makeBasis(_bx, _by, _bz));
}

/**
 * The thrown grenade: a body with a groove round it and one over the top, the
 * fuse's cap, the lever down its side, and the pin's ring. Two geometries, the
 * body and the fittings, for two instanced meshes (weapons/grenade.js).
 */
export function grenadeGeometry() {
  const body = mergeGeometries([
    new THREE.SphereGeometry(0.14, 12, 9).scale(1, 1.12, 1),
    new THREE.TorusGeometry(0.142, 0.012, 4, 16).rotateX(Math.PI / 2),
    new THREE.TorusGeometry(0.152, 0.01, 4, 16),
  ].map((g) => g.toNonIndexed()), false);
  const fittings = mergeGeometries([
    new THREE.CylinderGeometry(0.05, 0.055, 0.07, 8).translate(0, 0.17, 0),
    new THREE.BoxGeometry(0.035, 0.014, 0.17).rotateX(0.75).translate(0, 0.14, 0.07),
    new THREE.TorusGeometry(0.034, 0.008, 4, 10).rotateY(Math.PI / 2).translate(0.06, 0.2, 0),
  ].map((g) => g.toNonIndexed()), false);
  return { body, fittings };
}

/** The muzzle flash: a scribbled star, hidden until fired. */
export function buildFlash() {
  const geos = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    geos.push(box(0.02, 0.16, 0.02, 0, 0, 0, 0, 0, a));
  }
  const m = part(geos, { ink: INK.ORANGE, look: LOOK.SOLID });
  m.visible = false;
  return m;
}

const BUILD = { rifle: buildRifle, shotgun: buildShotgun, sniper: buildSniper, stapler: buildStapleGun, katana: buildKatana };
/** Each weapon's scale in your hands (weapons/index.js: 0.58 for the guns, the katana 0.7). */
const HELD_SCALE = { rifle: 0.58, shotgun: 0.58, sniper: 0.58, stapler: 0.58, katana: 0.7 };
// A friend's guns are their held scale times this, so the five keep the sizes they have to each
// other in your hands. Chosen so the rifle is as long on a figure as the prop it replaces (0.82 m
// on a figure 1.7 m tall): the rifle is 1.93 model units long, and 0.82 / (1.93 * 0.58) = 0.73.
const ON_FIGURE = 0.73;

/**
 * The weapon a friend's figure holds: the very model in your own hands, its parts merged into one
 * mesh per ink and look (the moving ones at rest), scaled to the figure, with `grip` at the hand.
 * `muzzle` is in the hand's frame, for where their tracers leave.
 */
export function buildProp(key) {
  const built = BUILD[key]();
  const s = HELD_SCALE[key] * ON_FIGURE;
  built.root.updateMatrixWorld(true);
  const by = new Map();
  built.root.traverse((o) => {
    if (!o.isMesh) return;
    // a clone has the whole geometry, so the shell saddle shows all four
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    g.translate(-built.grip.x, -built.grip.y, -built.grip.z).scale(s, s, s);
    if (!by.has(o.material)) by.set(o.material, []);
    by.get(o.material).push(g);
    o.geometry.dispose();
  });
  const root = new THREE.Group();
  for (const [mat, geos] of by) {
    if (geos.some((g) => !g.index)) for (let i = 0; i < geos.length; i++) if (geos[i].index) geos[i] = geos[i].toNonIndexed();
    const m = new THREE.Mesh(mergeGeometries(geos, false), mat);
    for (const g of geos) g.dispose();
    root.add(m);
  }
  return { root, muzzle: built.muzzle.clone().sub(built.grip).multiplyScalar(s) };
}
