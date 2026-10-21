import * as THREE from 'three';
import { Smooth } from '@p3p2/client/smooth';
import { TYPES, MODIFIERS } from '../entities/enemies/types.js';
import { pose } from '../entities/enemies/rig.js';
import { PICKUP } from '../entities/pickups.js';
import { PLANES } from '../entities/planes.js';
import { WAVES } from '../core/waves.js';
import { setDifficulty } from '../core/difficulty.js';
import { INK } from '../render/palette.js';
import { clamp, ease } from '../core/spring.js';
import { Reader, Writer, num } from './wire.js';

// The horde, as one page runs it and the others see it.
//
// The host runs everything that is not a player, exactly as a game alone does, and says what
// it sees:
//
//   hr   ten times a second, bytes, droppable: every figure (type, place, heading, how it
//        moves, what it is doing, its health and who it is after), the wave in progress, the
//        paper planes, and the toys
//   sh   the rounds it fires, as they are fired (twenty batches a second at most). Every page
//        flies every round, and judges only those that reach its own player.
//   dn   who went down, and whose kill it was
//   wv   a wave starts or is down: the banner, the twist, the top-up, and a way back in for
//        whoever is down
//   pk   what lies on the desk to be picked up, whenever that changes
//   hurt a blade or a charge that reaches one player: to that player alone, whose page asks
//        its katana first, as it always did (guard: what the katana did about it)
//   hl   one player is highlighted: to that player
//   give one player gets what it walked over first
//
// The others draw the figures where the host says, a tenth of a second in the past, and ask
// the host for what they do to its world:
//
//   hit    their rounds, blades and blasts that land on a figure, twenty batches a second at
//          most, with the noise their guns make
//   plane  a paper plane they shot down
//   take   something they walked over
//   stg    a figure their katana staggered
//
// When the host goes, the next one has been drawing every figure, knows its type, health and
// target, and has the wave's state down to the list still to come. It makes them its own and
// carries on (`lead`). What it cannot know is each figure's plan: they start hunting afresh.

const TYPE_KEYS = Object.keys(TYPES);
const WAVE_STATES = ['idle', 'breather', 'spawning', 'clearing'];
const PLANE_MODES = ['fly', 'fall', 'gone', 'enter'];
const CARRY = ['bandage', 'stapler'];
const SOURCES = ['', 'katana', 'parry'];
const REPORT_HZ = 10;
const BATCH_SECONDS = 0.05;
/** How far in the past a guest draws the horde, ms: two reports at ten a second, and the server. */
const DELAY = 140;
/** A guest's noise is told at most this often, seconds: a rifle fires ten times a second. */
const NOISE_GAP = 0.25;

