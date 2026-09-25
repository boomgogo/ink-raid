import * as THREE from 'three';
import { Wobble, Wobble3, ease, clamp } from '../../core/spring.js';
import { raycast } from '../../core/physics.js';
import { IMPULSE } from '../../world/toys.js';
import { INK } from '../../render/palette.js';
import { buildRifle, buildShotgun, buildSniper, buildKatana, buildFlash, buildStapleGun } from './models.js';
import { EM } from '../../ui/hud.js';

// Weapons.
//
// What makes a gun feel like a gun, in rough order of importance:
//   1. it interrupts you — hitstop on a hit, and a camera kick on every shot;
//   2. the viewmodel moves independently of the camera, on springs, so it lags,
//      recovers and overshoots slightly;
//   3. the crosshair tells the truth: the spread cone that widens as you fire
//      and while you move is the same number the bullets are drawn from;
//   4. everything leaves a mark — tracer, blot, shell, flash.
//
// Damage numbers are per-hit against enemy HP in entities/enemies.

// Every gun's numbers, grouped by what they gate rather than listed flat —
// ammo economy, cadence, lethality, accuracy, aiming, feel, reach & stealth,
// cosmetics — with the one-line derivation next to each. `Gun` keeps this
// whole thing under `this.stats`, so no stat can collide with the instance's
// own fields.
export const GUNS = {
  rifle: {
    name: 'RIFLE', hint: 'Thirty-two to a clip. Short bursts stay tight; a long hold climbs.',
    ammo: {
      clipSize: 32,        // 32*0.1 = 3.2 s to empty, mid the 3-4 s magazine-time target
      reserve: 160,        // 5 magazines, inside the 4-6 target
      spareCap: 320,      // 2x the start, per the wave-clear top-up target
    },
    cadence: {
      interval: 0.1,       // 10 rounds/s, inside 9-12; 5 rounds land in a 0.5 s hold, clears the >=4 pin
      auto: true,
      reloadTime: 1.5,       // mid the 1.3-1.8 s target, well inside the 2.2 s pin
    },
    lethality: {
      // ceil(hp/25): sketch 60->3, cutter 46->2, highlighter 50->2, tape 58->3,
      // punch 110->5 — every regular type lands inside its 2-3/2-5/4-5 band
      damage: 25, headBonus: 3, pellets: 1, falloff: null,
    },
    accuracy: {
      // worst-case strafing bound at walk 5.5 m/s: 0.006 + 5.5*0.0015 + 0.05*e^-1.75
      // = 0.0229 rad, under the 0.0349 hip limit
      hipSpread: 0.006, sightSpread: 0.003, runSpread: 0.0015,
      bloomPerShot: 0.004, bloomCap: 0.05,
    },
    aiming: {
      sightFov: 60,          // m = tan40/tan30 = 1.45x, mid the 1.3-1.6x target
      aimZ: 0.46,          // clears the 0.43-long model by 0.21 m past the near plane
    },
    feel: {
      // 32 shots * ~1.15 avg kick * 0.55 kept = ~20x camKickPitch of cumulative
      // climb; 0.01 rad gives ~11.6 deg, inside the 8-15 deg target
      camKickPitch: 0.01, camKickYaw: 0.002,
      modelKickBack: 1.0, modelKickYawJitter: 0.6, modelKickPitch: 4,
      zoomPunch: 35,          // peak ~= kick*0.0204 (player's punch spring): 0.7 deg, under the 1 deg target
      shake: 0.15,          // barely perceptible, per the target
    },
    reach: {
      range: 120,           // covers the longest sightlines on the desk
      noise: 48,             // strictly between the 43-51 m pin band
    },
    cosmetics: { tracerWidth: 0.02, shellInk: INK.GREEN },
  },
  shotgun: {
    name: 'SHOTGUN', hint: 'Seven shells, loaded one at a time. Fire mid-load if you have to.',
    ammo: {
      clipSize: 7,          // inside the 5-8 shell tube target: seven pumps is a room cleared
      reserve: 30,          // 5 tubes, inside the 4-6 target
      spareCap: 60,        // 2x the start
    },
    cadence: {
      interval: 0.85,       // mid the 0.7-1.0 s pump target
      auto: false,
      reloadTime: 0.4,       // mid the 0.35-0.5 s per-shell target
      refillStyle: 'shells',
    },
    lethality: {
      // 8 pellets * 10 dmg = 80 close-range volley: kills every light type
      // (max 60 hp) in one, and the 110 hp bruiser in two (ceil(110/80)=2)
      damage: 10, headBonus: 2, pellets: 8,
      falloff: [8, 30, 0.2],  // value at 11 m: 1-((11-8)/22)*0.8=0.89 mid-range; at 30 m it's the 0.2 floor, under the quarter-damage target
    },
    accuracy: {
      hipSpread: 0.05, sightSpread: 0.03, runSpread: 0.004,
      bloomPerShot: 0.01, bloomCap: 0.08,
    },
    aiming: {
      sightFov: 70,           // m = tan40/tan35 = 1.20x, inside the 1.1-1.25x target
      aimZ: 0.52,            // clears the 0.47-long model by 0.25 m past the near plane
    },
    feel: {
      camKickPitch: 0.05, camKickYaw: 0.01,
      modelKickBack: 2.2, modelKickYawJitter: 4, modelKickPitch: 10,
      zoomPunch: 150,          // peak ~= kick*0.0204: 3.1 deg, inside the 2-4 deg target
      shake: 0.9,             // a big jolt, per the target
    },
    reach: {
      range: 60,              // past the falloff far edge, with room
      noise: 46,               // similar to the rifle's 48, per the target
    },
    cosmetics: { tracerWidth: 0.03, shellInk: INK.BLUE },
  },
  sniper: {
    name: 'SNIPER', hint: 'Four rounds, a slow bolt and a steep zoom. Settle, then click.',
    ammo: {
      clipSize: 4,           // inside the 4-6 round target: four bolts, then a reload you have to plan
      reserve: 24,            // 6 magazines, top of the 4-6 target: the sniper is fed sparingly
      spareCap: 48,          // 2x the start
    },
    cadence: {
      interval: 1.0,         // mid the 0.8-1.1 s bolt target
      auto: false,
      reloadTime: 2.0,          // mid the 1.8-2.4 s target
    },
    lethality: {
      // 90 body-hit kills every regular type but the bruiser through wave 8's
      // ramp (max non-bruiser hp 60 * 1.406 = 84.4); headBonus 2 (180) clears
      // the bruiser's 110 * 1.406 = 154.7
      damage: 90, headBonus: 2, pellets: 1,
      falloff: null,
    },
    accuracy: {
      hipSpread: 0.03,        // >= 1.5 deg (0.0262 rad), deliberately poor hip-fire
      sightSpread: 0.002, runSpread: 0.01,
      bloomPerShot: 0.002, bloomCap: 0.02,
    },
    aiming: {
      sightFov: 24,               // m = tan40/tan12 = 3.95x, inside the 3-4.5x target
      aimZ: 0.56,                // clears the 0.54-long model by 0.25 m past the near plane
      scope: true,
    },
    feel: {
      camKickPitch: 0.09, camKickYaw: 0.015,
      modelKickBack: 3.0, modelKickYawJitter: 3, modelKickPitch: 14,
      zoomPunch: 220,            // peak ~= kick*0.0204: 4.5 deg, a heavy punch
      shake: 1.0,               // the heaviest kick and the loudest report
    },
    reach: {
      range: 150,               // the longest sightline on the desk, with room
      noise: 72,                 // about 1.5x the rifle's 48, per the target
    },
    cosmetics: { tracerWidth: 0.015, shellInk: INK.PINK },
  },
  stapler: {
    name: 'STAPLE GUN', hint: "It's semi-automatic and it never reloads, so make every click count.",
    ammo: {
      clipSize: 60,             // equals carry: the whole stash rides in the "magazine"
      reserve: 0, spareCap: 0, // no reserve, per the target
      carry: 60,                 // game.js: up to 60 carried; one 30-staple pickup from 0 lands exactly on 30, per the pin
    },
    cadence: {
      interval: 0.15,           // 6.67 clicks/s, inside the 5-7 target
      auto: false,
      reloadTime: 1.0,            // never reached: reserve is 0, so beginRefill never fires
    },
    lethality: {
      damage: 60, headBonus: 1.5, pellets: 1, // kills every light type (max 60 hp) in one hit
      falloff: null,
    },
    accuracy: {
      hipSpread: 0.015, sightSpread: 0.008, runSpread: 0.002,
      bloomPerShot: 0.005, bloomCap: 0.04,
    },
    aiming: {
      sightFov: 66,                // m = tan40/tan33 = 1.29x, near the 1.3x target
      aimZ: 0.30,                  // clears the 0.09-long model with room to spare
    },
    feel: {
      camKickPitch: 0.015, camKickYaw: 0.004,
      modelKickBack: 0.6, modelKickYawJitter: 1.5, modelKickPitch: 3,
      zoomPunch: 70,                  // peak ~= kick*0.0204: 1.4 deg, a light snap
      shake: 0.3,                    // light, per the "quieter than the rifle" target
    },
    reach: {
      range: 35,                     // a close-in windfall weapon
      noise: 29,                      // about 0.6x the rifle's 48, per the target
    },
    cosmetics: { tracerWidth: 0.02, shellInk: INK.ORANGE },
  },
};

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _end = new THREE.Vector3();
const _world = new THREE.Vector3();

