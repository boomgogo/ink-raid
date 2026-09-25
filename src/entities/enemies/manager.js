import * as THREE from 'three';
import { buildFigure, pose } from './rig.js';
import { TYPES } from './types.js';
import { newBody, stepBody, raycast, rayCapsule, raySphere, onLadder, ladderLocal, GRAVITY } from '../../core/physics.js';
import { LADDER, MOVE } from '../player.js';
import { Marks } from './marks.js';
import { INK, LOOK } from '../../render/palette.js';
import { surface } from '../../render/surface.js';
import { clamp, ease } from '../../core/spring.js';
import { difficulty } from '../../core/difficulty.js';
import { IMPULSE } from '../../world/toys.js';

// Enemies: spawning, AI, damage, and their bullets.
//
// The AI is a small state machine per enemy, not a behaviour tree — with a
// handful of types and one target there is nothing a tree would buy. What matters much more
// than the AI is the READ: an enemy telegraphs before it does anything, so
// getting hit is always something you could have seen coming. Every attack has a
// wind-up, and every wind-up is visible in the pose.

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _to = new THREE.Vector3();
const _hit = new THREE.Vector3();
const _lad = { u: 0, v: 0, h: 0 };
const _cand = [];

// Ladders. Without these a ladder top is somewhere nothing can follow you: no
// enemy has a way up but the one you took. This is a heuristic, not
// navigation — the nearest ladder whose foot is close and whose top is up
// where you are — but it is the one place on the map they would be stuck.
const CLIMB = {
  above: 3,           // you are at least this far above it
  near: 12,           // and a ladder's foot is at most this far from it
  speed: 0.8,         // of the player's climbing speed
  over: 4,            // m/s on to the top
};

const MAX_BULLETS = 200;

// Melee: how much faster a blade closes from `lunge` out, how long the swing
// down takes to draw, and how far past `range` a strike still lands once it
// has wound up (you were in range when it started).
const LUNGE = 1.35;
const CUT = 0.16;
const REACH = 0.35;
// How hard a walking enemy turns its velocity toward the one it wants, m/s².
const STEER = 40;
// Wedged against a wall this long, it steps sideways (and a little back) for `for`.
// And blind, it goes hard round cover for `flank` after last touching a wall.
export const UNSTICK = { after: 0.35, for: 0.6, back: 0.35, flank: 1.5 };
// Highlighted: after a highlighter last had you in sight, how long every enemy
// on the desk goes on knowing where you are.
export const HIGHLIGHT = { hold: 3 };

// Awareness: what an enemy that is not hunting you notices, and what it does
// about it. Distances are MEDIUM's; `difficulty.sight` scales them.
export const AWARE = {
  cone: Math.cos((55 * Math.PI) / 180),   // a 110 degree view cone
  // how far it sees you, in its view cone with a clear line, by what you are doing
  sight: { sprint: 50, walk: 38, still: 38, crouchWalk: 12, crouch: 7 },
  // and hears you, from any side
  hear: { sprint: 14, walk: 6, still: 0, crouchWalk: 2, crouch: 0 },
  sniperSight: 90,         // a sniper on a nest, scanning
  sniperCrouched: 25,      // ...and you, crouched and still
  noticeNear: 0.25,        // seconds to notice you at point blank...
  noticeFar: 1.2,          // ...and at the edge of its range
  mark: 1,                 // the `!` is up this long
  alert: 15,               // noticing you tells anything this close
  lose: 4,                 // hunting, this long without sight of you: go and look
  searchFor: 6,            // looking round where it lost you
  homeFor: 20,             // then roaming within homeR of there
  homeR: 15,
  searchSpeed: 0.8,        // of its speed
  roamSpeed: 0.55,
  roamMin: 12, roamMax: 25,
  stuck: 0.8,              // held against a wall this long: pick somewhere else
  idleChance: 0.3,
  idle: [1, 3],
  drift: 45,               // no contact for this long: roaming leans toward your last noise
  pips: 25,                // ...and with two or fewer left, this long: the HUD points at them
};

/** What the player is doing, as far as being noticed goes. */
export function stanceOf(p) {
  const moving = p.speed > 1.2 || !p.body.onGround;
  if (p.crouching) return moving ? 'crouchWalk' : 'crouch';
  if (p.sliding || p.speed > MOVE.walkSpeed + 0.8) return 'sprint';
  return moving ? 'walk' : 'still';
}

// How much wider than the ink the hit volumes are is `difficulty.aimMargin`:
// 1.06 on MEDIUM. It used to be 1.15, and it was doing double duty: covering aim
// slop AND papering over hitboxes that were in the wrong place. With them
// anchored to the drawing it only has to do the first, and a smaller number
// keeps the red burst on the figure. EASY widens it on purpose.

export class Enemies {
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.alive = 0;
    this.frame = 0;             // stamps the per-frame hit-volume cache
    this.mods = { speed: 1, damage: 1, hp: 1, count: 1, crit: 1, body: 1, heal: 0 };
    this.onFoeDown = null;
    this.onPlayerHit = null;
    this.stance = 'still';
    this.contactT = 0;          // since anything hunting last saw you
    this.noiseAt = new THREE.Vector3();
    this.hunters = 0;           // alive and hunting you, for the HUD's eye
    this.highlightT = 0;        // a highlighter has you: see highlight()
    this.pips = [];             // the last few, once they have gone unfound a while
    // the `?` and `!` over their heads; needs a camera to face
    this.marks = ctx.camera ? new Marks(ctx) : null;

    // enemy bullets: instanced, visible, and slow enough to dodge
    const g = new THREE.BoxGeometry(0.09, 0.09, 0.5);
    this.bulletMesh = new THREE.InstancedMesh(g, surface({ ink: INK.RED, look: LOOK.SOLID }), MAX_BULLETS);
    this.bulletMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bulletMesh.frustumCulled = false;
    this.bulletMesh.count = 0;
    ctx.scene.add(this.bulletMesh);
    this.bullets = [];
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  clear() {
    for (const e of this.list) this.ctx.scene.remove(e.fig.root);
    this.list.length = 0;
    this.bullets.length = 0;
    this.alive = 0;
    this.contactT = 0;
    this.hunters = 0;
    this.highlightT = 0;
    this.pips.length = 0;
    this.marks?.update(this.list);
  }

