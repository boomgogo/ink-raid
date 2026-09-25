import * as THREE from 'three';
import { PAPER_KINDS } from './palette.js';
import { SHARED, surface } from './surface.js';
import { pageMaterial, pageTriangle, VIEWS } from './page.js';
import { pixelRatio } from './pixels.js';

// The frame, in three passes:
//
//   1. WORLD. The scene, drawn once into the page buffer: one RGBA8 colour
//      target and a depth texture. Every surface writes its pattern's ink, its
//      tone, and its ink and look packed together (surface.js).
//   2. HELD WEAPON. The group `hold()` was given, parented to the camera, drawn
//      into the same buffer with a near plane of its own. The world is drawn
//      into depth [K, 1] and the weapon into [0, K) with gl.depthRange, so the
//      weapon is always in front — it cannot clip into a wall you stand
//      against — and the page pass can still decode both depths exactly, so
//      its outlines and pattern work like everything else's.
//   3. PAGE. One full-screen triangle turns the buffer and depth into the
//      picture (page.js).

// The world camera's near plane. The player's body is 0.35 m in radius and the
// corners of a near plane at an 80 degree vertical FOV on a 16:10 screen are
// 1.9 near planes from the eye, so 0.1 m cannot reach a wall you are touching
// — and every doubling of it halves the depth quantisation the outline pass
// has to see past (about 6e-7 of 1/z per step, 1.8e-4 relative at 100 m).
export const NEAR = 0.1;
// The far plane: the clouds are 330 m out and 15 m across (world/sky.js).
export const FAR = 450;
// The held weapon's own near and far. Its rearmost point sits 9 cm in front of
// the eye at the hip and the recoil throws it a few centimetres nearer; the
// katana's swing reaches about a metre and a half out.
export const HAND_NEAR = 0.01;
export const HAND_FAR = 4;
// The weapon's share of the depth range: 1/64 of 24 bits is 262,144 steps over
// 1/z from 100 to 0.25, which resolves the weapon's own creases, and costs the
// world 1.6% of its precision.
export const HAND_K = 1 / 64;

// The key light: from above and over the right shoulder of someone looking
// down -z, which is how the spawn and every calibration shot look. With no
// lift, a top sits at tone 0.10 (bare), a face to the right at 0.22 (all but
// bare), a face towards the camera (+z) at 0.32 (a light single hatch), a face
// away (-z) at 0.61 and one to the left at 0.70 (lines and stipple), and an
// underside at 0.88, the darkest thing on the page: dots alone. Undersides
// being darkest is what the level was built around (world/map_desk.js, rule 2).
// The drawn sun in the sky (world/sky.js) is drawn along this same direction,
// 49 degrees up, so the drawing's light comes from the sun it shows.
export const KEY = new THREE.Vector3(0.55, 0.75, 0.35).normalize();
// The fill: a weak bounce from the opposite, shadow side, a little above the
// horizon, so faces in shadow are not all one tone.
const FILL = new THREE.Vector3(-0.7, 0.2, -0.6).normalize();