// far enough into the sights for aimed spread and aimed recoil
const aimingNow = (w) => w.aimMix > 0.6;

class WeaponBase {
  constructor(ctx, player) {
    this.ctx = ctx;
    this.player = player;
    this.root = new THREE.Group();
    this.root.visible = false;

    // Where the model sits at rest, and where it sits aiming.
    //
    // The scale matters more than it looks: at FOV 80 with the model 0.35 m from
    // the eye, a life-sized rifle fills two thirds of the screen. This scale
    // and offset keep the gun inside the bottom-right quadrant.
    this.scale = 0.58;
    this.root.scale.setScalar(this.scale);
    this.restPos = new THREE.Vector3(0.30, -0.22, -0.34);
    this.restRot = new THREE.Vector3(0.02, -0.06, 0.04);
    this.sightPos = new THREE.Vector3(0, -0.075, -0.24);
    // Aiming levels the gun out. The rest pose is tilted — a few degrees of
    // yaw and roll so the hip silhouette is not a flat elevation drawing — and
    // that tilt used to survive into ADS, swinging the sight about 10 px off
    // the crosshair. A red dot that is not on the crosshair is worse than no
    // red dot. The katana overrides this back to its rest pose, because its
    // "aim" is a block and it has no sight to line up.
    this.aimRot = new THREE.Vector3(0, 0, 0);

    this.aimMix = 0;
    // settle 0.2-0.3 s target; rotation less damped than position:
    //   position: ζ 0.62, settle 0.25 s
    //   rotation: ζ 0.50, settle 0.25 s
    this.recoil = new Wobble3(666, 32);       // model position kick
    this.kickTilt = new Wobble3(1024, 32);   // model rotation kick
    this.bobT = 0;
    this.cooldown = 0;
    this.drawClock = 0;
    // Down out of the way while a bandage goes on: no aiming, no guard.
    this.lowered = false;
    this.lowAmt = 0;
  }