const F_ALIVE = 1, F_AIM = 2, F_HUNT = 4, F_SEARCH = 8, F_STAGGER = 16, F_CHARGE = 32, F_WIND = 64;

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Horde {
  /**
   * @param {any} game the Game (game.js)
   * @param {any} net the Net (net/room.js)
   */
  constructor(game, net) {
    this.game = game;
    this.net = net;
    this.ctx = game.ctx;
    this.room = null;
    this.leading = false;
    this.smooth = new Smooth({ delay: DELAY, angles: [3], jump: 8 });
    this.planeSmooth = new Smooth({ delay: DELAY, quaternions: [3], jump: 20 });
    this.reportT = 0;
    this.batchT = 0;
    this.seq = 0;
    this.shots = [];       // [enemy, bullet, firedAt] waiting to go out
    this.downs = [];
    this.hits = [];
    this.noises = [];
    this.noiseT = 0;
    /** What the last wave's start said: its twist, for a host that takes over during it. */
    this.waveInfo = null;
    /** The last report, for the tests: what this page was told. */
    this.last = null;
    this._offs = [];
    this.pickupIds = 0;
    this.pkDue = false;
    this.pkT = 0;
    this.taken = new Map();   // pickup id -> when this page last asked for it
  }

  start(room) {
    this.stop();
    this.room = room;
    const r = room;
    const fromHost = (from) => !r.isHost && from === r.host;
    this._offs.push(
      r.on('hr', (data, from) => { if (fromHost(from) && data instanceof Uint8Array) this.onReport(data); }),
      r.on('sh', (data, from) => { if (fromHost(from) && data instanceof Uint8Array) this.onShots(data); }),
      r.on('dn', (data, from) => { if (fromHost(from) && Array.isArray(data)) for (const d of data) this.onDown(d); }),
      r.on('wv', (data, from) => { if (fromHost(from)) this.onWave(data); }),
      r.on('pk', (data, from) => { if (fromHost(from) && Array.isArray(data)) this.onPickups(data); }),
      r.on('hurt', (data, from) => { if (from === r.host) this.onHurt(data); }),
      r.on('hl', (_data, from) => { if (from === r.host) this.ctx.enemies.highlight(this.ctx.player); }),
      r.on('give', (data, from) => { if (from === r.host && data && typeof data.item === 'string') this.game.take(data.item, true); }),
      // to the host
      r.on('hit', (data, from) => { if (r.isHost && from) this.onHits(data, from); }),
      r.on('plane', (data, from) => { if (r.isHost && from) this.onPlane(data, from); }),
      r.on('take', (data, from) => { if (r.isHost && from) this.onTake(data, from); }),
      r.on('guard', (data, from) => { if (r.isHost && from) this.onGuard(data, from); }),
      r.on('stg', (data, from) => { if (r.isHost && from) this.onStagger(data); }),
    );
  }

  stop() {
    for (const off of this._offs) off();
    this._offs = [];
    this.room = null;
    if (!this.leading) this.unfollow();
    this.leading = false;
  }

  // ---- whose horde it is -------------------------------------------------------------

  /** This page runs the horde: alone, as the host, or as the next host. */
  lead() {
    if (this.leading) return;
    const wasFollowing = !!this.ctx.enemies.net?.follows;
    this.leading = true;
    const en = this.ctx.enemies;
    this.unfollow();
    if (!wasFollowing) return this.offerPickups();
    // Every figure this page was drawing becomes one it runs, where it stands.
    let top = 0;
    for (const e of en.list) {
      top = Math.max(top, e.id || 0);
      if (!e.alive) continue;
      e.body.vel.set(0, 0, 0);
      e.chargeState = null;
      e.volleyLeft = 0;
      e.windT = 0;
      e.cutT = 0;
      e.ladder = null;
      e.endClock = 0;
      e.cool = 0.6 + Math.random();
      e.mind = 'roam';
      en.hunt(e, false);
    }
    en.nextId = (top % 65535) + 1;
    // What comes next is at the run's difficulty, whatever this page last played alone.
    if (this.net.run) setDifficulty(this.net.run.d);
    // The wave carries on from where the last report had it.
    const w = this.game.waves;
    const info = this.waveInfo;
    if (info) {
      Object.assign(en.mods, info.mods || {});
      w.modifier = info.mi >= 0 ? MODIFIERS[info.mi] : null;
      w.boss = !!info.boss;
    }
    w.bossCount = Math.floor(w.wave / WAVES.bossEvery);
    if (w.state === 'idle' && this.net.runOn()) w.state = 'clearing';
    // The planes in the sky go on round their circles; one that was falling or gliding in starts again.
    for (const p of this.ctx.planes.list) {
      if (p.mode === 'fly') {
        const c = p.circle;
        p.a = Math.atan2(p.pos.z - Math.sin(c.at) * PLANES.offset, p.pos.x - Math.cos(c.at) * PLANES.offset);
      } else if (p.mode !== 'gone') {
        p.mode = 'gone';
        p.gone = 2;
      }
    }
    // What lies on the desk is this page's to keep now: the map's spots know their rolls again.
    const pk = this.ctx.pickups;
    for (const q of pk.list) this.pickupIds = Math.max(this.pickupIds, q.id || 0);
    for (const s of pk.spots) {
      const q = pk.list.find((o) => !o.spot && o.item === s.item && o.life === Infinity && o.pos.distanceTo(s.pos) < 0.6);
      s.here = q || null;
      s.takenT = 0;
      if (q) q.spot = s;
    }
    this.offerPickups();
  }

  /** This page draws the horde the host runs. */
  follow() {
    this.leading = false;
    const en = this.ctx.enemies;
    en.net = this.drawer || (this.drawer = this.makeDrawer());
    this.game.waves.stop();
    this.ctx.planes.follower = (dt) => this.drawPlanes(dt);
    this.ctx.planes.asked = (p) => this.askPlane(p);
    this.ctx.pickups.follow = true;
    this.smooth = new Smooth({ delay: DELAY, angles: [3], jump: 8 });
  }

  unfollow() {
    const en = this.ctx.enemies;
    en.net = this.leader || (this.leader = this.makeLeader());
    this.ctx.planes.follower = null;
    this.ctx.planes.asked = null;
    this.ctx.pickups.follow = false;
  }

  /** Alone again: nobody to tell anything. */
  alone() {
    this.ctx.enemies.net = null;
    this.ctx.planes.follower = null;
    this.ctx.planes.asked = null;
    this.ctx.pickups.follow = false;
    this.leading = false;
  }

  /** What the enemies' manager asks of the host's page (entities/enemies/manager.js). */
  makeLeader() {
    return {
      follows: false,
      mine: () => this.net.mine(),
      targets: (out) => this.net.targets(out),
      shot: (e, bullets) => this.shot(e, bullets),
      strike: (e, p, dmg, launch) => this.strike(e, p, dmg, launch),
      highlight: (p) => this.room?.send('hl', 1, { to: p.remote }),
      proxyOf: (id) => this.net.crew.proxyOf(id),
      downed: (e, info) => this.downed(e, info),
    };
  }

  /** ...and of a guest's page. */
  makeDrawer() {
    return {
      follows: true,
      mine: () => this.net.mine(),
      drive: (e, dt) => this.drive(e, dt),
      hit: (e, amount, info) => this.hit(e, amount, info),
      noise: (pos, radius, kind) => this.noise(pos, radius, kind),
      stagger: (e, seconds) => this.room?.send('stg', { e: e.id, s: seconds }, { to: 'host' }),
    };
  }

  // ---- every frame -------------------------------------------------------------------

  tick(dt) {
    const r = this.room;
    if (!r) return;
    this.batchT -= dt;
    this.noiseT -= dt;
    if (this.leading) {
      this.reportT -= dt;
      if (this.reportT <= 0) {
        this.reportT = 1 / REPORT_HZ;
        if (r.members.length > 1) r.send('hr', this.report(), { volatile: true });
      }
      if (this.batchT <= 0) {
        this.batchT = BATCH_SECONDS;
        this.flushShots();
        if (this.downs.length) { r.send('dn', this.downs); this.downs = []; }
      }
      this.pkT -= dt;
      if (this.pkDue && this.pkT <= 0) this.sendPickups();
    } else if (this.batchT <= 0) {
      this.batchT = BATCH_SECONDS;
      if (this.hits.length || this.noises.length) {
        r.send('hit', { h: this.hits, n: this.noises }, { to: 'host' });
        this.hits = [];
        this.noises = [];
      }
    }
  }

  // ---- the host's reports ----------------------------------------------------------------

  report() {
    const w = new Writer(1024);
    const r = this.room;
    const en = this.ctx.enemies;
    const waves = this.game.waves;
    // its number, and the room's clock when it was true
    w.u16(++this.seq % 65536).f64(r.now());
    // the wave
    w.u16(waves.wave).u8(Math.max(0, WAVE_STATES.indexOf(waves.state))).f32(waves.timer).u8(waves.boss ? 1 : 0);
    const queue = waves.toSpawn.slice(0, 255);
    w.u8(queue.length);
    for (const k of queue) w.u8(TYPE_KEYS.indexOf(k));
    // the figures
    const live = en.list.filter((e) => e.alive).slice(0, 255);
    w.u8(live.length);
    const me = this.room.self.id;
    for (const e of live) {
      const b = e.body;
      let f = F_ALIVE;
      if (e.aiming) f |= F_AIM;
      if (e.mind === 'hunt') f |= F_HUNT;
      if (e.mind === 'search') f |= F_SEARCH;
      if (e.staggerT > 0) f |= F_STAGGER;
      if (e.chargeState === 'run') f |= F_CHARGE;
      if (e.chargeState === 'wind') f |= F_WIND;
      w.u16(e.id).u8(TYPE_KEYS.indexOf(e.type))
        .pos(b.pos.x).pos(b.pos.y).pos(b.pos.z).angle(e.yaw)
        .unit(clamp(e.walk, 0, 1)).u8(f).unit(clamp(e.raise || 0, 0, 1)).unit(clamp(e.cut || 0, 0, 1))
        .u16(Math.ceil(e.hp)).u16(Math.ceil(e.maxHp))
        .unit(clamp(e.notice, 0, 1)).u8(clamp(e.markT, 0, 2.55) * 100).unit(clamp(e.hurt, 0, 1))
        .u16(e.target?.remote ?? (e.target === this.ctx.player ? me : 0));
    }
    // the planes
    const planes = this.ctx.planes.list;
    w.u8(planes.length);
    for (const p of planes) {
      w.u8(PLANE_MODES.indexOf(p.mode)).u8(CARRY.indexOf(p.carry))
        .pos(p.pos.x).pos(p.pos.y).pos(p.pos.z)
        .signed(p.quat.x).signed(p.quat.y).signed(p.quat.z).signed(p.quat.w);
    }
    // the toys
    const parts = this.ctx.level.toys?.parts || [];
    w.u8(parts.length);
    for (const part of parts) {
      const s = toyState(part);
      w.u8(s.length);
      for (const v of s) w.f32(v);
    }
    return w.bytes();
  }

  onReport(bytes) {
    let rep;
    try { rep = readReport(bytes); } catch { return; }
    // An old report that overtook a newer one says nothing new.
    if (this.last && ((rep.seq - this.last.seq + 65536) % 65536) > 32768) return;
    this.last = rep;
    const en = this.ctx.enemies;
    const waves = this.game.waves;
    waves.wave = rep.wave;
    waves.state = rep.waveState;
    waves.timer = rep.timer;
    waves.boss = rep.boss;
    waves.toSpawn = rep.queue;
    const me = this.room.self.id;
    const seen = new Set();
    for (const f of rep.foes) {
      seen.add(f.id);
      let e = en.byId(f.id);
      if (!e) {
        e = en.spawn(f.type, new THREE.Vector3(f.x, f.y, f.z));
        if (!e) continue;
        e.id = f.id;
        e.yaw = f.yaw;
        e.walk = 0;
        e.markT = 0;
      }
      if (!e.alive) continue;
      e.missing = 0;
      this.smooth.set(f.id, [f.x, f.y, f.z, f.yaw]);
      e.netWalk = f.walk;
      e.flags = f.flags;
      e.raise = f.raise;
      e.cut = f.cut;
      e.hp = f.hp;
      e.maxHp = f.maxHp;
      e.notice = f.notice;
      e.markT = f.markT;
      e.hurt = Math.max(e.hurt, f.hurt);
      e.mind = f.flags & F_HUNT ? 'hunt' : f.flags & F_SEARCH ? 'search' : 'roam';
      e.staggerT = f.flags & F_STAGGER ? 0.2 : 0;
      e.chargeState = f.flags & F_CHARGE ? 'run' : f.flags & F_WIND ? 'wind' : null;
      e.target = f.target === me ? this.ctx.player : null;
    }
    // Gone from the reports without a word: taken off the desk by the host (a fall off the edge).
    // One that went down is missing from the next report too, and its `dn` may come after that
    // report: it has three reports' time to arrive, and say whose kill it was.
    for (const e of en.list) {
      if (!e.alive || seen.has(e.id) || (e.missing = (e.missing || 0) + 1) < 3) continue;
      e.alive = false;
      e.downFor = 3;
      en.alive--;
      this.smooth.delete(e.id);
    }
    // the planes, to draw between reports
    const planes = this.ctx.planes.list;
    rep.planes.forEach((q, i) => {
      const p = planes[i];
      if (!p) return;
      if (p.mode !== q.mode) this.planeSmooth.delete(i);
      p.mode = q.mode;
      p.carry = q.carry;
      this.planeSmooth.set(i, [q.x, q.y, q.z, q.qx, q.qy, q.qz, q.qw]);
    });
    // The toys: the train where the host has it, if this page has drifted; the two that are chaos
    // as the host has them, brought up to now.
    const age = clamp((this.room.now() - rep.at) / 1000, 0, 0.3);
    const toys = this.ctx.level.toys;
    rep.toys.forEach((s, i) => { if (toys?.parts[i]) setToyState(toys.parts[i], s, age, toys); });
  }

  /** A guest's figure, where the host last said, drawn a moment in the past. */
  drive(e, dt) {
    const at = this.smooth.get(e.id);
    const b = e.body;
    if (at) {
      b.pos.set(at[0], at[1], at[2]);
      e.yaw = at[3];
    }
    const t = e.t;
    e.walk = ease(e.walk, e.netWalk || 0, 10, dt);
    e.stateT += dt;
    e.hurt = Math.max(0, e.hurt - dt * 3);
    e.markT = Math.max(0, e.markT - dt);
    e.center.copy(b.pos).setY(b.pos.y + b.height * 0.55);
    e.eye.copy(b.pos).setY(b.pos.y + b.height * 0.9);
    e.fig.root.position.copy(b.pos);
    e.fig.root.rotation.y = e.yaw;
    const f = e.flags || 0;
    const reel = f & F_STAGGER ? 0.4 : 0;
    pose(e.fig.J, {
      t: e.phase + e.stateT,
      walk: e.walk,
      aim: !!(f & F_AIM),
      raise: f & F_WIND ? 1 : e.raise || 0,
      cut: e.cut || 0,
      lean: e.walk * 0.25 - reel * 0.9 + (f & F_CHARGE ? 0.7 : 0),
      hurt: Math.max(e.hurt, reel),
    });
    e.fig.root.rotation.z = reel * Math.sin(e.stateT * 18) * 0.12;
    e.phase += dt * (0.4 + e.walk);
    e.fig.root.scale.setScalar(t.frame.scale || 1);
  }

  // ---- rounds ------------------------------------------------------------------------

  /** The host's figure `e` fired `bullets`, just now. */
  shot(e, bullets) {
    if (!this.room || this.room.members.length < 2) return;
    const at = performance.now();
    // where it left the barrel: by the time the batch goes, the host's own copy has moved on, or hit something
    for (const bu of bullets) this.shots.push([e, bu.pos.clone(), bu.vel.clone(), bu.dmg, at]);
    if (this.shots.length > 200) this.shots.splice(0, this.shots.length - 200);
  }

  flushShots() {
    if (!this.shots.length) return;
    const shots = this.shots.slice(0, 255);
    const w = new Writer(16 + shots.length * 28);
    const at = performance.now();
    // when the batch went, on the room's clock; and for each round, how long before that it was fired
    w.f64(this.room.now()).u8(shots.length);
    for (const [e, pos, vel, dmg, firedAt] of shots) {
      w.u16(e.id).u8(TYPE_KEYS.indexOf(e.type)).u8(Math.min(255, at - firedAt))
        .pos(pos.x).pos(pos.y).pos(pos.z)
        .f32(vel.x).f32(vel.y).f32(vel.z).f32(dmg);
    }
    this.shots = [];
    this.room.send('sh', w.bytes());
  }

  /** Rounds the host fired: this page flies them too, and they may be for its player. */
  onShots(bytes) {
    const en = this.ctx.enemies;
    const rd = new Reader(bytes);
    try {
      const ago = clamp((this.room.now() - rd.f64()) / 1000, 0, 0.3);
      const n = rd.u8();
      for (let i = 0; i < n; i++) {
        const id = rd.u16(), type = TYPE_KEYS[rd.u8()], before = rd.u8() / 1000;
        const pos = new THREE.Vector3(rd.pos(), rd.pos(), rd.pos());
        const vel = new THREE.Vector3(rd.f32(), rd.f32(), rd.f32());
        const dmg = rd.f32();
        const t = TYPES[type];
        if (!t || en.bullets.length >= 200 || !Number.isFinite(vel.lengthSq()) || !Number.isFinite(dmg)) continue;
        const speed = vel.length() || 1;
        const falloff = t.attack.falloff || null;
        en.bullets.push({
          pos, vel, dmg: clamp(dmg, 0, 500),
          life: falloff ? (falloff[1] + 6) / speed : 3,
          from: en.byId(id) || null,
          returned: false,
          origin: falloff ? pos.clone().addScaledVector(vel, -0.5 / speed) : null,
          falloff,
          sticks: t.attack.sticks || 0,
          // it has been flying for this long already: the next step makes it up, hits included
          lag: ago + before,
        });
        const e = en.byId(id);
        if (e?.alive) {
          _d.copy(vel).normalize();
          this.ctx.effects.burst(e.eye.clone().addScaledVector(_d, 0.55), _d.clone(), t.attack.pellets || t.attack.fan ? 5 : 2, {
            speed: 3, size: 0.03, life: 0.1, ink: INK.ORANGE,
          });
          if (e.eye.distanceTo(this.ctx.camera.position) < 60) this.ctx.audio?.foeShot();
        }
      }
    } catch { /* a short batch: what was read of it stands */ }
  }

  // ---- blows that land on somebody else's player -------------------------------------

  strike(e, p, dmg, launch) {
    this.room?.send('hurt', {
      e: e.id, d: Math.round(dmg * 10) / 10, k: launch ? 'charge' : 'melee',
      l: launch ? launch.map((v) => Math.round(v * 100) / 100) : undefined,
    }, { to: p.remote });
  }

  /** On the page whose player it reached: the katana first, as it always is. */
  onHurt(data) {
    if (!data || typeof data !== 'object') return;
    const g = this.game;
    const p = this.ctx.player;
    const e = this.ctx.enemies.byId(num(data.e, -1));
    if (!p.alive || g.state === 'down' || !e) return;
    const verdict = this.ctx.onIncomingMelee?.(e);
    if (verdict) {
      this.room.send('guard', { e: e.id, v: verdict }, { to: 'host' });
      _d.copy(e.center).sub(p.center).setY(0);
      if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1);
      this.ctx.effects.burst(_v.copy(p.center).lerp(e.center, 0.45), _d.normalize(), verdict === 'parry' ? 12 : 6, {
        speed: 7, size: 0.035, life: 0.22, ink: INK.ORANGE, drag: 3, stretch: 0.18,
      });
      return;
    }
    p.damage(clamp(num(data.d), 0, 500));
    this.ctx.enemies.onPlayerHit?.(e);
    this.ctx.effects.hurt = 1;
    this.ctx.effects.kick(0.3);
    this.ctx.audio?.playerHurt();
    const l = data.l;
    if (Array.isArray(l) && l.length === 3 && l.every(Number.isFinite)) p.launch(clamp(l[0], -20, 20), clamp(l[1], -20, 20), clamp(l[2], -20, 20), 0.3);
  }

  /** The host: a guest's katana blocked or parried a blow; the figure is shoved off the blade. */
  onGuard(data, from) {
    const e = this.ctx.enemies.byId(num(data?.e, -1));
    const p = this.net.crew.proxyOf(from.id);
    if (!e || !e.alive || !p) return;
    _d.copy(e.center).sub(p.center).setY(0);
    if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1);
    e.body.vel.addScaledVector(_d.normalize(), data.v === 'parry' ? 9 : 5);
  }

  onStagger(data) {
    const e = this.ctx.enemies.byId(num(data?.e, -1));
    if (e) this.ctx.enemies.stagger(e, clamp(num(data.s), 0, 3));
  }

  // ---- a guest's blows on the host's figures -----------------------------------------------

  hit(e, amount, info) {
    if (!e.id || !Number.isFinite(amount)) return;
    this.hits.push([e.id, Math.round(amount * 10) / 10, info.crit ? 1 : 0, Math.max(0, SOURCES.indexOf(info.source || ''))]);
  }

  noise(pos, radius, kind) {
    if (kind === 'shot' && this.noiseT > 0) return;
    if (kind === 'shot') this.noiseT = NOISE_GAP;
    this.noises.push([Math.round(pos.x * 10) / 10, Math.round(pos.y * 10) / 10, Math.round(pos.z * 10) / 10, radius, kind === 'shot' ? 1 : 0]);
  }

  /** The host takes a guest's hits off its figures. A kill is that guest's. */
  onHits(data, from) {
    if (!data || typeof data !== 'object') return;
    const en = this.ctx.enemies;
    const proxy = this.net.crew.proxyOf(from.id);
    for (const h of Array.isArray(data.h) ? data.h.slice(0, 200) : []) {
      if (!Array.isArray(h)) continue;
      const e = en.byId(num(h[0], -1));
      const dmg = clamp(num(h[1]), 0, 1000);
      if (!e || !e.alive || !dmg) continue;
      _d.copy(e.center).sub(proxy ? proxy.eye : e.center);
      if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1);
      en.damage(e, dmg, {
        point: e.center.clone(), dir: _d.normalize().clone(), part: h[2] ? 'head' : 'torso', crit: h[2] === 1,
        source: SOURCES[h[3]] || undefined, by: from.id, quiet: true,
      });
    }
    for (const n of Array.isArray(data.n) ? data.n.slice(0, 20) : []) {
      if (!Array.isArray(n) || n.length !== 5 || !n.every(Number.isFinite)) continue;
      en.noise(new THREE.Vector3(n[0], n[1], n[2]), clamp(n[3], 0, 200), n[4] ? 'shot' : 'bang', proxy);
    }
  }

  /** A figure went down on the host: everybody is told, and whose it was. */
  downed(e, info) {
    if (!this.room) return;
    this.downs.push({ i: e.id, by: info.by || this.room.self.id, c: info.crit ? 1 : 0, s: info.source || '' });
  }

  onDown(d) {
    if (!d || typeof d !== 'object') return;
    const en = this.ctx.enemies;
    const e = en.byId(num(d.i, -1));
    if (!e || !e.alive) return;
    e.alive = false;
    e.downFor = 0;
    en.alive--;
    this.smooth.delete(e.id);
    const fx = this.ctx.effects;
    fx.burst(e.center.clone(), new THREE.Vector3(0, 1, 0), 16, {
      speed: 9, size: 0.07, life: 0.5, ink: INK.RED, gravity: 14, drag: 2.2, stretch: 0.22,
    });
    const mine = d.by === this.room.self.id;
    if (mine) {
      fx.stop(e.t.role?.boss ? 0.16 : 0.055, 0.1);
      this.ctx.audio?.kill();
      this.ctx.hud?.markHit('kill');
      if (en.mods.heal && this.ctx.player.alive) this.ctx.player.hp = Math.min(this.ctx.player.maxHp, this.ctx.player.hp + en.mods.heal);
    }
    en.onFoeDown?.(e, { crit: d.c === 1, source: typeof d.s === 'string' ? d.s : '', by: num(d.by) });
  }

  // ---- waves -------------------------------------------------------------------------

  /** The host's wave director started a wave, or saw one down. */
  wave(kind, n, extra = {}) {
    const info = { t: kind, n, ...extra };
    if (kind === 'start') this.waveInfo = info;
    this.room?.send('wv', info);
  }

  onWave(data) {
    if (!data || typeof data !== 'object') return;
    const n = Math.max(0, Math.floor(num(data.n)));
    const waves = this.game.waves;
    if (data.t === 'start') {
      this.waveInfo = {
        t: 'start', n, mi: Math.floor(num(data.mi, -1)), boss: !!data.boss,
        mods: data.mods && typeof data.mods === 'object' ? sanitizeMods(data.mods) : {},
      };
      Object.assign(this.ctx.enemies.mods, this.waveInfo.mods);
      waves.wave = n;
      waves.onWaveStart?.(n, typeof data.mod === 'string' ? data.mod.slice(0, 40) : '', !!data.boss, typeof data.intro === 'string' ? data.intro.slice(0, 120) : '');
    } else if (data.t === 'clear') {
      waves.onWaveClear?.(n);
    }
  }

  // ---- the paper planes ------------------------------------------------------------------

  drawPlanes() {
    for (const p of this.ctx.planes.list) {
      const at = this.planeSmooth.get(p.i);
      if (!at) continue;
      p.pos.set(at[0], at[1], at[2]);
      p.quat.set(at[3], at[4], at[5], at[6]).normalize();
    }
  }

  /** A guest shot a plane down: the host brings it down, if it is still up there. */
  askPlane(p) {
    this.room?.send('plane', { i: p.i }, { to: 'host' });
    // It is this player's: the points now, the plane when the host says so.
    this.game.planes.onDown?.(p);
  }

  onPlane(data, from) {
    const p = this.ctx.planes.list[num(data?.i, -1)];
    if (p && (p.mode === 'fly' || p.mode === 'enter')) this.ctx.planes.down(p, from.id);
  }

  // ---- what lies on the desk ---------------------------------------------------------

  /** The host's list changed: everybody gets the new one, a tenth of a second later at most. */
  pickupsChanged() {
    if (this.leading && this.room) this.pkDue = true;
  }

  offerPickups() {
    this.pkDue = true;
    this.pkT = 0;
  }

  sendPickups() {
    this.pkDue = false;
    this.pkT = 0.1;
    if (this.room.members.length < 2) return;
    const list = this.ctx.pickups.list.slice(0, PICKUP.max).map((q) => {
      if (!q.id) q.id = this.pickupIds = (this.pickupIds % 65535) + 1;
      return [q.id, q.item, Math.round(q.pos.x * 100) / 100, Math.round(q.pos.y * 100) / 100, Math.round(q.pos.z * 100) / 100,
        q.life === Infinity ? -1 : Math.round(q.life - q.age), Math.round(q.age * 10) / 10];
    });
    this.room.send('pk', list);
  }

  onPickups(list) {
    const pk = this.ctx.pickups;
    const before = new Map(pk.list.map((q) => [q.id, q]));
    const next = [];
    for (const row of list.slice(0, PICKUP.max)) {
      if (!Array.isArray(row) || row.length !== 7) continue;
      const [id, item, x, y, z, left, age] = row;
      if (!Number.isFinite(id) || (item !== 'bandage' && item !== 'stapler') || ![x, y, z, left, age].every(Number.isFinite)) continue;
      const known = before.get(id);
      if (known) { next.push(known); continue; }
      const under = pk.settle(new THREE.Vector3(x, y + 0.5, z));
      const pos = under ? under.pos : new THREE.Vector3(x, y, z);
      next.push({
        id, item, pos, age: Math.max(0, age), life: left < 0 ? Infinity : Math.max(0, age) + left,
        spot: null, mover: under?.mover || null, lpos: under?.lpos || null,
      });
    }
    pk.list.length = 0;
    pk.list.push(...next);
    pk.draw();
  }

  /** A guest walked over something: it asks, once a second at most for the same thing. */
  askTake(q) {
    const now = performance.now();
    if (!q.id || now - (this.taken.get(q.id) || 0) < 1000) return;
    this.taken.set(q.id, now);
    this.room?.send('take', { i: q.id }, { to: 'host' });
  }

  /** The host: the first to ask for something gets it, and it is gone for everybody. */
  onTake(data, from) {
    const pk = this.ctx.pickups;
    const i = pk.list.findIndex((q) => q.id === num(data?.i, -1));
    if (i < 0) return;
    const q = pk.list[i];
    const p = this.net.crew.proxyOf(from.id);
    // within reach of where that player is, give or take a second of running
    if (!p || p.body.pos.distanceTo(q.pos) > PICKUP.reach + 10) return;
    pk.list.splice(i, 1);
    if (q.spot) { q.spot.here = null; q.spot.takenT = 0; }
    this.room.send('give', { item: q.item }, { to: from.id });
    this.pickupsChanged();
  }

  // ---- for the tests -------------------------------------------------------------------

  list() {
    const en = this.ctx.enemies;
    return en.list.filter((e) => e.alive).map((e) => ({
      id: e.id, type: e.type, hp: Math.round(e.hp), pos: e.body.pos.toArray().map((v) => Math.round(v * 100) / 100),
      mind: e.mind, target: e.target?.remote ?? (e.target === this.ctx.player ? 'me' : null),
    }));
  }
}

