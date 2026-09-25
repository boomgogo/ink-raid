// The roster. Each type is one silhouette, one behaviour and one reason to
// change what you are doing — a shape you can read across the arena and know
// immediately whether to back off, close in, or shoot it right now.
//
// Every entry is grouped by concern rather than listed flat — identity, look,
// frame, reward, pace and attack — and every number below carries a one-line
// derivation against its design target. The
// attack's `kind` (gun | melee | charge | spotter) is what decides whether a
// type shoots, swings, charges or spots; `look.prop` is only what it is
// drawn holding, which used to double as that test (manager.js:589) and no
// longer does.
//
// Named for what lives on a desk, and keyed by the same names, so a key read
// in a tool or a log says which enemy it is. The keys themselves are pinned
// and unchanged.
export const TYPES = {
  sketch: {
    id: 'sketch', name: 'SKETCH',
    look: { hat: 'clip', prop: 'rifle' },
    frame: { scale: 1, girth: 1, headSize: 1, limbThickness: 0.035 }, // limbRadius = 0.035*1.9 = 0.0665 m, a readable stroke at range
    // ceil(60/25 rifle dmg) = 3 body hits, inside the 2-3 target; the 75 dmg
    // rifle headshot one-shots it
    reward: { hp: 60, score: 100 },
    pace: {
      speed: 5.2,           // inside the (4.5, 5.8) pin, and under the player's 5.5 m/s walk
      engage: 28,            // mid the 25-30 m engage target
      closeTo: 14,             // about half of engage, per the "closes to about half" target
      backOff: 7,                // inside the "backs off inside about 8 m" target
    },
    attack: {
      kind: 'gun',
      // exposure = 120 / (3*8/(3*0.15+1.8)) = 11.25 s, inside the 8-12 s target
      burst: 3, burstGap: 0.15,
      cooldown: [1.4, 2.2],
      damage: 8, spread: 0.04, muzzle: 40, // 20 m in 0.5 s, mid the 0.4-0.6 s travel target
    },
  },
  cutter: {
    id: 'cutter', name: 'CUTTER',
    look: { hat: 'blade', prop: 'katana' },
    frame: { scale: 1, girth: 0.95, limbThickness: 0.037, headSize: 1 }, // slightly thicker than sketch's baseline
    // ceil(46/25 rifle dmg) = 2 body hits, matching the target; one katana
    // slash (70 dmg) and one rifle headshot (75) both clear it in one
    reward: { hp: 46, score: 150 },
    pace: {
      speed: 10.5,            // > the 9.5 m/s pin, and above the player's 8.8 m/s sprint
      engage: 1.8,              // + the 0.35 m REACH constant clears the 1.8 m strike-range pin
      closeTo: 1.2, backOff: 0.5, // closes to nearly contact; barely backs off
      lunge: 6,                    // from 6 m out it commits to closing at LUNGE speed
    },
    attack: {
      kind: 'melee',
      // windup(0.4) + mean cooldown(0.75) = 1.15 s cycle, inside the 1-1.3 s target
      cooldown: [0.6, 0.9],
      windup: 0.4,                   // inside the [0.25, 0.6) s pin, and > the 0.12 s pin
      damage: 30,                       // ceil(120/30) = 4 strikes to kill, inside the 3-5 target
    },
  },
  punch: {
    id: 'punch', name: 'HOLE PUNCH',
    look: { hat: 'brim', prop: 'shotgun' },
    frame: { scale: 1, girth: 1.2, headSize: 1, limbThickness: 0.040 }, // a bruiser reads girthier and thicker-limbed
    // ceil(110/25 rifle dmg) = 5 body hits, inside the 4-5 target; 2 katana
    // slashes (70*2=140 > 110)
    reward: { hp: 110, score: 170 },
    pace: {
      speed: 3.8,               // slower: a bruiser that pushes in rather than dashes
      engage: 12,                 // pinned band: "engages to about 12 m"
      closeTo: 7,                   // pinned band: "closes to about 7 m"
      backOff: 3,                     // only backs off once it is nearly on top of you
    },
    attack: {
      kind: 'gun',
      burst: 1, cooldown: [2.0, 3.0],
      tell: 0.5,                        // >= the 0.5 s pin
      aimHold: 0.5,
      pellets: 7,                          // pinned: exactly 7
      // 7 pellets * 6 dmg = 42, exactly 35% of the 120 hp player: mid the 30-40% target
      damage: 6, spread: 0.05, muzzle: 30,
      // value at 11 m = 1-((11-8)/(14-8))*(1-0.2) = 0.47, < 0.7x the near value: clears the pin
      falloff: [8, 14, 0.2],
    },
  },
  liner: {
    id: 'liner', name: 'FINE LINER',
    look: { hat: 'pencap', prop: 'sniper' },
    frame: { scale: 1, girth: 0.9, headSize: 1, limbThickness: 0.032 }, // a lean sniper silhouette
    reward: { hp: 28, score: 140 },       // pinned: exactly 28
    pace: {
      speed: 3,                              // nominal: stationary, so pace rarely drives it
      engage: 90, closeTo: 80,                 // >= the 85 m "covers the desk from any nest" target
      backOff: 70,
    },
    role: { stationary: true },
    attack: {
      kind: 'gun',
      burst: 1, cooldown: [2.5, 4],               // mid the 2.5-4 s rest target
      aimHold: 1.6,                                 // >= the 1.5 s "aim shows well before firing" target
      // one hit = 21, 17.5% of the 120 hp player: mid the 15-20% target
      damage: 21, spread: 0.01,
      muzzle: 45,                                     // ~1 s over a nest-distance sightline
    },
  },
  highlighter: {
    id: 'highlighter', name: 'HIGHLIGHTER',
    look: { hat: 'highlighter', prop: 'marker' },
    frame: { scale: 1, girth: 0.95, headSize: 1, limbThickness: 0.033 },
    // ceil(50/25 rifle dmg) = 2 body hits, exactly matching the target
    reward: { hp: 50, score: 130 },
    pace: {
      speed: 4.5,
      engage: 22,                 // > the 20 m pin, inside the 15-25 m "keeps its distance" target
      closeTo: 20, backOff: 15,
    },
    attack: {
      kind: 'spotter',
      spotTime: 1.0,                 // inside the 0.5-1 s target, and < the ~2 s pin
    },
  },
  tape: {
    id: 'tape', name: 'TAPE',
    look: { hat: 'none', prop: 'tape' },
    frame: { scale: 1, girth: 0.9, headSize: 0.95, limbThickness: 0.032 },
    // ceil(58/25 rifle dmg) = 3 body hits, exactly matching the target
    reward: { hp: 58, score: 140 },
    drops: true,
    pace: {
      speed: 4.0,
      engage: 18,                     // inside the 15-20 m engage target, and > the 9 m pin
      closeTo: 15, backOff: 10,
    },
    attack: {
      kind: 'gun',
      burst: 1, cooldown: [2, 3],
      tell: 0.6, aimHold: 0.5,
      damage: 5,                          // 4.2% of the 120 hp player, under the 5% pin
      spread: 0.03, muzzle: 20,             // pinned: strips at about 20 m/s
      sticks: 2.0,                            // > the 1.5 s pin, inside the 0.5-0.65x TAPED.speedMul target
    },
  },
  author: {
    id: 'author', name: 'THE AUTHOR',
    look: { hat: 'crown', prop: 'rifle' },
    frame: { scale: 2, girth: 1.3, headSize: 1.2, limbThickness: 0.046 }, // a bulkier boss silhouette
    // 2000 * wave-6 ramp (1.29) = 2580 hp / (rifle magazine 32*25=800) = 3.2 ->
    // 4 magazines, inside the 3-5 target
    reward: { hp: 2000, score: 3000 },   // a boss is worth ~30x a rifleman (100)
    pace: { speed: 3.0, engage: 35, closeTo: 25, backOff: 15 }, // mid the "engages to about 35 m; slow" target
    role: { boss: true, byTrain: true },
    attack: {
      kind: 'gun',
      // exposure = 120 / (8*9/(8*0.12+2.5)) = 5.8 s, inside the 4-7 s target
      burst: 8, burstGap: 0.12,
      cooldown: [2, 3],
      damage: 9, spread: 0.035, muzzle: 40,
    },
    // scale 2 * 1.7 + wagon deck 0.8 = 4.4 m, well under the 6.5 m track clearance
    intro: 'it is coming in on the train',
  },
  stapler: {
    id: 'stapler', name: 'THE STAPLER',
    look: { hat: 'stapler', prop: 'staples' },
    frame: { scale: 2, girth: 1.3, headSize: 1.2, limbThickness: 0.046 }, // a bulkier boss silhouette
    // same magazine math as the author: 4 rifle magazines at wave-6 ramp
    reward: { hp: 2200, score: 3000 },
    pace: { speed: 3.0, engage: 30, closeTo: 22, backOff: 15 }, // > the 22 m range pin
    role: { boss: true },
    attack: {
      kind: 'gun',
      burst: 2, burstGap: 1.0,               // two fan volleys inside the 4 s pin
      cooldown: [3, 4],
      fan: 9,                                  // pinned: exactly 9 per fan
      fanArc: 1.2,                               // > the 0.9 rad pin; half-gap = 1.2/8/2 = 0.075 > the 0.03 rad pin
      // one staple = 11, 9.2% of the 120 hp player: mid the 8-12% target
      damage: 11, muzzle: 20,                       // pinned: about 20 m/s
    },
    intro: 'staples come in fans: find the gap',
  },
  stamp: {
    id: 'stamp', name: 'THE STAMP',
    look: { hat: 'stamp', prop: 'none' },
    frame: { scale: 2.2, girth: 1.35, headSize: 1.2, limbThickness: 0.047 },
    reward: { hp: 2200, score: 3000 },
    pace: { speed: 3.0, engage: 25, closeTo: 20, backOff: 10 }, // > the 16 m range pin
    role: { boss: true },
    attack: {
      kind: 'charge',
      cooldown: [3, 4.5],
      windup: 0.8,                       // inside the 0.6-1.0 s target, and < the 3 s pin
      speed: 18, duration: 1.2,            // inside the 16-20 m/s target; speed*duration=21.6 m, clears the >=18 m pin
      stun: 2.0,                             // > the 1.5 s pin
      reach: 2.0, minDist: 4.0,                // < the 5.5 m pin
      // 36 dmg = 30% of the 120 hp player, mid the 25-35% target
      damage: 36,
    },
    intro: 'it charges: step aside and let it hit a wall',
  },
};