  equip() { this.root.visible = true; this.drawClock = 0.28; }
  holster() { this.root.visible = false; }

  /**
   * Purely visual decay, ticked on REAL time in every game state.
   *
   * Anything that fades out on its own has to live here rather than in
   * update(), because update() only runs while the game is playing. The muzzle
   * flash used to decay inside update(), so firing and then dying or pausing
   * within its 45 ms life froze it mid-flash and burned it onto the death
   * screen — which is precisely when it happens, since that is what dying in a
   * firefight looks like. Reproduced: flareClock stuck at 0.0283 with the flash
   * visible, indefinitely.
   *
   * `playing` is the same gate as `hud.setGameVisible`, which hides the scope
   * overlay with the rest of the in-game HUD, so anything that hides part of
   * the weapon for the scope unhides it again on the pause and death screens.
   */
  tickFx(realDt, playing) {}

  /** Position the model each frame: rest pose + aim + bob + sway + recoil. */
  place(dt, input) {
    const p = this.player;
    const wantAim = input.aim && this.canAim !== false && !this.lowered;
    this.aimMix = ease(this.aimMix, wantAim ? 1 : 0, 14, dt);
    this.lowAmt = ease(this.lowAmt, this.lowered ? 1 : 0, 12, dt);
    const a = this.aimMix;

    this.recoil.update(dt);
    this.kickTilt.update(dt);

    // bob tracks the player's, so gun and view agree
    this.bobT = p.feel.bob.phase;
    const bob = p.feel.bob.amount * (1 - a * 0.8);
    const bx = Math.sin(this.bobT) * 0.018 * bob;
    const by = Math.sin(this.bobT * 2) * 0.014 * bob;

    // the equip animation: swing up from below
    const eq = this.drawClock > 0 ? (this.drawClock / 0.28) : 0;
    this.drawClock = Math.max(0, this.drawClock - dt);

    _tmp.copy(this.restPos).lerp(this.sightPos, a);
    this.root.position.set(
      _tmp.x + bx - p.swayX * 0.03 * (1 - a * 0.7) + this.recoil.vx,
      _tmp.y + by + p.swayY * 0.03 * (1 - a * 0.7) + this.recoil.vy - eq * 0.35 + p.feel.dip.value * 0.012 - this.lowAmt * 0.3,
      _tmp.z + this.recoil.vz,
    );
    const rx = this.restRot.x + (this.aimRot.x - this.restRot.x) * a;
    const ry = this.restRot.y + (this.aimRot.y - this.restRot.y) * a;
    const rz = this.restRot.z + (this.aimRot.z - this.restRot.z) * a;
    this.root.rotation.set(
      rx + this.kickTilt.vx * 0.1 - p.swayY * 0.12 * (1 - a) - eq * 0.8 - this.lowAmt * 0.6,
      ry + this.kickTilt.vy * 0.1 - p.swayX * 0.16 * (1 - a),
      rz + this.kickTilt.vz * 0.1 + (p.sliding ? 0.2 : 0) + eq * 0.5,
    );
  }
}

