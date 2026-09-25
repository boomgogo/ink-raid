// All sound is synthesised. Nothing is loaded, so the audio costs zero bytes of
// the load budget and nothing has to be waited for before the game can start.
//
// The palette is deliberately dry and papery rather than cinematic: short
// filtered noise bursts for anything percussive, small detuned square blips for
// UI, and a bass pulse under it all. A drawing of a gunshot, not a gunshot.

const CLAMP = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.hissBuffer = null;
    this.enabled = true;
    this.playMusic = false;
    this.volume = 0.5;
    this._musicT = 0;
    this._step = 0;
  }

  /** Must be called from a user gesture, or the context stays suspended. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    // one second of white noise, reused by every percussive sound
    const n = this.ctx.sampleRate;
    this.hissBuffer = this.ctx.createBuffer(1, n, n);
    const d = this.hissBuffer.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    this.scoreBus = this.ctx.createGain();
    this.scoreBus.gain.value = 0;
    this.scoreBus.connect(this.master);
  }

  setVolume(v) {
    this.volume = CLAMP(v, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  // --- primitives -----------------------------------------------------------

  noise({ dur = 0.1, freq = 1200, q = 1, type = 'lowpass', gain = 0.4, decay = 1, dest = null }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.t;
    const src = this.ctx.createBufferSource();
    src.buffer = this.hissBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * decay), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest || this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  tone({ freq = 440, to = null, dur = 0.12, type = 'square', gain = 0.16, delay = 0, dest = null }) {
    if (!this.ctx || !this.enabled) return;
    const t = this.t + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // --- the game -------------------------------------------------------------

  shot(kind) {
    if (kind === 'shotgun') {
      this.noise({ dur: 0.26, freq: 2600, decay: 0.08, gain: 0.5, type: 'lowpass' });
      this.tone({ freq: 130, to: 44, dur: 0.16, type: 'square', gain: 0.22 });
    } else if (kind === 'stapler') {
      // a spring and a thunk, not a bang
      this.noise({ dur: 0.05, freq: 3000, q: 4, type: 'bandpass', gain: 0.3, decay: 0.4 });
      this.tone({ freq: 180, to: 90, dur: 0.06, type: 'square', gain: 0.16 });
    } else if (kind === 'sniper') {
      this.noise({ dur: 0.42, freq: 5200, decay: 0.04, gain: 0.5 });
      this.tone({ freq: 200, to: 40, dur: 0.34, type: 'sawtooth', gain: 0.2 });
      this.noise({ dur: 0.5, freq: 900, q: 6, type: 'bandpass', gain: 0.12, decay: 0.5 });  // the tail
    } else {
      this.noise({ dur: 0.10, freq: 3400, decay: 0.12, gain: 0.34 });
      this.tone({ freq: 240, to: 80, dur: 0.07, type: 'square', gain: 0.13 });
    }
  }

  foeShot() {
    this.noise({ dur: 0.08, freq: 1800, decay: 0.2, gain: 0.13 });
  }

  impact() { this.noise({ dur: 0.06, freq: 2200, decay: 0.3, gain: 0.10 }); }

  hitmark(crit) {
    this.tone({ freq: crit ? 1500 : 1050, to: crit ? 900 : 700, dur: 0.05, type: 'square', gain: 0.13 });
  }

  kill() {
    this.tone({ freq: 900, to: 260, dur: 0.16, type: 'square', gain: 0.16 });
    this.noise({ dur: 0.2, freq: 1400, decay: 0.2, gain: 0.16 });
  }

  swing() { this.noise({ dur: 0.14, freq: 900, q: 4, type: 'bandpass', gain: 0.2, decay: 3 }); }

  bladeStrike() {
    this.tone({ freq: 2100, to: 1200, dur: 0.12, type: 'triangle', gain: 0.2 });
    this.noise({ dur: 0.14, freq: 3200, decay: 0.2, gain: 0.22 });
  }

  explosion() {
    this.noise({ dur: 0.7, freq: 1400, decay: 0.05, gain: 0.55 });
    this.tone({ freq: 90, to: 28, dur: 0.5, type: 'sawtooth', gain: 0.3 });
  }

  throwNade() { this.noise({ dur: 0.12, freq: 700, q: 3, type: 'bandpass', gain: 0.14, decay: 2 }); }

  playerHurt() {
    this.tone({ freq: 160, to: 90, dur: 0.18, type: 'sawtooth', gain: 0.2 });
    this.noise({ dur: 0.16, freq: 700, decay: 0.4, gain: 0.16 });
  }

  step(speed) {
    this.noise({ dur: 0.05, freq: 500 + speed * 40, q: 2, type: 'bandpass', gain: 0.05, decay: 0.6 });
  }

  land(impact) {
    this.noise({ dur: 0.12, freq: 400 + impact * 500, q: 1.5, type: 'lowpass', gain: 0.06 + impact * 0.16 });
  }

  reload() {
    this.tone({ freq: 320, dur: 0.05, type: 'square', gain: 0.1 });
    this.tone({ freq: 220, dur: 0.06, type: 'square', gain: 0.1, delay: 0.12 });
  }

  // One shell into the tube. Shorter and drier than a magazine reload, and it
  // fires once per shell, so a pump reload is heard as a run of clicks.
  reloadShell() {
    this.noise({ dur: 0.045, freq: 1800, q: 3, type: 'bandpass', gain: 0.14, decay: 3 });
    this.tone({ freq: 260, dur: 0.04, type: 'square', gain: 0.07 });
  }

  swap() { this.tone({ freq: 520, to: 700, dur: 0.06, type: 'square', gain: 0.1 }); }

  // --- the toys: `near` is 1 beside it and falls to 0 across the desk -------

  /** The train pulling out of a station: two notes, a toy's whistle. */
  whistle(near = 1) {
    if (near <= 0.02) return;
    this.tone({ freq: 1180, dur: 0.32, type: 'triangle', gain: 0.07 * near });
    this.tone({ freq: 1480, dur: 0.5, type: 'triangle', gain: 0.06 * near, delay: 0.3 });
  }

  /** Steel on steel in the cradle, as hard as it hit. */
  click(near = 1) {
    if (near <= 0.02) return;
    this.noise({ dur: 0.035, freq: 5200, q: 9, type: 'bandpass', gain: 0.16 * near, decay: 0.7 });
    this.tone({ freq: 3100, dur: 0.05, type: 'sine', gain: 0.05 * near });
  }

  wave() {
    for (let i = 0; i < 3; i++)
      this.tone({ freq: 300 * (i + 1), dur: 0.5, type: 'triangle', gain: 0.1, delay: i * 0.12 });
  }

  gameOver() {
    this.tone({ freq: 400, to: 90, dur: 1.2, type: 'sawtooth', gain: 0.22 });
  }

  // --- music ----------------------------------------------------------------
  // A two-bar pulse whose intensity follows the wave. Not a tune — a heartbeat
  // that tells you how much trouble you are in without you having to look.

  setMusic(on) {
    this.playMusic = on;
    if (this.scoreBus) {
      this.scoreBus.gain.setTargetAtTime(on ? 0.5 : 0, this.t, 0.4);
    }
  }

  updateMusic(dt, intensity) {
    if (!this.ctx || !this.playMusic || !this.enabled) return;
    const bpm = 96 + intensity * 44;
    const interval = 60 / bpm / 2;
    this._musicT -= dt;
    if (this._musicT > 0) return;
    this._musicT = interval;
    const s = this._step++ % 8;
    const root = 55;
    const notes = [0, 0, 3, 0, 5, 0, 3, -2];
    if (s % 2 === 0) {
      this.tone({ freq: root * Math.pow(2, notes[s] / 12), dur: interval * 1.6, type: 'triangle',
        gain: 0.14 + intensity * 0.06, dest: this.scoreBus });
    }
    if (s === 0 || s === 4) this.noise({ dur: 0.09, freq: 220, gain: 0.16, dest: this.scoreBus });
    if (intensity > 0.4 && (s === 2 || s === 6)) {
      this.noise({ dur: 0.05, freq: 6000, q: 2, type: 'highpass', gain: 0.05 + intensity * 0.05, dest: this.scoreBus });
    }
  }
}
