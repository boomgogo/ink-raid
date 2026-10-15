// In the page: wires the brain to the game's inputs, writes the run's event
// log, and keeps a log of every sound so the soundtrack can be rendered offline
// to the virtual clock (see clock.js).
//
// The only things written into the game are inputs: `input.state` for keys,
// the trigger and aim flags, and mouse counts into `input.mouse`, the same
// accumulator a real mouse feeds. The callbacks below are chained, never
// replaced: the game's own handler always runs first, and the log only reads.
(() => {
  const B = (window.__bot = window.__bot || {});
  const events = [];
  let t0 = 0;                 // virtual ms when the recording clock started
  const T = () => +((performance.now() - t0) / 1000).toFixed(3);
  const ev = (type, data = {}) => events.push({ t: T(), type, ...data });

  // --- inputs -------------------------------------------------------------------
  let lastOut = null;
  function apply(I, out) {
    for (const k in out.keys) I.state[k] = out.keys[k];
    I.fire = out.fire;
    I.aim = out.aim;
    I.mouse.dx += out.look[0];
    I.mouse.dy += out.look[1];
  }

  // --- the run's log ---------------------------------------------------------------
  function hookEvents(G) {
    const chain = (obj, key, fn) => {
      const prev = obj[key];
      obj[key] = function (...a) { const r = prev?.apply(this, a); try { fn(...a); } catch (e) { ev('hookError', { msg: String(e) }); } return r; };
    };
    chain(G.enemies, 'onFoeDown', (e, info) => ev('kill', {
      foe: e.type, boss: !!e.t.role?.boss, crit: !!info.crit, source: info.source || G.weapon.name || '',
      combo: G.combo, score: G.score, dist: +e.center.distanceTo(G.ctx.player.eye).toFixed(1),
    }));
    chain(G.planes, 'onDown', (p) => ev('plane', { carry: p.carry }));
    // logged before the game's own handler, which may be the one that calls die()
    const hit = G.enemies.onPlayerHit;
    G.enemies.onPlayerHit = function (from) {
      try { logHurt(from); } catch (e) { ev('hookError', { msg: String(e) }); }
      return hit?.call(this, from);
    };
    const logHurt = (from) => ev('hurt', {
      by: from?.type || 'blast', hp: Math.round(G.ctx.player.hp),
      seen: !!from && B.lastSnap?.foes.some((f) => f.type === from.type),
    });
    chain(G.waves, 'onWaveStart', (n, mod, boss) => ev('wave', { n, mod, boss }));
    chain(G.waves, 'onWaveClear', (n) => ev('clear', { n }));
    chain(G.pickups, 'onTouch', (item) => ev('pickup', { item }));
    const die = G.die.bind(G);
    G.die = () => {
      if (G.state === 'dead') return die();
      const last = events.filter((e) => e.type === 'hurt').slice(-1)[0];
      ev('death', { wave: G.waves.wave, score: G.score, kills: G.kills, by: last?.by || '?' });
      return die();
    };
    const take = G.take.bind(G);
    G.take = (item) => { const ok = take(item); if (ok) ev('take', { item }); return ok; };
  }

  // --- the soundtrack ----------------------------------------------------------------
  // Every sound in fx/audio.js is built from two primitives, noise() and tone(),
  // timed off `this.t`. Logging those calls with the virtual time is the whole
  // soundtrack; renderAudio() plays them back into an OfflineAudioContext.
  const sound = [];
  let recording = false;
  function hookAudio(A) {
    const proto = Object.getPrototypeOf(A);
    for (const k of ['noise', 'tone']) {
      A[k] = function (o = {}) {
        if (recording && this.ctx && this.enabled) sound.push([k, T(), { ...o, dest: o.dest ? 1 : 0 }]);
        return proto[k].call(this, o);
      };
    }
    A.setMusic = function (on) { if (recording) sound.push(['music', T(), !!on]); return proto.setMusic.call(this, on); };
    A.setVolume = function (v) { if (recording) sound.push(['volume', T(), v]); return proto.setVolume.call(this, v); };
  }

  B.renderAudio = async (from, to, sr = 48000, tail = 3) => {
    const A = window.__ink.game.audio;
    const proto = Object.getPrototypeOf(A);
    const ctx = new OfflineAudioContext(1, Math.ceil((to - from + tail) * sr), sr);
    const fake = Object.create(proto);
    let cur = 0;
    Object.defineProperty(fake, 't', { get: () => cur });
    fake.ctx = ctx;
    fake.enabled = true;
    fake.master = ctx.createGain();
    fake.master.connect(ctx.destination);
    fake.scoreBus = ctx.createGain();
    fake.scoreBus.connect(fake.master);
    const n = sr;
    fake.hissBuffer = ctx.createBuffer(1, n, n);
    const d = fake.hissBuffer.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    // the state of the buses at `from`
    let vol = A.volume, music = 0;
    for (const [k, t, v] of sound) {
      if (t >= from) break;
      if (k === 'volume') vol = v;
      if (k === 'music') music = v ? 0.5 : 0;
    }
    fake.master.gain.value = vol;
    fake.scoreBus.gain.value = music;
    for (const [k, t, v] of sound) {
      if (t < from) continue;
      if (t >= to) break;
      cur = t - from;
      if (k === 'noise' || k === 'tone') proto[k].call(fake, { ...v, dest: v.dest ? fake.scoreBus : null });
      else if (k === 'music') fake.scoreBus.gain.setTargetAtTime(v ? 0.5 : 0, cur, 0.4);
      else if (k === 'volume') fake.master.gain.setValueAtTime(v, cur);
    }
    const buf = await ctx.startRendering();
    const f = buf.getChannelData(0);
    const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // --- the loop -----------------------------------------------------------------------
  let map = null, hooked = false, sampleAt = 0;
  B.events = () => events.splice(0, events.length);
  B.soundCount = () => sound.length;
  B.markStart = () => { t0 = performance.now(); recording = true; const A = window.__ink.game.audio; sound.push(['volume', 0, A.volume], ['music', 0, A.playMusic && !!A.ctx]); };
  B.ev = ev;
  B.start = (opts = {}) => {
    const I = window.__ink, G = I.game;
    if (!hooked) { hookEvents(G); hookAudio(G.audio); hooked = true; }
    B.brain.seed(opts.seed ?? 1);
    B.brain.reset();
    map = B.map();
    const R = window.__vt.realNow;
    B.prof = { sense: 0, brain: 0, n: 0 };
    window.__vt.before.push((dt) => {
      const r0 = R();
      const s = B.sense(dt);
      const r1 = R();
      B.lastSnap = s;
      if (!s) return;
      const out = B.brain.tick(s, B.ray, map);
      B.prof.sense += r1 - r0; B.prof.brain += R() - r1; B.prof.n++;
      lastOut = out;
      if (out.note) ev('note', { msg: out.note });
      if (s.state === 'playing') apply(I.input, out);
      if (opts.overlay) {
        let o = document.getElementById('__botOverlay');
        if (!o) { o = document.createElement('pre'); o.id = '__botOverlay'; o.style.cssText = 'position:fixed;left:50%;top:60px;transform:translateX(-50%);margin:0;padding:4px 8px;background:rgba(255,255,255,.8);font:12px monospace;z-index:99;pointer-events:none;color:#000'; document.body.appendChild(o); }
        const d = B.brain.debug();
        const f = s.foes.find((x) => x.id === d.target);
        o.textContent = `t ${s.t.toFixed(1)} hp ${Math.round(s.me.hp)} slot ${s.slot} foes ${s.foes.length} tgt ${f ? f.type + ' ' + f.dist.toFixed(0) + 'm' : d.target ?? '-'} ` +
          `fire ${out.fire ? 'Y' : '-'} aim ${out.aim ? 'Y' : '-'} keys ${Object.entries(out.keys).filter((x) => x[1]).map((x) => x[0]).join(',')} ` +
          `goal ${d.goal ? Math.hypot(d.goal[0] - s.me.pos[0], d.goal[2] - s.me.pos[2]).toFixed(0) + 'm' : '-'} path ${d.path} ${out.note || ''}`;
      }
      if (s.t >= sampleAt) {
        sampleAt = s.t + 1;
        ev('sample', {
          hp: Math.round(s.me.hp), score: s.score, wave: s.wave, ws: s.waveState, alive: G.enemies.alive,
          left: s.remaining, seen: s.foes.length, pos: s.me.pos.map((x) => +x.toFixed(1)), slot: s.slot,
          heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
          fx: G.effects.particles.length, bullets: G.enemies.bullets.length, list: G.enemies.list.length,
          state: s.state,
          // for the report, never for the bot: where the ones left are, and what they are doing
          foes: G.enemies.alive <= 3 ? G.enemies.list.filter((e) => e.alive).map((e) => ({ type: e.type, pos: [e.body.pos.x, e.body.pos.y, e.body.pos.z].map((x) => +x.toFixed(1)), mind: e.mind, ladder: !!e.ladder, wedged: +e.wedgedFor.toFixed(1) })) : undefined,
          pips: s.pips.length,
        });
      }
    });
  };
  B.lastOut = () => lastOut;
})();