export class Gun extends WeaponBase {
  constructor(ctx, player, key) {
    super(ctx, player);
    // Nested under `stats` rather than spread on to the instance: the
    // group names (ammo, cadence, lethality, ...) don't collide with
    // anything WeaponBase set up, but a flat Object.assign would have been
    // one accidental field name away from silently overwriting instance
    // state.
    this.stats = GUNS[key];
    this.name = this.stats.name;
    this.hint = this.stats.hint;
    this.key = key;
    this.mag = this.stats.ammo.clipSize;
    this.reserveLeft = this.stats.ammo.reserve;
    this.reloading = 0;
    this.spreadLive = this.stats.accuracy.hipSpread;
    this.firesRounds = true;

    const built = key === 'rifle' ? buildRifle() : key === 'shotgun' ? buildShotgun()
      : key === 'stapler' ? buildStapleGun() : buildSniper();
    this.model = built;
    this.root.add(built.root);
    this.muzzlePt = built.muzzle;
    this.casingPort = built.eject;

    this.flash = buildFlash();
    this.flash.position.copy(built.muzzle);
    this.root.add(this.flash);
    this.flareClock = 0;

    // The ADS pose is derived, not typed.
    //
    // Y is forced: the sight has to end up on the eye line or aiming is a lie,
    // so the model drops by exactly the sight height. That leaves Z — how far
    // down the eye line the gun sits — as the only free number, and it is the
    // one that was wrong. It used to pull the model TOWARDS the eye (-0.24,
    // nearer than the -0.34 hip pose), which put the stock 1 cm the wrong side
    // of the camera. Geometry straddling the near plane does not vanish, it
    // explodes: the clipped remainder of the stock flared into a slab covering
    // the whole lower-centre of the screen, which is what "the gun is blocking
    // the view" was. So aimZ has to clear the rearmost point of the model by a
    // good margin — the recoil spring kicks the model +Z toward the eye too:
    //
    //   rifle   0.46 - 0.43*0.58 = 0.21 m of clearance
    //   shotgun 0.52 - 0.47*0.58 = 0.25 m
    //   sniper  0.56 - 0.54*0.58 = 0.25 m
    //
    // Pushing the gun back shrinks it, and that is the trade: at FOV 80 a
    // 0.58-scale viewmodel cannot be both large on screen and clear of the eye.
    // See the note on sightFov in Game.applyFov.
    this.sightPos.set(0, -built.sight * this.scale, -this.stats.aiming.aimZ);
  }

  get ammoText() { return `${this.mag}/${this.reserveLeft}`; }

  /**
   * Far enough into the scope that the scope overlay has taken the screen.
   *
   * The HUD draws a full-screen scope for the sniper, which means the player is
   * looking down the tube — and the viewmodel sat inside that circle, so the one
   * weapon whose whole purpose is seeing further showed you the side of its own
   * receiver instead. Hidden here, and the HUD uses the same getter so the gun
   * and the overlay swap on exactly the same frame.
   */
  get scoped() { return !!this.stats.aiming.scope && this.aimMix > 0.7; }

  // Only the weapon in hand is ticked, so put a holstered one away clean —
  // otherwise a flash still alive at the moment you switch pops back for its
  // remaining few milliseconds when you switch back.
  holster() {
    super.holster();
    this.flareClock = 0;
    this.flash.visible = false;
    this.model.root.visible = true;
  }

  tickFx(realDt, playing) {
    const gone = playing && this.scoped;
    this.model.root.visible = !gone;
    this.flareClock = Math.max(0, this.flareClock - realDt);
    this.flash.visible = this.flareClock > 0 && !gone;
    if (this.flash.visible) {
      this.flash.rotation.z = Math.random() * Math.PI;
      this.flash.scale.setScalar(0.7 + Math.random() * 0.7);
    }
  }

  beginRefill() {
    if (this.reloading > 0 || this.mag >= this.stats.ammo.clipSize || this.reserveLeft <= 0) return;
    this.reloading = this.stats.cadence.reloadTime;
  }

  /**
   * A pump gun is loaded one shell at a time, and the fact that you can stop
   * part-way and shoot is the whole character of the weapon: two shells in the
   * tube beats a full reload you did not survive. `refillStyle: 'shells'` had
   * been in the data for a while and nothing read it — the shotgun ran the
   * same single timer as the rifle, so its reload was all-or-nothing.
   */
  _tickShellReload(dt) {
    this.reloading -= dt;
    if (this.reloading > 0) return;
    this.mag++;
    this.reserveLeft--;
    this.ctx.audio?.reloadShell();
    if (this.mag < this.stats.ammo.clipSize && this.reserveLeft > 0) this.reloading = this.stats.cadence.reloadTime;
    else this.reloading = 0;
  }

  update(dt, input) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const { ammo, cadence, accuracy } = this.stats;

    if (this.reloading > 0) {
      if (cadence.refillStyle === 'shells') {
        this._tickShellReload(dt);
      } else {
        this.reloading -= dt;
        if (this.reloading <= 0) {
          const want = ammo.clipSize - this.mag;
          const take = Math.min(want, this.reserveLeft);
          this.mag += take;
          this.reserveLeft -= take;
        }
      }
    }

