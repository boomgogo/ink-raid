import * as THREE from 'three';
import { raycast } from '../core/physics.js';
import { surface } from '../render/surface.js';
import { INK, LOOK } from '../render/palette.js';
import { clamp, ease } from '../core/spring.js';

// The grapple. Tap to fire, hold to reel in, jump to launch off it.
//
// It is a spring, not a rope: pulling toward the anchor with a spring and
// damping the radial velocity gives you a swing you can steer, where a hard
// distance constraint gives you a pendulum that fights the player. Stamina is
// what stops it becoming the only way anyone moves.

export const GRAPPLE = {
  range: 42,
  // The constant tug has to beat gravity outright, or hooking something above
  // you while standing does nothing at all and the grapple is only usable as a
  // mid-air nudge. 60 against gravity's 34 gives a real yank off the floor.
  pull: 60,
  spring: 55,           // extra pull per metre the rope is stretched
  maxSpeed: 30,         // stop the tug adding speed past this
  radialDamp: 2.6,
  reel: 16,             // rope shortens this fast while the button is held
  minLen: 3.5,
  launch: 8.4,          // upward kick when you jump off
  stamMax: 1,
  stamDrain: 0.42,      // per second while attached
  stamRegen: 0.34,
  staminaWait: 0.5,       // beat before regen starts
};

const _dir = new THREE.Vector3();
const _to = new THREE.Vector3();
const _v = new THREE.Vector3();

export class Grapple {
  constructor(ctx, player) {
    this.ctx = ctx;
    this.player = player;
    this.attached = false;
    this.point = new THREE.Vector3();
    this.len = 0;
    this.stam = GRAPPLE.stamMax;
    this.staminaWait = 0;
    this.targetValid = 0;      // 0 none, 1 in range, 2 attached — for the HUD

    // the rope: one thin box scaled along its length each frame, so it costs a
    // single draw call and picks up the ink pass like everything else
    const g = new THREE.BoxGeometry(0.055, 0.055, 1);
    g.translate(0, 0, -0.5);
    this.rope = new THREE.Mesh(g, surface({ ink: INK.BLACK, look: LOOK.SOLID }));
    this.rope.visible = false;
    this.rope.frustumCulled = false;
    ctx.scene.add(this.rope);
  }

  /** Where the rope would attach if fired right now, or null. */
  probe() {
    const p = this.player;
    _dir.set(0, 0, -1).applyEuler(p.camera.rotation).normalize();
    const hit = raycast(this.ctx.level, p.eye, _dir, GRAPPLE.range);
    return hit && hit.box.tag !== 'desk' ? hit : null;
  }

  fire() {
    if (this.stam < 0.12) return false;
    const hit = this.probe();
    if (!hit) return false;
    this.attached = true;
    this.point.copy(hit.point);
    this.len = Math.max(GRAPPLE.minLen, hit.dist);
    this.rope.visible = true;
    return true;
  }

  detach() {
    this.attached = false;
    this.rope.visible = false;
    this.staminaWait = GRAPPLE.staminaWait;
  }

  launch() {
    if (!this.attached) return;
    const b = this.player.body;
    b.vel.y = Math.max(b.vel.y, 0) + GRAPPLE.launch;
    this.detach();
    this.player.feel.punch.kick(-9);
  }

  update(dt, input) {
    const p = this.player;
    const b = p.body;

    if (input.pressed('grapple')) {
      if (this.attached) this.detach();
      else this.fire();
    }

    if (this.attached) {
      this.stam = Math.max(0, this.stam - GRAPPLE.stamDrain * dt);
      if (this.stam <= 0) this.detach();
    } else {
      this.staminaWait = Math.max(0, this.staminaWait - dt);
      if (this.staminaWait <= 0) this.stam = Math.min(GRAPPLE.stamMax, this.stam + GRAPPLE.stamRegen * dt);
    }

    if (this.attached) {
      _to.copy(this.point).sub(p.eye);
      const dist = _to.length();
      if (dist > GRAPPLE.range * 1.4) { this.detach(); }
      else {
        _to.multiplyScalar(1 / Math.max(1e-5, dist));
        // reel in while the button is held
        if (input.down('grapple')) this.len = Math.max(GRAPPLE.minLen, this.len - GRAPPLE.reel * dt);
        // a constant tug so it always feels like it is pulling, plus a spring
        // once the rope goes taut
        const stretch = Math.max(0, dist - this.len);
        const pull = GRAPPLE.pull + GRAPPLE.spring * stretch;
        // ... but stop adding speed once you are already going that fast toward
        // the anchor, or a long rope turns into a slingshot with no top end
        const along = _v.copy(b.vel).dot(_to);
        if (along < GRAPPLE.maxSpeed) b.vel.addScaledVector(_to, pull * dt);
        // damp motion ALONG the rope only; motion across it is the swing
        const radial = _v.copy(b.vel).dot(_to);
        if (radial < 0) b.vel.addScaledVector(_to, -radial * clamp(GRAPPLE.radialDamp * dt, 0, 1));
        b.onGround = false;
      }
    }

    // rope visual
    if (this.attached) {
      const from = p.camera.position;
      const d = _v.copy(this.point).sub(from);
      const len = d.length();
      this.rope.position.copy(from);
      this.rope.lookAt(this.point);
      this.rope.scale.set(1, 1, len);
      this.targetValid = 2;
    } else {
      this.targetValid = this.probe() ? 1 : 0;
    }

    this.stamShown = ease(this.stamShown ?? this.stam, this.stam, 12, dt);
  }
}
