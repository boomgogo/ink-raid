// Everything on the desk that moves by itself: the train, the double pendulum,
// the Newton's cradle. Each works out where its bodies are this frame; then
// the movers carry whoever is standing on them and push whoever is in the way
// (see world/movers.js).
//
// Game runs this before anything walks, behind the menu as well as in a run,
// and not behind the pause screen. A capture that pins the camera never runs
// it at all, so every toy holds its seeded starting pose and a shot is the
// same frame every time.

// A round's push on a toy, per point of damage it does, in the toys' own units
// of momentum: a rifle round swings a cradle ball about 15 degrees. Each toy
// caps how fast it will go, so a sniper round is a hard shove, not a launch.
export const IMPULSE = 0.15;

export class Toys {
  constructor(movers, parts) {
    this.movers = movers;
    this.parts = parts;
    this.onEvent = null;     // (kind, position, strength): Game plays the sound
  }

  /** `bodies`: every walking body there is. */
  update(dt, level, bodies) {
    for (const p of this.parts) p.update(dt, this, bodies);
    this.movers.step(dt, level, bodies);
  }

  emit(kind, pos, strength = 1) { this.onEvent?.(kind, pos, strength); }

  /** Every toy back where it starts, and nobody carried or pushed getting there. */
  reset(level) {
    for (const p of this.parts) p.reset?.();
    this.movers.step(1 / 60, level, []);
    this.movers.step(1 / 60, level, []);
  }

  /** A round hit collider `c`, which belongs to a mover: tell whoever owns it. */
  hit(c, point, dir, impulse) {
    const body = c?.mover;
    if (body?.owner?.hit) body.owner.hit(body, point, dir, impulse);
  }

  /** A blast: anything with a body in reach gets pushed. */
  blast(center, radius, strength) {
    for (const p of this.parts) p.blast?.(center, radius, strength);
  }
}