    if (input.pressed('reload')) this.beginRefill();

    // Spread recovers toward its floor, and floors higher while you move.
    //
    // `runSpread` is radians per metre per second, and it used to be
    // multiplied by 60 on top — as if it were per frame, which it never was.
    // Walking, that put the rifle's floor at 0.49 rad: half its rounds landed
    // more than 20 degrees off the crosshair, and the sniper's more than 50.
    // Now: speed capped at 24, a little more in the air or a slide, and most
    // of it gone while aiming.
    const p = this.player;
    const aiming = aimingNow(this);
    let moveTerm = Math.min(p.speed, 24) * accuracy.runSpread
      + (p.body.onGround ? 0 : 0.01) + (p.sliding ? 0.008 : 0);
    if (aiming) moveTerm *= this.stats.aiming.scope ? 0.03 : 0.3;
    const floor = (aiming ? accuracy.sightSpread : accuracy.hipSpread) + moveTerm;
    this.spreadLive = Math.max(floor, ease(this.spreadLive, floor, 5, dt));

    const triggerHeld = cadence.auto ? input.fire : input.triggerTapped();
    // Interrupting a shell reload to fire what you already have is the point of
    // loading one at a time, so firing cancels it rather than being ignored.
    if (triggerHeld && cadence.refillStyle === 'shells' && this.reloading > 0 && this.mag > 0) {
      this.reloading = 0;
    }
    if (triggerHeld && this.cooldown <= 0 && this.reloading <= 0) {
      if (this.mag > 0) this.fire();
      else this.beginRefill();
    }

    this.place(dt, input);
  }

  fire() {
    const ctx = this.ctx;
    const p = this.player;
    const { cadence, lethality, accuracy, feel, reach, cosmetics } = this.stats;
    this.mag--;
    this.cooldown = cadence.interval;
    this.flareClock = 0.045;

    // Camera kick, model kick, shake — all at once, all springs.
    //
    // Only part of the kick stays in your aim. All of it used to, pitch AND a
    // random walk in yaw, so a held trigger marched the crosshair 18 degrees up
    // a magazine and wandered it sideways. Now 55% of the pitch kick is kept
    // and the rest, with all of the yaw, springs back.
    const kick = feel.camKickPitch * (aimingNow(this) ? 0.7 : 1) + Math.random() * feel.camKickPitch * 0.3;
    p.pitch += kick * 0.55;
    p.feel.kickUp.kick(kick * 22);
    p.feel.kickSide.kick((Math.random() - 0.5) * feel.camKickYaw * 2 * 30);
    p.feel.punch.kick(feel.zoomPunch);
    this.recoil.kick((Math.random() - 0.5) * 0.01, 0.012, feel.modelKickBack * 0.06);
    this.kickTilt.kick(-feel.modelKickPitch, (Math.random() - 0.5) * feel.modelKickYawJitter, 0);
    ctx.effects.kick(feel.shake * (1 - this.aimMix * 0.3));
    ctx.audio?.shot(this.key);
    // everything within earshot knows where you are now: `noise` metres
    ctx.enemies?.noise(p.eye, reach.noise);

    this.root.updateMatrixWorld();
    _world.copy(this.muzzlePt).applyMatrix4(this.root.matrixWorld);

    for (let i = 0; i < lethality.pellets; i++) this.shoot(_world);

    // eject a casing sideways
    _tmp.copy(this.casingPort).applyMatrix4(this.root.matrixWorld);
    _dir.set(1, 0, 0).applyQuaternion(p.camera.quaternion);
    ctx.effects.shell(_tmp, _dir, cosmetics.shellInk, this.key === 'shotgun' ? 0.035 : 0.02);

    this.spreadLive = Math.min(accuracy.bloomCap, this.spreadLive + accuracy.bloomPerShot);
  }

  shoot(from) {
    const ctx = this.ctx;
    const p = this.player;
    const { lethality, reach, cosmetics } = this.stats;
    // Along the centre of the screen, which is where the crosshair is.
    _dir.set(0, 0, -1).applyEuler(p.camera.rotation);
    if (this.spreadLive > 0) {
      // A disc in the view plane, with the crosshair's own radius. It used to be
      // a cube in WORLD axes: its corners reached 1.4x the spread the crosshair
      // drew, and the component along the view direction did nothing, so the
      // cone changed shape with the way you faced.
      _right.set(1, 0, 0).applyEuler(p.camera.rotation);
      _up.set(0, 1, 0).applyEuler(p.camera.rotation);
      const r = Math.tan(this.spreadLive) * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    }

    // enemies first, then the world — whichever is nearer wins
    const eye = p.eye;
    const worldHit = raycast(ctx.level, eye, _dir, reach.range);
    const enemyHit = ctx.enemies?.raycast(eye, _dir, worldHit ? worldHit.dist : reach.range);
    // and the paper planes overhead, if nothing nearer took the round
    const planeHit = ctx.planes?.raycast(eye, _dir, enemyHit ? enemyHit.dist : worldHit ? worldHit.dist : reach.range);

    if (planeHit) {
      ctx.planes.down(planeHit.plane);
      ctx.hud?.markHit('kill');
      ctx.audio?.hitmark(false);
      _end.copy(planeHit.point);
    } else if (enemyHit) {
      let dmg = lethality.damage * (enemyHit.part === 'head' ? lethality.headBonus : 1);
      if (lethality.falloff) {
        const [near, far, mul] = lethality.falloff;
        dmg *= 1 - clamp((enemyHit.dist - near) / (far - near), 0, 1) * (1 - mul);
      }
      ctx.enemies.damage(enemyHit.enemy, dmg, {
        point: enemyHit.point, dir: _dir, part: enemyHit.part, crit: enemyHit.part === 'head',
      });
      _end.copy(enemyHit.point);
    } else if (worldHit) {
      ctx.effects.impact(worldHit.point, worldHit.normal, INK.PEN, worldHit.box.mover);
      if (worldHit.box.mover) ctx.level.toys?.hit(worldHit.box, worldHit.point, _dir, lethality.damage * IMPULSE);
      ctx.audio?.impact();
      _end.copy(worldHit.point);
    } else {
      _end.copy(eye).addScaledVector(_dir, reach.range);
    }

    ctx.effects.tracer(from, _end, { width: cosmetics.tracerWidth, ink: INK.ORANGE });
  }
}

