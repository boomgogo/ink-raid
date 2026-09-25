import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { surface } from '../render/surface.js';
import { INK, LOOK } from '../render/palette.js';
import { KEY } from '../render/pipeline.js';

// The sky is not a colour — the paper shows through. Overhead there is a
// scribbled sun and a few clouds, and nothing else.
//
// There used to be a dome as well, meridians and latitude rings drawn over the
// whole sky, and it was removed: from the ground its lines were
// arcs across everything you looked up at. The clouds were moved further up and
// away: they are higher and about twice as far out now, and
// bigger to make up for it, so they read as background and not as something on
// the desk. All of it sits inside the far plane (render/pipeline.js), so the
// distance fade keeps it pale.
//
// The sun hangs where the key light comes from (render/pipeline.js), so the
// side of everything that faces it is the lit side: up and over the right
// shoulder of the spawn view, 49 degrees above the horizon.

const R = 190;

export function buildSky(scene) {
  const mat = surface({ ink: INK.PEN, look: LOOK.SOLID });

  // --- the sun: a ring with radial ticks -----------------------------------
  const sunGeos = [];
  const sunDir = KEY.clone().multiplyScalar(R * 0.86);
  {
    const rr = 9;
    const ring = new THREE.TorusGeometry(rr, 0.34, 5, 24);
    sunGeos.push(ring);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const t = new THREE.BoxGeometry(0.5, 4.4, 0.5);
      t.translate(0, rr + 3.2, 0);
      t.rotateZ(a);
      sunGeos.push(t);
    }
    const sun = new THREE.Mesh(mergeGeometries(sunGeos, false), mat);
    for (const g of sunGeos) g.dispose();
    sun.position.copy(sunDir);
    sun.lookAt(0, 0, 0);
    sun.frustumCulled = false;
    scene.add(sun);
  }

  // --- clouds: overlapping puffs, outline only -----------------------------
  const cloudGeos = [];
  const rnd = mulberry(7);
  const CLOUD = 330;                                   // was 171
  for (let c = 0; c < 5; c++) {
    const a = rnd() * Math.PI * 2;
    const phi = 0.38 + rnd() * 0.24;                   // was 0.22-0.42
    const cx = Math.cos(a) * Math.cos(phi) * CLOUD;
    const cy = Math.sin(phi) * CLOUD;
    const cz = Math.sin(a) * Math.cos(phi) * CLOUD;
    const n = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const s = (5 + rnd() * 5) * 1.5;
      const g = new THREE.SphereGeometry(s, 9, 6);
      g.scale(1, 0.72, 1);
      g.translate(cx + (i - n / 2) * s * 1.25, cy + (rnd() - 0.5) * s * 0.5, cz);
      cloudGeos.push(g);
    }
  }
  if (cloudGeos.length) {
    const clouds = new THREE.Mesh(mergeGeometries(cloudGeos, false), surface({ ink: INK.PEN, lift: 0.42 }));
    for (const g of cloudGeos) g.dispose();
    clouds.frustumCulled = false;
    scene.add(clouds);
  }

  // The paper aeroplanes that used to orbit out here were too far away to see.
  // They fly over the desk now, to be shot down: entities/planes.js.
  return { update() {} };
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
