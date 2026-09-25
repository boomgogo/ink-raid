import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surface } from '../../render/surface.js';
import { INK, LOOK } from '../../render/palette.js';

// Viewmodels, drawn the same way the world is: boxes and cylinders with no
// texture, letting the ink pass do the rest. The held weapon is patterned in
// its own frame (render/surface.js), so its strokes ride with it rather than
// crawling across it as it bobs and recoils.

function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/**
 * A capped cylinder geometry, own long axis chosen rather than assumed.
 *
 * `THREE.CylinderGeometry` always stands on y, closed at both ends, indexed,
 * with position/normal/uv — the same attribute set `box()` produces, so the
 * two merge cleanly in `part()`. This just turns that stock shape onto the
 * axis the caller wants and drops it at a point, taking its arguments as one
 * bag rather than a long positional list.
 */
function cyl({ r, len, at, axis = 'y', seg = 8 }) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  if (axis === 'x') g.rotateZ(Math.PI / 2);
  else if (axis === 'z') g.rotateX(Math.PI / 2);
  const [x, y, z] = at;
  g.translate(x, y, z);
  return g;
}

function part(geos, opts) {
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return new THREE.Mesh(merged, surface(opts));
}

/** Rifle: long, boxy, with a reflex sight on a mount. */
export function buildRifle() {
  const root = new THREE.Group();
  root.add(part([
    box(0.10, 0.13, 0.85, 0, 0, -0.22),          // receiver
    box(0.08, 0.09, 0.34, 0, 0.005, -0.78),      // handguard
    box(0.09, 0.20, 0.16, 0, -0.14, -0.02),      // grip
    box(0.10, 0.14, 0.30, 0, -0.02, 0.28),       // stock
    box(0.07, 0.22, 0.10, 0, -0.16, -0.30),      // magazine
  ], { ink: INK.PEN }));
  root.add(part([
    cyl({ r: 0.022, len: 0.5, at: [0, 0.015, -1.16], axis: 'z', seg: 7 }),    // barrel
    box(0.05, 0.05, 0.07, 0, 0.015, -1.40),      // muzzle
  ], { ink: INK.BLACK }));
  // The reflex sight is a built housing, not a red sticker on the rail: a hood,
  // a base bar, two walls and a mount, with the red dot floating in the middle
  // of an OPEN window. A flat coloured rectangle reads as a decal at any
  // distance and is one of the first things that gives a viewmodel away as
  // unfinished — but the window has to be open and it has to be big, because
  // aiming parks this housing exactly on the crosshair. A small solid one puts
  // a block of hatching precisely where the thing you are shooting has to be.
  // The carry handle that used to sit under it is gone for the same reason: it
  // stood in the bottom half of the sight picture.
  root.add(part([
    box(0.040, 0.045, 0.06, 0, 0.062, -0.30),    // mount
    box(0.150, 0.018, 0.06, 0, 0.221, -0.30),    // hood
    box(0.150, 0.018, 0.06, 0, 0.089, -0.30),    // base bar
    box(0.018, 0.114, 0.06, -0.066, 0.155, -0.30), // left wall
    box(0.018, 0.114, 0.06, 0.066, 0.155, -0.30),  // right wall
  ], { ink: INK.BLACK }));
  root.add(part([box(0.016, 0.016, 0.008, 0, 0.155, -0.30)], { ink: INK.RED, look: LOOK.SOLID }));
  return {
    root, sight: 0.155,
    muzzle: new THREE.Vector3(0, 0.015, -1.44), eject: new THREE.Vector3(0.07, 0.02, -0.14),
  };
}

/** Shotgun: fat tube, pump, wide muzzle. */
export function buildShotgun() {
  const root = new THREE.Group();
  root.add(part([
    box(0.12, 0.15, 0.62, 0, 0, -0.14),
    box(0.10, 0.20, 0.16, 0, -0.15, 0.02),
    box(0.12, 0.16, 0.34, 0, -0.02, 0.30),
  ], { ink: INK.PEN }));
  const pump = part([box(0.11, 0.11, 0.26, 0, -0.045, -0.62)], { ink: INK.PEN });
  root.add(pump);
  root.add(part([
    cyl({ r: 0.042, len: 0.95, at: [0, 0.03, -0.60], axis: 'z', seg: 8 }),
    cyl({ r: 0.030, len: 0.80, at: [0, -0.045, -0.55], axis: 'z', seg: 8 }),  // magazine tube
    box(0.016, 0.010, 0.66, 0, 0.078, -0.66),    // sighting rib
    box(0.014, 0.052, 0.014, 0, 0.104, -1.02),   // front post
  ], { ink: INK.BLACK }));
  // The bead. Without it the shotgun aimed at nothing: a smooth tube with no
  // sight anywhere on it, so ADS had no line to put on the crosshair and the
  // pose was guesswork. It sits high enough on its post that the receiver
  // clears the sight picture rather than crowding it.
  root.add(part([box(0.020, 0.020, 0.012, 0, 0.132, -1.02)], { ink: INK.RED, look: LOOK.SOLID }));
  return {
    root, pump, sight: 0.132,
    muzzle: new THREE.Vector3(0, 0.03, -1.08), eject: new THREE.Vector3(0.08, 0.02, -0.10),
  };
}