export class Pipeline {
  constructor(canvas) {
    this.canvas = canvas;
    const r = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance',
    });
    // The page pass writes the palette's values as they are.
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.autoClear = false;
    r.info.autoReset = false;
    this.renderer = r;
    this.gl = r.getContext();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, 1, NEAR, FAR);
    this.hand = new THREE.PerspectiveCamera(80, 1, HAND_NEAR, HAND_FAR);
    this.hand.matrixAutoUpdate = false;
    this.hand.matrixWorldAutoUpdate = false;
    this.held = null;

    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });

    this.page = new THREE.Mesh(pageTriangle(), pageMaterial());
    this.page.frustumCulled = false;
    this.pageCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const u = this.page.material.uniforms;
    u.tPage.value = this.target.texture;
    u.depthTex.value = this.target.depthTexture;
    u.uK.value = HAND_K;

    SHARED.uLight.value.copy(KEY);
    SHARED.uCover.value.copy(FILL);

    this.stats = { calls: 0, tris: 0 };
    this.size = { cssW: 0, cssH: 0, ratio: 1, w: 0, h: 0 };
    this.view = 'final';
    this.paper = 'dots';
    // The canvas is the whole window (index.html), so the window's resize is
    // the only one there is. Asking the canvas its size every frame would force
    // a layout after the HUD's writes, every frame.
    this._resize();
    addEventListener('resize', () => this._resize());

    // Start both programs compiling now, after the canvas has its size (a
    // resize waits for the GPU to finish what it was given). The GPU process
    // compiles while this thread goes on to build the level, so the first frame
    // waits for the rest of the compile rather than all of it: on a cold start
    // the compile is most of the first frame.
    const warm = new THREE.Scene();
    warm.add(new THREE.Mesh(new THREE.BufferGeometry(), surface()));
    r.compile(warm, this.camera);
    r.compile(this.page, this.pageCam);
  }

  /** The group the player holds, parented to the camera: drawn over the world. */
  hold(group) { this.held = group; }

  setPaper(kind) {
    if (!PAPER_KINDS.includes(kind)) return;
    this.paper = kind;
    this.page.material.uniforms.uGraph.value = kind === 'graph' ? 1 : 0;
  }

  /** Test hook: false leaves the stipple out, so the lines can be seen alone. */
  debugDots(on) { SHARED.uDots.value = on ? 1 : 0; }

  setView(name) {
    const i = VIEWS.indexOf(name);
    if (i < 0) return;
    this.view = name;
    this.page.material.uniforms.uView.value = i;
  }

  _resize() {
    const cssW = Math.max(1, this.canvas.clientWidth || innerWidth);
    const cssH = Math.max(1, this.canvas.clientHeight || innerHeight);
    const touch = matchMedia('(pointer: coarse)').matches;
    const ratio = pixelRatio(cssW, cssH, devicePixelRatio || 1, touch);
    const s = this.size;
    if (s.cssW === cssW && s.cssH === cssH && s.ratio === ratio) return;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(cssW, cssH, false);
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(db.x, db.y);
    Object.assign(s, { cssW, cssH, ratio, w: db.x, h: db.y, touch });
    this.camera.aspect = cssW / cssH;
    this.camera.updateProjectionMatrix();
    const u = this.page.material.uniforms;
    u.uPx.value = ratio;
    SHARED.uPx.value = ratio;
    // the dot grid: a dot every 1/27 of the canvas height, both ways
    u.uGrid.value = db.y / 27;
  }

  render(t, fx = {}) {
    const r = this.renderer;
    const gl = this.gl;
    const cam = this.camera;

    r.info.reset();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    // the page pass leaves depth writes off, and clear() obeys the mask
    r.state.buffers.depth.setMask(true);
    r.state.buffers.color.setMask(true);
    r.clear(true, true, false);

    // 1. the world, in [K, 1] of the depth range, without the weapon
    const held = this.held;
    const heldWas = held ? held.visible : false;
    if (held) held.visible = false;
    gl.depthRange(HAND_K, 1);
    r.render(this.scene, cam);

    // 2. the weapon, in [0, K): the same view, its own near and far
    if (held && heldWas) {
      held.visible = true;
      const h = this.hand;
      if (h.fov !== cam.fov || h.aspect !== cam.aspect) {
        h.fov = cam.fov;
        h.aspect = cam.aspect;
        h.updateProjectionMatrix();
      }
      h.matrixWorld.copy(cam.matrixWorld);
      h.matrixWorldInverse.copy(cam.matrixWorldInverse);
      gl.depthRange(0, HAND_K);
      r.render(held, h);
    }
    if (held) held.visible = heldWas;
    gl.depthRange(0, 1);

    // 3. the page
    const u = this.page.material.uniforms;
    u.uDepth.value.set(1 / NEAR, 1 / NEAR - 1 / FAR, 1 / HAND_NEAR, 1 / HAND_NEAR - 1 / HAND_FAR);
    u.uDelta.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / this.size.h;
    u.uFx.value.set(fx.hurt || 0, fx.nearDeath || 0, fx.flash || 0, fx.slow || 0);
    u.uTime.value = t;
    r.setRenderTarget(null);
    r.render(this.page, this.pageCam);

    this.stats.calls = r.info.render.calls;
    this.stats.tris = r.info.render.triangles;
  }
}