function readReport(bytes) {
  const rd = new Reader(bytes);
  const seq = rd.u16();
  const at = rd.f64();
  const wave = rd.u16();
  const waveState = WAVE_STATES[rd.u8()] || 'idle';
  const timer = rd.f32();
  const boss = rd.u8() === 1;
  const queue = [];
  for (let i = rd.u8(); i > 0; i--) {
    const k = TYPE_KEYS[rd.u8()];
    if (k) queue.push(k);
  }
  const foes = [];
  for (let i = rd.u8(); i > 0; i--) {
    const f = {
      id: rd.u16(), type: TYPE_KEYS[rd.u8()],
      x: rd.pos(), y: rd.pos(), z: rd.pos(), yaw: rd.angle(),
      walk: rd.unit(), flags: rd.u8(), raise: rd.unit(), cut: rd.unit(),
      hp: rd.u16(), maxHp: rd.u16(), notice: rd.unit(), markT: rd.u8() / 100, hurt: rd.unit(), target: rd.u16(),
    };
    if (f.type && f.id) foes.push(f);
  }
  const planes = [];
  for (let i = rd.u8(); i > 0; i--) {
    planes.push({
      mode: PLANE_MODES[rd.u8()] || 'fly', carry: CARRY[rd.u8()] || 'bandage',
      x: rd.pos(), y: rd.pos(), z: rd.pos(), qx: rd.signed(), qy: rd.signed(), qz: rd.signed(), qw: rd.signed(),
    });
  }
  const toys = [];
  for (let i = rd.u8(); i > 0; i--) {
    const s = [];
    for (let j = rd.u8(); j > 0; j--) s.push(rd.f32());
    toys.push(s);
  }
  return { seq, at, wave, waveState, timer, boss, queue, foes, planes, toys };
}