// The regular roster in debut order, and the wave each debuts on. One new
// type per wave from wave 2, so the whole roster (6 types) has appeared by
// wave 6 — a wave before the first boss (wave 7, see WAVES.bossEvery in
// core/waves.js). The nest sniper and the spotter debut back to back, last.
// Wave 1 is riflemen only, per the target; one new type per wave from wave 2
// fills out the roster by wave 6, a wave before the first boss (wave 7). The
// nest sniper and the spotter debut back to back, last.
export const DEBUT = {
  sketch: 1, cutter: 2, punch: 3, tape: 4, liner: 5, highlighter: 6,
};

// How much of the wave's pool each type is, as a function of the wave
// number: the LAST step whose wave is <= the current one applies. Declared
// as steps on the roster rather than (from, type, weight) rows, so a type's
// whole curve lives in one place.
//
// Sketch alone carries a third of the pool even at the far end (10 / (10+7+
// 6+3+2+2) = 0.333), which is the "never less than about a third" target.
// Cutter and punch step up from wave 8 — the wave after the first boss —
// which is the "mix shifts toward blades and bruisers" target.
export const WEIGHT_CURVE = {
  sketch: [[1, 10]],
  cutter: [[2, 3], [8, 7]],
  punch: [[3, 3], [8, 6]],
  tape: [[4, 3]],
  liner: [[5, 2]],
  highlighter: [[6, 2]],
};

