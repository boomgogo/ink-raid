import * as THREE from 'three';
import { newBody, stepBody, floorAt, clearAbove, roomToStand, ladderAt, onLadder, ladderLocal, GRAVITY, PLAYER_BODY } from '../core/physics.js';
import { Wobble, ease, clamp } from '../core/spring.js';
import { Grapple } from './grapple.js';
import { difficulty } from '../core/difficulty.js';

// The player: movement, camera feel, health.
//
// Tuning is in MOVE below, in metres and seconds. The feel is a fast, floaty,
// momentum-carrying shooter where you are almost never standing still.
//
// The parts that actually make it feel good, none of which are visible in a
// screenshot:
//   * coyote time and jump buffering, so a jump you meant lands even when your
//     timing is a frame or two out either side
//   * per-axis collision with step-up, so you slide along walls and climb kerbs
//   * a landing dip, an FOV punch under speed, strafe roll and head bob, all on
//     springs — the camera is never rigid
//   * slide keeps your speed and decays it, so crouching out of a sprint is a
//     move rather than a stop

// Movement, in metres and seconds, grouped by what each dial is for rather
// than listed flat. Every number below is derived from a design target, or
// from a limit the map or a test sets, with the one-line working next to it.
export const MOVE = {
  walkSpeed: 5.5,          // brisk; strafing median > 4 m/s (game.mjs:237), and above every regular enemy's pace
  sprintSpeed: 8.8,         // 1.6x walk, and walk+2 for the noise-stance change; under the cutter's 10.5 m/s
  crouchSpeed: 3.3,          // 0.6x walk; > the 1.3 m/s crawl pin
  groundAccel: 100,           // walk speed in 0.055 s, mid the 0.04-0.07 s target
  airControl: 22,               // full reversal of walk speed in 0.5 s, mid the 0.4-0.6 s target
  groundFriction: 16,            // ~3 time-constants in 0.1875 s, inside the 0.15-0.25 s stop target
  gravity: GRAVITY,
  jumpSpeed: 7.4,                  // apex v^2/2g = 0.8 m, mid the 0.6-1.0 m target and above the 0.35 m pin
  extraJumps: 1,                      // pinned: exactly 1
  dashSpeed: 24,                        // mid the 20-28 m/s target, above the 18 m/s pin, under the 34 m/s tunnelling proof
  dashCooldown: 1.2,                      // mid the 1-1.5 s target
  slideKick: 3,                             // a noticeable burst over sprint on entry
  slideDecel: 3,                              // drag, so the steering floor 14/drag = 4.67 m/s
  slideExitSpeed: 5.0,                          // > 14/drag (4.67), and a sprint slide decays under it within 1.4 s
  wallKickUp: 7.0,                                // > the 6.3 m/s pin
  wallKickOut: 4.0,                                 // > the 3.5 m/s pin
  wallKickCooldown: 0.2,                              // mid the ~0.2 s target
  coyoteTime: 0.12,                                     // >= the 0.1 s pin
  jumpBufferTime: 0.12,                                   // mid the 0.1-0.15 s target
  eyeHeight: 1.6,                                           // pinned: exactly 1.6 m, level with the figures.mjs lineup
  eyeHeightCrouch: 1.0,                                       // < the 1.25 s pin, at the "~1.0" target
  bodyHeight: PLAYER_BODY.height,
  bodyHeightCrouch: 1.1,                                        // < the 1.3 m ledge pin, and > eyeHeightCrouch
  bodyRadius: PLAYER_BODY.radius,
  stepUp: PLAYER_BODY.step,
  regenAfter: 4.0,                                                // mid the 3-6 s target, above the 1.3 s pin
  regenPerSecond: 8,                                                // >= (125/2-30)/4.5 = 7.2 hp/s, so 30 hp climbs to half inside 4.5 s, with margin
  regenCeiling: 0.5,                                                  // pinned: exactly half
  baseFov: 80,                                                          // the 40 deg half-angle the magnification formulas are built on
};

