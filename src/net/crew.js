import * as THREE from 'three';
import { Smooth } from '@p3p2/client/smooth';
import { buildFigure, pose } from '../entities/enemies/rig.js';
import { stanceOf } from '../entities/enemies/manager.js';
import { MOVE } from '../entities/player.js';
import { jetPuffs } from '../entities/jetpack.js';
import { INK } from '../render/palette.js';
import { num } from './wire.js';

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
//   j   1 while its jetpack burns
//
// What comes in is somebody else's data: a report that is not the numbers it should be is
// ignored.

export const STANCES = ['still', 'walk', 'sprint', 'crouch', 'crouchWalk'];
const FRIEND_INKS = [INK.BLUE, INK.GREEN];
// The horde's figures all wear a hat: a friend wears none, so the two differ by shape as well as by ink.
const FRIEND = {
  look: { hat: 'none', prop: 'rifle' },
  frame: { scale: 1, girth: 1, headSize: 1, limbThickness: 0.035 },
};
const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const _v = new THREE.Vector3();

export class Crew {
  /**
   * @param {object} ctx the game's context: scene, camera, player
   * @param {HTMLElement} hud where the name tags go
   */
  constructor(ctx, hud) {
    this.ctx = ctx;
    this.room = null;
    /** member id -> { member, figure, tag, proxy, said } */
    this.mates = new Map();
    this.smooth = new Smooth({ angles: [3], jump: 6 });
    this.tags = document.createElement('div');
    this.tags.className = 'ir-tags';
    hud.appendChild(this.tags);
    this._said = {};
    this._offs = [];
  }

  start(room) {
    this.stop();
    this.room = room;
    const r = room;
    this._offs.push(
      r.presence.on((member, value, at) => this.heard(member, value, at)),
      r.on('member-leave', (member) => this.forget(member.id)),
    );
    for (const m of r.members) if (m !== r.self) this.heard(m, r.presence.get(m));
  }

  stop() {
    for (const off of this._offs) off();
    this._offs = [];
    for (const id of [...this.mates.keys()]) this.forget(id);
    this.room = null;
  }

  /** This page's player, as the others are to see it. Every frame; the library sends what changed. */
  say(player, runId, kills) {
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
    r.presence.set(s);
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
    return { member, fig, tag, proxy, said: null, phase: Math.random() * 10, downFor: 0, pack };
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
    for (const [id, mate] of this.mates) {
      const at = this.smooth.get(id);
      const fig = mate.fig;
      const said = mate.said;
      const shown = !!at && !!said && said.r > 0;
      fig.root.visible = shown;
      if (!shown) { mate.tag.style.display = 'none'; continue; }
      fig.root.position.set(at[0], at[1], at[2]);
      fig.root.rotation.y = at[3];
      const alive = said.a === 1;
      // their jetpack: the same puffs as your own, and no hiss, as with their other sounds
      const pack = mate.pack;
      if (dt > 0 && pack.seen) pack.vel.set(at[0], at[1], at[2]).sub(pack.pos).multiplyScalar(1 / dt);
      pack.pos.set(at[0], at[1], at[2]);
      pack.seen = true;
      if (alive && said.j === 1) pack.puff = jetPuffs(this.ctx.effects, pack, at[3], dt, pack.puff);
      mate.downFor = alive ? 0 : mate.downFor + dt;
      const walk = Math.min(1, num(said.v) / MOVE.walkSpeed);
      mate.phase += dt * (0.4 + walk);
      pose(fig.J, {
        t: mate.phase, walk, aim: alive && walk < 0.6, lean: walk * 0.25, hurt: 0,
        dead: !alive, downFor: mate.downFor,
      });
      // crouched: lower, and bent at the hips
      if (alive && said.c === 1) { fig.J.pivot.position.y = -0.42; fig.J.chest.rotation.x += 0.35; }
      // the name, over the head, where the camera sees it
      _v.set(at[0], at[1] + 1.95, at[2]).project(cam);
      const front = _v.z < 1 && Math.abs(_v.x) < 1.1 && Math.abs(_v.y) < 1.1;
      mate.tag.style.display = front ? '' : 'none';
      if (front) {
        mate.tag.style.transform = `translate(${((_v.x + 1) / 2) * innerWidth}px, ${((1 - _v.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
        mate.tag.classList.toggle('ir-tag-down', !alive);
      }
    }
  }

  /** For the tests and the death screen: who is here, and how they are doing. */
  list() {
    return [...this.mates.values()].map(({ member, proxy, fig }) => ({
      id: member.id, name: member.name, state: member.state, alive: proxy.alive, run: proxy.run, kills: proxy.kills,
      pos: proxy.body.pos.toArray().map(r2), drawn: fig.root.visible ? fig.root.position.toArray().map(r2) : null,
    }));
  }
}
