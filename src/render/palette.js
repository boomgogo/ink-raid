// The pens, the ways a surface can be drawn, and the paper.
//
// Everything the page shows is one of these inks laid on STYLE.paper. The
// values are linear and are written to the framebuffer as they are: no colour
// space conversion anywhere between here and the screen, so the CSS colours in
// index.html (--ink, --red, --paper) are these numbers times 255.

// PEN and RED are fixed at 0 and 1: figures.mjs and compare.mjs look for red.
export const INK = {
  PEN: 0,      // the world's black ballpoint
  RED: 1,      // the enemies, and danger
  PINK: 2,
  BLACK: 3,    // heavy black: solid parts, the nib, the rails
  GREEN: 4,
  ORANGE: 5,
  BLUE: 6,
};
export const INK_COUNT = 7;

// The accents are chosen for a desk: a highlighter, a leaf-green marker, a
// rose felt-tip and a navy fountain pen. Each is saturated enough to read as a
// colour at a glance next to the black pen, and none is close enough to the
// enemy red to be mistaken for it.
export const INK_RGB = [
  [0.075, 0.075, 0.095],   // PEN     #131318
  [0.80, 0.10, 0.22],      // RED     #cc1a38: enemies and danger
  [0.88, 0.30, 0.47],      // PINK    rose felt-tip
  [0.02, 0.02, 0.03],      // BLACK   heavy black
  [0.16, 0.50, 0.18],      // GREEN   leaf-green marker
  [0.96, 0.40, 0.03],      // ORANGE  highlighter
  [0.12, 0.25, 0.58],      // BLUE    navy fountain pen
];

// How a surface is drawn. A look is a uniform in the one surface program, not a
// define, so every look shares it (see surface.js).
export const LOOK = {
  LINE: 0,     // slice lines in the half-tones, stipple in shadow: the desk, most things
  SOLID: 1,    // flooded with its ink: bullets, marks, heads, small dark parts
  WASH: 2,     // a marker tint with streaks, stippled on the shadow side: notes, the train
  MASS: 3,     // dense lines at a fixed world spacing that close up at range: figures
  WRAP: 4,     // lines round the object's own axis: pencils, coins, wire, lamp arms
};
export const LOOK_COUNT = 5;

// The paper kinds, for Pipeline.setPaper. `?graph=1` picks the grid.
export const PAPER = { DOTS: 'dots', GRAPH: 'graph' };
export const PAPER_KINDS = [PAPER.DOTS, PAPER.GRAPH];

export const STYLE = {
  paper: [0.95, 0.946, 0.924],
};
