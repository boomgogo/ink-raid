import * as THREE from 'three';
import { INK, INK_RGB, INK_COUNT, LOOK, STYLE } from './palette.js';
import { PACK_GLSL } from './pack.js';

// The page pass: one full-screen triangle that turns the page buffer and its
// depth into the picture — paper, the pattern's ink, the outlines, and the
// screen effects.
//
// OUTLINES are found in the depth alone, from the Laplacian of inverse depth.
// For a perspective camera the depth buffer is affine in 1/z, and on any plane
// 1/z is affine in screen position, so its discrete Laplacian is zero on a
// plane however the plane is tilted: a floor running to the horizon draws no
// line. It is non-zero where the surface bends (a crease) and large where one
// surface passes behind another (a silhouette). Divided by the local 1/z, the
// silhouette test is independent of distance; divided once more by the
// pixel's angular size, a crease reads as the bend itself, so the crease test
// is independent of resolution and field of view too.
//
//   silhouette   |L|/w large; only its near side (L < 0) is drawn, so the
//                line lies on the nearer surface and takes its ink
//   figure rim   one pixel outside a figure's silhouette, in the figure's ink
//                (below)
//   convex       L < 0, drawn medium
//   concave      L > 0, drawn thin and broken
//
// Two stencils (+ and x) at scales of 1, 2 and (at higher pixel ratios) 3 px.
// A pixel d px from an edge answers at every scale above d, so a line of width
// W is simply "answered at scale d+1" weighted by W - d: the weight is a
// number, and it varies along the line with the pen pressure the surface wrote
// into the buffer's alpha — anchored to the surface, so it never crawls.
//
// THE HELD WEAPON is drawn into the first K of the depth range and the world
// into the rest (pipeline.js), so the two decode with their own near and far,
// and wherever the weapon meets the world it is a silhouette whatever the two
// depths are.

const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));
const rgb = (c) => /* glsl */ `vec3(${c.map(f).join(', ')})`;

// --- constants ---------------------------------------------------------------

// A silhouette is a jump in 1/z of more than 2.5 to 6% of it across one tap: a
// thing 2.5% nearer than what is behind it (a figure a metre in front of a
// wall 40 m away). Creases stay well under 1%: a 90 degree edge seen at 45
// degrees moves 1/z by about 0.4% per pixel at 800 px high.
const SIL0 = 0.025;
const SIL1 = 0.06;
// A crease is drawn from a bend measure of 0.9 and at full weight from 1.6.
// A box's edge seen obliquely measures about 2; the 30 degree facets of the
// builder's 12-sided cylinders about 0.5, and they are meant to look round, so
// they stay under the threshold. A hexagonal pencil's corners (60 degrees)
// come out at about 1.1: faint, as they should.
const CREASE0 = 0.9;
const CREASE1 = 1.6;
// Line weights, px at a pixel ratio of 1: silhouettes boldest, convex creases
// medium, concave creases thin (and broken, below).
const W_SIL = 2.1;
const W_CVX = 1.2;
const W_CCV = 0.8;
// A concave crease is drawn where the pen pressure is above this, so about
// two thirds of its length: a broken line, anchored to the surface.
const CCV_BREAK = 0.38;
const CCV_ALPHA = 0.7;
// Distance fade: from 36 m to 170 m (the far edge of the desk seen across it,
// and the sky drawings beyond). 36 m is just inside the arena's old edge, 40 m
// out: everything you fight across stays at full ink, and the fade starts on
// the band of desk and track beyond it. The pattern goes to 30%, the lines to
// 50%: an outline is the last thing a far object keeps, so it keeps half its
// ink; a silhouette against bare paper keeps 85% so it still reads as a shape.
const FADE_Z0 = 36;
const FADE_Z1 = 170;
const FADE_PATTERN = 0.3;
const FADE_LINE = 0.5;
const FADE_SKY_LINE = 0.85;
// The figure rim. A figure is drawn with one more pixel of its own ink all round
// its silhouette. Its parts meet across slivers of paper: the legs hang from
// the hips, below the round of the torso, so at 18 m there is a row of paper
// between them, and at 60 m the figure is 13 px tall and its limbs are under a
// pixel across. A line drawn only inside each part can neither close the one
// nor widen the other, and the drawing falls apart into fragments too small to
// see as a figure. The rim closes the rows between parts stacked one over the
// other, and makes a 60 m figure the 7 x 16 px it was always meant to read as.
// It is left off a pixel with figure on both its left and right: the gap
// between the legs, and between an arm and the body, is what makes the shape
// a figure and not a post. Only figures (LOOK.MASS) get it; the world's
// outlines lie inside what they outline.

