import * as THREE from 'three';
import { INK, LOOK } from './palette.js';
import { PACK_GLSL } from './pack.js';
import { TONE, TONE_GLSL } from './tone.js';

// The world pass: every surface in the game, drawn by one program.
//
// A surface writes three things into the page buffer, and a fourth for the
// outlines (see pipeline.js):
//
//   R  how much ink its pattern puts on this pixel, 0-1
//   G  its tone, 0 (lit) to 1 (turned away from the light)
//   B  its ink and its look, packed (pack.js)
//   A  a slow noise anchored to the surface, which the page pass reads as the
//      pen's pressure: the weight of the outline drawn along it
//
// THE FRAME. The pattern is computed at `vPat`, the vertex position in the
// object's own frame, scaled to world units: position times the length of
// each column of the full model matrix. For the merged static world the model
// matrix is the identity, so that is world space. For anything that moves — a
// mover body (its matrix comes from the bodies texture), an instance, a
// figure's limb, the held weapon — it is the thing's own frame, so the pattern
// is carried with it and never swims.
//
// SLICE LINES. A stroke lies where the surface crosses one of a family of
// evenly spaced parallel planes. There are three plane directions, FAMILIES:
// an orthonormal triad, the world axes turned 72 degrees about (1,1,1). At
// each pixel the family whose planes cut the surface most steeply (smallest
// |n.a|) draws the lines. The triad is chosen so every axis-aligned face has
// one clear winner: on each of them the three |n.a| are 0.32, 0.54 and 0.78,
// so a box's faces never sit near a switch, and the steepest family always
// crosses at 71 degrees. Hatching comes out at 35 and 55 degrees on walls.
//
// OCTAVES. The spacing is 2^k world units, k chosen from the screen-space
// derivative of the slice coordinate so the lines sit P px apart at the
// coarse end of an octave and P/2 at the fine end. Within an octave the lines
// fall into three classes: every 4th half-spacing (A, kept at both levels),
// the odd whole spacings (B, primary at level k, the halfway set at k+1) and
// the odd half-spacings (C, the halfway set at k, gone at k+1). Their widths
// are interpolated so coverage is exactly constant through the octave, and at
// the octave boundary the next level's pattern is the same lines at the same
// widths: nothing pops.
//
// STIPPLE. Dots on a jittered lattice in the plane of the two families that
// are not most aligned with the normal, measured in SCREEN pixels through the
// inverse Jacobian so each dot is round on the page at every angle and
// distance. Octaves again: at level k one dot in each 2x2 block survives into
// level k+1 (and slides, over the octave, to where level k+1 puts it); the
// other three shrink with exactly the radius that keeps coverage constant.
//
// SWITCHES. Where the steepest family changes (on a curved surface), the lines
// of the outgoing family thin away to nothing and the incoming one grows from
// nothing, and the coverage they give up is handed to the stipple over the
// same band. So a switch is a soft band of dots: no seam, and never two
// directions crossing. Where the stipple's plane changes, both lattices draw
// over the band with their radii split.

// --- constants ----------------------------------------------------------------

const TH = (72 * Math.PI) / 180;
const C1 = (1 + 2 * Math.cos(TH)) / 3;
const C2 = (1 - Math.cos(TH)) / 3 - Math.sin(TH) / Math.sqrt(3);
const C3 = (1 - Math.cos(TH)) / 3 + Math.sin(TH) / Math.sqrt(3);
/** The three slicing-plane normals, in any pattern frame. */
export const FAMILIES = [[C1, C3, C2], [C2, C1, C3], [C3, C2, C1]];

const v3 = (a) => /* glsl */ `vec3(${a.map((x) => x.toFixed(6)).join(', ')})`;
const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));