/** The weight of `type` at `wave`, or 0 before it has debuted. */
export function weightAt(type, wave) {
  const steps = WEIGHT_CURVE[type];
  if (!steps || wave < steps[0][0]) return 0;
  let w = 0;
  for (const [from, weight] of steps) if (wave >= from) w = weight;
  return w;
}

// Bosses rotate through a fixed order: boss ordinal k (how many boss waves
// have happened so far, this one included) maps to `BOSS_ORDER[(k-1) %
// BOSS_ORDER.length]`, so boss waves 1, 2 and 3 are three different fights,
// and the fourth repeats the first.
export const BOSS_ORDER = ['author', 'stapler', 'stamp'];

// Wave modifiers, as data. Each one changes how a wave is fought rather than
// how hard it is. The fields a modifier leaves out keep their plain value:
//   speedMul, damageMul, hpMul, countMul  scale the wave's figures (1)
//   huntFromSpawn  every figure comes straight for you (false)
//   oneType        the whole wave is one debuted type that moves, picked at random (false)
//   critMul, bodyMul  scale damage taken on head hits and on everything else (1)
//   healOnDrop     health you get back for each figure dropped (0)
export const MODIFIERS = [
  {
    // One pen: the whole wave is drawn with the same pen. A page of cutters
    // wants the shotgun; a page of liners wants cover and the sniper.
    key: 'onePen', name: 'ONE PEN', oneType: true,
  },
  {
    // Fine print: only a head hit reads. Bodies soak up most of a round, heads
    // take half again, so it is a wave for aiming, not spraying.
    key: 'finePrint', name: 'FINE PRINT', critMul: 1.5, bodyMul: 0.6,
  },
  {
    // Second draft: each figure you drop gives some health back, past the
    // regen ceiling. Staying in the fight is the way to heal.
    key: 'secondDraft', name: 'SECOND DRAFT', healOnDrop: 12, damageMul: 1.15,
  },
  {
    // Lamp on: the desk lamp lights you up, and every one of them comes
    // straight for you from where it spawns.
    key: 'lampOn', name: 'LAMP ON', speedMul: 0.9, huntFromSpawn: true,
  },
];
