import * as THREE from 'three';
import { Gun, Katana } from './entities/weapons/index.js';
import { MOVE } from './entities/player.js';
import { Grenades, GRENADE } from './entities/weapons/grenade.js';
import { Enemies } from './entities/enemies/manager.js';
import { Pickups, ITEMS } from './entities/pickups.js';
import { Effects } from './fx/effects.js';
import { Audio } from './fx/audio.js';
import { WaveDirector } from './core/waves.js';
import { Hud, EM } from './ui/hud.js';
import { TouchControls } from './ui/touch.js';
import { clamp, ease } from './core/spring.js';
import { DIFFICULTIES, difficulty, setDifficulty } from './core/difficulty.js';
import { MenuFlight } from './world/flight.js';
import { Planes, PLANES } from './entities/planes.js';
import { INK } from './render/palette.js';

// The game: state machine, loadout, scoring, and the glue between the systems.
//
// States are menu -> playing -> dead, and the only thing that owns the mouse is
// `playing`. Everything else is a screen you click through.

// MEDIUM keeps the key the best score has always lived under.
const bestKey = (d) => (d === 'medium' ? 'ink_best' : `ink_best_${d}`);

const KILL_WORDS = ['INKED OVER', 'CROSSED OFF', 'BLOTTED OUT', 'SMUDGED AWAY', 'STRUCK THROUGH'];

const _v = new THREE.Vector3();

