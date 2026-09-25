// Difficulty: one table, read by everything it touches.
//
// MEDIUM is the game as it was, to the number, so every gate tuned against it
// still means what it meant. EASY answers the playtester's four asks: enemies
// with less health, enemies easier to shoot, fewer enemies, more player health.
// "Easier to shoot" is two things, since a miss is either aim or a target that
// will not hold still: fatter hit volumes, and less side-stepping.
//
// Systems read `difficulty` at the moment they use a number, never copy it, so
// switching between runs needs nothing but setDifficulty(). HARD is for the
// backlog; add a column here and a button in Game.showMenu.

// Field names below are new and grouped by what they gate; `sight`,
// `bandageDrop`, `key` and `crowdCap` stay flat and exactly named because
// tools read them off `window.__ink.difficulty` by that path.
export const DIFFICULTIES = {
  easy: {
    label: 'EASY',
    enemyHpMul: 0.6,        // pinned: exactly 0.6 of MEDIUM, bosses too
    enemyCountMul: 0.6,     // mid the 0.5-0.7 target; never below 3 either way
    escortMul: 0.5,         // half the sketches that come with a boss
    crowdCap: 8,            // < MEDIUM's, per the pin
    // R (a TAPE's world head radius) * aimMargin must clear 0.3 m: with R
    // near 0.25 m that wants > 1.2; 1.35 gives margin
    aimMargin: 1.35,
    strafeMul: 0.4,         // mid the 0.3-0.5 target
    enemySpeedMul: 0.85,    // mid the 0.8-0.9 target
    hp: 180,                // pinned: exactly 180
    windupMul: 1.4,         // mid the 1.3-1.5 target: longer to read a wind-up
    sight: 0.8,             // mid the 0.75-0.85 target
    bandageDrop: 0.35,      // pinned: exactly 0.35
  },
  medium: {
    // The button says PLAY: it is the game, and EASY is the
    // variant. The key stays `medium`, so best scores and the remembered
    // choice carry over, and a HARD column can still come after it.
    label: 'PLAY',
    enemyHpMul: 1,
    enemyCountMul: 1,
    escortMul: 1,
    crowdCap: 14,           // >= 3, and inside what perf.mjs validates at 12 hunting
    // R * aimMargin must stay under 0.3 m, and this is "aim slop only": just
    // over 1
    aimMargin: 1.08,
    strafeMul: 1,
    enemySpeedMul: 1,
    hp: 125,                // >= the 90 hp pin (40->90 bandage test); inside the 100-140 target, so a full sketch burst (4 x 7) is under a quarter of it
    windupMul: 1,
    sight: 1,
    bandageDrop: 0.2,       // pinned: exactly 0.2
  },
};

export const difficulty = { key: 'medium', ...DIFFICULTIES.medium };

export function setDifficulty(key) {
  if (!DIFFICULTIES[key]) key = 'medium';
  Object.assign(difficulty, { key }, DIFFICULTIES[key]);
  return difficulty;
}
