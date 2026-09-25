// A button outline, drawn as a pen would draw it: round the rectangle twice,
// not quite meeting itself, the corners run a little long. Nothing here is a
// straight line, but nothing here reads as messy either — the jitter is small
// and the same shape comes back every time a given button is drawn, because
// the wobble is seeded off the button's own id. A shimmering outline would be
// worse than a straight one.
//
// The path lives in a fixed 0-100 x 0-40 box and stretches with the button
// through `preserveAspectRatio="none"`; `vector-effect="non-scaling-stroke"`
// keeps the stroke a constant pixel width while the box around it stretches to
// fit anything from a settings checkbox to a full-width start button.

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 100, H = 40, PAD = 5, OVER = 6;

function pass(rng, jitter) {
  const corners = [
    [PAD, PAD], [W - PAD, PAD], [W - PAD, H - PAD], [PAD, H - PAD],
  ];
  const j = () => (rng() - 0.5) * jitter;
  const p = corners.map(([x, y]) => [x + j(), y + j()]);
  let d = `M ${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
  for (let i = 1; i < p.length; i++) d += ` L ${p[i][0].toFixed(1)} ${p[i][1].toFixed(1)}`;
  // the stroke runs past where it started rather than stopping dead on it
  const ex = p[0][0] + (rng() - 0.5) * OVER;
  const ey = p[0][1] + (rng() - 0.5) * OVER;
  d += ` L ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  return { d, close: `${d} Z` };
}

let hatchId = 0;

/**
 * @param {string} seedKey  unique per button; the same key always draws the same wobble
 * @param {{filled?: boolean}} [opts]
 * @returns {string} an inline <span> of SVG, absolutely positioned to fill its parent
 */
export function quillButton(seedKey, opts = {}) {
  const rng = mulberry32(hash(seedKey));
  const a = pass(rng, 2.6);
  const b = pass(rng, 1.9);
  const hid = `irh${hatchId++}`;
  return `<span class="ir-quill">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <pattern id="${hid}" width="3.2" height="3.2" patternTransform="rotate(35)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="3.2" stroke="currentColor" stroke-width="1.1"/>
        </pattern>
      </defs>
      <path class="ir-quill-fill" d="${a.close}" fill="${opts.filled ? `url(#${hid})` : 'none'}"/>
      <path class="ir-quill-a" d="${a.d}" vector-effect="non-scaling-stroke"/>
      <path class="ir-quill-b" d="${b.d}" vector-effect="non-scaling-stroke"/>
    </svg>
  </span>`;
}