// requestPointerLock() returns a promise in current Chrome and rejects if the
// document is not focused or the gesture is not recent enough — "The root
// document of this element is not valid for pointer lock." An unhandled
// rejection there is a page error, which is not a thing a player can see but is
// a thing the game gate counts, and it was turning an ordinary unfocused window
// into a test failure. Older engines return undefined, hence the guard.
function grabPointer(el) {
  try {
    const r = el?.requestPointerLock?.();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch { /* not available, or not allowed right now */ }
}

export class Game {
  constructor(ctx) {
    this.ctx = ctx;
    const player = ctx.player;

    ctx.effects = new Effects(ctx);
    ctx.audio = new Audio();
    ctx.enemies = new Enemies(ctx);
    this.flight = ctx.level.flight ? new MenuFlight(ctx.level.flight) : null;
    ctx.hud = new Hud(document.getElementById('hud'));
    this.hud = ctx.hud;
    this.effects = ctx.effects;
    this.audio = ctx.audio;
    this.enemies = ctx.enemies;

    this.weapons = [
      new Gun(ctx, player, 'rifle'),
      new Gun(ctx, player, 'shotgun'),
      new Gun(ctx, player, 'sniper'),
      new Katana(ctx, player),
      // Key 5, and only while you have one: a paper plane drops it (see take)
      new Gun(ctx, player, 'stapler'),
    ];
    this.stapler = this.weapons[4];
    this.stapler.mag = 0;
    this.stapler.hidden = true;
    this.lastIndex = 0;
    this.heldSlot = 0;
    // the viewmodel rides the camera, so it inherits every shake and dip
    this.rig = new THREE.Group();
    ctx.camera.add(this.rig);
    ctx.scene.add(ctx.camera);
    for (const w of this.weapons) this.rig.add(w.root);
    // drawn over the world, with a near plane of its own: see render/pipeline.js
    ctx.renderer.hold(this.rig);

    this.grenades = new Grenades(ctx, player);
    this.waves = new WaveDirector(ctx);
    ctx.pickups = new Pickups(ctx);
    this.pickups = ctx.pickups;
    // paper aeroplanes to shoot down, for a bandage or a staple gun
    ctx.planes = new Planes(ctx);
    this.planes = ctx.planes;
    this.pickups.onTouch = (item) => this.take(item);
    this.bandages = ITEMS.bandage.start;
    this.wrapT = 0;             // wrapping a bandage: seconds left
    this.bandageTip = false;

    this.state = 'menu';
    this.score = 0;
    this.kills = 0;
    this.combo = 1;
    this.chainClock = 0;
    this.runT = 0;
    this.pausedAt = 0;
    this.touchpadTipShown = false;
    // the last difficulty picked, which is also what clicking the backdrop starts
    this.difficulty = DIFFICULTIES[localStorage.getItem('ink_difficulty')] ? localStorage.getItem('ink_difficulty') : 'medium';
    this.best = {};
    for (const d in DIFFICULTIES) this.best[d] = Number(localStorage.getItem(bestKey(d)) || 0);
    this.playMusic = localStorage.getItem('ink_music') !== '0';
    const vol = Number(localStorage.getItem('ink_volume') ?? 50);
    this.volume = Number.isFinite(vol) ? Math.min(100, Math.max(0, vol)) : 50;
    this.audio.setVolume(this.volume / 100);

    this.touch = new TouchControls(ctx.input, document.getElementById('hud'));
    this.touch.onSwap = () => this.cycleWeapon(1);
    if (TouchControls.shouldEnable()) this.touch.enable();

    // Losing the mouse mid-fight pauses.
    //
    // Esc is bound to pause, but while the pointer is locked the browser spends
    // that Esc on releasing the lock and does not reliably pass the key on. So
    // the first Esc could free the cursor and leave the fight running, and only
    // a second one paused. Alt-tab released the lock with no pause at all. A pad
    // player never needs the lock, and the touch layer never takes it.
    ctx.input.onPointerLock = (locked) => {
      if (locked || this.state !== 'playing' || this.touch.enabled || ctx.input.pad.active) return;
      this.pause();
    };

    // The katana gets first refusal on every incoming round and strike, while
    // there is a fight: behind the death screen its guard is whatever it was.
    const guarding = () => this.state === 'playing' && this.weapon instanceof Katana;
    ctx.onIncomingBullet = (b) => (guarding() ? this.weapon.onIncoming(b) : null);
    ctx.onIncomingMelee = (e) => (guarding() ? this.weapon.onMelee(e) : null);

    // What moves by itself (world/toys.js): it turns your view with it when you
    // ride it round a bend, and it makes a noise.
    this.toys = ctx.level.toys || null;
    if (this.toys) {
      this.toys.movers.onTurn = (b, dyaw) => { if (b === player.body) player.yaw += dyaw; };
      this.toys.onEvent = (kind, pos, strength) => {
        const near = clamp(1 - ctx.camera.position.distanceTo(pos) / 90, 0, 1) * strength;
        if (kind === 'whistle') this.audio.whistle(near);
        else if (kind === 'click') this.audio.click(near);
      };
    }

    this._wire();
    this.showMenu();
  }

  _wire() {
    const p = this.ctx.player;
    const hud = this.hud;

    p.onLand = (impact) => { if (impact > 0.1) this.audio.land(impact); };
    p.onStep = (speed) => this.audio.step(speed);
    p.onVoidDrop = () => {
      p.body.pos.copy(this.ctx.level.startPoint);
      p.body.vel.set(0, 0, 0);
      p.body.riding = null;
      p.damage(25);
      hud.message('OVER THE EDGE', 'back at the start, freshly drawn');
      this.effects.hurt = 1;
    };

    this.enemies.onFoeDown = (e, info) => {
      this.kills++;
      this.chainClock = 3.2;
      this.combo = Math.min(9, this.combo + 1);
      const pts = Math.round((e.t.reward.score || 100) * this.combo * (info.crit ? 1.5 : 1));
      this.score += pts;
      const word = info.crit ? 'HEADSHOT' : info.source === 'katana' ? 'HALVED'
        : KILL_WORDS[Math.floor(Math.random() * KILL_WORDS.length)];
      hud.kill(`${e.t.name} ${word.toLowerCase()}`, pts);
      if (info.crit) hud.message('HEADSHOT');
      this.pickups.onFoeDown(e);
    };

    this.planes.onDown = (plane) => {
      this.effects.burst(plane.pos, new THREE.Vector3(0, 1, 0), 14, {
        speed: 7, size: 0.08, life: 0.6, ink: INK.PEN, gravity: 6, drag: 1.5, stretch: 0.4,
      });
      this.audio.impact();
      if (this.state !== 'playing') return;
      this.score += PLANES.score;
      hud.kill(`plane shot down, carrying ${plane.carry === 'stapler' ? 'a staple gun' : 'a bandage'}`, PLANES.score);
    };

    this.enemies.onPlayerHit = (from) => {
      this.effects.hurt = 1;
      if (from) {
        // Clockwise-from-up, in view space: 0 is straight ahead. dx,dz is the
        // source minus the player, so this is `yaw + atan2(dx, -dz)` — not
        // `-(atan2(dx, -dz) - yaw)`, which mirrored the direction and
        // double-counted yaw (an enemy dead ahead at yaw 0.7 came out as 1.4,
        // and one on the right pointed left). Fixed at both call sites; see
        // the same computation in updateHud for the pips.
        _v.copy(from.center).sub(p.center);
        hud.showHurtFrom(p.yaw + Math.atan2(_v.x, -_v.z));
      }
      if (!p.alive && this.state === 'playing') this.die();
    };

    this.waves.onWaveStart = (n, mod, boss, intro) => {
      hud.showWave(n);
      hud.showTwist(mod);
      hud.message(boss ? 'BOSS' : `WAVE ${n}`, boss ? intro : mod || 'something just started moving on the desk');
      this.audio.wave();
    };
    this.waves.onWaveClear = (n) => {
      // Reworded from the flagged "WAVE n CLEARED / catch your breath": the
      // sub-line now says what actually happens between waves, since the
      // resupply below was previously silent.
      hud.message(`WAVE ${n} DOWN`, 'reload topped up, grenades refilled');
      // topping up between waves keeps the pace up: no scavenging, no downtime
      for (const w of this.weapons) {
        if (!w.firesRounds) continue;
        const { reserve, spareCap } = w.stats.ammo;
        w.reserveLeft = Math.min(spareCap, w.reserveLeft + Math.ceil(reserve * 0.5));
      }
      this.grenades.count = GRENADE.carry.max;
      this.audio.wave();
    };
  }

  // --- screens --------------------------------------------------------------

  showMenu() {
    this.state = 'menu';
    this.hud.setGameVisible(false);
    const diffs = {};
    // PLAY (medium) before EASY, regardless of how DIFFICULTIES itself is
    // ordered: it is the default/primary pick and must be the first button.
    for (const d of ['medium', 'easy']) {
      diffs[d] = {
        label: DIFFICULTIES[d].label,
        blurb: d === 'medium' ? 'stand on the desk for as long as it lets you' : 'lighter waves, softer hits',
        best: this.best[d] || 0,
      };
    }
    this.hud.screens.menu({
      diffs, selected: this.difficulty,
      volume: this.volume, music: this.playMusic, sens: this.ctx.input.sens, invert: this.ctx.input.invert,
      howtoOpen: !!this.howtoOpen, touch: this.touch.enabled,
      onStart: (d) => this.startRun(d),
      onSetting: (key, value) => this.applySetting(key, value),
      onHowto: (open) => { this.howtoOpen = open; },
      onBackdrop: () => this.startRun(),
    });
  }

  applySetting(key, value) {
    if (key === 'volume') {
      this.volume = value;
      localStorage.setItem('ink_volume', String(value));
      this.audio.setVolume(value / 100);
    } else if (key === 'sens') {
      this.ctx.input.sens = value;
      localStorage.setItem('ink_sens', String(value));
    } else if (key === 'invert') {
      this.ctx.input.invert = value;
      localStorage.setItem('ink_invert', value ? '1' : '0');
    } else if (key === 'music') {
      this.playMusic = value;
      localStorage.setItem('ink_music', this.playMusic ? '1' : '0');
      this.audio.setMusic(this.playMusic);
    }
  }

  startRun(d = this.difficulty) {
    if (DIFFICULTIES[d] && d !== this.difficulty) {
      this.difficulty = d;
      localStorage.setItem('ink_difficulty', d);
    }
    setDifficulty(this.difficulty);
    // The focus is still on whatever setting was touched last, and a checkbox
    // with focus toggles on Space: the jump key.
    document.activeElement?.blur?.();
    this.audio.init();
    this.audio.setMusic(this.playMusic);
    this.score = 0;
    this.kills = 0;
    this.combo = 1;
    this.state = 'playing';
    this.hud.closeScreen();
    this.hud.setGameVisible(true);
    this.hud.showScore(0);
    this.hud.setTally(0);
    this.hud.showTwist('');

    const p = this.ctx.player;
    p.respawn();
    for (const w of this.weapons) {
      if (!w.firesRounds) { w.resetGuard?.(); continue; }
      w.mag = w === this.stapler ? 0 : w.stats.ammo.clipSize;
      w.reserveLeft = w.stats.ammo.reserve;
      w.reloading = 0;
    }
    this.stapler.hidden = true;
    this.grenades.count = GRENADE.carry.max;
    this.grenades.live.length = 0;
    this.pickups.reset();
    this.bandages = ITEMS.bandage.start;
    this.wrapT = 0;
    this.runT = 0;
    this.selectWeapon(0);
    this.enemies.clear();
    this.waves.start();
    this.hud.tip(this.touch.enabled
      ? ['tap ', EM('LINE'), ', hold to reel it in']
      : ['hold ', EM(this.ctx.input.key('grapple')), ' to pull yourself in on the line'], 6);

    if (!this.touch.enabled) grabPointer(this.ctx.renderer.canvas);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.pausedAt = performance.now();
    this.hud.screens.pause({
      diffLabel: difficulty.label, score: this.score, wave: this.waves.wave,
      onMainMenu: () => this.quitToMenu(),
      onBackdrop: () => this.resume(),
    });
    document.exitPointerLock?.();
  }

  resume() {
    this.state = 'playing';
    this.hud.closeScreen();
    if (!this.touch.enabled) grabPointer(this.ctx.renderer.canvas);
  }

  die() {
    if (this.state === 'dead') return;
    this.state = 'dead';
    this.waves.stop();
    this.audio.gameOver();
    this.effects.flash = 0.6;
    document.exitPointerLock?.();
    const d = this.difficulty;
    if (this.score > this.best[d]) {
      this.best[d] = this.score;
      localStorage.setItem(bestKey(d), String(this.best[d]));
    }
    this.hud.setGameVisible(false);
    this.hud.screens.death({
      diffLabel: difficulty.label, waves: this.waves.wave, kills: this.kills, score: this.score,
      best: this.best[d], touch: this.touch.enabled,
      onMainMenu: () => this.quitToMenu(),
      onBackdrop: () => this.startRun(),
    });
  }

  /**
   * Back to the title screen, from the pause or the death screen. A run quit
   * from the pause screen is abandoned, not scored:
   * the best score is only ever set by dying.
   */
  quitToMenu() {
    if (this.state !== 'paused' && this.state !== 'dead') return;
    this.waves.stop();
    this.enemies.clear();
    this.grenades.live.length = 0;
    this.grenades.mesh.count = 0;
    this.pickups.reset();
    this.wrapT = 0;
    this.touch.clear();
    document.exitPointerLock?.();
    this.showMenu();
  }

  /**
   * Tell a touchpad player why their gun may be firing by itself — once.
   *
   * With tap-to-click on, the OS turns a light touch on the pad into a left
   * click, and with tap-and-drag on it holds the button down for the whole of
   * the next slide. Aiming on a touchpad is exactly that motion, so the rifle
   * fires while you only aim. The page receives the same mousedown a physical
   * click sends, so the game cannot filter it without eating real shots; what
   * it can do is say so. Scrolling is the one thing that gives a touchpad away
   * (see Input._onWheel), and the tip waits until the opening grapple tip has
   * had its turn.
   */
  touchpadTip() {
    if (this.touchpadTipShown || !this.ctx.input.touchpadSuspected || this.runT < 7) return;
    this.touchpadTipShown = true;
    this.hud.tip(['on a touchpad? a gun firing on its own is usually ', EM('tap-to-click'), ' — turn it off'], 7);
  }

  // --- loadout --------------------------------------------------------------

  selectWeapon(i) {
    if (this.weapons[i].hidden) return;
    if (i === this.heldSlot && this.weapons[i].root.visible) return;
    this.cancelWrap();
    this.weapons[this.heldSlot].holster();
    if (this.heldSlot !== i && !this.weapons[this.heldSlot].hidden) this.lastIndex = this.heldSlot;
    this.heldSlot = i;
    this.weapons[i].equip();
    this.audio.swap();
  }

  cycleWeapon(dir) {
    const n = this.weapons.length;
    let i = this.heldSlot;
    do { i = (i + dir + n) % n; } while (this.weapons[i].hidden && i !== this.heldSlot);
    this.selectWeapon(i);
  }

  get weapon() { return this.weapons[this.heldSlot]; }

  /** Every body walking the desk, for the toys to carry and push. */
  walkers(withPlayer) {
    const out = this._walkers || (this._walkers = []);
    out.length = 0;
    if (withPlayer && this.ctx.player.alive) out.push(this.ctx.player.body);
    // dead field `flying` dropped: nothing ever set it, so this always ran
    for (const e of this.enemies.list) if (e.alive) out.push(e.body);
    return out;
  }

  // --- carrying -----------------------------------------------------------------

  /** Walked over an item: take it if there is room. */
  take(item) {
    if (this.state !== 'playing') return false;
    if (item === 'stapler') {
      // 30 staples, up to 60 carried, and it is in your hand the first time
      const s = this.stapler;
      if (s.mag >= s.stats.ammo.carry) return false;
      const first = s.hidden;
      s.mag = Math.min(s.stats.ammo.carry, s.mag + ITEMS.stapler.staples);
      s.hidden = false;
      this.audio.reloadShell();
      this.hud.kill('picked up the staple gun');
      if (first) {
        this.selectWeapon(4);
        this.hud.tip([EM('5'), ' swaps to the staple gun — no reserve once it runs dry'], 4);
      }
      return true;
    }
    if (item !== 'bandage') return false;
    if (this.bandages >= ITEMS.bandage.max) return false;
    this.bandages++;
    this.audio.reloadShell();
    this.hud.kill('picked up a bandage');
    if (!this.bandageTip) {
      this.bandageTip = true;
      this.hud.tip(this.touch.enabled
        ? [EM('WRAP'), ' puts a bandage on']
        : ['press ', EM(this.ctx.input.key('heal')), ' to wrap it on'], 4);
    }
    return true;
  }

  /**
   * A bandage takes ITEMS.bandage.wrap seconds to put on, with the weapon down.
   * Firing or swapping stops it and keeps the bandage: it is a decision to
   * make out of the line of fire, not a button to press in the middle of it.
   */
  startWrap() {
    const p = this.ctx.player;
    if (this.wrapT > 0 || this.bandages <= 0 || !p.alive || p.hp >= p.maxHp) return;
    this.wrapT = ITEMS.bandage.wrap;
    this.audio.reload();
  }

  cancelWrap() { this.wrapT = 0; }

  updateWrap(dt, input) {
    if (this.wrapT <= 0) return;
    if (input.fire || input.pressed('melee') || input.pressed('grenade')) { this.cancelWrap(); return; }
    this.wrapT -= dt;
    if (this.wrapT > 0) return;
    const p = this.ctx.player;
    this.wrapT = 0;
    this.bandages--;
    p.hp = Math.min(p.maxHp, p.hp + ITEMS.bandage.heal);
    this.hud.kill(`wrapped: +${ITEMS.bandage.heal} hp`);
    this.audio.swap();
  }

  // --- frame ----------------------------------------------------------------

  update(realDt) {
    const ctx = this.ctx;
    const input = ctx.input;
    const p = ctx.player;

    if (input.pressed('pause')) {
      if (this.state === 'playing') this.pause();
      // Not the same Esc that just paused by releasing the lock, in a browser
      // that does let the key through as well.
      else if (this.state === 'paused' && performance.now() - this.pausedAt > 250) this.resume();
    }
    if (this.state === 'dead' && input.pressed('jump')) this.startRun();

    this.touch.update();

    // hitstop scales game time but not the effects that report it
    const scale = this.effects.timeScale(realDt);
    const dt = realDt * scale;

    if (this.state === 'playing') {
      for (let i = 0; i < 5; i++) if (input.pressed(`slot${i + 1}`)) this.selectWeapon(i);
      // the staple gun is gone once it is empty: back to what you had before
      if (this.weapon === this.stapler && this.stapler.mag <= 0 && this.stapler.cooldown <= 0) {
        this.stapler.hidden = true;
        this.selectWeapon(this.lastIndex);
      }
      if (input.wheel) this.cycleWeapon(input.wheel > 0 ? 1 : -1);

      if (input.pressed('heal')) this.startWrap();
      this.updateWrap(dt, input);
      for (const w of this.weapons) w.lowered = this.wrapT > 0;

      this.toys?.update(dt, ctx.level, this.walkers(true));
      p.update(dt, input);
      this.weapon.update(dt, input);
      // After the weapon, because the weapon owns how far into the aim it is.
      p.setFov(this.applyFov(p.baseFov));
      p.lookScale = this.lookScale();
      this.grenades.update(dt, input);
      this.enemies.update(dt);
      this.waves.update(dt);
      this.pickups.update(dt, p);
      this.planes.update(dt);

      this.chainClock -= realDt;
      if (this.chainClock <= 0) this.combo = 1;

      this.runT += realDt;
      this.touchpadTip();

      if (!p.alive) this.die();
      this.updateHud();
    } else {
      // The world keeps drawing behind the menu, so the page is never static.
      // Not behind the pause screen: enemies left running there kept shooting,
      // and a six-second pause with five alive took HP from 120 to 8. Losing
      // the mouse pauses, so an alt-tab did that.
      if (this.state !== 'paused') {
        // a capture tool that pins the camera wants the same frame every
        // time: the toys hold their starting pose for it
        if (!this.pinned) {
          this.toys?.update(Math.min(dt, 0.05), ctx.level, this.walkers(false));
          this.planes.update(Math.min(dt, 0.05));
        }
        this.enemies.update(Math.min(dt, 0.02));
      }
      // Nothing ticks the weapon here, so a sniper scoped at the moment you
      // died or paused would leave the FOV pinned at 22 degrees behind the
      // panel. Let the zoom fall away instead of freezing it.
      p.setFov(ease(ctx.camera.fov, MOVE.baseFov, 12, Math.min(dt, 0.05)));
      p.lookScale = 1;
      // On the title screen the camera flies through the desk (world/flight.js),
      // with nothing in its hands. A capture tool that pins the camera to a
      // named pose sets `pinned`, and the flight leaves it where it is.
      if (this.state === 'menu' && this.flight && !this.pinned) {
        this.flight.update(Math.min(realDt, 0.05), ctx.camera);
        this.weapon.root.visible = false;
      }
    }

    // Visual decay on the held weapon runs in EVERY state and on real time —
    // see WeaponBase.tickFx. Putting it inside the `playing` branch is what
    // froze the muzzle flash on the death screen.
    this.weapon?.tickFx(realDt, this.state === 'playing');
    this.effects.update(dt, realDt);
    const intensity = clamp(this.enemies.alive / 8, 0, 1);
    this.audio.updateMusic(realDt, this.state === 'playing' ? intensity : 0);

    // the camera shake is applied after the player has placed the camera
    ctx.camera.position.add(this.effects.shakeOffset);

    return {
      hurt: this.effects.hurt,
      flash: this.effects.flash,
      slow: this.effects.slow,
      nearDeath: this.state === 'playing' && p.hp < p.maxHp * 0.3 ? 1 : 0,
    };
  }

  updateHud() {
    const hud = this.hud;
    const p = this.ctx.player;
    const w = this.weapon;
    hud.showScore(this.score);
    hud.setCombo(this.combo);
    hud.setLeft(this.waves.remaining);
    hud.showHealth(p.hp, p.maxHp);
    hud.showAmmo(w.firesRounds ? w.mag : Infinity, w.firesRounds ? w.reserveLeft : 0, w.firesRounds && w.reloading > 0);
    hud.setNades(this.grenades.count);
    hud.setBandages(this.bandages);
    hud.setWrap(this.wrapT > 0 ? 1 - this.wrapT / ITEMS.bandage.wrap : -1);
    this.touch.setHeal(this.bandages > 0);
    // the eye: open while anything is hunting you
    hud.setEye(this.enemies.hunters > 0);
    const pips = [];
    for (const e of this.enemies.pips) {
      _v.copy(e.center).sub(p.center);
      pips.push(p.yaw + Math.atan2(_v.x, -_v.z));      // same convention as showHurtFrom, see onPlayerHit
    }
    hud.setPips(pips);
    hud.setTally(this.kills);
    hud.showSlots(this.weapons, this.heldSlot);
    hud.showSpread(
      w.firesRounds ? w.spreadLive : 0.02,
      THREE.MathUtils.degToRad(this.ctx.camera.fov),
      window.innerHeight,
      !w.firesRounds,
      w.firesRounds && w.scoped,
    );
    hud.showScope(w.firesRounds && w.scoped);
    hud.setGrapple(p.grapple.targetValid, p.grapple.stam);
    hud.setFocus(w instanceof Katana ? w.focus : -1, w instanceof Katana && w.focusReady);
    hud.setGuard(w instanceof Katana ? w.guard : -1, w instanceof Katana && (w.brokenT > 0 || w.mustRelease));

    const boss = this.enemies.list.find((e) => e.alive && e.t.role?.boss);
    hud.showBoss(boss ? boss.t.name : '', boss ? boss.hp / boss.maxHp : null);
  }

  /**
   * ADS pulls the FOV in; the weapon owns how far.
   *
   * This is the other half of the ADS pose. A narrower FOV magnifies the
   * viewmodel along with the world, which is the only way a gun can read large
   * on the crosshair while staying physically far enough from the eye not to
   * clip through the near plane — see the aimZ note in weapons/index.js.
   *
   * At full aim the result is exactly `sightFov`: the speed term and the per-shot
   * zoomPunch blend out as you settle into the sights, so the zoom is a number
   * you can trust rather than something that punches on every round. Both come
   * back as you lower the weapon.
   */
  applyFov(baseFov) {
    const w = this.weapon;
    if (!w.firesRounds) return baseFov;
    return baseFov + (w.stats.aiming.sightFov - baseFov) * w.aimMix;
  }

  /**
   * Mouse gain at the current zoom, as a multiplier on the look delta.
   *
   * The tangent ratio, not the FOV ratio: it is what the projection actually
   * does, so a given mouse travel moves the same number of *pixels* at every
   * zoom level. Driven off sightFov rather than the live camera FOV so that the
   * speed term and the recoil kick do not tug at your aim.
   */
  lookScale() {
    const w = this.weapon;
    if (!w.firesRounds || w.aimMix <= 0) return 1;
    const fov = MOVE.baseFov + (w.stats.aiming.sightFov - MOVE.baseFov) * w.aimMix;
    return Math.tan(THREE.MathUtils.degToRad(fov) / 2) / Math.tan(THREE.MathUtils.degToRad(MOVE.baseFov) / 2);
  }
}
