// A virtual clock for the page, injected before any of the game's code runs.
//
// Recording a tab in real time tops out near 30 fps at 1080p on the machine
// this was built on (the capture, not the game, is the limit), and a dropped
// frame in a video is a stutter nobody can unsee. So the game is not run in real
// time at all while it is recorded: `performance.now`, `requestAnimationFrame`
// and the page's timers are replaced with a clock that only moves when the tool
// says so, and the tool steps it one frame at a time and photographs each one.
// Game time is then exact: every frame is 1/60 s, however long the photograph
// took. CSS animations and transitions on the HUD are walked to the same clock.
//
// The bot's limits (reaction time, turn rate) are in game time, so a virtual
// second is the second a player would have had.
//
// Not shipped: tools/ only. Loaded with page.addInitScript.
(() => {
  if (window.__vt) return;
  const realNow = performance.now.bind(performance);
  const realSetTimeout = window.setTimeout.bind(window);
  let now = 0;                       // virtual ms since the page began
  let raf = [];
  let rafId = 0;
  const timers = new Map();          // id -> { at, fn, args, every }
  let timerId = 1;

  performance.now = () => now;
  window.requestAnimationFrame = (fn) => { raf.push({ id: ++rafId, fn }); return rafId; };
  window.cancelAnimationFrame = (id) => { raf = raf.filter((r) => r.id !== id); };
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = timerId++;
    timers.set(id, { at: now + Math.max(0, +ms || 0), fn, args, every: 0 });
    return id;
  };
  window.setInterval = (fn, ms = 0, ...args) => {
    const id = timerId++;
    const every = Math.max(1, +ms || 0);
    timers.set(id, { at: now + every, fn, args, every });
    return id;
  };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };

  const call = (fn, args) => {
    try { typeof fn === 'function' ? fn(...args) : (0, eval)(fn); }
    catch (e) { realSetTimeout(() => { throw e; }); }
  };

  function runTimers() {
    for (;;) {
      let next = null, nid = 0;
      for (const [id, t] of timers) if (t.at <= now && (!next || t.at < next.at)) { next = t; nid = id; }
      if (!next) return;
      if (next.every) next.at += next.every; else timers.delete(nid);
      call(next.fn, next.args);
    }
  }

  // CSS animations and transitions run on the compositor's clock, which is real
  // time. Each one is paused the first time it is seen and then placed by hand.
  const started = new WeakMap();
  function syncAnimations() {
    for (const a of document.getAnimations()) {
      let s = started.get(a);
      if (s === undefined) {
        s = now - (a.currentTime || 0);
        started.set(a, s);
        a.pause();
      }
      const t = now - s;
      const end = a.effect?.getComputedTiming().endTime;
      if (Number.isFinite(end) && t >= end) { a.finish(); continue; }
      a.currentTime = t;
    }
  }

  window.__vt = {
    get now() { return now; },
    hz: 60,
    pageMs: 0,
    /** Hooks run each frame before the page's own: the bot sets its inputs here. */
    before: [],
    /** Advance `n` frames. */
    step(n = 1) {
      const dt = 1000 / this.hz;
      for (let i = 0; i < n; i++) {
        now += dt;
        runTimers();
        for (const h of this.before) h(dt / 1000, now);
        const q = raf;
        raf = [];
        const r0 = realNow();
        for (const r of q) call(r.fn, [now]);
        this.pageMs += realNow() - r0;
        syncAnimations();
      }
      return now;
    },
    realNow,
  };
})();
