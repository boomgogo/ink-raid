import { DEBUT, weightAt, MODIFIERS, TYPES, BOSS_ORDER } from '../entities/enemies/types.js';
import * as THREE from 'three';
import { difficulty } from './difficulty.js';
import { raycast } from './physics.js';

// The wave director.
//
// Shape of a wave: a short breather with the next wave announced, then enemies
// trickling in from spawn points you are not looking at, then a clear. The
// trickle matters — dumping twelve enemies at once turns into a scrum, while a
// steady feed keeps you moving and shooting.
//
// Difficulty comes from three dials, not one: how many, what mix, and a
// modifier that changes how they behave for the whole wave. How many alive at
// once, and how many per wave, also answer to core/difficulty.js.
export const WAVES = {
  firstDelay: 2.5,       // mid the 2-3 s target; pinned: >= 3 alive within ~10 s
  breather: 4.5,          // mid the 3-6 s target
  baseCount: 5,            // wave 1 lasts 30-60 s at medium; easy's n comes out <= 3
  perWave: 1.4,            // wave10 full = 5+9*1.4 = 17.6, a 3.52x of wave1: inside 3-4x
  spawnGap: 0.6,           // 5 gaps over the first 6 arrivals = 3 s, inside the 2-5 s target
  bossEvery: 7,            // the last debut is wave 6 (see types.js DEBUT); mid the 5-7 cadence target
};

// The global ramp: a slow rise so a modifier changes how a wave feels more
// than a flat repeat of it would. At wave 12: hp x(1+11*0.058)=1.64 (+64%,
// inside 50-80%), damage x(1+11*0.029)=1.32 (+32%, inside 25-40%).
export const RAMP = { hpPerWave: 0.058, damagePerWave: 0.029 };