// Getting over a ledge. `liftReach` is how far above your feet a ledge can be
// and still be vaulted; `carrySpeed` is the speed the vault carries you on to
// it with.
export const MANTLE = {
  liftReach: 1.8,     // jump apex (0.8) + liftReach >= the 2.5 m pin, with margin
  carrySpeed: 3.0,      // >= the 2.5 m/s pin, so angled lips are climbed rather than slid along
  duration: 0.5,          // enough to carry the vault fully over a lip
};

// Taped: a strip of tape from a TAPE slows you for as long as it sticks.
// < 0.7 pin, mid the 0.5-0.65 target.
export const TAPED = { speedMul: 0.55 };

export const LADDER = {
  climbSpeed: 4.5,       // clears the ~3 m/s pin with room for the reach.mjs timing formula
  descendSpeed: 8.5,     // faster than the climb, so holding crouch is a shortcut down
  sideSpeed: 2.4,        // along it, strafing, which is also how you step off sideways
  faceCos: 0.5,           // cos 60 deg: how squarely you have to face it to get on
  kickOutSpeed: 6.0,      // jumping off: away from the wall...
  kickUpSpeed: 5.5,       // ...and up
  regrabDelay: 0.35,      // after jumping off, before it will take you again
  topZone: 0.4,           // this close to the top, forward is getting off
};

