// The tone ramp: how much ink a surface of a given tone gets, and in what form.
//
// Tone runs from 0 (facing the light: bare paper) to 1 (turned right away from
// it). Along the way:
//
//   0    .. T0   bare
//   T0   .. T1   one set of slice lines, thickening from nothing to W1
//   T1   .. T2   a second set comes in halfway between them, up to W2
//   T3   .. T4   past the terminator: stipple dots over the lines
//   T4   .. T5   the lines thin away and the dots take over
//   T5   .. 1    dots alone
//
// All widths are in page pixels at a pixel ratio of 1; the shader scales them
// by the ratio (uPx). The curve is written ONCE, here, and both the shader and
// the node check in tools/render.mjs are generated from these numbers, so the
// check that total coverage never falls as tone rises is a check of the curve
// the GPU actually runs.

export const TONE = {
  // With the key light (pipeline.js) a top face sits at about 0.12 and a face
  // square to the camera at about 0.3: the first should be paper, the second
  // should carry a light hatch, so the lines start between them.
  T0: 0.2,
  // The terminator sits at 0.5 for a material with no lift. The single set is
  // at full weight a little before it, so the lit side has its whole range of
  // single-line tones to itself.
  T1: 0.44,
  T2: 0.56,
  // Dots start at the terminator: the side turned away from the light is the
  // side that is stippled.
  T3: 0.5,
  T4: 0.62,
  // By here a face is well into shadow (an underside is 0.88) and carries
  // dots only: small round blobs, never two directions of line.
  T5: 0.86,

  // Line period at the coarse end of an octave: lines run 9 px apart, and
  // halfway through the octave they have closed to 4.5. Below about 4 px pen
  // lines read as grey; above about 10 they read as stripes rather than tone.
  P: 9,
  // The first set's full weight, and the second's. 1.3 px is about the
  // lightest line that survives the paper grain at 1x without going grey; the
  // second set is thinner so it reads as filling in rather than a new layer.
  W1: 1.3,
  W2: 0.85,
  // The stipple lattice's spacing at the coarse end of an octave. Smaller than
  // P: dots have to be denser than lines to carry the same coverage and stay
  // separate.
  PD: 6,
  // Coverage the dots add over full-weight lines at T4, and the coverage of the
  // dots alone at the darkest. CDMAX must be at least the lines' full coverage
  // plus CD1 over them, or the stipple would be lighter than the tone before
  // it; (1.3 + 0.85) / 9 = 0.239, plus 0.06 over it = 0.285, under 0.30. The
  // darkest is 0.30 and not more: a big underside at full density read as a
  // grey fill, and the page as a whole carried more ink than a pen drawing
  // should. 0.30 at PD = 6 is dots 3.7 px across, well apart.
  CD1: 0.06,
  CDMAX: 0.30,
};

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Line widths (px), dot coverage and the total coverage aimed for, at tone t. */
export function toneTargets(t) {
  const { T0, T1, T2, T3, T4, T5, P, W1, W2, CD1, CDMAX } = TONE;
  const out = smooth(T4, T5, t);
  const w1 = W1 * smooth(T0, T1, t) * (1 - out);
  const w2 = W2 * smooth(T1, T2, t) * (1 - out);
  const cl = (w1 + w2) / P;
  const clMax = (W1 + W2) / P;
  const cMid = clMax + CD1 * (1 - clMax);
  const c = t < T4 ? cl + CD1 * smooth(T3, T4, t) * (1 - cl) : cMid + (CDMAX - cMid) * out;
  const cd = Math.max(0, (c - cl) / (1 - cl));
  return { w1, w2, cd, c };
}

const f = (x) => (Number.isInteger(x) ? `${x}.0` : String(x));

// The same curve in GLSL. Returns (w1, w2, dot coverage, total).
export const TONE_GLSL = /* glsl */ `
vec4 toneTargets(float t) {
  float o = smoothstep(${f(TONE.T4)}, ${f(TONE.T5)}, t);
  float w1 = ${f(TONE.W1)} * smoothstep(${f(TONE.T0)}, ${f(TONE.T1)}, t) * (1.0 - o);
  float w2 = ${f(TONE.W2)} * smoothstep(${f(TONE.T1)}, ${f(TONE.T2)}, t) * (1.0 - o);
  float cl = (w1 + w2) / ${f(TONE.P)};
  float clMax = ${f((TONE.W1 + TONE.W2) / TONE.P)};
  float cMid = clMax + ${f(TONE.CD1)} * (1.0 - clMax);
  float c = t < ${f(TONE.T4)}
    ? cl + ${f(TONE.CD1)} * smoothstep(${f(TONE.T3)}, ${f(TONE.T4)}, t) * (1.0 - cl)
    : cMid + (${f(TONE.CDMAX)} - cMid) * o;
  return vec4(w1, w2, max(0.0, (c - cl) / (1.0 - cl)), c);
}
`;