  /**
   * @param {object} [o]  `mind`: 'roam' (the default: it does not know where
   *   you are) or 'hunt' (it does, and it is coming)
   */
  spawn(typeKey, at, o = {}) {
    const t = TYPES[typeKey];
    if (!t) return null;
    const fig = buildFigure(t, t.ink ?? INK.RED);
    this.ctx.scene.add(fig.root);

    const e = {
      type: typeKey, t, fig,
      body: newBody(at, 0.34 * (t.frame.scale || 1), 1.7 * (t.frame.scale || 1), 0.6),
      hp: t.reward.hp * this.mods.hp * difficulty.enemyHpMul,
      maxHp: t.reward.hp * this.mods.hp * difficulty.enemyHpMul,
      alive: true,
      downFor: 0,
      state: 'hunt',
      stateT: 0,
      cool: rand(t.attack.cooldown || [1, 2]),
      volleyLeft: 0,
      volleyGap: 0,
      yaw: 0,
      walk: 0,
      phase: Math.random() * 10,
      hurt: 0,
      center: new THREE.Vector3(),
      eye: new THREE.Vector3(),
      hitPts: [],               // fig.hit endpoints in world space, a pair each
      hitFrame: -1,
      flank: Math.random() < 0.5 ? -1 : 1,   // which way it goes round cover
      blindT: 0,
      wedgedFor: 0,                // pressed to a wall, going nowhere
      wallAgo: 9,               // since it last touched one
      sideT: 0,                 // stepping off it
      spotT: 0,                 // a highlighter, holding you in sight
      chargeState: null,        // a charger: null | 'wind' | 'run'
      chargeT: 0,
      chargeDir: new THREE.Vector3(),
      chargeHit: false,
      fanFlip: false,           // a fan of staples, shifted half a gap every other volley
      windT: 0,                 // a melee strike on its way: the blade is up
      cutT: 0,                  // and coming down
      aimClock: 0,                  // how long a gun has held its aim on you (see `tell`)
      staggerT: 0,              // a parried strike: no moving, no attacking
      ladder: null,             // climbing this
      endClock: 0,                 // getting off the top of one
      mind: 'roam',             // roam | hunt | search; see perceive()
      mindT: 0,
      notice: 0,                // 0-1: how close it is to having noticed you
      markT: 0,                 // the `!` over its head
      blindFor: 0,                 // hunting, and no sight of you for this long
      lastKnown: at.clone(),
      roamTo: null,
      home: null,               // searching: roam near here
      homeT: 0,
      lookT: 0,                 // stood looking about
      wallT: 0,                 // held against a wall
      lookYaw: Math.random() * Math.PI * 2,
    };
    // a sniper on a nest looks out over the desk, not at the wall behind it
    if (t.role?.stationary) e.lookYaw = Math.atan2(at.x, at.z);
    e.yaw = e.lookYaw;
    this.list.push(e);
    this.alive++;
    if (o.mind === 'hunt' || this.alwaysHunts(e)) this.hunt(e, false);
    e.markT = 0;
    return e;
  }

  // --- queries used by the weapons -----------------------------------------

  /**
   * Nearest enemy hit by a ray, with the body part.
   *
   * Two passes. The first is one sphere round the whole figure; the second is
   * the ten individual parts, and only figures that survived the first have
   * their parts brought up to date with the pose they are drawn in. A shotgun
   * fires ten of these per trigger pull and nearly all of them meet nobody.
   */
  raycast(origin, dir, maxDist) {
    let best = null;
    const margin = difficulty.aimMargin;
    for (const e of this.list) {
      if (!e.alive) continue;
      const bd = e.fig.bound;
      _v.copy(e.body.pos);
      _v.y += bd.y;
      // The bound holds every part at its drawn radius. No part is wider than
      // the bound, so a margin of m pushes no surface further out than bd.r × m.
      const bt = raySphere(origin, dir, _v, bd.r * margin);
      if (bt === null || bt > maxDist) continue;

      this.posedHits(e);
      const parts = e.fig.hit;
      for (let i = 0; i < parts.length; i++) {
        const r = parts[i].r * margin;
        const t = parts[i].len
          ? rayCapsule(origin, dir, e.hitPts[i * 2], e.hitPts[i * 2 + 1], r)
          : raySphere(origin, dir, e.hitPts[i * 2], r);
        if (t === null || t > maxDist) continue;
        if (!best || t < best.dist) {
          best = {
            enemy: e, part: parts[i].part, dist: t,
            point: origin.clone().addScaledVector(dir, t),
          };
        }
      }
    }
    return best;
  }

  /**
   * Move an enemy's hit volumes onto the pose it is currently DRAWN in.
   *
   * Each one lands in hitPts as a pair: a sphere's two ends coincide, a
   * capsule's run down its joint's own -y. Once per frame per enemy, and only
   * for one the broad phase kept — the extra updateMatrixWorld duplicates work
   * the renderer does later in the frame, which is why it is not simply done
   * for everyone in think().
   */
  posedHits(e) {
    if (e.hitFrame === this.frame) return;
    e.hitFrame = this.frame;
    e.fig.root.updateMatrixWorld(true);
    const hit = e.fig.hit;
    for (let i = 0; i < hit.length; i++) {
      const m = hit[i].node.matrixWorld;
      const a = e.hitPts[i * 2] || (e.hitPts[i * 2] = new THREE.Vector3());
      const b = e.hitPts[i * 2 + 1] || (e.hitPts[i * 2 + 1] = new THREE.Vector3());
      const at = hit[i].at;
      if (at) {
        a.set(at[0], at[1], at[2]).applyMatrix4(m);
        b.copy(a);
        continue;
      }
      const off = hit[i].off || 0;
      a.set(0, off, 0).applyMatrix4(m);
      b.set(0, off - hit[i].len, 0).applyMatrix4(m);
    }
  }

  /** Enemies inside a cone — the katana's swing. */
  withinSweep(origin, dir, range, cosArc) {
    const out = [];
    for (const e of this.list) {
      if (!e.alive) continue;
      _to.copy(e.center).sub(origin);
      const d = _to.length();
      if (d > range) continue;
      _to.multiplyScalar(1 / d);
      if (_to.dot(dir) < cosArc) continue;
      out.push({ enemy: e, point: e.center.clone(), dist: d });
    }
    return out;
  }