const _wish = new THREE.Vector3();
const _flat = new THREE.Vector3();
const _lad = { u: 0, v: 0, h: 0 };

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.level = ctx.level;
    this.camera = ctx.camera;
    this.camera.rotation.order = 'YXZ';
    this.camera.fov = MOVE.baseFov;
    this.camera.updateProjectionMatrix();
    this.baseFov = MOVE.baseFov;
    this.lookScale = 1;

    this.body = newBody(ctx.level.startPoint, MOVE.bodyRadius, MOVE.bodyHeight, MOVE.stepUp);
    this.yaw = 0;
    this.pitch = 0;

    this.maxHp = difficulty.hp;
    this.hp = this.maxHp;
    this.alive = true;
    this.hurtClock = 99;
    this.slowT = 0;             // taped: see taped()

    this.crouching = false;
    this.sliding = false;
    this.slideClock = 0;
    this.sprinting = false;
    this.lateJumpT = 0;  // grace after leaving an edge
    this.jumpQueueT = 0;  // an early jump press, held briefly
    this.airHops = MOVE.extraJumps;
    this.dashLockout = 0;
    this.wallKickLockout = 0;
    this.airborneFor = 0;
    this._fallVel = 0;
    this.vaultLockout = 0;
    this.mantle = null;        // a vault in progress; see startMantle
    this.ladder = null;        // the ladder being climbed
    this.climbCd = 0;
    this.launchT = 0;

    this.eyeLevel = MOVE.eyeHeight;
    this.speed = 0;

    // Camera feel: everything driven by springs or by distance travelled,
    // grouped under one object rather than left as loose instance fields.
    // Each spring pair is solved from spring.js's own formulas against a
    // settle time and a damping ratio (ω=√k, ζ=d/2√k, settle≈4/ζω), not
    // carried over from anywhere: see the derivation notes on MOVE.
    this.feel = {
      // ζ 0.55, settle 0.4 s (mid 0.35-0.5 s, one small overshoot)
      dip: new Wobble(330, 20),
      // ζ 0.51, settle 0.3 s
      punch: new Wobble(710, 27),
      // the part of a gun's camera kick that springs back rather than
      // staying in your aim — see Gun.fire. ζ 0.61, settle 0.3 s: 3 rifle
      // intervals
      kickUp: new Wobble(495, 27),
      kickSide: new Wobble(495, 27),
      bob: { phase: 0, amount: 0, stride: 0 },
    };
    this.roll = 0;
    this.swayX = 0;
    this.swayY = 0;

    this.forward = new THREE.Vector3(0, 0, -1);
    this.right = new THREE.Vector3(1, 0, 0);
    this.eye = new THREE.Vector3();
    this.center = new THREE.Vector3();

    this.grapple = new Grapple(ctx, this);
    this.onVoidDrop = null;
    this.onLand = null;
    this.onStep = null;
  }

  get onGround() { return this.body.onGround; }

  respawn() {
    this.body.pos.copy(this.level.startPoint);
    this.body.vel.set(0, 0, 0);
    this.body.riding = null;              // nothing carries you in from the train
    this.maxHp = difficulty.hp;
    this.hp = this.maxHp;
    this.alive = true;
    this.slowT = 0;
    this.sliding = false;
    this.mantle = null;
    this.ladder = null;
    this.grapple.detach();
  }

  /**
   * Throw the player, and suspend the ground speed cap while they are flying.
   * Without the suspension the cap trims the velocity back to walking pace on
   * the very next frame and the launch does nothing at all — which is exactly
   * what happened to the katana's dash-slash.
   */
  launch(vx, vy, vz, seconds = 0.35) {
    this.body.vel.set(vx, vy, vz);
    this.launchT = Math.max(this.launchT, seconds);
    this.sliding = false;
    this.ladder = null;          // a dash-slash off a ladder takes you off it
    this.mantle = null;
  }

  /** Stuck with tape for `seconds`: slower on your feet until it comes off. */
  taped(seconds) {
    this.slowT = Math.max(this.slowT, seconds);
  }

  damage(n) {
    if (!this.alive) return;
    this.hp = Math.max(0, this.hp - n);
    this.hurtClock = 0;
    if (this.hp <= 0) this.alive = false;
  }

  update(dt, input) {
    if (!this.alive) return;
    const b = this.body;

    // --- look ---------------------------------------------------------------
    //
    // `lookScale` is the ADS zoom, set by the Game once the weapon has told it
    // how far in the FOV pulled. A degree of mouse movement has to buy a degree
    // of view, not a degree of world angle: at the sniper's 22 deg FOV the world
    // is magnified 3.6x, and without this a flick that used to cross the screen
    // crosses three and a half of them and the scope is unusable.
    const look = input.look();
    const dyaw = look.yaw * this.lookScale;
    const dpitch = look.pitch * this.lookScale;
    this.yaw += dyaw;
    this.pitch = clamp(this.pitch + dpitch, -1.52, 1.52);
    // the weapon and camera lag the mouse slightly; this is what "weight" is
    this.swayX = ease(this.swayX, clamp(dyaw * 26, -1, 1), 9, dt);
    this.swayY = ease(this.swayY, clamp(dpitch * 26, -1, 1), 9, dt);

    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    // --- wish direction -----------------------------------------------------
    let fx = 0, sx = 0;
    if (input.down('forward')) fx += 1;
    if (input.down('back')) fx -= 1;
    if (input.down('right')) sx += 1;
    if (input.down('left')) sx -= 1;
    _wish.set(0, 0, 0).addScaledVector(this.forward, fx).addScaledVector(this.right, sx);
    const moving = _wish.lengthSq() > 0;
    if (moving) _wish.normalize();

    // sprint only counts going forwards — backpedalling at a full sprint feels wrong
    this.sprinting = input.down('sprint') && fx > 0 && !this.crouching && b.onGround;

    const hadFloor = b.onGround;
    this.launchT = Math.max(0, this.launchT - dt);
    this.slowT = Math.max(0, this.slowT - dt);
    this.dashLockout = Math.max(0, this.dashLockout - dt);
    this.wallKickLockout = Math.max(0, this.wallKickLockout - dt);
    this.climbCd = Math.max(0, this.climbCd - dt);
    this.vaultLockout = Math.max(0, this.vaultLockout - dt);

    // --- ladders --------------------------------------------------------------
    // You get on by facing one and moving, from the ground or out of the air —
    // which is also how you get on from the top: face the wall and back off the
    // edge. Standing on the top, or backing away from it at the foot, does not
    // take you. You get off by leaving its volume, jumping, reaching the bottom
    // going down, or reaching the top going up (see climb). Pad sticks and the
    // touch stick press forward and back like keys, so they need nothing.
    if (this.ladder && (!onLadder(this.ladder, b.pos) || this.grapple.attached)) this.ladder = null;
    if (!this.ladder && !this.mantle && this.climbCd <= 0 && fx !== 0) {
      const l = ladderAt(this.level, b.pos);
      if (l && -(this.forward.x * l.nx + this.forward.z * l.nz) >= LADDER.faceCos) {
        ladderLocal(l, b.pos, _lad);
        if (!(b.onGround && (fx < 0 || _lad.h > l.height - 0.6))) {
          this.ladder = l;
          this.sliding = false;
          if (this.grapple.attached) this.grapple.detach();
        }
      }
    }

    // --- crouch and slide ---------------------------------------------------
    const crouchHeld = input.down('crouch') && !this.ladder;
    _flat.set(b.vel.x, 0, b.vel.z);
    const flatSpeed = _flat.length();

    if (crouchHeld && b.onGround && !this.sliding && flatSpeed > MOVE.walkSpeed * 0.9) {
      this.sliding = true;
      this.slideClock = 0;
      if (flatSpeed > 0.01) {
        _flat.normalize();
        b.vel.x += _flat.x * MOVE.slideKick;
        b.vel.z += _flat.z * MOVE.slideKick;
      }
    }
    if (this.sliding) {
      this.slideClock += dt;
      if (!crouchHeld || !b.onGround || flatSpeed < MOVE.slideExitSpeed) this.sliding = false;
    }
    this.crouching = crouchHeld && !this.sliding;
    // Stand up only where there is room to. Under a 1.3 m overhang, letting go
    // of crouch used to grow the body into the ceiling, and from then on every
    // move overlapped it and was refused both ways: wedged for good. Now you
    // stay crouched until you have walked out from under it.
    if (!this.crouching && !this.sliding && b.height < MOVE.bodyHeight && !roomToStand(this.level, b, MOVE.bodyHeight)) {
      this.crouching = true;
    }

    const targetH = (this.crouching || this.sliding) ? MOVE.bodyHeightCrouch : MOVE.bodyHeight;
    b.height = ease(b.height, targetH, 16, dt);
    // ease never quite arrives, and a body a hair under standing height would
    // ask the question above every frame for the rest of the run
    if (Math.abs(b.height - targetH) < 1e-3) b.height = targetH;
    const eyeGoal = (this.crouching || this.sliding) ? MOVE.eyeHeightCrouch : MOVE.eyeHeight;
    this.eyeLevel = ease(this.eyeLevel, eyeGoal, 16, dt);

    if (this.ladder) {
      this.climb(input, fx, sx);
    } else {
      // --- ground / air movement ---------------------------------------------
      const grappling = this.grapple.attached;
      let maxSpeed = this.sliding ? Math.max(flatSpeed, MOVE.walkSpeed)
        : this.crouching ? MOVE.crouchSpeed
          : this.sprinting ? MOVE.sprintSpeed : MOVE.walkSpeed;
      if (this.slowT > 0 && !this.sliding) maxSpeed *= TAPED.speedMul;

      if (b.onGround && !this.sliding && this.launchT <= 0) {
        const a = MOVE.groundAccel * dt;
        if (moving) {
          b.vel.x += _wish.x * a;
          b.vel.z += _wish.z * a;
        }
        // friction pulls toward zero, then the cap trims the top end
        const f = Math.max(0, 1 - MOVE.groundFriction * dt * (moving ? 0.35 : 1));
        b.vel.x *= f;
        b.vel.z *= f;
        const sp = Math.hypot(b.vel.x, b.vel.z);
        if (sp > maxSpeed) {
          b.vel.x *= maxSpeed / sp;
          b.vel.z *= maxSpeed / sp;
        }
      } else if (this.launchT > 0) {
        // launched: only drag, no cap and no steering authority
        const f = Math.max(0, 1 - 1.6 * dt);
        b.vel.x *= f;
        b.vel.z *= f;
      } else if (this.sliding) {
        const f = Math.max(0, 1 - MOVE.slideDecel * dt);
        b.vel.x *= f;
        b.vel.z *= f;
        if (moving) {                    // a little steering, not full control
          b.vel.x += _wish.x * 14 * dt;
          b.vel.z += _wish.z * 14 * dt;
        }
      } else if (moving) {
        // air control: accelerate, but only up to the air cap, so you cannot
        // gain speed by holding forward off a ledge
        const a = MOVE.airControl * dt * (grappling ? 1.5 : 1);
        const cap = grappling ? 26 : MOVE.sprintSpeed;
        const nx = b.vel.x + _wish.x * a;
        const nz = b.vel.z + _wish.z * a;
        const sp = Math.hypot(nx, nz);
        if (sp <= cap || sp < Math.hypot(b.vel.x, b.vel.z)) { b.vel.x = nx; b.vel.z = nz; }
      }

      // --- jump, double jump, wall jump, dash --------------------------------
      if (input.pressed('jump')) this.jumpQueueT = MOVE.jumpBufferTime;
      this.jumpQueueT = Math.max(0, this.jumpQueueT - dt);
      this.lateJumpT = b.onGround ? MOVE.coyoteTime : Math.max(0, this.lateJumpT - dt);
      if (b.onGround) this.airHops = MOVE.extraJumps;

      if (this.jumpQueueT > 0) {
        if (this.lateJumpT > 0) {
          b.vel.y = MOVE.jumpSpeed;
          this.jumpQueueT = 0;
          this.lateJumpT = 0;
          this.sliding = false;
          this.feel.punch.kick(-6);
        } else if (this.grapple.attached) {
          this.grapple.launch();
          this.jumpQueueT = 0;
        } else if (b.touchingWall && this.wallKickLockout <= 0 && !this.mantle) {
          b.vel.y = MOVE.wallKickUp;
          b.vel.x += b.wallFacing.x * MOVE.wallKickOut;
          b.vel.z += b.wallFacing.z * MOVE.wallKickOut;
          this.wallKickLockout = MOVE.wallKickCooldown;
          this.jumpQueueT = 0;
          this.feel.punch.kick(-8);
        } else if (this.airHops > 0) {
          b.vel.y = MOVE.jumpSpeed * 0.92;
          this.airHops--;
          this.jumpQueueT = 0;
          this.feel.punch.kick(-6);
        }
      }

      // --- mantle -------------------------------------------------------------
      // Step-up handles anything under 0.55 while walking. Above that you stop
      // dead against a ledge that is obviously climbable, which feels awful, so
      // bumping into one in the air vaults you onto it instead.
      //
      // It used to wait until you were rising slower than 3 m/s, and then give
      // one kick: up, and 3.2 m/s forward. On a lip met at an angle the wall
      // block zeroed the forward part in the same frame, and sliding along the
      // lip had already put you over the air-control cap, so nothing ever added
      // it back: at 40 degrees, a jump got you onto nothing between 0.8 and 2.4 m.
      // Now any lip in reach vaults, and the vault is carried through (below).
      // It goes INTO the wall that stopped you rather than the way you look,
      // so a lip met at a glancing angle is climbed, not slid along — as long
      // as you are facing it at all (within about 70 degrees).
      const wx = -b.wallFacing.x, wz = -b.wallFacing.z;
      if (!this.mantle && !b.onGround && b.touchingWall && this.vaultLockout <= 0 && fx > 0
          && this.forward.x * wx + this.forward.z * wz > 0.3) {
        const ax = b.pos.x + wx * (b.radius + 0.5);
        const az = b.pos.z + wz * (b.radius + 0.5);
        const ledge = floorAt(this.level, ax, az, b.pos.y + MANTLE.liftReach);
        if (ledge > b.pos.y + 0.1 && clearAbove(this.level, ax, az, ledge, b.height)) {
          this.startMantle(ledge, wx, wz);
        }
      }

      if (input.pressed('crouch') && !b.onGround && this.dashLockout <= 0) {
        const dir = moving ? _wish : this.forward;
        this.launch(dir.x * MOVE.dashSpeed, Math.max(b.vel.y, 1.2), dir.z * MOVE.dashSpeed, 0.22);
        this.dashLockout = MOVE.dashCooldown;
        this.feel.punch.kick(-14);
      }
    }
    this.carryMantle(dt);

    // --- integrate ----------------------------------------------------------
    this.grapple.update(dt, input);
    if (this.ladder) { /* the ladder holds you: climb() set the velocity */ }
    else if (!b.onGround || b.vel.y > 0) b.vel.y -= MOVE.gravity * dt;
    else b.vel.y = -2;                          // stick to slopes instead of hopping

    // read the fall speed BEFORE the move: landing zeroes it, so sampling
    // afterwards always reports an impact of nothing
    this._fallVel = b.vel.y;
    // Crouch so you can't fall off edges, for easier sniping.
    // Walking crouched only: a slide, a jump or a launch goes where it goes.
    b.edgeGuard = this.crouching && !this.sliding && !this.ladder && this.launchT <= 0 && !this.mantle;
    stepBody(this.level, b, dt);

    this.airborneFor = b.onGround ? 0 : this.airborneFor + dt;
    if (b.onGround && !hadFloor) {
      const impact = clamp(-this._fallVel / 22, 0, 1);
      this.feel.dip.kick(-impact * 11);
      this.feel.punch.kick(impact * 5);
      this.onLand?.(impact);
      this.airHops = MOVE.extraJumps;
    }

    // off the page
    if (b.pos.y < this.level.killY) {
      this.onVoidDrop?.();
      return;
    }

    // --- regen --------------------------------------------------------------
    this.hurtClock += dt;
    const cap = this.maxHp * MOVE.regenCeiling;
    if (this.hurtClock > MOVE.regenAfter && this.hp < cap)
      this.hp = Math.min(cap, this.hp + MOVE.regenPerSecond * dt);

    this.updateCamera(dt);
  }

  /**
   * Vault on to a ledge at height `y`, going (dx, dz).
   *
   * A vault is carried through rather than kicked once: until the feet are
   * first over the ledge it keeps enough upward speed to clear it by a quarter
   * of a metre, and until you land it keeps at least `push` toward it, whatever
   * the wall or the air-control cap did to your speed on the way. Only until
   * FIRST over: coming down on to the ledge is below it again, and lifting you
   * then bounced you across the top for as long as the vault lasted.
   */
  startMantle(y, dx, dz) {
    const len = Math.hypot(dx, dz) || 1;
    this.mantle = { y, dx: dx / len, dz: dz / len, t: MANTLE.duration, over: false };
    this.vaultLockout = 0.45;
    this.feel.dip.kick(-3);
  }

  carryMantle(dt) {
    const m = this.mantle;
    if (!m) return;
    const b = this.body;
    m.t -= dt;
    if (m.t <= 0 || (b.onGround && m.t < MANTLE.duration - dt * 1.5)) { this.mantle = null; return; }
    if (b.pos.y >= m.y + 0.05) m.over = true;
    else if (!m.over) b.vel.y = Math.max(b.vel.y, Math.sqrt(2 * MOVE.gravity * (m.y + 0.25 - b.pos.y)));
    const along = b.vel.x * m.dx + b.vel.z * m.dz;
    if (along < MANTLE.carrySpeed) {
      b.vel.x += m.dx * (MANTLE.carrySpeed - along);
      b.vel.z += m.dz * (MANTLE.carrySpeed - along);
    }
  }

  /**
   * On a ladder: forward climbs, back descends, crouch slides down, strafing
   * moves along it, jump kicks off. Gravity is off, and the feet are pulled to
   * a rest distance from the wall so you do not drift off it.
   */
  climb(input, fx, sx) {
    const l = this.ladder;
    const b = this.body;
    ladderLocal(l, b.pos, _lad);
    this.airHops = MOVE.extraJumps;
    this.lateJumpT = 0;

    if (input.pressed('jump')) {
      b.vel.set(l.nx * LADDER.kickOutSpeed, LADDER.kickUpSpeed, l.nz * LADDER.kickOutSpeed);
      this.ladder = null;
      this.climbCd = LADDER.regrabDelay;
      this.jumpQueueT = 0;
      this.feel.punch.kick(-6);
      return;
    }

    const slide = input.down('crouch');
    const vy = slide ? -LADDER.descendSpeed : LADDER.climbSpeed * fx;
    if (b.onGround && vy < 0) { this.ladder = null; return; }

    // at the top, going up: over it, the same way a vault takes you on to a ledge
    if (fx > 0 && !slide && _lad.h >= l.height - LADDER.topZone) {
      const ax = b.pos.x - l.nx * (b.radius + 0.5);
      const az = b.pos.z - l.nz * (b.radius + 0.5);
      const ledge = floorAt(this.level, ax, az, l.top + 1);
      if (ledge > b.pos.y - 0.3 && clearAbove(this.level, ax, az, ledge, b.height)) {
        this.ladder = null;
        this.startMantle(ledge, -l.nx, -l.nz);
        return;
      }
    }

    b.vel.y = vy;
    const pull = (l.rest - _lad.v) * 10;
    const side = sx * (this.right.x * l.tx + this.right.z * l.tz) * LADDER.sideSpeed;
    b.vel.x = l.nx * pull + l.tx * side;
    b.vel.z = l.nz * pull + l.tz * side;
  }

  updateCamera(dt) {
    const b = this.body;
    this.speed = Math.hypot(b.vel.x, b.vel.z);

    // head bob, driven by distance travelled rather than by time, so it stays in
    // step with your legs at any speed and stops dead when you do
    if (b.onGround && !this.sliding) {
      this.feel.bob.stride += this.speed * dt;
      this.feel.bob.phase = this.feel.bob.stride * 1.55;
      this.feel.bob.amount = ease(this.feel.bob.amount, clamp(this.speed / MOVE.sprintSpeed, 0, 1), 8, dt);
      const stride = Math.floor(this.feel.bob.phase / Math.PI);
      if (stride !== this._lastStride) { this._lastStride = stride; if (this.speed > 1.5) this.onStep?.(this.speed); }
    } else {
      this.feel.bob.amount = ease(this.feel.bob.amount, 0, 6, dt);
    }

    const stepSwayY = Math.sin(this.feel.bob.phase * 2) * 0.035 * this.feel.bob.amount;
    const stepSwayX = Math.sin(this.feel.bob.phase) * 0.045 * this.feel.bob.amount;

    // roll into strafes, and harder into a slide
    const strafe = this.right.dot(_flat.set(b.vel.x, 0, b.vel.z)) / MOVE.sprintSpeed;
    const targetRoll = -clamp(strafe, -1, 1) * 0.035 + (this.sliding ? -0.13 : 0);
    this.roll = ease(this.roll, targetRoll, 7, dt);

    this.feel.dip.update(dt);
    this.feel.punch.update(dt);
    this.feel.kickUp.update(dt);
    this.feel.kickSide.update(dt);

    // Eye and centre both hang off the feet (b.pos), so this stays correct
    // through crouch, slide and every ladder or mantle pose: the eye lifts by
    // its own height plus the dip spring and the bob, and the centre — the
    // point weapons aim for — sits at the body's own midline.
    const eyeLift = this.eyeLevel + this.feel.dip.value * 0.06 + stepSwayY;
    const midline = b.height * 0.5;
    this.eye.set(b.pos.x, b.pos.y + eyeLift, b.pos.z);
    this.center.set(b.pos.x, b.pos.y + midline, b.pos.z);

    this.camera.position.copy(this.eye).addScaledVector(this.right, stepSwayX);
    this.camera.rotation.set(
      this.pitch + this.swayY * 0.01 + this.feel.kickUp.value,
      this.yaw + this.swayX * 0.01 + this.feel.kickSide.value,
      this.roll,
    );

    // FOV widens with speed: cheap, and the single biggest contributor to a
    // sprint feeling fast rather than merely being fast.
    //
    // This is the HIP field of view, kept on the player because it is the
    // player's — speed and recoil. Aiming down sights overrides it afterwards,
    // from Game.update, which is the only place that knows which weapon is in
    // hand and how far into the aim it is.
    const speedFov = clamp((this.speed - MOVE.walkSpeed) / (MOVE.sprintSpeed - MOVE.walkSpeed), 0, 1) * 5;
    this.baseFov = MOVE.baseFov + speedFov + this.feel.punch.value;
    this.setFov(this.baseFov);
  }

  /** Write a field of view, skipping the projection rebuild when unchanged. */
  setFov(fov) {
    if (Math.abs(this.camera.fov - fov) <= 0.01) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }
}
