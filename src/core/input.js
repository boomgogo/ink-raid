// Keyboard, mouse, pointer lock and gamepad. Actions are named, not keyed, so
// the HUD can print the binding and a rebind screen has somewhere to write —
// and so a pad can drive the same actions without anything downstream knowing
// there is a pad.

export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  crouch: ['KeyC', 'ControlLeft'],
  grapple: ['KeyQ', 'KeyE'],
  reload: ['KeyR'],
  melee: ['KeyF'],
  grenade: ['KeyG'],
  heal: ['KeyH'],
  slot1: ['Digit1'], slot2: ['Digit2'], slot3: ['Digit3'], slot4: ['Digit4'], slot5: ['Digit5'],
  pause: ['Escape'],
};

const LABEL = {
  KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyC: 'C', KeyQ: 'Q', KeyE: 'E',
  KeyR: 'R', KeyF: 'F', KeyG: 'G', KeyH: 'H', Space: 'Space', ShiftLeft: 'Shift',
  ControlLeft: 'Ctrl', Escape: 'Esc',
};

// Mouse look gain, derived from a target feel rather than kept as a bare
// literal: at sens 100, a 100 px flick should turn the view by about
// DEG_PER_100PX_AT_SENS100 degrees: quick enough to turn round in a short
// swipe on a laptop pad, slow enough to hold a head at forty metres.
const DEG_PER_100PX_AT_SENS100 = 13.7;
const LOOK_GAIN = DEG_PER_100PX_AT_SENS100 * (Math.PI / 180) / 100;

// How far one wheel step has to travel, in pixels, before it swaps a weapon.
// A mouse notch is 50-120 px in every browser; a touchpad scroll is a stream of
// events a few pixels each.
const WHEEL_STEP = 40;
// A touchpad gesture is over once the stream has been quiet for this long.
const GESTURE_GAP = 150;

export class Input {
  constructor(canvas, settings = {}) {
    this.canvas = canvas;
    this.sens = settings.sens ?? 100;
    this.invert = !!settings.invert;
    this.state = {};
    this.prev = {};
    this.mouse = { dx: 0, dy: 0 };
    // One trigger and one aim flag PER DEVICE, and `fire` / `aim` are any of
    // them. They used to be a single flag each that every device wrote, so the
    // touch layer — which writes its state every frame — overwrote the mouse
    // and the pad on any machine where it was switched on: a touchscreen laptop
    // could not fire with its mouse at all. `script` is what tools and the
    // `fire` / `aim` setters write.
    this.fireBy = { mouse: false, pad: false, touch: false, script: false };
    this.aimBy = { mouse: false, pad: false, touch: false, script: false };
    this.prevFire = false;
    this.locked = false;
    this.wheel = 0;
    this._wheelAcc = 0;
    this._wheelT = -1e9;
    this._gestureSteps = 0;
    this._gestureStream = false;
    // Set the first time the wheel behaves like a touchpad (see _onWheel). The
    // page cannot tell a touchpad TAP from a click — the OS sends both as the
    // same left-button press — so this is the only hint it ever gets that the
    // player may be on one.
    this.touchpadSuspected = false;
    // Raw event log for ?debug=input; null unless something asks for it.
    this.log = null;
    this._downT = {};
    // Called with the new state when pointer lock is actually gained or lost —
    // not when a request fails, which changes nothing.
    this.onPointerLock = null;

    // --- gamepad ---
    // Polled, not evented: the Gamepad API gives no events for stick or trigger
    // movement, only for connect/disconnect, so the state has to be read every
    // frame. `padLook` accumulates alongside the mouse delta, so look() does not
    // care which device produced the motion.
    this.pad = { index: -1, active: false };
    this.padLook = { dx: 0, dy: 0 };
    this._padPrev = {};
    addEventListener('gamepadconnected', (e) => { this.pad.index = e.gamepad.index; });
    addEventListener('gamepaddisconnected', (e) => {
      if (this.pad.index === e.gamepad.index) { this.pad.index = -1; this.pad.active = false; }
    });

    this._codeToAction = new Map();
    for (const [action, codes] of Object.entries(BINDINGS))
      for (const c of codes) this._codeToAction.set(c, action);

    addEventListener('keydown', (e) => {
      const a = this._codeToAction.get(e.code);
      if (a) { this.state[a] = true; if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); }
    });
    addEventListener('keyup', (e) => {
      const a = this._codeToAction.get(e.code);
      if (a) this.state[a] = false;
    });