  /** Knocked off balance by a parry: it stops, reels back, and does nothing for `seconds`. */
  stagger(e, seconds) {
    if (!e.alive) return;
    e.staggerT = Math.max(e.staggerT, seconds);
    e.chargeState = null;
  }

  damage(e, amount, info) {
    if (!e.alive) return;
    this.hunt(e, true);
    this.contactT = 0;
    e.hp -= amount * (info.crit ? this.mods.crit : this.mods.body);
    e.hurt = 1;
    const fx = this.ctx.effects;
    fx.hit(info.point, info.dir, info.crit);
    if (e.hp <= 0) {
      e.alive = false;
      e.downFor = 0;
      this.alive--;
      fx.burst(info.point, info.dir, 16, {
        speed: 9, size: 0.07, life: 0.5, ink: INK.RED, gravity: 14, drag: 2.2, stretch: 0.22,
      });
      fx.stop(e.t.role?.boss ? 0.16 : 0.055, 0.1);
      fx.kick(e.t.role?.boss ? 1.2 : 0.18);
      this.ctx.audio?.kill();
      const p = this.ctx.player;
      if (this.mods.heal && p?.alive) p.hp = Math.min(p.maxHp, p.hp + this.mods.heal);
      this.onFoeDown?.(e, info);
    } else {
      fx.stop(0.02, 0.5);
      this.ctx.audio?.hitmark(info.crit);
      // knock them back a touch, so shooting something visibly moves it
      e.body.vel.addScaledVector(info.dir, info.crit ? 3.5 : 2.0);
      this.ctx.hud?.markHit(info.crit ? 'crit' : 'body');
    }
    if (!e.alive) this.ctx.hud?.markHit('kill');
  }

  // --- update ---------------------------------------------------------------

