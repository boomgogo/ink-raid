// The photo on the desk: THE AUTHOR, the crowned boss, in a chicken costume.
//
// Drawn as polylines on a 10 x 13.8 sheet, x right and y up, and laid on the
// picture by Builder.strokes, so it comes out in the same pens and through the
// same outline pass as the rest of the desk. The costume is the world pen; the
// boss inside it — face, crown, rifle — is red, as it is in the game.
//
// `w` scales a stroke's width; the rest are drawn at the one pen width.

const ring = (cx, cy, rx, ry, a0 = 0, a1 = Math.PI * 2, n = 20) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
  });

export const COSTUME = [
  { p: [[0.8, 1.2], [9.2, 1.2]], w: 0.7 },                                      // the floor
  // chicken feet: a leg and three toes each
  { p: [[3.9, 3.3], [3.9, 1.3]] }, { p: [[2.9, 1.25], [3.9, 1.3], [4.7, 1.25]] }, { p: [[3.9, 1.3], [3.6, 1.9]] },
  { p: [[6.1, 3.3], [6.1, 1.3]] }, { p: [[5.3, 1.25], [6.1, 1.3], [6.9, 1.25]] }, { p: [[6.1, 1.3], [6.4, 1.9]] },
  // the suit: one big feathered egg, a tail, two wings
  { p: ring(5, 5.6, 2.6, 2.5, 0, Math.PI * 2, 28), w: 1.2 },
  { p: [[2.5, 6.6], [1.6, 7.7], [2.3, 7.3], [1.8, 8.5], [2.7, 7.6]] },
  { p: [[7.3, 6.7], [8.6, 5.7], [7.7, 4.6]] },
  { p: [[2.7, 6.4], [1.9, 5.3], [2.8, 4.5]] },
  // feathers
  { p: [[3.9, 5.2], [4.2, 4.8], [4.5, 5.2]], w: 0.7 }, { p: [[5.3, 4.5], [5.6, 4.1], [5.9, 4.5]], w: 0.7 },
  { p: [[4.6, 6.4], [4.9, 6.0], [5.2, 6.4]], w: 0.7 }, { p: [[6.0, 5.8], [6.3, 5.4], [6.6, 5.8]], w: 0.7 },
  // the hood, its beak, comb and wattle
  { p: ring(5, 9.4, 1.4, 1.4, 0, Math.PI * 2, 22), w: 1.1 },
  { p: [[6.1, 9.7], [7.3, 9.35], [6.1, 9.0]] },
  { p: [[4.2, 10.6], [4.4, 11.2], [4.7, 10.7], [5.0, 11.4], [5.3, 10.7], [5.6, 11.2], [5.8, 10.6]] },
  { p: [[6.0, 8.7], [6.3, 8.1], [5.9, 8.0], [5.9, 8.6]] },
];

export const AUTHOR = [
  // the face in the hood's opening, grim about it
  { p: ring(5.0, 9.25, 0.8, 0.85, 0, Math.PI * 2, 16) },
  { p: [[4.7, 9.45], [4.75, 9.4]], w: 1.6 }, { p: [[5.3, 9.45], [5.35, 9.4]], w: 1.6 },
  { p: [[4.7, 8.85], [5.0, 8.95], [5.3, 8.85]] },
  // the crown, perched on the comb and not quite straight
  { p: [[4.1, 11.6], [4.0, 12.7], [4.6, 12.1], [5.1, 13.0], [5.5, 12.2], [6.1, 13.0], [6.05, 11.9], [4.1, 11.6]], w: 1.1 },
  // and the rifle, tucked under a wing
  { p: [[6.6, 5.6], [9.4, 7.5]], w: 1.2 },
  { p: [[6.6, 5.6], [6.0, 5.1], [6.4, 4.8], [7.0, 5.3]] },
  { p: [[7.7, 6.4], [7.5, 5.8]] },
];

export const SHEET = { w: 10, h: 13.8 };