/** Sniper: very long barrel, big scope, bolt. */
export function buildSniper() {
  const root = new THREE.Group();
  root.add(part([
    box(0.09, 0.12, 0.72, 0, 0, -0.18),
    box(0.09, 0.19, 0.15, 0, -0.14, 0.04),
    box(0.10, 0.16, 0.40, 0, -0.02, 0.34),
    box(0.06, 0.05, 0.30, 0, -0.09, -0.62),      // fore-end
  ], { ink: INK.PEN }));
  root.add(part([
    cyl({ r: 0.020, len: 1.10, at: [0, 0.005, -1.02], axis: 'z', seg: 7 }),
    cyl({ r: 0.034, len: 0.10, at: [0, 0.005, -1.55], axis: 'z', seg: 8 }),   // brake
  ], { ink: INK.BLACK }));
  const bolt = part([
    cyl({ r: 0.016, len: 0.16, at: [0.07, 0.05, -0.10], axis: 'x', seg: 6 }),
    box(0.03, 0.03, 0.03, 0.15, 0.05, -0.10),
  ], { ink: INK.BLACK });
  root.add(bolt);
  root.add(part([
    cyl({ r: 0.055, len: 0.42, at: [0, 0.13, -0.30], axis: 'z', seg: 10 }),   // scope tube
    cyl({ r: 0.075, len: 0.08, at: [0, 0.13, -0.50], axis: 'z', seg: 10 }),   // objective
    box(0.03, 0.07, 0.03, 0, 0.085, -0.16),
    box(0.03, 0.07, 0.03, 0, 0.085, -0.44),
  ], { ink: INK.PEN }));
  return {
    root, bolt, sight: 0.13,                     // the scope axis is the sight line
    muzzle: new THREE.Vector3(0, 0.005, -1.60), eject: new THREE.Vector3(0.08, 0.05, -0.10),
  };
}

/**
 * Staple gun: what a paper plane drops. A squat body on a pistol grip, the
 * striker lever along its top, and the nose the staples come out of at the
 * front and bottom. The lever's top edge is the sight line.
 */
export function buildStapleGun() {
  const root = new THREE.Group();
  root.add(part([
    box(0.13, 0.20, 0.62, 0, 0.02, -0.26),       // body
    box(0.11, 0.24, 0.14, 0, -0.17, 0.0, 0.18),  // grip
  ], { ink: INK.PEN }));
  root.add(part([
    box(0.09, 0.05, 0.56, 0, 0.145, -0.22),      // the lever
    box(0.13, 0.11, 0.10, 0, -0.05, -0.60),      // the nose
    box(0.14, 0.03, 0.40, 0, -0.07, -0.30),      // the magazine's edge
  ], { ink: INK.BLACK }));
  root.add(part([box(0.115, 0.10, 0.12, 0, -0.20, 0.0, 0.18)], { ink: INK.ORANGE, look: LOOK.WASH }));
  return {
    root, sight: 0.17,
    muzzle: new THREE.Vector3(0, -0.08, -0.66), eject: new THREE.Vector3(0.07, 0.02, -0.22),
  };
}

/** Katana: a long blade with a wrapped hilt. Held across the view, not down it. */
export function buildKatana() {
  const root = new THREE.Group();
  const blade = part([
    box(0.035, 0.10, 1.25, 0, 0, -0.62),
    box(0.020, 0.06, 0.16, 0, 0.02, -1.30),      // tip taper
  ], { ink: INK.PEN });
  root.add(blade);
  root.add(part([
    box(0.14, 0.03, 0.14, 0, 0, 0.02),           // guard
    cyl({ r: 0.028, len: 0.30, at: [0, 0, 0.20], axis: 'z', seg: 8 }),        // hilt
  ], { ink: INK.BLACK }));
  // the wrap: little bands, the detail that says "katana" at a glance
  const wraps = [];
  for (let i = 0; i < 6; i++) wraps.push(box(0.062, 0.062, 0.022, 0, 0, 0.09 + i * 0.045, 0, 0, 0.5));
  root.add(part(wraps, { ink: INK.PEN, look: LOOK.SOLID }));
  return { root, blade, muzzle: new THREE.Vector3(0, 0, -1.35), eject: new THREE.Vector3(0, 0, 0) };
}

/** A grenade in the hand, and the thrown object. */
export function buildGrenade() {
  const g = new THREE.Group();
  g.add(part([
    cyl({ r: 0.055, len: 0.12, at: [0, 0, 0], axis: 'y', seg: 10 }),
    box(0.02, 0.05, 0.02, 0.03, 0.08, 0),
  ], { ink: INK.BLACK }));
  return g;
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
