// Ink and look share one 8-bit channel of the page buffer.
//
// Seven inks need three bits and five looks another three, so the byte is
// look * 8 + ink: 0..39 of the 256 steps, each a whole step apart, which an
// UNORM8 target stores exactly. The JS and the GLSL below are the same formula
// written twice from the same constant; tools/render.mjs round-trips every
// combination through an 8-bit quantisation in node.
import { INK_COUNT, LOOK_COUNT } from './palette.js';

// The stride between looks: the smallest power of two above INK_COUNT, so the
// ink is the low bits and the decode is exact integer arithmetic.
export const LOOK_STRIDE = 8;
if (INK_COUNT > LOOK_STRIDE || LOOK_COUNT * LOOK_STRIDE > 256) throw new Error('ink/look packing does not fit a byte');

export const packInkLook = (ink, look) => look * LOOK_STRIDE + ink;
export const unpackInkLook = (byte) => ({ ink: byte % LOOK_STRIDE, look: Math.floor(byte / LOOK_STRIDE) });

/** What the surface shader writes to the channel, as a 0-1 float. */
export const encodeInkLook = (ink, look) => packInkLook(ink, look) / 255;
/** What the page shader reads back from the channel. */
export const decodeInkLook = (v) => unpackInkLook(Math.floor(v * 255 + 0.5));

const S = `${LOOK_STRIDE}.0`;
export const PACK_GLSL = /* glsl */ `
float packInkLook(float ink, float look) { return (look * ${S} + ink) / 255.0; }
vec2 unpackInkLook(float v) {
  float b = floor(v * 255.0 + 0.5);
  float look = floor(b / ${S});
  return vec2(b - look * ${S}, look);
}
`;