/**
 * The katana's guard; times in seconds. The playtester found the old one "a bit
 * glitched and overpowered", and it was both: it stopped rounds from behind,
 * stayed up for as long as RMB was held, re-armed the parry on every press (so
 * tapping RMB parried everything), sent rounds back at x3, did nothing about
 * melee, and froze the game once per parried round.
 */
export const GUARD = {
  facingCos: Math.cos(Math.PI / 3), // a round or a strike counts only from within 60 deg of the view
  holdTime: 1.5,        // mid the (1.0,2.0) s pin; at 0.7 s, 1-0.7/1.5=0.53 of the ring is left, inside 0.3-0.7
  refillTime: 1.2,       // <= the 1.5 s pin (full again well inside the test's 1.6 s wait)
  brokenLockout: 0.75,   // < 3.1 - holdTime (1.6), and until aim is let go
  parryTime: 0.15,       // >= the 0.12 s pin, and clears rounds that arrive 0.08-0.09 s after the raise
  freshAfter: 0.35,      // > the 0.05 s pin, so tapping every 50 ms parries at most once
  reflectMul: 1.5,       // pinned: exactly 1.5, so a parried 10-damage round returns for 15
  staggerTime: 1.0,       // >= the 0.7 s pin
  hitstopGap: 0.3,        // > the 0.1 s pin: at most one parry hitstop this often, real time
  bannerGap: 0.9,          // > the 0.1 s pin: and one PARRIED banner this often
};

// A blade is quiet: only what is nearly on top of you hears it. "A few
// metres", per the target.
const KATANA_NOISE = 4;

export class Katana extends WeaponBase {
  constructor(ctx, player) {
    super(ctx, player);
    this.name = 'KATANA';
    this.hint = 'A slash cuts. Hold aim to raise your guard, and time the raise to parry.';
    this.key = 'katana';
    this.firesRounds = false;
    // Kills every light type (60/46/28/50/58 hp) in one, the 110 hp bruiser in
    // two: 70 < 110 <= 140.
    this.damage = 70;
    this.range = 3.2;                     // mid the 3-3.5 m target
    this.arc = Math.cos((55 * Math.PI) / 180); // 55 deg half-angle, mid the 50-60 deg target
    this.swingClock = 0;
    this.swingTime = 0.28;     // inside the 0.25-0.35 s target, on the quick side so a slash answers the tell
    this.combo = 0;
    this.strikeLanded = false;
    this.guardMix = 0;
    this.resetGuard();
    this.lastStop = -1e9;     // real seconds
    this.lastBanner = -1e9;
    this.tiredTip = false;
    this.mag = Infinity;

    // The focus gauge. Slashes, blocks and parries fill it; when it is lit, a
    // fire press while aiming (or the melee key) spends it on a dash-slash. It
    // exists to give the katana a reason to be in your hands when you also have
    // a rifle: it is the only weapon that rewards being in the wrong place.
    this.focus = 0;
    this.focusReady = false;
    this.dashT = 0;

    const built = buildKatana();
    this.model = built;
    this.root.add(built.root);
    this.root.scale.setScalar(0.7);
    // Held low and to the right at rest, tip forward, with a light tilt — the
    // same idea as a gun's hip pose. Raised and brought inward for the guard,
    // the blade crossing in front of the camera. Checked in shots/stills/game-katana.png.
    this.restPos.set(0.32, -0.28, -0.42);
    this.restRot.set(0.05, 0.35, 0.08);
    this.aimRot.copy(this.restRot);
    this.sightPos.set(0.06, -0.16, -0.30);
    this.guardRot = new THREE.Vector3(-0.55, 0.35, 0.55);
  }