// The paper: a dot every 1/27 of the height. The dot is a pale blue-grey 1 px
// in radius, at 55%: on the paper it comes out about (194, 202, 219) — bluer
// than the paper and far paler than any ink, so it never reads as a mark.
const DOT_RGB = [0.62, 0.68, 0.82];
const DOT_R = 1.0;
const DOT_A = 0.55;
// Graph paper: 1 px lines on the same period, fainter than the dots since
// there is so much more of them.
const GRID_A = 0.28;
// Grain: per-CSS-pixel speckle of +-1.2% and a mottle 24 px across of
// +-0.5%, both fixed to the screen like the paper they are. Mean 0.983. The
// mottle is just enough that a bare page is not flat digital colour; more
// reads as dirt.
const GRAIN = 0.012;
const MOTTLE = 0.005;
const MOTTLE_PX = 24;
// Hurt: red dots on an 8 px lattice, 2.2 px in radius at the frame's edge and
// shrinking in step with the distance to the inner end of their reach, which
// goes in 12% of the short side at full hurt (96 px on a 1280x800 frame) and
// never past 15% with the ragged front: a hit floods the margin and thins
// fast, and the middle of the frame, where the red enemies are, stays clear at
// every level of hurt. Each dot's own threshold is jittered by 30% of the
// reach so the front is ragged: ink soaking in, not a vignette.
const HURT_CELL = 8;
const HURT_R = 2.2;
const HURT_REACH = 0.12;
const HURT_RAGGED = 0.3;
// Low HP: the same stipple held at 30% of full hurt, breathing +-10% on a
// three second cycle: slow enough to read as breath, not as a warning light.
const LOW_BASE = 0.3;
const LOW_BREATH = 0.1;
const LOW_RATE = 2.1;
// Hitstop: the ink goes heavier. Pattern ink up by 60%, lines 0.8 px wider,
// every ink 30% darker.
const SLOW_PAT = 0.6;
const SLOW_W = 0.8;
const SLOW_DARK = 0.3;

export const VIEWS = ['final', 'edges', 'tone', 'pattern', 'ink', 'depth'];

const VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
uniform highp sampler2D tPage;
uniform highp sampler2D depthTex;
uniform vec4 uDepth;
uniform float uK;
uniform float uDelta;
uniform float uPx;
uniform vec3 uPen[${INK_COUNT}];
uniform vec3 uSheet;
uniform float uGraph;
uniform float uGrid;
uniform vec4 uFx;
uniform float uTime;
uniform int uView;
layout(location = 0) out highp vec4 fragColor;

${PACK_GLSL}

ivec2 SZ;

// window depth -> 1/z. The weapon is in [0, K), the world in [K, 1]; each is
// an ordinary perspective depth squeezed into its part of the range.
float invZ(float d) {
  return d < uK ? uDepth.z - uDepth.w * (d / uK) : uDepth.x - uDepth.y * ((d - uK) / (1.0 - uK));
}
float depthAt(ivec2 q) { return texelFetch(depthTex, clamp(q, ivec2(0), SZ - 1), 0).r; }