// A switch between families is blended over this much difference in |n.a|.
// 0.05 puts 7% of wall orientations inside a band (see the note on FAMILIES)
// and on a sphere is a band about 3 degrees wide: wide enough to hide the
// change of direction, narrow enough that flat faces almost never land in it.
const BAND = 0.05;
// On a curved surface the band is widened to at least this many pixels on the
// page. A sphere 280 px across turns its normal 1/140 rad a pixel, so 0.05 of
// |n.a| went by in 7 px: the families met in hard chevrons and rings round
// the point where three of them meet. Across 28 px (three line periods) the
// lines thin out and dots carry the tone between them, so a round thing reads
// as patches of strokes turning with it. Flat faces have no curvature and
// keep the narrow band. Capped at 0.3 of |n.a|: past that, on a small far
// round thing, it is dots.
const BAND_PX = 28;
const BAND_MAX = 0.3;
// Stipple grain: a big shadow plane stippled edge to edge with one size of dot
// read as grey static. The dots' pitch drifts across a surface, from 0.8 to
// 1.5 of nominal, with a noise about 4 m across anchored like the pattern: a
// shadow breaks into patches of fine, close dots and of larger, sparser ones,
// as a hand fills a big shadow. The radius scales with the pitch, so the
// coverage, and the tone it stands for, is the same everywhere; on average the
// dots are 15% further apart than PD, which also takes edges out of the page.
const GRAIN_MEAN = 1.15;
const GRAIN_SWING = 0.35;
const MOTTLE_M = 1.5;
// Dot jitter, as a fraction of a lattice cell: each dot sits anywhere in the
// middle half of its cell. At 0.35 the lattice's rows still showed, and against
// the lines they read as a second direction; at 0.5 they are gone, and two
// neighbours are still at least half a cell apart, so it is rare for the
// darkest dots (0.62 of a cell across) to touch.
const JIT = 0.5;
// How far strokes waver off their planes: 16% of the local spacing, a wobble a
// hand makes, never enough to touch the next line (the halfway set is 50% off).
const WAVER = 0.16;
// The waver's wavelength: one noise texel per 3 line spacings, and the noise is
// smoothed over about three texels, so a stroke bends over roughly nine lines'
// width. Shorter reads as a tremor; longer, as a curved surface.
const WAVE_CELLS = 3;
// Pressure along a stroke: its width runs between 0.8 and 1.2 of nominal.
const PRESS = 0.4;
// MASS: the figures' lines, 4.5 cm apart in the figure's own frame. A figure
// 1.7 m tall at 10 m is 81 px tall and its lines 2.1 px apart, so it is
// already a solid shape there; at 5 m the lines open up to 4 px and read as a
// hatched body. Their width is what closes them up: at 1.6 px a pixel midway
// between two lines 2.1 px apart is still half ink, which is what
// tools/figures.mjs needs to see one connected red shape; 2.2 in shadow.
const MASS_S = 0.045;
const MASS_W0 = 1.6;
const MASS_W1 = 2.2;
// WASH: a marker's tint, a little heavier on the shadow side, plus streaks
// where the marker's strokes overlap. A marker stroke is broad, so the streaks
// are five line periods apart (22-45 px) and soft-edged: at three periods and
// hard-edged they read as a second, coarser hatching.
const WASH_TINT = 0.24;
const WASH_SHADE = 0.1;
const WASH_STREAK = 0.08;
const WASH_PERIOD = 5;
// The fill light's share of the brightness. Enough that faces in shadow are
// not all one tone, not enough to lift any of them out of it.
const FILL_K = 0.1;

// --- shared state: the noise tile, and uniforms the pipeline sets for everyone --

let noiseTex = null;

