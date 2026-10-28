import * as THREE from 'three';
import { Smooth } from '@p3p2/client/smooth';
import { buildFigure, pose } from '../entities/enemies/rig.js';
import { stanceOf } from '../entities/enemies/manager.js';
import { MOVE } from '../entities/player.js';
import { jetPuffs, JET } from '../entities/jetpack.js';
import { INK } from '../render/palette.js';
import { raycast } from '../core/physics.js';
import { ease } from '../core/spring.js';
import { Reader, Writer, ENDED, num } from './wire.js';

// The others on the desk: each player's own page says where its player is (presence), and
// every other page draws them from that, as a figure in blue or green ink. On the host the same
// reports make stand-ins the horde can hunt (`targets()`): a body, a centre, an eye.
//
// What a page says about its own player, twenty times a second at most:
//
//   p   where its feet are: [x, y, z]       y   which way it faces     pt  how far up it looks
//   v   how fast it moves                  st  its stance, as the horde hears it
//   a   1 alive, 0 down                    r   the run it is in, or 0
//   k   kills this run                     c   1 crouched
//   j   1 while its jetpack burns          w   the weapon in its hands: rifle, shotgun, sniper,
//   g   1 while its katana's guard is up       katana or stapler
//
// And what its player's weapons do, for the others to see (`pf`, bytes, droppable, twenty
// batches a second at most). It is for show: it hurts nobody, as a guest's hits on the figures
// still go to the host as `hit` (net/horde.js). A batch is a count, then that many of:
//
//   a shot     which gun (FIRED), how many pellets, and for each where it ended and on what
//              (ENDED: the air, the desk, a figure, a plane)
//   a slash    the katana
//   a throw    a grenade: where from, and how fast
//
// The other pages draw it on the figure, as late as they draw the figure itself: the tracer
// leaves the gun as it is drawn, and the desk is marked where the round hit.
//
// What comes in is somebody else's data: a report that is not the numbers it should be is
// ignored.

export const STANCES = ['still', 'walk', 'sprint', 'crouch', 'crouchWalk'];
const SPRINT = STANCES.indexOf('sprint');
const FRIEND_INKS = [INK.BLUE, INK.GREEN];
/** Each weapon a player can hold: a friend's figure holds the same model of it (rig.js). */
export const HELD = ['rifle', 'shotgun', 'sniper', 'katana', 'stapler'];
// The horde's figures all wear a hat: a friend wears none, so the two differ by shape as well as by ink.
export const FRIEND = {
  look: { hat: 'none', props: HELD },
  frame: { scale: 1, girth: 1, headSize: 1, limbThickness: 0.035 },
};
/** What a batch of `pf` names: a shot from each gun, then a slash and a throw. */
const FIRED = ['rifle', 'shotgun', 'sniper', 'stapler'];
const SLASH = FIRED.length, THROW = FIRED.length + 1;
/** How often `pf` goes, seconds: as often as a guest's hits go to the host. */
const PF_SECONDS = 0.05;
/** The most in one batch, and waiting to be drawn for one friend: a rifle is ten a second. */
const PF_MOST = 32;
/** A friend's shot is drawn this long after it comes, ms: Smooth's own delay, so the gun fires as it is drawn. */
const PLAYBACK_MS = 120;
/**
 * A guard is said to be up for at least this long, ms. Presence goes twenty times a second at
 * most and says only where things ended up, so a parry, a tap of aim, could be up and down again
 * between two reports and never be seen.
 */
const GUARD_SHOWN_MS = 300;
/** How fast a friend's guard comes up and goes down: as fast as your own (Katana.guardMix). */
const GUARD_EASE = 14;
/** A friend's shots are heard to this far, metres, quieter on the way: as the host's figures' are. */
const HEARD = 60;
/**
 * A friend's steps are heard to `steps` metres and their jet's hiss to `jet`, quieter on the way,
 * from the nearest `stepping` and `hissing` of them only: five friends flying at once would be
 * sixty voices a second on a phone. A step is taken over `fast` m/s, as your own are (Player).
 */
const HEARD_MOVING = { steps: 20, jet: 40, stepping: 3, hissing: 2, fast: 1.5 };
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const _v = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _end = new THREE.Vector3();
const _d = new THREE.Vector3();
const _o = new THREE.Vector3();