  update(dt) {
    this.frame++;
    const p = this.ctx.player;
    this.stance = stanceOf(p);
    this.contactT += dt;
    this.highlightT = Math.max(0, this.highlightT - dt);
    if (this.stance === 'sprint') this.noiseAt.copy(p.center);
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive) {
        e.downFor += dt;
        // keep falling while crumpling, so bodies do not hang in the air
        e.body.vel.y -= GRAVITY * dt;
        stepBody(this.ctx.level, e.body, dt);
        e.fig.root.position.copy(e.body.pos);
        e.fig.root.rotation.z = 0;              // killed mid-stagger
        pose(e.fig.J, { t: e.phase, walk: 0, dead: true, downFor: e.downFor });
        if (e.downFor > 3.2) {
          this.ctx.scene.remove(e.fig.root);
          this.list.splice(i, 1);
        }
        continue;
      }
      this.think(e, dt, p);
    }
    this.updateBullets(dt, p);

    let hunters = 0;
    this.pips.length = 0;
    for (const e of this.list) if (e.alive && e.mind === 'hunt') hunters++;
    this.hunters = hunters;
    if (this.alive > 0 && this.alive <= 2 && this.contactT > AWARE.pips) {
      for (const e of this.list) if (e.alive) this.pips.push(e);
    }
    this.marks?.update(this.list);
  }

  think(e, dt, p) {
    const t = e.t;
    const kind = t.attack.kind;      // 'gun' | 'melee' | 'charge' | 'spotter'
    const b = e.body;
    e.stateT += dt;
    e.mindT += dt;
    e.markT = Math.max(0, e.markT - dt);
    e.hurt = Math.max(0, e.hurt - dt * 3);
    e.staggerT = Math.max(0, e.staggerT - dt);
    const staggered = e.staggerT > 0;
    e.center.copy(b.pos).setY(b.pos.y + b.height * 0.55);
    e.eye.copy(b.pos).setY(b.pos.y + b.height * 0.9);

    _to.copy(p.center).sub(e.center);
    const dist = _to.length();
    _to.multiplyScalar(1 / Math.max(1e-5, dist));

    // --- what it knows ------------------------------------------------------
    // Hunting, it looks for you every frame, exactly as it always did. Anything
    // else only asks the world for a line of sight when you are inside its view
    // cone and its range, which is most of the time not at all.
    if (e.mind !== 'hunt' && this.alwaysHunts(e)) this.hunt(e, false);
    let sees;
    if (e.mind === 'hunt') {
      sees = this.canSee(e, p);
      if (sees || this.highlightT > 0) {
        // highlighted, it knows where you are whether it can see you or not
        e.blindFor = 0;
        e.lastKnown.copy(p.center);
        if (sees) this.contactT = 0;
      } else if ((e.blindFor += dt) > AWARE.lose && !this.alwaysHunts(e)) {
        this.search(e, e.lastKnown);
      }
    } else {
      sees = this.perceive(e, dt, p, dist);
    }
    const hunting = e.mind === 'hunt';

    // How long it has been unable to see you, and which way round it is trying
    // to go. If a wall has been in the way for a while, try the other way.
    if (sees) e.blindT = 0;
    else {
      e.blindT += dt;
      if (e.blindT > 2.6 && b.touchingWall) { e.flank = -e.flank; e.blindT = 0; }
    }

    // Hunting, it faces you — an enemy that shoots you side-on reads as broken.
    // On a ladder it faces the wall it is climbing. Otherwise it faces the way
    // it is walking, or looks about where it stands.
    let wantYaw;
    if (e.ladder) wantYaw = Math.atan2(e.ladder.nx, e.ladder.nz);
    else if (hunting) wantYaw = Math.atan2(-_to.x, -_to.z);
    else if (Math.hypot(b.vel.x, b.vel.z) > 0.8 && !t.role?.stationary) wantYaw = Math.atan2(-b.vel.x, -b.vel.z);
    else wantYaw = e.lookYaw + Math.sin(e.mindT * (t.role?.stationary ? 0.45 : 0.9)) * (t.role?.stationary ? 1.2 : 0.8);
    e.yaw = angleDamp(e.yaw, wantYaw, hunting ? 8 : 4, dt);
    e.fig.root.rotation.y = e.yaw;

    // --- movement -----------------------------------------------------------
    let wantMove = 0;
    if (staggered || !hunting || e.chargeState === 'wind') {
      wantMove = 0;
    } else if (t.role?.stationary) {
      wantMove = dist > t.pace.engage ? 1 : 0;
    } else {
      // close to `closeTo`, back off below `backOff`: a band, not a point, or
      // they jitter forwards and backwards on the boundary.
      //
      // Holding inside that band only makes sense if it can SEE you. It used to
      // hold regardless, and an enemy that walked up behind a book stopped
      // there for the rest of the wave: nothing below can fire without line of
      // sight and nothing above moves it again. Reproduced with five sketches
      // stacked behind one piece of ring-road cover, `cool` down to -15 and not
      // a shot fired in twenty seconds. Blind, it keeps closing.
      if (dist > t.pace.closeTo) wantMove = 1;
      else if (dist < t.pace.backOff) wantMove = -0.7;
      else wantMove = sees ? 0 : 1;
    }

    // From `lunge` out, a blade that is ready to strike closes faster.
    const lunging = hunting && t.pace.lunge && !staggered && dist < t.pace.lunge && (e.cool <= 0.15 || e.windT > 0);
    const speed = t.pace.speed * this.mods.speed * difficulty.enemySpeedMul * (lunging ? LUNGE : 1);
    if (e.chargeState === 'run') {
      this.chargeRun(e, dt, p);
    } else if (e.ladder) {
      this.climb(e, dt);
      e.walk = ease(e.walk, 0.6, 8, dt);
    } else {
      // The velocity it wants, steered toward at no more than STEER m/s². It
      // used to add 30·dt a frame and then take 15% off for friction, which
      // settles at 2.83 m/s at 60 fps (2.33 at 30) whatever the type's `speed`
      // said: every enemy on the desk walked at the same pace, and the cutter's
      // 9.4 was never reached.
      let wx = 0, wz = 0, carried = false;
      // Up where it cannot get to you: head for a ladder instead. Only what has
      // to reach you does this unconditionally; a gun that can see you shoots.
      const lad = hunting && !staggered && (kind === 'melee' || kind === 'charge' || !sees) && p.body.pos.y - b.pos.y >= CLIMB.above
        ? this.ladderFor(e, p) : null;
      if (lad) {
        _d.set(lad.foot.x + lad.nx * lad.rest - b.pos.x, 0, lad.foot.z + lad.nz * lad.rest - b.pos.z).normalize();
        wx = _d.x * speed;
        wz = _d.z * speed;
        if (onLadder(lad, b.pos) && b.onGround) e.ladder = lad;
      } else if (e.endClock > 0) {
        // carried over the lip, as the player's vault is: up until clear of it,
        // and on to it whatever the wall did to the speed
        carried = true;
        e.endClock -= dt;
        const lip = e.overY;
        if (b.pos.y >= lip + 0.05) e.overClear = true;
        else if (!e.overClear) b.vel.y = Math.max(b.vel.y, Math.sqrt(2 * GRAVITY * (lip + 0.25 - b.pos.y)));
        const along = b.vel.x * e.overX + b.vel.z * e.overZ;
        if (along < CLIMB.over) { b.vel.x += e.overX * (CLIMB.over - along); b.vel.z += e.overZ * (CLIMB.over - along); }
        if (b.onGround && b.pos.y > lip - 0.1) e.endClock = 0;
      } else if (!hunting) {
        if (!staggered && !t.role?.stationary && this.wander(e, dt)) {
          wx = _d.x * speed * (e.mind === 'search' ? AWARE.searchSpeed : AWARE.roamSpeed);
          wz = _d.z * speed * (e.mind === 'search' ? AWARE.searchSpeed : AWARE.roamSpeed);
        }
      } else if (wantMove !== 0) {
        // Strafe a little as they close, so they are not a straight line of
        // targets walking down your barrel.
        //
        // Blind, it has to be a COMMITTED direction rather than that sine: a
        // sine averages to nothing over its period, and five sketches spent
        // twenty seconds sliding left and right along the same face of the same
        // book, four metres from an end they never reached. `flank` holds one
        // way round until the wall says it is the wrong one.
        // Only the sine answers to difficulty: it is there to spoil your aim,
        // while `flank` is how they get round cover at all.
        //
        // And only hard round something it has just walked into. Blind in the
        // open — you behind a hill, say — it used to set off at 51 degrees to
        // go round the hill rather than over it, and ran into whatever stood
        // beside it instead (probed: the putty hill by the pencil cup, and the
        // pen next to it).
        const flanking = e.wallAgo < UNSTICK.flank ? 1.25 : 0.3;
        const strafe = sees ? Math.sin(e.phase + e.stateT * 1.4) * 0.45 * difficulty.strafeMul : e.flank * flanking;
        // _to points FROM the enemy TOWARD the player, so closing is +_to and
        // backing off is -_to (wantMove carries the sign). The strafe rides the
        // perpendicular (-_to.z, _to.x).
        _d.set(_to.x * wantMove - _to.z * strafe, 0, _to.z * wantMove + _to.x * strafe).normalize();
        // Closing on `stop`, brake so as to arrive there rather than run through
        // it: with no friction a blade at full lunge overshot you by metres.
        let arrive = wantMove > 0 && dist > t.pace.closeTo ? Math.min(speed, Math.sqrt(2 * STEER * (dist - t.pace.closeTo))) : speed;
        // Wedged: pressed to a wall and going nowhere. Collision is resolved an
        // axis at a time, so against a plank at an angle, or in the crook of a
        // hill and a block, a way round that points into the wall on both axes
        // moves on neither, and it stood there until it gave up on you (probed
        // on THE DESK). Step off sideways a moment, the other way each time.
        e.wedgedFor = b.touchingWall && Math.hypot(b.vel.x, b.vel.z) < 0.6 ? e.wedgedFor + dt : Math.max(0, e.wedgedFor - dt);
        if (e.wedgedFor > UNSTICK.after && e.sideT <= 0) { e.sideT = UNSTICK.for; e.flank = -e.flank; e.wedgedFor = 0; }
        if (e.sideT > 0) {
          e.sideT -= dt;
          _d.set(-_to.z * e.flank - _to.x * UNSTICK.back, 0, _to.x * e.flank - _to.z * UNSTICK.back).normalize();
          arrive = speed;
        }
        wx = _d.x * arrive;
        wz = _d.z * arrive;
      }
      if (!carried) steer(b, wx, wz, STEER * dt);
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (!b.onGround) b.vel.y -= GRAVITY * dt;
      else b.vel.y = -2;

      // they climb: if blocked and there is a low ledge, hop it
      if (b.touchingWall && b.onGround && (wx || wz) && Math.random() < 0.06) b.vel.y = 8;

      stepBody(this.ctx.level, b, dt);
      e.wallAgo = b.touchingWall ? 0 : e.wallAgo + dt;
      e.walk = ease(e.walk, clamp(sp / Math.max(0.1, t.pace.speed * this.mods.speed * difficulty.enemySpeedMul), 0, 1), 8, dt);
      if (b.pos.y < this.ctx.level.killY) { e.hp = 0; e.alive = false; this.alive--; }
    }

    e.fig.root.position.copy(b.pos);

    // --- attacking ----------------------------------------------------------
    // Only at something it is hunting: a roaming enemy you walk up behind has
    // not seen you, and does nothing about you until it has.
    let aiming = false;
    if (staggered || !hunting) {
      // nothing: that is what the parry bought, or it does not know you are there
      e.windT = 0;
      e.aimClock = 0;
      e.spotT = 0;
    } else if (kind === 'spotter') {
      // A highlighter points its pen at you. Held long enough, you are
      // highlighted, and stay so for as long as it keeps you in sight.
      if (sees && dist < t.pace.engage) {
        aiming = true;
        e.spotT += dt;
        if (e.spotT >= t.attack.spotTime) this.highlight();
      } else {
        e.spotT = Math.max(0, e.spotT - dt);
      }
    } else if (kind === 'charge') {
      this.chargeTick(e, dt, sees, dist, p);
    } else if (kind === 'melee') {
      // Wind up, then strike. It used to strike the frame it was in range and
      // cooled down, with nothing to read: the one attack in the game you could
      // only parry by guessing. Now the blade goes up for `windup` first, and
      // whether you are still in reach is asked again when it comes down.
      e.cool -= dt;
      if (e.windT > 0) {
        e.windT -= dt;
        if (e.windT <= 0) {
          e.windT = 0;
          e.cutT = CUT;
          e.cool = rand(t.attack.cooldown);
          if (dist < t.pace.engage + REACH) {
            this.meleeHit(e, p);
          } else {
            e.cool *= 0.5;                  // a whiff: it recovers sooner
          }
        }
      } else if (dist < t.pace.engage && e.cool <= 0) {
        e.windT = Math.max(1e-6, (t.attack.windup || 0) * difficulty.windupMul);
      }
    } else if (kind === 'gun') {
      if (e.volleyLeft > 0) {
        aiming = true;
        e.volleyGap -= dt;
        if (e.volleyGap <= 0) {
          this.shoot(e, p);
          e.volleyLeft--;
          e.volleyGap = t.attack.burstGap || 0.12;
          if (e.volleyLeft <= 0) e.cool = rand(t.attack.cooldown);
        }
      } else {
        e.cool -= dt;
        const onYou = sees && dist < t.pace.engage;
        // A gun with a `tell` has to have held its aim on you that long before
        // it fires; without one, a cooled-down gun fires the frame you walk in.
        e.aimClock = onYou ? e.aimClock + dt : 0;
        aiming = onYou && (e.cool < (t.attack.aimHold || 0.45) || (t.attack.tell && e.aimClock > 0));
        if (onYou && e.cool <= 0 && e.aimClock >= (t.attack.tell || 0)) {
          e.volleyLeft = t.attack.burst || 1;
          e.volleyGap = 0;
        }
      }
    }

    // Staggered, it reels: leans back, head thrown, and wobbles side to side
    // while the stagger runs out.
    const reel = staggered ? Math.min(1, e.staggerT * 2.5) : 0;
    e.cutT = Math.max(0, e.cutT - dt);
    const windup = Math.max(1e-3, (t.attack.windup || 0) * difficulty.windupMul);
    pose(e.fig.J, {
      t: e.phase + e.stateT,
      walk: e.walk,
      aim: aiming,
      raise: e.chargeState === 'wind' ? 1
        : e.windT > 0 ? Math.min(1, 0.25 + 1.6 * (1 - e.windT / windup)) : e.cutT > 0 ? 1 : 0,
      cut: e.cutT > 0 ? 1 - e.cutT / CUT : 0,
      lean: e.walk * 0.25 - reel * 0.9 + (e.chargeState === 'run' ? 0.7 : 0),
      hurt: Math.max(e.hurt, reel),
    });
    e.fig.root.rotation.z = reel * Math.sin(e.staggerT * 18) * 0.12;
    e.phase += dt * (0.4 + e.walk);
    e.fig.root.scale.setScalar(t.frame.scale || 1);
  }

  /**
   * You are highlighted: every enemy on the desk knows where you are for
   * HIGHLIGHT.hold seconds after a highlighter last had you in sight.
   */
  highlight() {
    if (this.highlightT <= 0) this.ctx.hud?.message('HIGHLIGHTED', 'the whole page knows where you are — break its line of sight');
    this.highlightT = HIGHLIGHT.hold;
  }

  /**
   * A charger, between charges: cool down, then plant itself and wind up
   * where you can see it. The run itself is chargeRun().
   */
  chargeTick(e, dt, sees, dist, p) {
    const c = e.t.attack;
    if (e.chargeState === 'wind') {
      e.chargeT -= dt;
      if (e.chargeT > 0) return;
      // Committed: it runs at where you were when the wind-up ended, and does
      // not steer after that. That is what makes it something you sidestep.
      e.chargeState = 'run';
      e.chargeT = c.duration;
      e.chargeHit = false;
      e.chargeDir.copy(p.body.pos).sub(e.body.pos).setY(0);
      if (e.chargeDir.lengthSq() < 1e-6) e.chargeDir.set(0, 0, -1);
      e.chargeDir.normalize();
    } else if (!e.chargeState) {
      e.cool -= dt;
      if (e.cool <= 0 && sees && dist < e.t.pace.engage && dist > c.minDist) {
        e.chargeState = 'wind';
        e.chargeT = c.windup * difficulty.windupMul;
      }
    }
  }

  /** The charge: flat out in a straight line, until it hits you, a wall, or runs out. */
  chargeRun(e, dt, p) {
    const c = e.t.attack;
    const b = e.body;
    const sp = c.speed * this.mods.speed * difficulty.enemySpeedMul;
    b.vel.x = e.chargeDir.x * sp;
    b.vel.z = e.chargeDir.z * sp;
    if (!b.onGround) b.vel.y -= GRAVITY * dt;
    else b.vel.y = -2;
    stepBody(this.ctx.level, b, dt);
    e.walk = 1;
    e.chargeT -= dt;
    e.center.copy(b.pos).setY(b.pos.y + b.height * 0.55);
    if (!e.chargeHit && p.center.distanceTo(e.center) < c.reach) {
      e.chargeHit = true;
      // bowled over, unless the katana took it
      if (this.meleeHit(e, p)) p.launch?.(e.chargeDir.x * 11, 6, e.chargeDir.z * 11, 0.3);
    }
    if (b.touchingWall && c.duration - e.chargeT > 0.12) {
      // Into a wall: it leaves its mark on the page, and stands there dazed.
      const fx = this.ctx.effects;
      fx.decal(b.pos.clone().setY(b.pos.y + 0.03), UP, { size: 3.4, ink: INK.RED });
      fx.kick(0.5);
      fx.burst(e.center, UP, 14, { speed: 6, size: 0.06, life: 0.4, ink: INK.RED, gravity: 12, drag: 2 });
      this.ctx.audio?.hitmark(true);
      e.cool = rand(e.t.attack.cooldown);
      this.stagger(e, c.stun);
    } else if (e.chargeT <= 0) {
      e.chargeState = null;
      e.cool = rand(e.t.attack.cooldown);
    }
    if (b.pos.y < this.ctx.level.killY) { e.hp = 0; e.alive = false; this.alive--; }
  }

  // --- awareness ----------------------------------------------------------------
  //
  // If they see you they move towards you but otherwise they just move around
  // randomly, and crouching means they don't notice you until you're really
  // close. Three states: `roam` (it does not know you are there), `hunt` (the
  // old AI, untouched) and `search` (it has lost you, and goes to look).
  //
  //   roam --(notice fills)--> hunt --(no sight AWARE.lose)--> search --(done)--> roam
  //     '--- hurt, or hears a shot ----^

  /**
   * Bosses never stop hunting; nor does anything on an "LAMP ON" wave, or
   * while a highlighter has you.
   */
  alwaysHunts(e) { return !!(e.t.role?.boss || this.mods.alwaysHunt || this.highlightT > 0); }

  /**
   * Can it see or hear you this frame? Fills its notice if so, and turns it on
   * to you when that is full. Returns whether it has a line of sight to you.
   */
  perceive(e, dt, p, dist) {
    const t = e.t;
    const st = this.stance;
    let range = (t.role?.stationary ? (st === 'crouch' ? AWARE.sniperCrouched : AWARE.sniperSight) : AWARE.sight[st]) * difficulty.sight;
    let sees = false, rate = 0;
    if (dist < range) {
      const hx = _to.x, hz = _to.z, hl = Math.hypot(hx, hz);
      const facing = hl < 1e-3 ? 1 : (-Math.sin(e.yaw) * hx - Math.cos(e.yaw) * hz) / hl;
      if (facing >= AWARE.cone && this.canSee(e, p)) {
        sees = true;
        rate = 1 / (AWARE.noticeNear + (AWARE.noticeFar - AWARE.noticeNear) * (dist / range));
      }
    }
    const hear = AWARE.hear[st] * difficulty.sight;
    if (!sees && dist < hear) {
      range = hear;
      rate = 1 / (AWARE.noticeNear + (AWARE.noticeFar - AWARE.noticeNear) * (dist / range));
    }
    if (rate > 0) {
      e.notice += rate * dt;
      e.lastKnown.copy(p.center);
      if (e.notice >= 1) this.hunt(e, true);
    } else {
      e.notice = Math.max(0, e.notice - dt * 0.5 / AWARE.noticeFar);
    }
    return sees;
  }

  /**
   * On to you, with where you are. It says so (`!`), and anything within
   * AWARE.alert of it is told as well — but the ones it tells do not pass it
   * on, or one noticing sketch would wake the whole desk.
   */
  hunt(e, tell = true) {
    if (!e.alive) return;
    const p = this.ctx.player;
    if (p) e.lastKnown.copy(p.center);
    e.blindFor = 0;
    e.notice = 1;
    if (e.mind === 'hunt') return;
    e.mind = 'hunt';
    e.mindT = 0;
    e.markT = AWARE.mark;
    e.roamTo = null;
    if (!tell) return;
    for (const o of this.list) {
      if (o === e || !o.alive || o.mind === 'hunt') continue;
      if (o.body.pos.distanceTo(e.body.pos) < AWARE.alert) this.hunt(o, false);
    }
  }

  /** Lost you: walk to `at`, look round, then roam near it. */
  search(e, at) {
    if (e.mind === 'hunt' && this.alwaysHunts(e)) return;
    e.mind = 'search';
    e.mindT = 0;
    e.notice = Math.min(e.notice, 0.5);
    e.roamTo = e.t.role?.stationary ? null : at.clone();
    e.home = at.clone();
    e.homeT = AWARE.homeFor;
    e.lookT = 0;
    e.wallT = 0;
    e.lookYaw = Math.atan2(-(at.x - e.body.pos.x), -(at.z - e.body.pos.z));
  }

  /**
   * Something made a noise at `pos`, heard within `radius`. A shot is you:
   * everything that hears it hunts you. A `bang` is only where something went
   * off, and whatever hears it goes to look.
   */
  noise(pos, radius, kind = 'shot') {
    const r = radius * difficulty.sight;
    if (kind === 'shot') this.noiseAt.copy(pos);
    for (const e of this.list) {
      if (!e.alive || e.mind === 'hunt') continue;
      if (e.center.distanceTo(pos) >= r) continue;
      if (kind === 'shot') this.hunt(e, true);
      else this.search(e, pos);
    }
  }

  /**
   * Roaming and searching: the way it is walking, into _d, or false to stand.
   * A random open point 12-25 m away, a new one on arrival or after being held
   * against a wall a moment, and now and then a stop to look about.
   */
  wander(e, dt) {
    const b = e.body;
    e.homeT = Math.max(0, e.homeT - dt);
    if (e.lookT > 0) {
      e.lookT -= dt;
      if (e.lookT > 0) return false;
      if (e.mind === 'search') { e.mind = 'roam'; e.mindT = 0; }
    }
    if (!e.roamTo) e.roamTo = this.roamPoint(e);
    if (!e.roamTo) return false;
    _d.set(e.roamTo.x - b.pos.x, 0, e.roamTo.z - b.pos.z);
    const d = _d.length();
    e.wallT = b.touchingWall ? e.wallT + dt : 0;
    const arrived = d < (e.mind === 'search' ? 2.5 : 1.5);
    if (arrived || e.wallT > AWARE.stuck) {
      e.lookYaw = e.yaw;
      e.mindT = 0;
      if (e.mind === 'search') {
        // look round where it lost you, then roam about there
        e.lookT = AWARE.searchFor;
        e.roamTo = null;
        return false;
      }
      e.roamTo = null;
      if (e.wallT > AWARE.stuck) { e.flank = -e.flank; e.wallT = 0; }
      else if (Math.random() < AWARE.idleChance) { e.lookT = rand(AWARE.idle); return false; }
      e.roamTo = this.roamPoint(e);
      if (!e.roamTo) return false;
      _d.set(e.roamTo.x - b.pos.x, 0, e.roamTo.z - b.pos.z);
    }
    _d.normalize();
    return true;
  }

  /**
   * An open point to walk to. Near `home` while it is still looking for you;
   * after AWARE.drift seconds with nobody finding you, the pick leans toward
   * the last noise you made, so a wave nobody can find still ends.
   */
  roamPoint(e) {
    const pool = this.ctx.level.spawnPool?.length ? this.ctx.level.spawnPool : this.ctx.level.spawns || [];
    const b = e.body;
    const home = e.homeT > 0 ? e.home : null;
    const drift = this.contactT > AWARE.drift;
    // every point in range: the pool is a hundred-odd points, and asked once
    // per walk, not per frame
    const cand = _cand;
    cand.length = 0;
    for (const q of pool) {
      const d = Math.hypot(q.x - b.pos.x, q.z - b.pos.z);
      if (home) {
        if (Math.hypot(q.x - home.x, q.z - home.z) > AWARE.homeR || d < 4) continue;
      } else if (d < AWARE.roamMin || d > AWARE.roamMax) continue;
      cand.push(q);
    }
    let best = null;
    if (cand.length && drift) {
      // one of the three nearest your last noise
      cand.sort((u, v) => Math.hypot(u.x - this.noiseAt.x, u.z - this.noiseAt.z) - Math.hypot(v.x - this.noiseAt.x, v.z - this.noiseAt.z));
      best = cand[Math.floor(Math.random() * Math.min(3, cand.length))];
    } else if (cand.length) {
      best = cand[Math.floor(Math.random() * cand.length)];
    }
    if (best) return best;
    // no pool, or nothing in range of it: somewhere in a random direction
    const a = Math.random() * Math.PI * 2, r = AWARE.roamMin + Math.random() * (AWARE.roamMax - AWARE.roamMin);
    const edge = (this.ctx.level.edge ?? 40) - 3;
    return new THREE.Vector3(clamp(b.pos.x + Math.cos(a) * r, -edge, edge), b.pos.y, clamp(b.pos.z + Math.sin(a) * r, -edge, edge));
  }

  /** The ladder this enemy should take up to the player, or null. */
  ladderFor(e, p) {
    const b = e.body;
    let best = null, bestD = CLIMB.near;
    for (const l of this.ctx.level.ladders || []) {
      if (Math.abs(l.foot.y - b.pos.y) > 1.2) continue;          // its foot is not down here
      if (l.top < b.pos.y + CLIMB.above - 1 || l.top > p.body.pos.y + 4) continue;
      const d = Math.hypot(l.foot.x - b.pos.x, l.foot.z - b.pos.z);
      if (d < bestD) { best = l; bestD = d; }
    }
    return best;
  }

  /** Up a ladder, held to it the way the player is, and over the top. */
  climb(e, dt) {
    const l = e.ladder;
    const b = e.body;
    ladderLocal(l, b.pos, _lad);
    if (!onLadder(l, b.pos)) { e.ladder = null; return; }        // knocked off it
    if (_lad.h >= l.height - LADDER.topZone) {
      e.ladder = null;
      e.endClock = 0.6;
      e.overY = l.top;
      e.overClear = false;
      e.overX = -l.nx;
      e.overZ = -l.nz;
      b.vel.set(0, Math.sqrt(2 * GRAVITY * Math.max(0.05, l.top + 0.25 - b.pos.y)), 0);
    } else {
      b.vel.y = LADDER.climbSpeed * CLIMB.speed * this.mods.speed * difficulty.enemySpeedMul;
      const pull = (l.rest - _lad.v) * 10;
      b.vel.x = l.nx * pull - l.tx * _lad.u * 4;
      b.vel.z = l.nz * pull - l.tz * _lad.u * 4;
    }
    stepBody(this.ctx.level, b, dt);
  }

  canSee(e, p) {
    _d.copy(p.center).sub(e.eye);
    const dist = _d.length();
    _d.multiplyScalar(1 / Math.max(1e-5, dist));
    const hit = raycast(this.ctx.level, e.eye, _d, dist);
    return !hit;
  }

  shoot(e, p) {
    const t = e.t;
    const s = t.attack.spread || 0.04;
    const speed = t.attack.muzzle || 40;
    // Pellets past their range are gone rather than drifting on across the map.
    const life = t.attack.falloff ? (t.attack.falloff[1] + 6) / speed : 3;
    _to.copy(p.center).sub(e.eye).normalize();
    // A fan is laid out, not scattered: evenly across `fanArc`, level, so the
    // gaps are where you can see them.
    const fan = t.attack.fan || 0;
    for (let i = 0; i < (fan || t.attack.pellets || 1) && this.bullets.length < MAX_BULLETS; i++) {
      _d.copy(_to);
      if (fan) {
        const gap = t.attack.fanArc / (fan - 1);
        _d.applyAxisAngle(UP, -t.attack.fanArc / 2 + gap * (i + (e.fanFlip ? 0.5 : 0)));
      } else {
        _d.x += (Math.random() - 0.5) * s * 2;
        _d.y += (Math.random() - 0.5) * s * 2;
        _d.z += (Math.random() - 0.5) * s * 2;
      }
      _d.normalize();
      this.bullets.push({
        pos: e.eye.clone().addScaledVector(_d, 0.5),
        vel: _d.clone().multiplyScalar(speed),
        dmg: (t.attack.damage || 8) * this.mods.damage,
        life,
        from: e,          // so a parried round can be sent back at the sender
        returned: false,
        origin: t.attack.falloff ? e.eye.clone() : null,
        falloff: t.attack.falloff || null,
        sticks: t.attack.sticks || 0,  // tape: slows whoever it lands on this long
      });
    }
    if (fan) e.fanFlip = !e.fanFlip;
    this.ctx.effects.burst(e.eye.clone().addScaledVector(_to, 0.55), _to, t.attack.pellets || fan ? 5 : 2, {
      speed: 3, size: 0.03, life: 0.1, ink: INK.ORANGE,
    });
    this.ctx.audio?.foeShot();
  }

  /** Returns whether it landed: false if the katana blocked or parried it. */
  meleeHit(e, p) {
    // The katana gets first refusal, as it does on rounds. Blocked or parried,
    // the striker is shoved back off the blade; a parry has also staggered it.
    const verdict = this.ctx.onIncomingMelee?.(e);
    if (verdict) {
      _d.copy(e.center).sub(p.center).setY(0);
      if (_d.lengthSq() < 1e-6) _d.set(0, 0, 1);
      _d.normalize();
      e.body.vel.addScaledVector(_d, verdict === 'parry' ? 9 : 5);
      _hit.copy(p.center).lerp(e.center, 0.45);
      this.ctx.effects.burst(_hit, _d, verdict === 'parry' ? 12 : 6, {
        speed: 7, size: 0.035, life: 0.22, ink: INK.ORANGE, drag: 3, stretch: 0.18,
      });
      return false;
    }
    p.damage((e.t.attack.damage || 10) * this.mods.damage);
    this.contactT = 0;
    this.onPlayerHit?.(e);
    this.ctx.effects.hurt = 1;
    this.ctx.effects.kick(0.3);
    this.ctx.audio?.playerHurt();
    return true;
  }

  updateBullets(dt, p) {
    const bs = this.bullets;
    for (let i = bs.length - 1; i >= 0; i--) {
      const bu = bs[i];
      bu.life -= dt;
      _v.copy(bu.vel).multiplyScalar(dt);
      const step = _v.length();
      _d.copy(_v).multiplyScalar(1 / Math.max(1e-6, step));

      if (bu.returned) {
        // a parried round: it belongs to the player now and hunts whoever is in
        // front of it
        const eh = this.raycast(bu.pos, _d, step + 0.6);
        if (eh) {
          this.damage(eh.enemy, bu.dmg, { point: eh.point, dir: _d.clone(), part: eh.part, crit: eh.part === 'head', source: 'parry' });
          bs.splice(i, 1);
          continue;
        }
      } else {
        // the player: a capsule test against the segment
        _to.copy(p.center).sub(bu.pos);
        const along = clamp(_to.dot(_d), 0, step);
        _hit.copy(bu.pos).addScaledVector(_d, along);
        if (_hit.distanceTo(p.center) < 0.55) {
          // A pellet's damage is settled by how far it came, before the katana
          // sees it: a parry returns what would have landed.
          if (bu.falloff) {
            const [near, far, mul] = bu.falloff;
            bu.dmg *= 1 - clamp((bu.pos.distanceTo(bu.origin) - near) / (far - near), 0, 1) * (1 - mul);
            bu.falloff = null;
          }
          // The katana gets first refusal: block, or parry it straight back.
          // A parry has already set the damage it returns with.
          const verdict = this.ctx.onIncomingBullet?.(bu, _hit);
          if (verdict === 'parry') {
            bu.returned = true;
            bu.life = 3;
            if (bu.from && bu.from.alive) {
              _v.copy(bu.from.center).sub(bu.pos).normalize().multiplyScalar(bu.vel.length() * 1.6);
              bu.vel.copy(_v);
            } else {
              bu.vel.multiplyScalar(-1.4);
            }
            continue;
          }
          if (verdict === 'block') { bs.splice(i, 1); continue; }
          if (bu.sticks) {
            if (!(p.slowT > 0)) this.ctx.hud?.message('TAPED', 'stuck slow until it peels off');
            p.taped?.(bu.sticks);
          }
          p.damage(bu.dmg);
          this.onPlayerHit?.(bu.from || null);
          this.ctx.effects.hurt = 1;
          this.ctx.effects.kick(0.16);
          this.ctx.audio?.playerHurt();
          bs.splice(i, 1);
          continue;
        }
      }

      const hit = raycast(this.ctx.level, bu.pos, _d, step);
      if (hit) {
        this.ctx.effects.impact(hit.point, hit.normal, INK.RED, hit.box.mover);
        if (hit.box.mover) this.ctx.level.toys?.hit(hit.box, hit.point, _d, bu.dmg * IMPULSE);
        bs.splice(i, 1);
        continue;
      }
      bu.pos.add(_v);
      if (bu.life <= 0) bs.splice(i, 1);
    }

    const n = Math.min(bs.length, MAX_BULLETS);
    for (let i = 0; i < n; i++) {
      _v.copy(bs[i].vel).normalize();
      this._q.setFromUnitVectors(UNIT_Z, _v);
      this._m.compose(bs[i].pos, this._q, this._s);
      this.bulletMesh.setMatrixAt(i, this._m);
    }
    this.bulletMesh.count = n;
    this.bulletMesh.instanceMatrix.needsUpdate = true;
  }
}

const UNIT_Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

function rand([a, b]) { return a + Math.random() * (b - a); }

/** Turn a body's horizontal velocity toward (wx, wz), by at most `acc`. */
function steer(b, wx, wz, acc) {
  const dx = wx - b.vel.x, dz = wz - b.vel.z;
  const d = Math.hypot(dx, dz);
  if (d <= acc) { b.vel.x = wx; b.vel.z = wz; return; }
  b.vel.x += (dx / d) * acc;
  b.vel.z += (dz / d) * acc;
}

function angleDamp(a, b, lambda, dt) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * (1 - Math.exp(-lambda * dt));
}

// The enemies are made of the same shapes the world is, so rayCapsule and
// raySphere come from core/physics.js rather than being written twice. A figure
// is two spheres and eight capsules, each anchored to the joint that carries
// the part it stands for — see rig.js.