/** A 32^3 tile of smooth noise in four channels, made here: nothing to download. */
function makeNoise() {
  const N = 32;
  const n = N * N * N;
  let seed = 0x1234abcd;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const data = new Uint8Array(n * 4);
  let ch = new Float32Array(n);
  let tmp = new Float32Array(n);
  const M = N - 1;
  for (let c = 0; c < 4; c++) {
    for (let i = 0; i < n; i++) ch[i] = rnd();
    // three passes of a [1 2 1] blur on each axis, wrapping: the tile stays
    // seamless and its features are about three texels across. Index
    // arithmetic on a power of two, so it costs a few milliseconds at start,
    // not tens.
    for (let pass = 0; pass < 3; pass++) {
      for (const shift of [0, 5, 10]) {
        for (let i = 0; i < n; i++) {
          const a = (i >> shift) & M;
          const base = i - (a << shift);
          tmp[i] = 0.5 * ch[i] + 0.25 * (ch[base + (((a - 1) & M) << shift)] + ch[base + (((a + 1) & M) << shift)]);
        }
        const t = ch; ch = tmp; tmp = t;
      }
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { lo = Math.min(lo, ch[i]); hi = Math.max(hi, ch[i]); }
    for (let i = 0; i < n; i++) data[i * 4 + c] = Math.round(((ch[i] - lo) / (hi - lo)) * 255);
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

/** Uniforms every surface shares, by reference: the pipeline sets them when they change. */
export const SHARED = {
  uLight: { value: new THREE.Vector3(0, 1, 0) },
  uCover: { value: new THREE.Vector3(0, 1, 0) },
  uPx: { value: 1 },
  uNoise: { value: null },
  // 0 draws no stipple: a test hook (Pipeline.debugDots), so tools/render.mjs
  // can look at the lines on their own
  uDots: { value: 1 },
};

// --- shaders --------------------------------------------------------------------

// ONE PROGRAM. These are raw shaders, so three adds no defines of its own and
// keys every surface material to the same program: plain meshes, instanced
// ones, front- and double-sided. What a define would have told the shader it
// works out for itself:
//
//   instanced?  An attribute a mesh does not carry reads as the generic value
//               (0, 0, 0, 1) in every column, which no affine matrix has: an
//               instance matrix's first column ends in 0.
//   own ink?    instanceColor is (ink, look, 1) where a mesh gives each
//               instance its own ink (fx/effects.js, enemies/marks.js), and
//               reads (0, 0, 0) where it does not.
//   back face?  Only a double-sided material draws one, and gl_FrontFacing says.
//
// Six programs became one, and the one compiles in a sixth of the time: that
// was most of the first frame on a cold start.
const HEAD = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
`;

const VERT = /* glsl */ `
uniform mat4 modelMatrix;
uniform mat4 viewMatrix;
uniform mat4 projectionMatrix;
uniform highp sampler2D uBodies;
uniform float uUseBodies;
in vec3 position;
in vec3 normal;
in mat4 instanceMatrix;
in vec3 instanceColor;
in float aBody;
in vec3 aAxis;
out highp vec3 vPat;
out highp vec3 vNrmP;
out vec3 vNrmW;
out highp vec3 vAxis;
flat out vec3 vInkLook;

void main() {
  mat4 M = modelMatrix;
  if (instanceMatrix[0].w < 0.5) M = M * instanceMatrix;
  // a mover's vertices are in its body's frame; the body's pose is a row of
  // the bodies texture, one column of the matrix per texel
  if (uUseBodies > 0.5) {
    int row = int(aBody + 0.5);
    M = M * mat4(texelFetch(uBodies, ivec2(0, row), 0), texelFetch(uBodies, ivec2(1, row), 0),
                 texelFetch(uBodies, ivec2(2, row), 0), texelFetch(uBodies, ivec2(3, row), 0));
  }
  // the object's own frame in world units: scale kept, rotation and position not
  vec3 s = vec3(length(M[0].xyz), length(M[1].xyz), length(M[2].xyz));
  vPat = position * s;
  vec3 ns = normal / s;
  vNrmP = ns;
  vNrmW = mat3(M) * (ns / s);
  vAxis = aAxis * s;
  vInkLook = instanceColor;
  gl_Position = projectionMatrix * (viewMatrix * (M * vec4(position, 1.0)));
}
`;

const FRAG = /* glsl */ `
uniform float uPen;
uniform float uLook;
uniform float uLift;
uniform float uContrast;
uniform vec3 uLight;
uniform vec3 uCover;
uniform float uPx;
uniform float uDots;
uniform highp sampler3D uNoise;
in highp vec3 vPat;
in highp vec3 vNrmP;
in vec3 vNrmW;
in highp vec3 vAxis;
flat in vec3 vInkLook;
layout(location = 0) out highp vec4 fragColor;

const vec3 FAM0 = ${v3(FAMILIES[0])};
const vec3 FAM1 = ${v3(FAMILIES[1])};
const vec3 FAM2 = ${v3(FAMILIES[2])};
const float P_LINE = ${f(TONE.P)};
const float P_DOT = ${f(TONE.PD)};
const float BAND = ${f(BAND)};
const float BAND_PX = ${f(BAND_PX)};
const float BAND_MAX = ${f(BAND_MAX)};
const float GRAIN_MEAN = ${f(GRAIN_MEAN)};
const float GRAIN_SWING = ${f(GRAIN_SWING)};
const float MOTTLE_M = ${f(MOTTLE_M)};
const float JIT = ${f(JIT)};
const float WAVER = ${f(WAVER)};
const float WAVE_CELLS = ${f(WAVE_CELLS)};
const float PRESS = ${f(PRESS)};
const float MASS_S = ${f(MASS_S)};
const float MASS_W0 = ${f(MASS_W0)};
const float MASS_W1 = ${f(MASS_W1)};
const float FILL_K = ${f(FILL_K)};

${PACK_GLSL}
${TONE_GLSL}

// coverage of a pixel whose centre is d px from the middle of a line w px wide:
// the exact overlap of a one-pixel box with the line
float band(float d, float w) {
  return max(min(d + 0.5, 0.5 * w) - max(d - 0.5, -0.5 * w), 0.0);
}

uvec3 pcg3(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 rnd(ivec2 c, int level, int salt) {
  return vec3(pcg3(uvec3(uvec2(c), uint(level + 64) * 4u + uint(salt)))) * (1.0 / 4294967296.0);
}

// The noise at this point for spacing level k, one texel per WAVE_CELLS spacings.
// Each level is offset by an irrational-looking fraction of the tile, so two
// levels never read the same noise.
vec4 noiseAt(float k) {
  vec3 q = vPat * exp2(-k) / (WAVE_CELLS * 32.0) + fract(vec3(0.137, 0.271, 0.419) * k);
  return texture(uNoise, q);
}

// Slice lines across u (world units). g: world units of u per pixel.
// lam: continuous level. w1, w2: widths of the primary and halfway sets, px.
float slices(float u, float g, float lam, float w1, float w2) {
  float k = floor(lam);
  float fr = lam - k;
  float S = exp2(k);
  float h = 2.0 * u / S;
  float pxH = 0.5 * S / g;
  float e = exp2(1.0 - fr) - 1.0;
  float wB = w2 + (w1 - w2) * e;
  float wC = w2 * e;
  float dA = abs(h - 4.0 * floor(h * 0.25 + 0.5));
  float dB = abs(h - 2.0 - 4.0 * floor((h - 2.0) * 0.25 + 0.5));
  float dC = abs(h - 1.0 - 2.0 * floor((h - 1.0) * 0.5 + 0.5));
  return max(band(dA * pxH, w1), max(band(dB * pxH, wB), band(dC * pxH, wC)));
}

// Dots on a jittered lattice in the (u, v) plane. Jinv takes a world offset in
// (u, v) to screen pixels. r: the dots' radius in px.
float stipple(vec2 uv, mat2 Jinv, float lam, float r, int salt) {
  float k = floor(lam);
  float fr = lam - k;
  int ik = int(k);
  float D0 = exp2(k);
  float D1 = 2.0 * D0;
  float cov = 0.0;
  // the survivors: one per level-(k+1) cell, sliding from where level k has
  // it to where level k+1 does
  vec2 b1 = floor(uv / D1 - 0.5);
  for (int i = 0; i < 4; i++) {
    ivec2 c = ivec2(b1) + ivec2(i & 1, i >> 1);
    vec3 hp = rnd(c, ik + 1, salt);
    int q = int(hp.z * 4.0);
    ivec2 cc = 2 * c + ivec2(q & 1, q >> 1);
    vec3 hc = rnd(cc, ik, salt);
    vec2 at = mix((vec2(cc) + 0.5 + (hc.xy - 0.5) * JIT) * D0, (vec2(c) + 0.5 + (hp.xy - 0.5) * JIT) * D1, fr);
    cov = max(cov, clamp(r - length(Jinv * (at - uv)) + 0.5, 0.0, 1.0));
  }
  // the other three in each block, shrinking out over the octave at the
  // radius that keeps the coverage constant
  float rn = r * sqrt(max(0.0, (exp2(2.0 - 2.0 * fr) - 1.0) / 3.0));
  if (rn > 0.1) {
    vec2 b0 = floor(uv / D0 - 0.5);
    for (int i = 0; i < 4; i++) {
      ivec2 c = ivec2(b0) + ivec2(i & 1, i >> 1);
      ivec2 par = ivec2(floor(vec2(c) * 0.5));
      int q = int(rnd(par, ik + 1, salt).z * 4.0);
      if (c - 2 * par == ivec2(q & 1, q >> 1)) continue;
      vec3 hc = rnd(c, ik, salt);
      vec2 at = (vec2(c) + 0.5 + (hc.xy - 0.5) * JIT) * D0;
      cov = max(cov, clamp(rn - length(Jinv * (at - uv)) + 0.5, 0.0, 1.0));
    }
  }
  return cov;
}

// Stipple on the plane of families a and b. cov: the coverage wanted.
float dots(vec3 a, vec3 b, vec3 dPx, vec3 dPy, vec2 wav, float cov, int salt, float pk) {
  if (cov < 0.004) return 0.0;
  mat2 J = mat2(dot(dPx, a), dot(dPx, b), dot(dPy, a), dot(dPy, b));
  float det = determinant(J);
  if (abs(det) < 1e-14) return 0.0;
  float g = max(length(vec2(J[0][0], J[1][0])), length(vec2(J[0][1], J[1][1])));
  float lam = log2(P_DOT * pk * uPx * g);
  float r = P_DOT * pk * uPx * sqrt(cov / 3.14159265);
  vec2 uv = vec2(dot(vPat, a), dot(vPat, b)) + wav;
  return stipple(uv, inverse(J), lam, r, salt);
}

void main() {
  vec3 n = normalize(vNrmP);
  vec3 nw = normalize(vNrmW);
  if (!gl_FrontFacing) { n = -n; nw = -nw; }
  float ink = uPen;
  float look = uLook;
  if (vInkLook.z > 0.5) { ink = vInkLook.x; look = vInkLook.y; }

  // --- tone: a key light, half-Lambert so the shadow side still has a
  // gradient, a soft fill, then the material's contrast and lift
  float bright = 0.5 + 0.5 * dot(nw, uLight) + FILL_K * max(dot(nw, uCover), 0.0);
  float tone = 1.0 - clamp(bright * uContrast + uLift, 0.0, 1.0);
  // a noise texel every MOTTLE_M world units, features about three texels
  float mottle = texture(uNoise, vPat / (MOTTLE_M * 32.0) + vec3(0.61, 0.23, 0.87)).w * 2.0 - 1.0;
  float grainK = GRAIN_MEAN + GRAIN_SWING * mottle;
  // the switch band: BAND, widened on a curved surface to BAND_PX on the page
  float bend = length(dFdx(n)) + length(dFdy(n));
  float swBand = clamp(bend * BAND_PX * uPx, BAND, BAND_MAX);

  // --- the families, sorted: A cuts most steeply, C is most nearly the normal
  vec3 A = FAM0, B = FAM1, C = FAM2, t3;
  float a = abs(dot(n, FAM0)), b = abs(dot(n, FAM1)), c = abs(dot(n, FAM2)), t1;
  if (a > b) { t1 = a; a = b; b = t1; t3 = A; A = B; B = t3; }
  if (b > c) { t1 = b; b = c; c = t1; t3 = B; B = C; C = t3; }
  if (a > b) { t1 = a; a = b; b = t1; t3 = A; A = B; B = t3; }

  highp vec3 dPx = dFdx(vPat);
  highp vec3 dPy = dFdy(vPat);

  // the line direction: the steepest family, or for WRAP the object's axis,
  // except on an end cap, which the axis planes would cut edge-on
  vec3 L = A;
  float sw = smoothstep(0.0, swBand, b - a);
  bool wrap = abs(look - ${f(LOOK.WRAP)}) < 0.5;
  if (wrap) {
    vec3 ax = normalize(vAxis);
    // 0.8: the cap of a cylinder is square to its axis (1.0) and the side
    // along it (0.0), so anything past 0.8 is a cap or a cone's tip
    if (abs(dot(n, ax)) < 0.8) { L = ax; sw = 1.0; }
  }
  float g = max(length(vec2(dot(dPx, L), dot(dPy, L))), 1e-7);
  float lam = log2(P_LINE * uPx * g);

  // noise at this level and the next, mixed through the octave so the waver
  // is continuous across the octave boundary
  float k = floor(lam);
  float fr = lam - k;
  vec4 N0 = noiseAt(k);
  vec4 N1 = noiseAt(k + 1.0);
  float S = exp2(k);
  vec2 wav = WAVER * mix(S * (N0.xy * 2.0 - 1.0), 2.0 * S * (N1.xy * 2.0 - 1.0), fr);
  float press = mix(N0.z, N1.z, fr);
  float wmul = uPx * (1.0 - 0.5 * PRESS + PRESS * press);

  vec4 tt = toneTargets(tone);
  float u = dot(vPat, L) + wav.x;
  // what the look lays down first (lines, a tint, a flood), then the dots
  // wanted over it; the stipple is evaluated in one place for every look, so
  // the program carries one copy of it
  float cov = 0.0;
  float dc = 0.0;
  bool wash = abs(look - ${f(LOOK.WASH)}) < 0.5;

  if (abs(look - ${f(LOOK.SOLID)}) < 0.5) {
    cov = 1.0;
  } else if (wash) {
    // marker: a flat tint, streaks where its strokes overlap, stipple in shadow
    float st0 = 0.5 + 0.5 * cos(6.2831853 * u / (${f(WASH_PERIOD)} * S) + 4.0 * N0.w);
    float st1 = 0.5 + 0.5 * cos(6.2831853 * u / (${f(2 * WASH_PERIOD)} * S) + 4.0 * N1.w);
    // soft: the overlap of two marker strokes ramps over two thirds of a
    // streak's period; the phase wanders with the noise so no two are straight
    float streak = smoothstep(0.35, 1.0, mix(st0, st1, fr));
    // heavier from the lit side's tone (0.3) to the shadow's (0.8)
    cov = ${f(WASH_TINT)} + ${f(WASH_SHADE)} * smoothstep(0.3, 0.8, tone) + ${f(WASH_STREAK)} * streak;
    dc = tt.z;
  } else if (abs(look - ${f(LOOK.MASS)}) < 0.5) {
    // fixed world spacing: close up they are lines, at range a solid shape
    float s = MASS_S / g;
    // once the lines are merging anyway a family switch needs no band
    // (under 4 px apart they are merging; under 2 px they have)
    float swm = mix(sw, 1.0, smoothstep(4.0, 2.0, s));
    // lit to shadow over most of the tone range, and only +-10% of pressure:
    // a figure's mass has to stay a mass
    float w = mix(MASS_W0, MASS_W1, smoothstep(0.15, 0.75, tone)) * uPx * (0.9 + 0.2 * press) * swm;
    float h = u / MASS_S;
    float d = abs(h - floor(h + 0.5)) * s;
    cov = min(1.0, band(d, w) + band(s - d, w));
    // under two pixels apart the lines are their average: solid, not moire
    cov = mix(cov, min(1.0, w / max(s, 1e-3)), smoothstep(2.0, 1.0, s));
    // a switch band on a figure is stippled at 0.4, about the lines' own
    // coverage at 4 px apart, so the band neither shows as a gap nor a blot
    dc = tt.z + (1.0 - swm) * 0.4 * (1.0 - tt.z);
  } else {
    cov = slices(u, g, lam, tt.x * wmul * sw, tt.y * wmul * sw);
    // what the thinning lines give up in a switch band, the dots take
    dc = tt.z + (1.0 - sw) * (tt.w - tt.z) * (1.0 - tt.z);
  }

  // the stipple plane: A and B, blended with A and C where B and C swap
  float d = 0.0;
  if (dc > 0.004 && uDots > 0.5) {
    float sd = smoothstep(0.0, swBand, c - b);
    for (int i = 0; i < 2; i++) {
      float share = i == 0 ? 0.5 + 0.5 * sd : 0.5 - 0.5 * sd;
      if (share > 0.002) d = max(d, dots(A, i == 0 ? B : C, dPx, dPy, wav, dc * share, i, grainK));
    }
  }
  cov = wash ? cov + d * (1.0 - cov) : max(cov, d);

  fragColor = vec4(clamp(cov, 0.0, 1.0), tone, packInkLook(ink, look), press);
}
`;

// --- materials ------------------------------------------------------------------

const cache = new Map();

/**
 * The material for a surface.
 *
 *   ink       INK.*, default PEN
 *   look      LOOK.*, default LINE
 *   lift      added to the brightness after contrast; positive is paler
 *   contrast  multiplies the brightness; 1 is as lit
 *   side      THREE.FrontSide (default) or DoubleSide
 *   bodies    a movers texture: the mesh's vertices carry `aBody`, a row in it
 *
 * Materials with the same settings are shared, and all of them share one
 * program. On an InstancedMesh, `instanceColor` may hold (ink, look, 1) per
 * instance, which overrides `ink` and `look`.
 */
export function surface({ ink = INK.PEN, look = LOOK.LINE, lift = 0, contrast = 1, side = THREE.FrontSide, bodies = null } = {}) {
  const key = bodies ? null : `${ink}|${look}|${lift}|${contrast}|${side}`;
  if (key && cache.has(key)) return cache.get(key);
  if (!noiseTex) { noiseTex = makeNoise(); SHARED.uNoise.value = noiseTex; }
  const m = new THREE.RawShaderMaterial({
    name: 'surface',
    glslVersion: THREE.GLSL3,
    vertexShader: HEAD + VERT,
    fragmentShader: HEAD + FRAG,
    side,
    uniforms: {
      ...SHARED,
      uPen: { value: ink },
      uLook: { value: look },
      uLift: { value: lift },
      uContrast: { value: contrast },
      uBodies: { value: bodies },
      uUseBodies: { value: bodies ? 1 : 0 },
    },
  });
  // Values for the two attributes of ours a mesh may not carry. Only a mover
  // reads aBody and only WRAP reads aAxis, and both of those always have them;
  // this just keeps the unused ones from being whatever the last draw left.
  m.defaultAttributeValues = { aBody: [0], aAxis: [0, 1, 0] };
  if (key) cache.set(key, m);
  return m;
}