export class Crew {
  /**
   * @param {object} ctx the game's context: scene, camera, player
   * @param {HTMLElement} hud where the name tags go
   * @param {any} game the Game (game.js): its weapons, and the grenades a friend throws
   */
  constructor(ctx, hud, game) {
    this.ctx = ctx;
    this.game = game;
    this.room = null;
    /** member id -> { member, figure, tag, proxy, said } */
    this.mates = new Map();
    // No coasting. A page says nothing more once its player stands still, so the last report is
    // where they stopped; carried on past it, a figure that has just landed went on falling, up to
    // eight metres through the floor for a second.
    this.smooth = new Smooth({ angles: [3], jump: 6, coast: 0 });
    this.tags = document.createElement('div');
    this.tags.className = 'ir-tags';
    hud.appendChild(this.tags);
    this._said = {};
    this._guardAt = -Infinity;
    this._offs = [];
    this._order = [];
    // what this page's player did since the last batch went
    this.out = new Writer(512).u8(0);
    this.outN = 0;
    this.outT = 0;
    this.pellets = 0;
    this._kit = null;
    /** For the tests: what this page has drawn of the others' weapons. */
    this.drawn = { shots: 0, tracers: 0, marks: 0, splashes: 0, slashes: 0, throws: 0 };
  }

  start(room) {
    this.stop();
    this.room = room;
    const r = room;
    this._offs.push(
      r.presence.on((member, value, at) => this.heard(member, value, at)),
      r.on('member-leave', (member) => this.forget(member.id)),
      r.on('pf', (data, from) => { if (from && from !== r.self && data instanceof Uint8Array) this.heardFire(from, data); }),
    );
    for (const m of r.members) if (m !== r.self) this.heard(m, r.presence.get(m));
  }

  stop() {
    for (const off of this._offs) off();
    this._offs = [];
    for (const id of [...this.mates.keys()]) this.forget(id);
    this.out.at = 0;
    this.out.u8(0);
    this.outN = 0;
    this.game.grenades.shown.length = 0;
    this.room = null;
  }

  /**
   * This page's player, as the others are to see it. Every frame; the library sends what changed.
   * `guard`: the katana's guard is up.
   */
  say(player, runId, kills, held, guard) {
    const r = this.room;
    if (!r) return;
    const b = player.body;
    const s = this._said;
    s.p = [r2(b.pos.x), r2(b.pos.y), r2(b.pos.z)];
    s.y = r3(player.yaw);
    s.pt = r2(player.pitch);
    s.v = Math.round(player.speed * 10) / 10;
    s.st = STANCES.indexOf(stanceOf(player));
    s.a = player.alive && runId ? 1 : 0;
    s.r = runId || 0;
    s.k = kills;
    s.c = player.crouching ? 1 : 0;
    s.j = player.jet.burning ? 1 : 0;
    s.w = held;
    const now = performance.now();
    if (guard) this._guardAt = now;
    s.g = now - this._guardAt < GUARD_SHOWN_MS ? 1 : 0;
    r.presence.set(s);
  }

  // ---- what this page's player's weapons do (`ctx.tell`, set by net/room.js in a room) --------

  /** A shot from `key`'s gun of `n` pellets, each told after it by pellet(). */
  shot(key, n) {
    const i = FIRED.indexOf(key);
    this.pellets = i >= 0 && this.outN < PF_MOST ? n : 0;
    if (!this.pellets) return;
    this.out.u8(i).u8(n);
    this.outN++;
  }

  /** Where one pellet ended, and on what (ENDED). */
  pellet(end, ended) {
    if (this.pellets <= 0) return;
    this.pellets--;
    this.out.pos(end.x).pos(end.y).pos(end.z).u8(ended);
  }

  /** A slash of the katana. */
  swing() {
    if (this.outN >= PF_MOST) return;
    this.out.u8(SLASH);
    this.outN++;
  }

  /** A grenade, thrown from `pos` at `vel`. */
  threw(pos, vel) {
    if (this.outN >= PF_MOST) return;
    this.out.u8(THROW).pos(pos.x).pos(pos.y).pos(pos.z).pos(vel.x).pos(vel.y).pos(vel.z);
    this.outN++;
  }