// The toys, as numbers: the train's place on its track, the pendulum's and the cradle's angles
// and how fast they turn.
function toyState(part) {
  if ('dwell' in part) return [part.s, part.v, part.dwell, part.next];
  if (Array.isArray(part.phi)) return [...part.phi, ...part.w];
  if (Array.isArray(part.q)) return [...part.q, ...part.w];
  return [];
}

function setToyState(part, s, age, toys) {
  if (!s.every(Number.isFinite)) return;
  if ('dwell' in part) {
    if (s.length !== 4) return;
    // The train runs the same everywhere; only a page that has drifted is put right.
    const L = part.track.length;
    const ahead = s[2] > 0 ? s[0] : (s[0] + s[1] * age) % L;
    const off = Math.abs(((part.s - ahead + L * 1.5) % L) - L / 2);
    if (off < 1.5 && part.next === s[3]) return;
    part.s = ahead;
    part.v = s[1];
    part.dwell = Math.max(0, s[2] - age);
    part.next = Math.floor(s[3]) % part.stops.length;
    part.place();
    return;
  }
  const arrays = Array.isArray(part.phi) ? [part.phi, part.w] : Array.isArray(part.q) ? [part.q, part.w] : null;
  if (!arrays || s.length !== arrays[0].length * 2) return;
  const n = arrays[0].length;
  for (let i = 0; i < n; i++) { arrays[0][i] = s[i]; arrays[1][i] = s[n + i]; }
  // It went on swinging while the report was on its way.
  part.acc = 0;
  part.update(age, toys, []);
}

const MOD_KEYS = ['speed', 'damage', 'hp', 'count', 'crit', 'body', 'heal'];
function sanitizeMods(m) {
  const out = {};
  for (const k of MOD_KEYS) if (Number.isFinite(m[k])) out[k] = clamp(m[k], 0, 10);
  out.alwaysHunt = m.alwaysHunt === true;
  return out;
}
