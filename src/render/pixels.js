// How many pixels the page is drawn at: the one policy, used by the pipeline
// and by tools/render.mjs to check it. No three.js here, so node can import it.

// Pixel ratio. A desktop is drawn at its device ratio up to 2, and never more
// than 2.4 million pixels (1920x1250): enough for a 1080p screen at 1x or a
// laptop at 1.25-1.5x, and a ceiling for a 4K one that an integrated GPU can
// fill 60 times a second.
//
// A phone or tablet (coarse pointer) is drawn at up to 1.375, and never more
// than 0.7 million pixels. Line widths are set in CSS pixels and scaled by the
// ratio, so the ratio decides how sharp a line is, not how thick: at 1.375 a
// 1.3 px hatch line is 1.8 drawn pixels, enough for a fully inked core, and the
// boldest outline (2.6 px) is 3.6, near enough the three stencil scales the
// page pass samples above a ratio of 1.2; at 1.5 it would be 3.9 and lose more
// of itself to that limit. And it is 16% fewer pixels than 1.5 for the page
// pass's 25 depth taps on an entry-level GPU. The budget moves with it: 0.7
// million is a 390x844 phone at 1.375 (536x1160, 0.62 million) with room to
// spare, and holds a big tablet to about the same cost.
export const RATIO = {
  desktop: { max: 2, pixels: 2.4e6 },
  touch: { max: 1.375, pixels: 0.7e6 },
};

/** The internal pixel ratio for a viewport, by the policy above. */
export function pixelRatio(cssW, cssH, dpr, touch) {
  const p = touch ? RATIO.touch : RATIO.desktop;
  const byCount = Math.sqrt(p.pixels / Math.max(1, cssW * cssH));
  // to 1/8: a browser zoom reports ratios like 1.0000000149
  return Math.max(0.5, Math.floor(Math.min(dpr + 1e-3, p.max, byCount) * 8) / 8);
}