  /** Every frame: what was done since the last batch, to everybody. */
  flush(dt) {
    this.outT -= dt;
    if (!this.outN || this.outT > 0 || !this.room) return;
    this.out.dv.setUint8(0, this.outN);
    this.room.send('pf', this.out.bytes().slice(), { volatile: true });
    this.out.at = 0;
    this.out.u8(0);
    this.outN = 0;
    this.outT = PF_SECONDS;
  }

  /** A friend's batch: read whole, or not at all, and drawn a moment later (draw). */
  heardFire(from, bytes) {
    const mate = this.mates.get(from.id);
    if (!mate) return;
    const at = performance.now() + PLAYBACK_MS;
    const got = [];
    try {
      const rd = new Reader(bytes);
      const n = rd.u8();
      for (let i = 0; i < n; i++) {
        const what = rd.u8();
        if (what < FIRED.length) {
          const ends = [];
          for (let k = rd.u8(); k > 0; k--) ends.push([rd.pos(), rd.pos(), rd.pos(), rd.u8()]);
          got.push({ at, key: FIRED[what], ends });
        } else if (what === SLASH) {
          got.push({ at, slash: true });
        } else if (what === THROW) {
          const pos = new THREE.Vector3(rd.pos(), rd.pos(), rd.pos());
          got.push({ at, pos, vel: new THREE.Vector3(rd.pos(), rd.pos(), rd.pos()) });
        } else {
          return;
        }
      }
    } catch {
      return;
    }
    for (const ev of got) if (mate.fire.length < PF_MOST) mate.fire.push(ev);
  }

