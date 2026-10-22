// Touch controls.
//
// The project spec requires entry level phones and touch devices. The layout is the one that works on a phone
// without a tutorial: left thumb drives a floating stick that appears wherever
// you first press, right thumb is a look-pad anywhere on the right half, and a
// short tap on the right half is a shot. Holding fire is its own button, INK,
// in the bottom-right corner, with what else a fight needs on an arc round it.
//
// It writes the same named-action state the keyboard uses, and its own trigger
// flag (`input.fireBy.touch`), so nothing downstream knows or cares which device
// is driving — and a mouse or pad on the same machine keeps working alongside.

// Where the buttons are, in CSS px from the screen's edges.
//
// The right thumb rests on INK. DUCK, UP, JET and BLAST sit on an arc round it,
// evenly spaced, so none is a stretch past another; JET is next to UP, as you
// jump and then fly. The ones pressed now and then (LOAD, NEXT, WRAP) are a row
// of small ones along the top edge, where they take nothing from the look pad.
// All eight were once in the bottom-right corner, and in a landscape phone they
// filled 80% of its height and sat on the weapon's name and slot list.
//
// The left thumb has the stick, and a second INK at the top left that only holds
// the trigger: the stick and the right INK walk and shoot, the left INK and the
// look pad aim and shoot.
const INK_AT = { right: 14, bottom: 10, size: 92 };
// From INK's centre: 180 degrees is straight left, 90 straight up.
const ARC = { radius: 118, size: 60, from: 180, to: 80 };
const ON_ARC = [
  { a: 'crouch', label: 'DUCK' },
  { a: 'jump', label: 'UP' },
  { a: 'jet', label: 'JET' },
  { a: 'grenade', label: 'BLAST' },
];
// From the top-right corner leftwards, at the 44 px floor tools/touch.mjs checks.
const ROW = { right: 14, top: 10, size: 44, gap: 8 };
const ON_ROW = [
  { a: 'reload', label: 'LOAD' },
  { swap: true, label: 'NEXT' },
  { a: 'heal', label: 'WRAP', cls: 'theal' },      // only while you carry a bandage
];
// Under the score (hud.css moves the blade gauge clear of it).
const LEFT_INK = { left: 16, top: 84, size: 76 };

const px = (o) => Object.entries(o).map(([k, v]) => `${k}:${Math.round(v)}px`).join(';');
const square = (size) => ({ width: size, height: size });

function arcAt(i) {
  const deg = ARC.from + ((ARC.to - ARC.from) * i) / (ON_ARC.length - 1);
  const t = (deg * Math.PI) / 180;
  const half = INK_AT.size / 2, s = ARC.size / 2;
  return {
    right: INK_AT.right + half - Math.cos(t) * ARC.radius - s,
    bottom: INK_AT.bottom + half + Math.sin(t) * ARC.radius - s,
    ...square(ARC.size),
  };
}

const rowAt = (i) => ({ right: ROW.right + i * (ROW.size + ROW.gap), top: ROW.top, ...square(ROW.size) });

function button(b, at, small = false) {
  const what = b.swap ? 'data-swap="1"' : `data-a="${b.a}"`;
  return `<button class="tbtn${small ? ' tsmall' : ''}${b.cls ? ` ${b.cls}` : ''}" ${what} style="${px(at)}">${b.label}</button>`;
}

// Look speed, in mouse pixels per screen pixel of thumb travel.
const LOOK_GAIN = 1.6;
// A touch on the look pad that ends inside both of these is a tap, and a tap is
// one shot.
const TAP_MS = 250;
const TAP_TRAVEL = 14;
// How long one tap holds the trigger. Long enough to be seen by the next frame
// at any frame rate the game supports.
const PULSE_MS = 110;