  get ammoText() { return '∞'; }
  beginRefill() {}

  /** A full guard, down long enough that the next one is fresh. */
  resetGuard() {
    this.blocking = false;
    this.guardFor = 0;          // how long the guard has been up
    this.guard = 1;           // what is left of the guard, 0-1
    this.downT = 9;           // how long the guard has been down
    this.fresh = false;       // it was down GUARD.freshAfter before this raise
    this.brokenT = 0;
    this.mustRelease = false; // a guard that ran dry comes back on a new press
    this.holsteredAt = null;
  }

  /** The guard refills while the katana is put away, as it would in hand. */
  holster() {
    super.holster();
    if (this.blocking) this.downT = 0;
    this.blocking = false;
    this.guardMix = 0;
    this.holsteredAt = this.ctx.effects?.time ?? null;
  }

  equip() {
    super.equip();
    if (this.holsteredAt == null || !this.ctx.effects) return;
    const away = Math.max(0, this.ctx.effects.time - this.holsteredAt);
    this.holsteredAt = null;
    this.guard = Math.min(1, this.guard + away / GUARD.refillTime);
    this.downT += away;
    this.brokenT = Math.max(0, this.brokenT - away);
  }

  /** Raised on a fresh guard, and still inside the window. */
  get canParry() { return this.blocking && this.fresh && this.guardFor <= GUARD.parryTime; }

  /** Whether something coming from `dir` (pointing AWAY from the player) is in front. */
  _facing(dir) {
    _tmp.set(0, 0, -1).applyEuler(this.player.camera.rotation);
    return _tmp.dot(dir) >= GUARD.facingCos;
  }

  /**
   * An enemy round is about to hit the player. Called from the bullet loop.
   *
   * A guard stops a round from in front. A guard raised a moment before it
   * arrives, after being down a while, sends it back: the reward for reading
   * the shot rather than holding RMB through the fight.
   * @returns {'parry'|'block'|null}
   */
  onIncoming(bullet) {
    if (!this.blocking) return null;
    _dir.copy(bullet.vel).normalize().negate();
    if (!this._facing(_dir)) return null;
    if (this.canParry) {
      this._parried(0.3);
      bullet.dmg *= GUARD.reflectMul;
      this.kickTilt.kick(-3.5, 2, 2.5);
      return 'parry';
    }
    this.addFocus(0.1);
    this.ctx.effects.kick(0.12);
    this.ctx.audio?.hitmark(false);
    this.kickTilt.kick(-1.6, 1, 1.2);
    return 'block';
  }

  /**
   * An enemy's strike is about to land. Called from Enemies.meleeHit.
   *
   * It used to be ignored: a cutter slashed straight through a raised guard.
   * Now a guard stops a strike from in front, and a parry staggers the striker.
   * @returns {'parry'|'block'|null}
   */
  onMelee(enemy) {
    if (!this.blocking) return null;
    _dir.copy(enemy.center).sub(this.player.eye).normalize();
    if (!this._facing(_dir)) return null;
    if (this.canParry) {
      this._parried(0.35);
      this.ctx.enemies?.stagger(enemy, GUARD.staggerTime);
      this.kickTilt.kick(-4, 2.5, 3);
      return 'parry';
    }
    this.addFocus(0.12);
    this.ctx.effects.kick(0.25);
    this.ctx.audio?.bladeStrike();
    this.kickTilt.kick(-2.4, 1.5, 1.8);
    return 'block';
  }

  /**
   * What a parry costs the frame. Every parried round of a burst used to
   * freeze the game and scribble PARRIED again: a heavy's six rounds froze it
   * six times over. One hitstop and one banner per GUARD.hitstopGap and
   * GUARD.bannerGap now, on real time, since hitstop itself slows game time.
   */
  _parried(focus) {
    const now = performance.now() / 1000;
    const fx = this.ctx.effects;
    this.addFocus(focus);
    fx.kick(0.3);
    this.ctx.audio?.bladeStrike();
    if (now - this.lastStop >= GUARD.hitstopGap) {
      this.lastStop = now;
      fx.stop(0.09, 0.1);
    }
    if (now - this.lastBanner >= GUARD.bannerGap) {
      this.lastBanner = now;
      this.ctx.hud?.message('PARRIED');
    }
  }

  addFocus(n) {
    this.focus = clamp(this.focus + n, 0, 1);
    if (this.focus >= 1 && !this.focusReady) {
      this.focusReady = true;
      this.ctx.hud?.tip(['blade is charged: hold ', EM('aim'), ', tap ', EM('fire'), ' to cut loose'], 3);
    }
  }