  /** `at`: when the server got it, so that a mate is drawn where they were then, not when the batch came. */
  heard(member, value, at) {
    if (!value || typeof value !== 'object') return this.forget(member.id);
    const p = value.p;
    if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) return;
    let mate = this.mates.get(member.id);
    if (!mate) {
      mate = this.mate(member);
      this.mates.set(member.id, mate);
    }
    mate.said = value;
    this.smooth.set(member.id, [p[0], p[1], p[2], num(value.y)], at);
    const x = mate.proxy;
    x.body.pos.set(p[0], p[1], p[2]);
    x.center.set(p[0], p[1] + MOVE.bodyHeight * 0.55, p[2]);
    x.eye.set(p[0], p[1] + MOVE.bodyHeight * 0.9, p[2]);
    x.speed = num(value.v);
    x.stance = STANCES[value.st] || 'still';
    x.crouching = value.c === 1;
    x.alive = value.a === 1;
    x.run = num(value.r);
    x.kills = num(value.k);
  }

  mate(member) {
    // The same player gets the same ink on every page: from their player id, not the order of joining.
    let h = 0;
    for (const ch of member.pid) h = (h * 31 + ch.charCodeAt(0)) | 0;
    const fig = buildFigure(FRIEND, FRIEND_INKS[Math.abs(h) % FRIEND_INKS.length]);
    fig.root.visible = false;
    this.ctx.scene.add(fig.root);
    const tag = document.createElement('div');
    tag.className = 'ir-tag';
    tag.textContent = member.name;
    this.tags.appendChild(tag);
    const proxy = {
      remote: member.id, member,
      body: { pos: new THREE.Vector3(), vel: new THREE.Vector3(), onGround: true, height: MOVE.bodyHeight },
      center: new THREE.Vector3(), eye: new THREE.Vector3(),
      speed: 0, stance: 'still', crouching: false, sliding: false,
      alive: false, run: 0, kills: 0,
    };
    // `pack`: where their jetpack is, for its puffs, and how fast it goes
    const pack = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), puff: 0, seen: false };
    // `fire`: their shots, slashes and throws, waiting to be drawn; `slashT`: a slash under way;
    // `guard`: how far their katana's guard is up, 0-1
    // `dist`, `rank`: how far, and how near among the others, for what of theirs is heard
    return {
      member, fig, tag, proxy, said: null, phase: Math.random() * 10, downFor: 0, pack, held: null, fire: [], slashT: 0,
      guard: 0, stride: 0, hiss: 0, dist: Infinity, rank: 0,
    };
  }

  forget(id) {
    const mate = this.mates.get(id);
    if (!mate) return;
    this.ctx.scene.remove(mate.fig.root);
    mate.tag.remove();
    this.smooth.delete(id);
    this.mates.delete(id);
  }

  /**
   * Who the horde can go for, besides this page's own player: in the run, standing, and here.
   * A page in the background is frozen and cannot dodge or be hurt; one whose connection is
   * down cannot be told it was hit.
   */
  targets(runId, out = []) {
    for (const { proxy, member } of this.mates.values()) {
      if (proxy.alive && proxy.run === runId && member.state === 'here') out.push(proxy);
    }
    return out;
  }

  /** The stand-in for a member, on the host. */
  proxyOf(memberId) {
    return this.mates.get(memberId)?.proxy || null;
  }

  /** Everybody else whose page says it is in this run: alive or down, here or not. */
  inRun(runId) {
    const out = [];
    for (const { proxy } of this.mates.values()) if (proxy.run === runId) out.push(proxy);
    return out;
  }

  /** Every frame: the others where they were a moment ago, moving as they said. */
  draw(dt) {
    const cam = this.ctx.camera;
    const now = performance.now();
    this.game.grenades.tickShown(dt);
    for (const [id, mate] of this.mates) {
      const at = this.smooth.get(id);
      const fig = mate.fig;
      const said = mate.said;
      const shown = !!at && !!said && said.r > 0;
      fig.root.visible = shown;
      if (!shown) {
        mate.tag.style.display = 'none';
        mate.fire.length = 0;
        mate.slashT = 0;
        mate.guard = 0;
        mate.dist = Infinity;
        continue;
      }
      fig.root.position.set(at[0], at[1], at[2]);
      fig.root.rotation.y = at[3];
      const alive = said.a === 1;
      // their jetpack: the same puffs as your own, and its hiss if they are among the nearest
      const pack = mate.pack;
      if (dt > 0 && pack.seen) pack.vel.set(at[0], at[1], at[2]).sub(pack.pos).multiplyScalar(1 / dt);
      pack.pos.set(at[0], at[1], at[2]);
      pack.seen = true;
      mate.dist = fig.root.position.distanceTo(cam.position);
      const burning = alive && said.j === 1;
      if (burning) pack.puff = jetPuffs(this.ctx.effects, pack, at[3], dt, pack.puff);
      mate.hiss -= dt;
      if (burning && mate.hiss <= 0) {
        mate.hiss = JET.hissEvery;
        if (mate.rank < HEARD_MOVING.hissing) this.ctx.audio?.jet(1 - mate.dist / HEARD_MOVING.jet);
      }
      mate.downFor = alive ? 0 : mate.downFor + dt;
      const speed = num(said.v);
      const walk = Math.min(1, speed / MOVE.walkSpeed);
      mate.phase += dt * (0.4 + walk);
      // Their steps, each time the drawn legs cross (pose swings them on the same phase), while
      // they are on the ground: not burning, and not rising or falling faster than a stride.
      const stride = Math.floor((mate.phase * 9) / Math.PI);
      if (stride !== mate.stride) {
        mate.stride = stride;
        if (alive && !burning && speed > HEARD_MOVING.fast && Math.abs(pack.vel.y) < 1.5 && mate.rank < HEARD_MOVING.stepping) {
          this.ctx.audio?.step(speed, 1 - mate.dist / HEARD_MOVING.steps);
        }
      }
      // the weapon in their hands, and only that one
      const held = HELD.includes(said.w) ? said.w : 'rifle';
      if (mate.held !== held) {
        mate.held = held;
        for (const kind in fig.props) fig.props[kind].visible = kind === held;
      }
      // A gun is up and aimed where they look, unless they sprint. The katana moves as it does in
      // your own hands (weapons/models.js KATANA_MOVES): held low on the right, slashed from over
      // the right shoulder down to the left hip, and raised level across the body for the guard.
      // Crouched, they are lower and bent forward at the hips.
      const crouched = alive && said.c === 1;
      const slash = this.kit().slash;
      const blade = alive && held === 'katana';
      mate.slashT = Math.max(0, mate.slashT - dt);
      mate.guard = ease(mate.guard, blade && said.g === 1 ? 1 : 0, GUARD_EASE, dt);
      pose(fig.J, {
        t: mate.phase, walk, lean: walk * 0.25 + (crouched ? 0.7 : 0), hurt: 0,
        aim: alive && !blade && said.st !== SPRINT,
        pitch: Math.max(-1.2, Math.min(1.2, num(said.pt))),
        blade: blade ? { slash: mate.slashT > 0 ? 1 - mate.slashT / slash : -1, guard: mate.guard } : null,
        flying: alive && said.j === 1,
        dead: !alive, downFor: mate.downFor,
      });
      if (crouched) fig.J.pivot.position.y = -0.42;
      if (mate.fire.length && mate.fire[0].at <= now) this.play(mate, now);
      // the name, over the head, where the camera sees it
      _v.set(at[0], at[1] + 1.95, at[2]).project(cam);
      const front = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      mate.tag.style.display = front ? '' : 'none';
      if (front) {
        mate.tag.style.transform = `translate(${((_v.x + 1) / 2) * innerWidth}px, ${((1 - _v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
        mate.tag.classList.toggle('ir-tag-down', !alive);
      }
    }
    // nearest first, for which of them are heard next frame
    const order = this._order;
    order.length = 0;
    for (const mate of this.mates.values()) order.push(mate);
    order.sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < order.length; i++) order[i].rank = i;
  }

  /** What a friend's weapons did, now that the figure is drawn doing it. */
  play(mate, now) {
    const fx = this.ctx.effects;
    const kit = this.kit();
    const grip = mate.fig.J.grip;
    const near = Math.max(0, 1 - mate.fig.root.position.distanceTo(this.ctx.camera.position) / HEARD);
    mate.fig.root.updateMatrixWorld(true);
    while (mate.fire.length && mate.fire[0].at <= now) {
      const ev = mate.fire.shift();
      if (ev.slash) {
        mate.slashT = kit.slash;
        this.ctx.audio?.swing(near);
        this.drawn.slashes++;
        continue;
      }
      if (ev.vel) {
        this.game.grenades.show(ev.pos, ev.vel);
        this.drawn.throws++;
        continue;
      }
      // A shot: out of the gun as it is drawn, to where each round ended on their page.
      _muzzle.copy(mate.fig.props[ev.key].userData.muzzle).applyMatrix4(grip.matrixWorld);
      _d.set(0, 0, -1).transformDirection(grip.matrixWorld);
      fx.burst(_muzzle, _d, ev.ends.length > 1 ? 5 : 2, { speed: 3, size: 0.03, life: 0.1, ink: INK.ORANGE });
      for (const [x, y, z, ended] of ev.ends) {
        _end.set(x, y, z);
        fx.tracer(_muzzle, _end, { width: kit.widths[ev.key] || 0.02, ink: INK.ORANGE });
        this.drawn.tracers++;
        _d.copy(_end).sub(_muzzle).normalize();
        if (ended === ENDED.desk) {
          // The blot goes on the surface as this page has it, and rides the toy it is on: a
          // short ray of this page's own across the place it ended finds both.
          _o.copy(_end).addScaledVector(_d, -0.3);
          const hit = raycast(this.ctx.level, _o, _d, 0.6);
          if (hit) {
            fx.impact(hit.point, hit.normal, INK.PEN, hit.box.mover);
            this.drawn.marks++;
          }
        } else if (ended === ENDED.figure && !this.room?.isHost) {
          // the host drew this already, as it took the health off (EnemyManager.damage)
          fx.hit(_end, _d, false);
          this.drawn.splashes++;
        }
      }
      this.ctx.audio?.shot(ev.key, near);
      this.drawn.shots++;
    }
  }

  /** The widths of the guns' tracers, and how long a slash takes, from this page's own weapons. */
  kit() {
    if (this._kit) return this._kit;
    const widths = {};
    for (const w of this.game.weapons) if (w.stats) widths[w.key] = w.stats.cosmetics.tracerWidth;
    return (this._kit = { widths, slash: this.game.weapons.find((w) => w.key === 'katana').swingTime });
  }

  /** For the tests and the death screen: who is here, and how they are doing. */
  list() {
    return [...this.mates.values()].map(({ member, proxy, fig }) => ({
      id: member.id, name: member.name, state: member.state, alive: proxy.alive, run: proxy.run, kills: proxy.kills,
      pos: proxy.body.pos.toArray().map(r2), drawn: fig.root.visible ? fig.root.position.toArray().map(r2) : null,
    }));
  }
}