export class TouchControls {
  constructor(input, root) {
    this.input = input;
    this.root = root;
    this.enabled = false;
    // A phone or tablet: its main pointer is a finger, so the layer stays on.
    // Anything else (a touchscreen laptop) gets the layer only while it is being
    // touched — see _bind.
    this.coarse = matchMedia('(pointer: coarse)').matches;
    this.el = document.createElement('div');
    this.el.className = 'touch';
    this.el.innerHTML = `
      <div class="tstick" id="tStick"><i></i></div>
      <button class="tbtn tfire" data-fire="aim" style="${px({ right: INK_AT.right, bottom: INK_AT.bottom, ...square(INK_AT.size) })}">INK</button>
      <button class="tbtn tfire" data-fire="hold" style="${px({ left: LEFT_INK.left, top: LEFT_INK.top, ...square(LEFT_INK.size) })}">INK</button>
      ${ON_ARC.map((b, i) => button(b, arcAt(i))).join('')}
      ${ON_ROW.map((b, i) => button(b, rowAt(i), true)).join('')}
    `;
    root.appendChild(this.el);
    this.stick = this.el.querySelector('#tStick');
    this.knob = this.stick.firstElementChild;

    this.moveId = null;
    this.lookId = null;
    // Each INK: the finger on it, and where it last was. The right one aims as
    // it is dragged; the left one only holds the trigger.
    this.triggers = { aim: { id: null, x: 0, y: 0 }, hold: { id: null, x: 0, y: 0 } };
    this.origin = { x: 0, y: 0 };
    this.lookLast = { x: 0, y: 0 };
    this.lookMoved = 0;
    this.lookStart = 0;
    this.fireUntil = 0;
    this.onSwap = null;

    this._bind();
  }

  /**
   * On from the start only where a finger is the main pointer.
   *
   * This used to also say `navigator.maxTouchPoints > 1`, which is true of every
   * touchscreen laptop — so a laptop played with its mouse got thumb buttons
   * over the game, START stopped taking pointer lock, and (before the trigger
   * flags were split per device) the mouse could not fire at all.
   */
  static shouldEnable() {
    return matchMedia('(pointer: coarse)').matches;
  }

  enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.el.classList.add('on');
    // Lets the HUD (hud.css) move furniture that would otherwise sit under
    // the thumb-button cluster — the weapon name, hint and slot list, in
    // particular — clear of it while the buttons are up.
    this.root.classList.add('ir-touch');
    this.input.note('touch layer on');
  }

  disable() {
    if (!this.enabled) return;
    this.enabled = false;
    this.el.classList.remove('on');
    this.root.classList.remove('ir-touch');
    this.clear();
    this.input.note('touch layer off');
  }

  /** HEAL is only there while you carry a bandage. */
  setHeal(on) {
    if (this._heal === on) return;
    this._heal = on;
    this.el.classList.toggle('heal', on);
  }

  /** Let go of everything the touch layer is holding, and nothing else. */
  clear() {
    const s = this.input.state;
    if (this.moveId !== null) s.forward = s.back = s.left = s.right = s.sprint = false;
    for (const b of this.el.querySelectorAll('.tbtn.down')) {
      if (b.dataset.a) s[b.dataset.a] = false;
      b.classList.remove('down');
    }
    this.input.fireBy.touch = false;
    this.fireUntil = 0;
    this.moveId = this.lookId = this.triggers.aim.id = this.triggers.hold.id = null;
    this.knob.style.transform = '';
    this.stick.classList.remove('on');
  }

  _bind() {
    for (const btn of this.el.querySelectorAll('.tbtn')) {
      const act = btn.dataset.a;
      const fire = btn.dataset.fire;
      const press = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.dataset.swap) { this.onSwap?.(); return; }
        btn.classList.add('down');
        if (fire) { this._fireDown(e, fire); return; }
        this.input.state[act] = true;
      };
      const release = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (fire && !this._fireUp(e, fire)) return;
        if (act) this.input.state[act] = false;
        btn.classList.remove('down');
      };
      btn.addEventListener('touchstart', press, { passive: false });
      btn.addEventListener('touchend', release, { passive: false });
      btn.addEventListener('touchcancel', release, { passive: false });
      // A drag that starts on the right INK aims as well: one thumb cannot hold
      // the trigger on one spot and track a target somewhere else. A drag on the
      // left one does nothing: the right thumb is turning.
      if (fire === 'aim') btn.addEventListener('touchmove', (e) => { e.preventDefault(); this._fireMove(e); }, { passive: false });
      else if (fire) btn.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    }

    // A touchscreen laptop shows the layer when it is touched, and hides it
    // again when the mouse or touchpad moves with no finger down. Pointer
    // events, not mouse events: a finger also produces compatibility mouse
    // events, but its pointer events say `touch`.
    document.addEventListener('touchstart', () => this.enable(), { passive: true, capture: true });
    addEventListener('pointermove', (e) => {
      if (this.coarse || !this.enabled || e.pointerType !== 'mouse') return;
      if (this.moveId !== null || this.lookId !== null || this.firing()) return;
      this.disable();
    }, { passive: true });

    const target = document.getElementById('c');
    target.addEventListener('touchstart', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.clientX < innerWidth * 0.45 && this.moveId === null) {
          this.moveId = t.identifier;
          this.origin.x = t.clientX;
          this.origin.y = t.clientY;
          this.stick.style.left = `${t.clientX}px`;
          this.stick.style.top = `${t.clientY}px`;
          this.stick.classList.add('on');
          this.input.note('touch stick down');
        } else if (this.lookId === null) {
          this.lookId = t.identifier;
          this.lookLast.x = t.clientX;
          this.lookLast.y = t.clientY;
          this.lookMoved = 0;
          this.lookStart = performance.now();
          this.input.note('touch look down');
        }
      }
    }, { passive: true });

    target.addEventListener('touchmove', (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this.moveId) {
          const dx = t.clientX - this.origin.x;
          const dy = t.clientY - this.origin.y;
          const len = Math.hypot(dx, dy);
          const max = 58;
          const k = len > max ? max / len : 1;
          this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
          const nx = (dx * k) / max, ny = (dy * k) / max;
          const s = this.input.state;
          s.forward = ny < -0.25;
          s.back = ny > 0.25;
          s.left = nx < -0.25;
          s.right = nx > 0.25;
          // push the stick past three quarters and you are sprinting: no button
          s.sprint = ny < -0.72;
        } else if (t.identifier === this.lookId) {
          const dx = t.clientX - this.lookLast.x;
          const dy = t.clientY - this.lookLast.y;
          this.lookLast.x = t.clientX;
          this.lookLast.y = t.clientY;
          this.lookMoved += Math.abs(dx) + Math.abs(dy);
          // feed the same accumulator the mouse writes to
          this.input.mouse.dx += dx * LOOK_GAIN;
          this.input.mouse.dy += dy * LOOK_GAIN;
        }
      }
    }, { passive: true });

    const end = (e) => {
      if (!this.enabled) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this.moveId) {
          this.moveId = null;
          this.knob.style.transform = '';
          this.stick.classList.remove('on');
          const s = this.input.state;
          s.forward = s.back = s.left = s.right = s.sprint = false;
        } else if (t.identifier === this.lookId) {
          // A tap that did not travel is a shot; a drag is aiming, and ONLY
          // aiming. A deadline, not a timeout that pokes the flag directly:
          // update() runs every frame and owns it.
          const held = performance.now() - this.lookStart;
          const quick = held < TAP_MS && this.lookMoved < TAP_TRAVEL;
          if (quick) this.fireUntil = performance.now() + PULSE_MS;
          this.input.note(`touch look up after ${Math.round(held)} ms${quick ? ' (tap: fire)' : ''}`);
          this.lookId = null;
        }
      }
    };
    target.addEventListener('touchend', end, { passive: true });
    target.addEventListener('touchcancel', end, { passive: true });
  }

  /** Is a finger on either INK? */
  firing() { return this.triggers.aim.id !== null || this.triggers.hold.id !== null; }

  _fireDown(e, which) {
    const t = e.changedTouches[0];
    const trig = this.triggers[which];
    if (!t || trig.id !== null) return;
    trig.id = t.identifier;
    trig.x = t.clientX;
    trig.y = t.clientY;
    // a tap on FIRE shorter than a frame still gets its shot
    this.fireUntil = Math.max(this.fireUntil, performance.now() + PULSE_MS);
    this.input.note(`touch ${which === 'aim' ? '' : 'left '}FIRE down`);
  }

  _fireMove(e) {
    const trig = this.triggers.aim;
    for (const t of e.changedTouches) {
      if (t.identifier !== trig.id) continue;
      this.input.mouse.dx += (t.clientX - trig.x) * LOOK_GAIN;
      this.input.mouse.dy += (t.clientY - trig.y) * LOOK_GAIN;
      trig.x = t.clientX;
      trig.y = t.clientY;
    }
  }

  /** @returns {boolean} whether the finger that lifted was the one holding this INK */
  _fireUp(e, which) {
    const trig = this.triggers[which];
    for (const t of e.changedTouches) {
      if (t.identifier !== trig.id) continue;
      trig.id = null;
      this.input.note(`touch ${which === 'aim' ? '' : 'left '}FIRE up`);
      return true;
    }
    return false;
  }

  /**
   * The touch layer's trigger: either INK held, or the tail of a tap.
   *
   * This used to also fire whenever the look-pad touch had been down for more
   * than 260 ms, meant for "holding the right thumb still". Nothing checked
   * still, so every aim longer than a quarter of a second pulled the trigger:
   * a two-second aim fired twenty rifle rounds. `tools/touch.mjs` never saw it
   * because its look drag was 220 ms long.
   */
  update() {
    if (!this.enabled) { this.input.fireBy.touch = false; return; }
    this.input.fireBy.touch = this.firing() || performance.now() < this.fireUntil;
  }
}