float cellRandom(vec2 p) {
  uvec2 v = uvec2(ivec2(p)) * uvec2(1597334673u, 3812015801u);
  uint h = (v.x ^ v.y) * 1597334673u;
  return float(h ^ (h >> 16u)) * (1.0 / 4294967296.0);
}
float mottleField(vec2 p) {
  vec2 i = floor(p), fq = p - i;
  vec2 s = fq * fq * (3.0 - 2.0 * fq);
  return mix(mix(cellRandom(i), cellRandom(i + vec2(1, 0)), s.x), mix(cellRandom(i + vec2(0, 1)), cellRandom(i + vec2(1, 1)), s.x), s.y);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  SZ = textureSize(depthTex, 0);
  vec2 fc = gl_FragCoord.xy;
  vec4 pg = texelFetch(tPage, p, 0);
  float d0 = depthAt(p);
  bool sky0 = d0 >= 1.0;
  bool hand0 = d0 < uK;
  float w0 = invZ(d0);
  float z0 = 1.0 / w0;
  vec2 il = unpackInkLook(pg.b);
  float slow = uFx.w;

  // --- outlines --------------------------------------------------------------
  // near[s]: this pixel is on the near side of a silhouette within s px;
  // cvx[s], ccv[s]: a convex or concave crease within s px
  float sil[3], cvx[3], ccv[3];
  bool nearSky = false;
  // the far side of a silhouette, one pixel out: how sure, and where the
  // nearest thing across the edge is, for its look and ink
  float rim = 0.0;
  ivec2 farQ = p;
  float farW = w0;
  bool hSliver = false;
  // two scales carry lines up to 2 px; above a ratio of 1.2, or when hitstop
  // thickens them, lines are wider than that and need the third
  int scales = (uPx > 1.2 || slow > 0.01) ? 3 : 2;
  for (int si = 0; si < 3; si++) {
    sil[si] = 0.0; cvx[si] = 0.0; ccv[si] = 0.0;
    if (si >= scales) continue;
    int s = si + 1;
    for (int st = 0; st < 2; st++) {
      ivec2 o1 = st == 0 ? ivec2(s, 0) : ivec2(s, s);
      ivec2 o2 = st == 0 ? ivec2(0, s) : ivec2(s, -s);
      float sum = 0.0;
      bool cross = false;
      float wv[4];
      ivec2 offs[4] = ivec2[4](o1, -o1, o2, -o2);
      for (int t = 0; t < 4; t++) {
        ivec2 q = p + offs[t];
        float dq = depthAt(q);
        float wq = invZ(dq);
        // past the frame's edge, continue the surface in a straight line:
        // clamping would put a false crease along every border
        if (any(lessThan(q, ivec2(0))) || any(greaterThanEqual(q, SZ))) {
          dq = depthAt(p - offs[t]);
          wq = 2.0 * w0 - invZ(dq);
        }
        wv[t] = wq;
        sum += wq;
        cross = cross || ((dq < uK) != hand0);
        nearSky = nearSky || dq >= 1.0;
      }
      float Ln = (sum - 4.0 * w0) / w0;
      float e = sky0 ? 0.0 : smoothstep(${f(SIL0)}, ${f(SIL1)}, -Ln);
      if (hand0 && cross) e = 1.0;
      if (si == 0 && st == 0 && !hand0) {
        // one pixel out from a silhouette, across a side and not a corner
        // (the + stencil only), so the rim rounds a figure's corners rather
        // than squaring them: the Laplacian, positive, against the nearest
        // tap's 1/z, so it is the jump the near side sees; a plane's slope
        // cancels in it, as on the near side
        float wm = w0;
        int tm = 0;
        for (int t = 0; t < 4; t++) if (wv[t] > wm) { wm = wv[t]; tm = t; }
        float eo = smoothstep(${f(SIL0)}, ${f(SIL1)}, (sum - 4.0 * w0) / wm);
        if (eo > rim) { rim = eo; farW = wm; farQ = p + offs[tm]; }
        // figure on both the left and the right of this pixel
        if (min(wv[0], wv[1]) > w0
          && (wv[0] + wv[1] - 2.0 * w0) / (2.0 * min(wv[0], wv[1])) > ${f(SIL0)}) hSliver = true;
      }
      // the bend: per pixel of angular size, per pixel of stencil step
      float bend = Ln / (float(s) * (st == 0 ? 1.0 : 1.4142) * uDelta);
      sil[si] = max(sil[si], e);
      cvx[si] = max(cvx[si], sky0 ? 0.0 : smoothstep(${f(CREASE0)}, ${f(CREASE1)}, -bend) * (1.0 - e));
      // the far side of a silhouette is a large positive jump, not a crease:
      // a concave line fades out from half the silhouette threshold up to it
      float far = cross ? 0.0 : 1.0 - smoothstep(${f(SIL0)} * 0.5, ${f(SIL0)}, Ln);
      ccv[si] = max(ccv[si], sky0 ? 0.0 : smoothstep(${f(CREASE0)}, ${f(CREASE1)}, bend) * far);
    }
  }
  // a line W px wide is the pixels answered at scale d + 1, weighted W - d.
  // The pen pressure the surface wrote (0-1) takes a silhouette from 0.8 to
  // 1.25 of its weight (1.7 px at its lightest, close up: still the boldest
  // line on the page) and a convex crease from 0.8 to 1.2 — a hand's
  // variation, not a second kind of line; far off, lines thin to 0.7 of it
  // over the same range as the fade, as a pen line reads thinner at distance.
  float press = pg.a;
  float thin = mix(1.0, 0.7, smoothstep(${f(FADE_Z0)}, ${f(FADE_Z1)}, z0));
  float wS = (${f(W_SIL)} * (0.8 + 0.45 * press) * thin + ${f(SLOW_W)} * slow) * uPx;
  float wC = (${f(W_CVX)} * (0.8 + 0.4 * press) * thin + ${f(SLOW_W)} * slow) * uPx;
  float wV = (${f(W_CCV)} + 0.5 * ${f(SLOW_W)} * slow) * uPx;
  float aS = 0.0, aC = 0.0, aV = 0.0, aO = 0.0;
  for (int si = 0; si < 3; si++) {
    float k = clamp(wS - float(si), 0.0, 1.0);
    aS = max(aS, sil[si] * k);
    aC = max(aC, cvx[si] * clamp(wC - float(si), 0.0, 1.0));
    aV = max(aV, ccv[si] * clamp(wV - float(si), 0.0, 1.0));
  }
  // the breaks have soft ends, 0.08 of pressure wide: a couple of pixels
  aV *= ${f(CCV_ALPHA)} * smoothstep(${f(CCV_BREAK)} - 0.04, ${f(CCV_BREAK)} + 0.04, press);
  float fadeL = mix(1.0, ${f(FADE_LINE)}, smoothstep(${f(FADE_Z0)}, ${f(FADE_Z1)}, z0));
  float line = max(aS * (nearSky ? max(fadeL, ${f(FADE_SKY_LINE)}) : fadeL), max(aC, aV) * fadeL);
  if (hand0) line = max(aS, max(aC, aV));
  // the figure rim, in the figure's ink, faded as its own line would be
  vec3 outRGB = vec3(0.0);
  if (rim > 0.0 && !hSliver) {
    vec4 pn = texelFetch(tPage, farQ, 0);
    vec2 nl = unpackInkLook(pn.b);
    if (abs(nl.y - ${f(LOOK.MASS)}) < 0.5) aO = rim;
    outRGB = uPen[int(nl.x + 0.5)];
    // faded as the figure's own outline is, at the figure's depth
    float fo = mix(1.0, ${f(FADE_LINE)}, smoothstep(${f(FADE_Z0)}, ${f(FADE_Z1)}, 1.0 / farW));
    aO *= sky0 ? max(fo, ${f(FADE_SKY_LINE)}) : fo;
  }

  // --- paper -----------------------------------------------------------------
  vec2 css = fc / uPx;
  float grain = 1.0 - ${f(GRAIN + MOTTLE)} + ${f(2 * GRAIN)} * cellRandom(css) + ${f(2 * MOTTLE)} * mottleField(css / ${f(MOTTLE_PX)});
  vec3 paper = uSheet * grain;
  vec2 gq = fc / uGrid;
  if (uGraph > 0.5) {
    vec2 gd = abs(fract(gq + 0.5) - 0.5) * uGrid;
    float gl = max(max(min(gd.x + 0.5, 0.5 * uPx) - max(gd.x - 0.5, -0.5 * uPx), 0.0),
                   max(min(gd.y + 0.5, 0.5 * uPx) - max(gd.y - 0.5, -0.5 * uPx), 0.0));
    paper = mix(paper, ${rgb(DOT_RGB)}, ${f(GRID_A)} * gl);
  } else {
    float dd = length(fract(gq) - 0.5) * uGrid;
    paper = mix(paper, ${rgb(DOT_RGB)}, ${f(DOT_A)} * clamp(${f(DOT_R)} * uPx - dd + 0.5, 0.0, 1.0));
  }

  // --- ink ---------------------------------------------------------------------
  int ink = int(il.x + 0.5);
  vec3 inkRGB = uPen[ink] * (1.0 - ${f(SLOW_DARK)} * slow);
  float fadeP = hand0 ? 1.0 : mix(1.0, ${f(FADE_PATTERN)}, smoothstep(${f(FADE_Z0)}, ${f(FADE_Z1)}, z0));
  float pat = sky0 ? 0.0 : clamp(pg.r * fadeP * (1.0 + ${f(SLOW_PAT)} * slow), 0.0, 1.0);
  // a SOLID surface is its ink, faded only as far as a line is
  if (!sky0 && abs(il.y - 1.0) < 0.5) pat = hand0 ? 1.0 : max(pat, fadeL);
  vec3 col = mix(paper, inkRGB, pat);
  col = mix(col, inkRGB, line);
  col = mix(col, outRGB * (1.0 - ${f(SLOW_DARK)} * slow), aO);

  // --- screen effects ------------------------------------------------------------
  float hurt = max(uFx.x, uFx.y * (${f(LOW_BASE)} + ${f(LOW_BREATH)} * sin(uTime * ${f(LOW_RATE)})));
  if (hurt > 0.002) {
    vec2 res = vec2(SZ);
    float cell = ${f(HURT_CELL)} * uPx;
    vec2 q = fc / cell;
    vec2 b = floor(q - 0.5);
    float hc = 0.0;
    for (int i = 0; i < 4; i++) {
      vec2 c = b + vec2(float(i & 1), float(i >> 1));
      // jittered over the middle half of each cell, as the surface stipple is
      vec2 at = (c + 0.5 + (vec2(cellRandom(c), cellRandom(c + 17.0)) - 0.5) * 0.5) * cell;
      vec2 m = min(at, res - at);
      float edge = min(m.x, m.y) / min(res.x, res.y);
      float reach = hurt * ${f(HURT_REACH)};
      float grow = clamp(1.0 - edge / reach + ${f(HURT_RAGGED)} * (cellRandom(c + 5.0) - 0.5), 0.0, 1.0)
        * step(edge, ${f(HURT_REACH * 1.25)});
      float r = ${f(HURT_R)} * uPx * grow;
      hc = max(hc, clamp(r - length(fc - at) + 0.5, 0.0, 1.0));
    }
    // 90%: the red sits over the page like wet ink, the drawing just visible
    col = mix(col, uPen[${INK.RED}], hc * 0.9);
  }
  col = mix(col, vec3(1.0), uFx.z);

  // --- debug views ---------------------------------------------------------------
  if (uView == 1) col = mix(mix(vec3(1.0), sky0 ? vec3(0.0) : uPen[ink], line), outRGB, aO);
  else if (uView == 2) col = sky0 ? vec3(1.0, 0.95, 0.9) : vec3(1.0 - pg.g);
  else if (uView == 3) col = sky0 ? vec3(1.0) : vec3(1.0 - pg.r);
  else if (uView == 4) col = sky0 ? vec3(1.0) : uPen[ink];
  else if (uView == 5) col = hand0 ? vec3(0.15, 0.35, 1.0) : vec3(sky0 ? 1.0 : clamp(log2(z0 + 1.0) / 9.0, 0.0, 1.0));

  fragColor = vec4(col, 1.0);
}
`;

/** The page pass's material. The pipeline owns its uniforms. */
export function pageMaterial() {
  return new THREE.ShaderMaterial({
    name: 'page',
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tPage: { value: null },
      depthTex: { value: null },
      uDepth: { value: new THREE.Vector4() },
      uK: { value: 0 },
      uDelta: { value: 0.002 },
      uPx: { value: 1 },
      uPen: { value: INK_RGB.map((c) => new THREE.Vector3(...c)) },
      uSheet: { value: new THREE.Vector3(...STYLE.paper) },
      uGraph: { value: 0 },
      uGrid: { value: 30 },
      uFx: { value: new THREE.Vector4() },
      uTime: { value: 0 },
      uView: { value: 0 },
    },
  });
}

/** One triangle that covers the screen. */
export function pageTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}
