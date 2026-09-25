import * as THREE from 'three';
import { Builder } from './build.js';
import { INK, LOOK } from '../render/palette.js';

// A calibration scene, not a level.
//
// The map and the shader are two different variables, and judging the ink pass
// through a half-built level confuses them: a flat, empty page can mean the
// hatching is broken OR that nothing in front of the camera happens to face away
// from the light. This scene pins the second one down — known shapes, at known
// distances, at known angles — so anything wrong in the picture is the shader.
//
// What it exercises, left to right:
//   * a bare floor running to the horizon      -> outlines must draw NOTHING on it
//   * cubes at 8 / 16 / 32 / 64 m              -> hatch spacing and LOD vs distance
//   * a large wall square to the camera        -> stroke spacing, weight, waver
//   * a wall raked to 20 deg                   -> foreshortening without moire
//   * a cylinder and a sphere                  -> curvature, silhouette, banding
//   * a step pyramid                           -> creases where depth is continuous
//   * one cube of every ink                    -> palette
//   * a 1.2 m post beside each cube            -> a human-scale reference

export function buildCalib(scene) {
  const b = new Builder();

  b.box(0, -2, 0, 400, 2, 400, { ink: INK.PEN, lift: 0.30, tag: 'floor' });

  // distance ladder, marching away down -z
  for (const dist of [8, 16, 32, 64, 128]) {
    const s = 4;
    b.box(0, 0, -dist, s, s, s, { ink: INK.PEN });
    b.box(s * 0.9, 0, -dist, 0.35, 1.2, 0.35, { ink: INK.PEN });   // human-scale post
  }

  // a big wall square to the camera, and one raked away from it
  b.box(-24, 0, -30, 26, 18, 2, { ink: INK.PEN, tag: 'wall' });
  b.box(24, 0, -30, 26, 18, 2, { ink: INK.PEN, rotY: -1.22, tag: 'raked' });

  // curvature
  b.cyl(-12, 0, -14, 3, 12, { ink: INK.PEN, seg: 24 });
  b.sphere(12, 5, -14, 4, { ink: INK.PEN, seg: 20, seg2: 14 });

  // creases: depth is continuous across these, only the normal jumps
  for (let i = 0; i < 5; i++) {
    const s = 10 - i * 1.8;
    b.box(0, i * 1.4, 14, s, 1.4, s, { ink: INK.PEN });
  }

  // the palette, one cube each, plus a solid-fill cube to check the fill path.
  // Read off the enum's own order (Object.values) rather than spelling the
  // names out here a second time, so cube i always matches Object.keys(INK)[i]
  // — the order tools/render.mjs's palette check assumes — however INK is arranged.
  const inks = Object.values(INK);
  inks.forEach((ink, i) => {
    b.box(-18 + i * 5.4, 0, 10, 3.2, 3.2, 3.2, { ink });
  });
  b.box(21, 0, 10, 3.2, 3.2, 3.2, { ink: INK.PEN, look: LOOK.SOLID });

  // an overhang, so there is a guaranteed underside at full ink
  b.box(0, 9, -6, 20, 0.6, 8, { ink: INK.PEN });
  b.box(-9, 0, -6, 1.2, 9, 1.2, { ink: INK.PEN });
  b.box(9, 0, -6, 1.2, 9, 1.2, { ink: INK.PEN });

  b.startPoint.set(0, 0.2, 22);
  const level = b.finish(scene);
  level.edge = 180;
  level.killY = -50;
  level.name = 'CALIBRATION';
  level.blurb = 'not a level';
  level.spawns = [new THREE.Vector3(0, 0.2, 22)];
  return level;
}

// Poses that frame each test. Used by the shot harness.
export const CALIB_SHOTS = {
  'calib-ladder': [[0, 3.0, 24], [0, 2, -60]],
  'calib-wall': [[-24, 6.0, -8], [-24, 6, -30]],
  'calib-raked': [[10, 4.0, -6], [26, 5, -30]],
  'calib-curve': [[0, 4.0, 4], [0, 4, -14]],
  'calib-floor': [[0, 1.7, 30], [0, 0.9, -40]],
  'calib-creases': [[0, 6.0, 34], [0, 2, 14]],
  'calib-palette': [[3, 3.0, 24], [3, 1.6, 10]],
  'calib-overhang': [[0, 1.7, 8], [0, 7, -6]],
};