    // Losing focus mid-key leaves the key stuck down forever, which reads as a
    // wandering player when you tab back in.
    const clear = () => {
      for (const k in this.state) this.state[k] = false;
      for (const k in this.fireBy) this.fireBy[k] = false;
      for (const k in this.aimBy) this.aimBy[k] = false;
    };
    addEventListener('blur', clear);
    addEventListener('visibilitychange', () => { if (document.hidden) clear(); });

    canvas.addEventListener('mousedown', (e) => {
      if (this.log) {
        this._downT[e.button] = performance.now();
        this.note(`mousedown b${e.button}${this.locked ? '' : ' (takes pointer lock, no shot)'}`);
      }
      if (!this.locked) {
        // Can reject when the document is not focused; a rejection here is not
        // actionable and must not surface as an unhandled page error.
        try {
          const r = canvas.requestPointerLock();
          if (r && typeof r.catch === 'function') r.catch(() => {});
        } catch { /* not allowed right now */ }
        return;
      }
      if (e.button === 0) this.fireBy.mouse = true;
      if (e.button === 2) this.aimBy.mouse = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireBy.mouse = false;
      if (e.button === 2) this.aimBy.mouse = false;
      if (this.log) {
        const t0 = this._downT[e.button];
        this.note(`mouseup b${e.button}${t0 ? ` held ${Math.round(performance.now() - t0)} ms` : ''}`);
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    addEventListener('wheel', (e) => this._onWheel(e), { passive: true });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) clear();
      this.note(`pointer lock ${this.locked ? 'on' : 'off'}`);
      if (was !== this.locked) this.onPointerLock?.(this.locked);
    });
  }

  get fire() { const f = this.fireBy; return f.mouse || f.pad || f.touch || f.script; }
  set fire(v) { this.fireBy.script = !!v; }
  get aim() { const a = this.aimBy; return a.mouse || a.pad || a.touch || a.script; }
  set aim(v) { this.aimBy.script = !!v; }

  /** Append a line to the ?debug=input log. Free when nobody is listening. */
  note(text) {
    if (!this.log) return;
    this.log.push({ t: performance.now(), text });
    if (this.log.length > 40) this.log.shift();
  }

  /**
   * One weapon step per wheel notch — and per touchpad GESTURE, not per event.
   *
   * This used to add Math.sign(deltaY) for every event, and the game swaps one
   * weapon in any frame that saw one. A mouse notch is one event, so that was
   * fine; a two-finger touchpad scroll is a stream of small events, one or more
   * a frame, and half a second of it swapped weapons thirty times. Two fingers
   * brushing the pad mid-fight read as the gun glitching.
   *
   * So the two are told apart by size. Events closer together than GESTURE_GAP
   * are one gesture. While every event in it looks like a notch (line or page
   * mode, or a pixel delta of WHEEL_STEP or more) it is a mouse wheel, and each
   * notch steps. The moment one small pixel delta turns up, the whole gesture is
   * a touchpad scroll: it steps once, when it has travelled WHEEL_STEP, and the
   * rest of it — including a fast flick's big deltas and the kinetic tail — does
   * nothing. A touchpad scroll starts from a standing finger, so its first
   * events are small. A fine-grained high-resolution mouse wheel lands in the
   * second group too, which costs it nothing worse than one step per spin.
   */
  _onWheel(e) {
    const now = performance.now();
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    const small = (d) => d !== 0 && Math.abs(d) < WHEEL_STEP;
    const isSmall = e.deltaMode === 0 && (small(e.deltaY) || small(e.deltaX));
    if (this.log) this.note(`wheel dy ${+e.deltaY.toFixed(1)} dx ${+e.deltaX.toFixed(1)} mode ${e.deltaMode}`);

    if (now - this._wheelT > GESTURE_GAP) {
      this._wheelAcc = 0;
      this._gestureSteps = 0;
      this._gestureStream = false;
    }
    this._wheelT = now;
    if (isSmall) {
      this._gestureStream = true;
      this.touchpadSuspected = true;
    }

    if (!this._gestureStream) {               // a mouse wheel, notch by notch
      if (px) { this.wheel += Math.sign(px); this._gestureSteps++; }
      return;
    }
    if (this._gestureSteps > 0) return;       // a touchpad gesture swaps once
    this._wheelAcc += px;
    if (Math.abs(this._wheelAcc) >= WHEEL_STEP) {
      this.wheel += Math.sign(this._wheelAcc);
      this._gestureSteps = 1;
    }
  }

  // Standard mapping: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 10 L3,
  // 12-15 dpad; axes 0/1 left stick, 2/3 right stick.
  _pollPad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = this.pad.index >= 0 ? pads[this.pad.index] : null;
    if (!pad) for (const p of pads) if (p && p.connected) { pad = p; this.pad.index = p.index; break; }
    if (!pad) { this.pad.active = this.fireBy.pad = this.aimBy.pad = false; return; }

    const btn = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    // A stick reads a little off centre at rest on most pads, so anything
    // inside the deadzone is nothing at all; outside it, rescale from zero so
    // there is no step at the boundary.
    const dead = (v, dz = 0.22) => (Math.abs(v) < dz ? 0 : (v - Math.sign(v) * dz) / (1 - dz));
    const ax = (i) => dead(pad.axes[i] ?? 0);

    const lx = ax(0), ly = ax(1);
    const rx = ax(2), ry = ax(3);
    const any = lx || ly || rx || ry || pad.buttons.some((b) => b && b.pressed);
    if (any) this.pad.active = true;
    if (!this.pad.active) return;

    // Movement is analogue but the actions are boolean, so a stick past the
    // halfway point counts as the key being held. Sprint comes free from
    // pushing the stick right to its edge, which is what it means on a pad.
    const set = (a, v) => { if (v) this.state[a] = true; else if (this._padPrev[a]) this.state[a] = false; this._padPrev[a] = v; };
    set('forward', ly < -0.4);
    set('back', ly > 0.4);
    set('left', lx < -0.4);
    set('right', lx > 0.4);
    set('sprint', Math.hypot(lx, ly) > 0.92 || btn(10));
    set('jump', btn(0));
    set('crouch', btn(1));
    set('reload', btn(2));
    set('melee', btn(3));
    set('grenade', btn(5));
    set('grapple', btn(4));
    set('pause', btn(9));
    set('heal', btn(14));                     // d-pad left
    if (btn(12) && !this._padPrev.up) this.wheel -= 1;
    if (btn(13) && !this._padPrev.down) this.wheel += 1;
    this._padPrev.up = btn(12);
    this._padPrev.down = btn(13);

    const trig = (i) => (pad.buttons[i] ? pad.buttons[i].value : 0);
    const padFire = trig(7) > 0.35;
    if (padFire !== this.fireBy.pad) this.note(`pad trigger ${padFire ? 'down' : 'up'}`);
    this.fireBy.pad = padFire;
    this.aimBy.pad = trig(6) > 0.35;

    // A cubic response gives fine aim near centre and a fast whip at the edge,
    // which is the only way a stick competes with a mouse. Frame-rate
    // independent: this is a RATE, so it is scaled by dt rather than applied per
    // frame the way a mouse delta is.
    const curve = (v) => v * v * v;
    const rate = 3.1 * (this.sens / 100) * (dt || 0.016) / LOOK_GAIN;
    this.padLook.dx = curve(rx) * rate;
    this.padLook.dy = curve(ry) * rate * (this.invert ? -1 : 1);
  }

  /** Call once per frame, after everything has read the input. */
  endFrame() {
    this.prev = { ...this.state };
    this.prevFire = this.fire;
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.padLook.dx = 0;
    this.padLook.dy = 0;
    this.wheel = 0;
  }

  /** Is `a` held right now? */
  down(a) { return this.state[a] === true; }

  /** Edge-detect against last frame's snapshot: true only the frame it changed. */
  _edge(a, from, to) { return this.down(a) === to && !!this.prev[a] === from; }
  pressed(a) { return this._edge(a, false, true); }
  released(a) { return this._edge(a, true, false); }
  triggerTapped() { return this.fire && !this.prevFire; }

  /** Look delta in radians for this frame, from whichever device moved. */
  look() {
    const gain = LOOK_GAIN * (this.sens / 100);
    const dx = this.mouse.dx + this.padLook.dx;
    const dy = this.mouse.dy + this.padLook.dy;
    return { yaw: -dx * gain, pitch: (this.invert ? 1 : -1) * dy * gain };
  }

  key(action) {
    const c = BINDINGS[action] && BINDINGS[action][0];
    return LABEL[c] || (c || '').replace(/^(Key|Digit)/, '');
  }
}