  /** Spend a full gauge: a long fast dash that cuts everything on the way. */
  dashSlash() {
    if (!this.focusReady) return;
    const p = this.player;
    const ctx = this.ctx;
    this.focus = 0;
    this.focusReady = false;
    this.dashT = 0.30;
    _dir.set(0, 0, -1).applyEuler(p.camera.rotation);
    p.launch(_dir.x * 34, Math.max(p.body.vel.y, 2), _dir.z * 34, 0.34);
    p.feel.punch.kick(-18);
    ctx.effects.kick(0.5);
    ctx.effects.stop(0.06, 0.25);
    ctx.audio?.swing();
    this.ctx.hud?.message('BLADE');
  }

  beginSwing() {
    // a blade is quiet: only what is nearly on top of you hears it
    this.ctx.enemies?.noise(this.player.eye, KATANA_NOISE);
    this.swingClock = this.swingTime;
    this.strikeLanded = false;
    this.combo = (this.combo + 1) % 3;
    this.cooldown = this.swingTime * 0.8;
    this.ctx.audio?.swing();
  }

  /**
   * The guard: up while aim is held, for as long as there is guard left.
   *
   * It drains while up and refills while down, rather than being a timer that
   * restarts on every press: a timer that restarts is beaten by letting go for
   * a frame. Run it dry and it drops for GUARD.brokenLockout, and stays down until aim
   * is let go, so a held button does not flicker the guard up and down by itself.
   */
  updateGuard(dt, input) {
    this.brokenT = Math.max(0, this.brokenT - dt);
    if (!input.aim) this.mustRelease = false;
    const want = input.aim && this.brokenT <= 0 && !this.mustRelease && !this.lowered;
    if (want && !this.blocking) {
      this.guardFor = 0;
      this.fresh = this.downT >= GUARD.freshAfter;
    } else if (!want && this.blocking) {
      this.downT = 0;
    }
    this.blocking = want;

    if (this.blocking) {
      this.guardFor += dt;
      this.guard -= dt / GUARD.holdTime;
      if (this.guard <= 0) {
        this.guard = 0;
        this.blocking = false;
        this.downT = 0;
        this.brokenT = GUARD.brokenLockout;
        this.mustRelease = true;
        this.kickTilt.kick(3, -1.5, -2);
        this.ctx.audio?.hitmark(false);
        if (!this.tiredTip) {
          this.tiredTip = true;
          this.ctx.hud?.tip(['guard worn through: release ', EM('aim'), ' and bring it back up'], 3.5);
        }
      }
    } else {
      this.downT += dt;
      this.guard = Math.min(1, this.guard + dt / GUARD.refillTime);
    }
  }

  update(dt, input) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.updateGuard(dt, input);
    this.guardMix = ease(this.guardMix, this.blocking ? 1 : 0, 14, dt);

    this.dashT = Math.max(0, this.dashT - dt);
    // A fire PRESS while aim is held, or melee, while the gauge is lit. It used
    // to be both buttons merely held, so raising the guard with fire already
    // down launched you somewhere you never asked to go.
    if (this.focusReady && ((input.triggerTapped() && input.aim) || input.pressed('melee'))) this.dashSlash();
    if (this.dashT > 0) this.landBlow();

    if (this.swingClock > 0) {
      this.swingClock -= dt;
      const t = 1 - this.swingClock / this.swingTime;
      if (!this.strikeLanded && t > 0.4) { this.strikeLanded = true; this.landBlow(); } // the cut lands as the blade crosses the middle of the frame, just before the swing's midpoint
    } else if ((input.triggerTapped() || input.pressed('melee')) && this.cooldown <= 0 && !this.blocking) {
      this.beginSwing();
    }

    this.place(dt, input);

    // the swing itself, layered on top of the rest pose
    if (this.swingClock > 0) {
      const t = 1 - this.swingClock / this.swingTime;
      const swing = Math.sin(t * Math.PI);
      const dirSign = this.combo === 1 ? -1 : 1;
      this.root.rotation.z += swing * 2.4 * dirSign;
      this.root.rotation.x -= swing * 0.9;
      this.root.position.z -= swing * 0.24;
    }
    if (this.guardMix > 0.01) {
      this.root.rotation.x += (this.guardRot.x - this.restRot.x) * this.guardMix;
      this.root.rotation.z += (this.guardRot.z - this.restRot.z) * this.guardMix;
    }
  }

  landBlow() {
    const ctx = this.ctx;
    const p = this.player;
    _dir.set(0, 0, -1).applyEuler(p.camera.rotation);
    const hits = ctx.enemies?.withinSweep(p.eye, _dir, this.range, this.arc) || [];
    let any = false;
    for (const h of hits) {
      any = true;
      ctx.enemies.damage(h.enemy, this.damage, {
        point: h.point, dir: _dir, part: 'torso', crit: false, source: 'katana',
      });
    }
    if (any) {
      ctx.effects.stop(0.07, 0.12);
      ctx.effects.kick(0.22);
      ctx.audio?.bladeStrike();
      this.kickTilt.kick(0, 0, 1.5);
      this.addFocus(0.22);
    }
  }
}