// Where enemies come in. Enemies don't all spawn in the same spot; they spawn
// randomly.
export const SPAWN = {
  minDist: 18,        // pinned: never nearer you than this
  recentCount: 4,      // ...nor within `recentMinDist` of the last this many spawn points
  recentMinDist: 8,
  crowdMinDist: 4,      // ...nor this close to anything alive
  sightProbeHeight: 1.2, // and out of your sight: a line from your eye to here on the point
};

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class WaveDirector {
  constructor(ctx) {
    this.ctx = ctx;
    this.wave = 0;
    this.state = 'idle';     // idle | breather | spawning | clearing | boss
    this.timer = 0;
    this.toSpawn = [];
    this.entryClock = 0;
    // "None" is a policy, not a list entry: waves 1-2 read as no modifier by
    // simply not picking one (see nextWave), so this starts out unset.
    this.modifier = null;
    this.bossCount = 0;      // how many boss waves have happened so far
    this.onAnnounce = null;
    this.onWaveStart = null;
    this.onWaveClear = null;
    this.boss = false;
    this.recent = [];        // the last few spawn points, so they do not repeat
  }

  start() {
    this.wave = 0;
    this.state = 'breather';
    this.timer = WAVES.firstDelay;
    this.bossCount = 0;
    this.ctx.enemies.clear();
  }

  stop() { this.state = 'idle'; }

  get remaining() { return this.ctx.enemies.alive + this.toSpawn.length; }

  nextWave() {
    this.wave++;
    const w = this.wave;
    const isBoss = w % WAVES.bossEvery === 0;
    this.boss = isBoss;

    // Modifier policy: none on the first two waves, then one at random, never
    // twice running, because a repeat reads as no modifier at all.
    this.modifier = w <= 2 ? null : pickModifier(this.modifier);

    const m = this.modifier || {};
    const mods = {
      speed: m.speedMul ?? 1, damage: m.damageMul ?? 1, hp: m.hpMul ?? 1, count: m.countMul ?? 1,
      alwaysHunt: !!m.huntFromSpawn, crit: m.critMul ?? 1, body: m.bodyMul ?? 1, heal: m.healOnDrop ?? 0,
    };
    // and a slow global ramp on top, so wave 12 is harder than wave 6 with the
    // same modifier
    mods.hp *= 1 + (w - 1) * RAMP.hpPerWave;
    mods.damage *= 1 + (w - 1) * RAMP.damagePerWave;
    Object.assign(this.ctx.enemies.mods, mods);

    this.toSpawn = [];
    if (isBoss) {
      this.bossCount++;
      this.bossKey = BOSS_ORDER[(this.bossCount - 1) % BOSS_ORDER.length];
      this.toSpawn.push(this.bossKey);
      const escorts = Math.round((4 + w) * difficulty.escortMul);
      for (let i = 0; i < escorts; i++) this.toSpawn.push('sketch');
    } else {
      const full = Math.round((WAVES.baseCount + (w - 1) * WAVES.perWave) * (mods.count || 1));
      // never thinned below 3, unless it was already smaller
      const n = Math.max(Math.min(full, 3), Math.round(full * difficulty.enemyCountMul));
      const pool = Object.keys(DEBUT).filter((type) => weightAt(type, w) > 0);
      // a whole wave of one stationary type would only be a wall of snipers
      const movers = pool.filter((type) => !TYPES[type].role?.stationary);
      const only = m.oneType && movers.length ? movers[Math.floor(Math.random() * movers.length)] : null;
      for (let i = 0; i < n; i++) this.toSpawn.push(only || weighted(pool, w));
    }

    this.state = 'spawning';
    this.entryClock = 0;
    this.onWaveStart?.(w, this.modifier?.name || '', isBoss, isBoss ? TYPES[this.bossKey].intro : '');
  }

  update(dt) {
    if (this.state === 'idle') return;
    const ctx = this.ctx;

    if (this.state === 'breather') {
      ctx.enemies.contactT = 0;
      this.timer -= dt;
      if (this.timer <= 0) this.nextWave();
      return;
    }

    if (this.state === 'spawning') {
      this.entryClock -= dt;
      if (this.entryClock <= 0 && this.toSpawn.length && ctx.enemies.alive < difficulty.crowdCap) {
        const key = this.toSpawn.shift();
        const at = this.chooseEntry(key);
        // a boss comes for you, and so does its escort
        if (at) ctx.enemies.spawn(key, at, this.boss ? { mind: 'hunt' } : undefined);
        this.entryClock = WAVES.spawnGap;
      }
      if (!this.toSpawn.length) this.state = 'clearing';
      return;
    }

    if (this.state === 'clearing' && ctx.enemies.alive === 0) {
      this.onWaveClear?.(this.wave);
      this.state = 'breather';
      this.timer = WAVES.breather;
      this.onAnnounce?.(this.wave + 1);
    }
  }

  /**
   * A random open point, out of your sight.
   *
   * It used to take the best score of 16 fixed points round the edge, scored
   * mostly on being behind you, and the one or two points straight behind you
   * won nearly every roll: a wave trickled out of the same spot. Now it is
   * uniform over every open point on the desk that passes four rules, checked
   * in a random order and cheapest first, so the first to pass is the pick and
   * the line of sight is only cast for a point that got that far. If nothing
   * passes, the rules are let go from the last — the spacing from the living,
   * then from recent spawns, then being out of sight — but never the distance.
   */
  chooseEntry(key) {
    const lv = this.ctx.level;
    const p = this.ctx.player;
    if (TYPES[key]?.role?.stationary && lv.snipers.length) return this.pickNest();
    if (TYPES[key]?.role?.byTrain && lv.train) return this.onTrain();
    const pool = lv.spawnPool?.length ? lv.spawnPool : lv.spawns;
    if (!pool.length) return null;
    const alive = this.ctx.enemies.list.filter((e) => e.alive);

    const order = shuffled(pool.length);
    const far2 = SPAWN.minDist * SPAWN.minDist;
    for (let relax = 0; relax < 4; relax++) {
      for (const i of order) {
        const s = pool[i];
        const dx = s.x - p.body.pos.x, dz = s.z - p.body.pos.z;
        if (dx * dx + dz * dz < far2) continue;
        if (relax < 1 && alive.some((e) => Math.hypot(e.body.pos.x - s.x, e.body.pos.z - s.z) < SPAWN.crowdMinDist)) continue;
        if (relax < 2 && this.recent.some((r) => Math.hypot(r.x - s.x, r.z - s.z) < SPAWN.recentMinDist)) continue;
        if (relax < 3 && this.inSight(s)) continue;
        return this.remember(s);
      }
    }
    // everything is within `minDist` of you: the furthest there is
    let best = pool[0], bd = -1;
    for (const s of pool) {
      const d = Math.hypot(s.x - p.body.pos.x, s.z - p.body.pos.z);
      if (d > bd) { bd = d; best = s; }
    }
    return this.remember(best);
  }

  /**
   * On the train's flat wagon, wherever the train is: whoever spawns there
   * rides it until they step off, as anything standing on it does.
   */
  onTrain() {
    const car = this.ctx.level.train.cars.find((c) => c.name === 'flat wagon');
    const at = car.body.pos;
    return new THREE.Vector3(at.x, 0.85, at.z);
  }

  /** A sniper goes to a nest nobody is on, if there is one. */
  pickNest() {
    const nests = this.ctx.level.snipers;
    const taken = (n) => this.ctx.enemies.list.some((e) => e.alive && e.t.role?.stationary
      && Math.hypot(e.body.pos.x - n.x, e.body.pos.z - n.z) < 2.5);
    const free = nests.filter((n) => !taken(n));
    const from = free.length ? free : nests;
    return from[Math.floor(Math.random() * from.length)];
  }

  /** Could you see something standing on point `s`? */
  inSight(s) {
    const p = this.ctx.player;
    _eye.copy(p.eye);
    _dir.set(s.x, s.y + SPAWN.sightProbeHeight, s.z).sub(_eye);
    const d = _dir.length();
    if (d < 1e-3) return true;
    _dir.multiplyScalar(1 / d);
    return !raycast(this.ctx.level, _eye, _dir, d);
  }

  remember(s) {
    this.recent.push(s);
    if (this.recent.length > SPAWN.recentCount) this.recent.shift();
    return s;
  }
}

function shuffled(n) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A modifier at random from MODIFIERS, never the one just used. */
function pickModifier(last) {
  if (MODIFIERS.length <= 1) return MODIFIERS[0];
  let pick;
  do { pick = MODIFIERS[Math.floor(Math.random() * MODIFIERS.length)]; }
  while (pick === last);
  return pick;
}

function weighted(types, wave) {
  let total = 0;
  for (const type of types) total += weightAt(type, wave);
  let x = Math.random() * total;
  for (const type of types) { x -= weightAt(type, wave); if (x <= 0) return type; }
  return types[0];
}
