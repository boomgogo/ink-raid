import * as THREE from 'three';
import { surface } from '../../render/surface.js';
import { INK, LOOK } from '../../render/palette.js';

// The `?` and `!` over an enemy's head.
//
// An enemy that does not know where you are has to SAY so, or stealth is a
// guess: a `?` that grows while it is noticing you, and a `!` for a second
// when it has. Both are written with the same few pen strokes the particles
// are — short boxes — in one instanced mesh, so every mark over every enemy is
// one draw call. The strokes are laid out in the camera's own plane, so the
// glyphs always face you.

// Strokes in glyph units, a glyph one unit tall: [x0, y0, x1, y1] each, and a
// dot as a zero-length stroke.
const QUESTION = [
  [-0.26, 0.7, -0.2, 0.9], [-0.2, 0.9, 0, 0.98], [0, 0.98, 0.2, 0.9], [0.2, 0.9, 0.26, 0.7],
  [0.26, 0.7, 0.08, 0.5], [0.08, 0.5, 0, 0.3], [0, 0.08, 0, 0.08],
];
const BANG = [[0, 0.98, 0, 0.32], [0, 0.08, 0, 0.08]];
const STROKE = 0.14;
const MAX = 28;
const PER = QUESTION.length;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

export class Marks {
  constructor(ctx) {
    this.ctx = ctx;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), surface({ ink: INK.RED, look: LOOK.SOLID }), MAX * PER);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * PER * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    ctx.scene.add(this.mesh);
  }

  update(list) {
    const cam = this.ctx.camera;
    let n = 0, glyphs = 0;
    if (cam) {
      _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      for (const e of list) {
        if (!e.alive || glyphs >= MAX) continue;
        let strokes, size, ink;
        if (e.markT > 0) {
          strokes = BANG; ink = INK.RED;
          size = 0.55 * (1 + 0.35 * Math.max(0, e.markT - 0.8) * 5);     // pops, then settles
        } else if (e.mind !== 'hunt' && e.notice > 0.04) {
          strokes = QUESTION; ink = INK.BLACK;
          size = 0.3 + 0.3 * Math.min(1, e.notice);
        } else continue;
        glyphs++;
        // readable at range: grows with distance past 14 m, up to 2.5x
        const d = cam.position.distanceTo(e.body.pos);
        size *= Math.min(2.5, Math.max(1, d / 14));
        const bx = e.body.pos.x, by = e.body.pos.y + e.body.height * 1.18 + 0.2, bz = e.body.pos.z;
        for (const [x0, y0, x1, y1] of strokes) {
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          _p.set(bx, by, bz).addScaledVector(_right, mx * size).addScaledVector(_up, my * size);
          const len = Math.hypot(x1 - x0, y1 - y0);
          // lay the box in the camera plane, turned along the stroke
          _q.copy(cam.quaternion).multiply(_qz.setFromAxisAngle(Z, Math.atan2(y1 - y0, x1 - x0)));
          _s.set((len + STROKE) * size, STROKE * size, STROKE * size);
          _m.compose(_p, _q, _s);
          this.mesh.setMatrixAt(n, _m);
          this.mesh.instanceColor.setXYZ(n, ink, LOOK.SOLID, 1);
          n++;
        }
      }
    }
    if (n === 0 && this.mesh.count === 0) return;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}
