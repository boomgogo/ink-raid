// The bot's brain: a snapshot (sense.js) in, a set of inputs out.
//
// It plays like a person at a keyboard and mouse, and is held to a person's
// limits:
//
// - REACTION: a target it has not been looking at is not acted on until it has
//   been on screen for 180-260 ms.
// - THE HAND: the crosshair is moved by mouse deltas, through a damped spring
//   with a top speed, some overshoot on a new target and a little tremor. A
//   flick across the screen takes a quarter of a second, and the aim lands
//   near the head before it lands on it.
// - THE TRIGGER: only pulled when the crosshair is on what it is aiming at, by
//   about the target's own size; the gun's spread does the rest.
// - THE SCREEN: it acts only on the snapshot, which holds what is on screen
//   plus the HUD's cues. It never touches the game.
//
// Inside those limits it plays to win: head height, the right gun for the
// range, strafing under fire, retreating to heal, grenades into a crowd.
//
// The functions here are plain JavaScript with no access to the page beyond
// the two it is handed: `ray` (a line test against the level) and the
// snapshot. tools/autoplay.mjs checks that it never names the game.
(() => {
  const B = (window.__bot = window.__bot || {});

  // A small seeded generator, so a run's choices can be replayed from its seed.
  let seed = 1;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (a, b) => a + (b - a) * rnd();
  const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const flat = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const yawTo = (from, to) => Math.atan2(-(to[0] - from[0]), -(to[2] - from[2]));
  const pitchTo = (from, to) => { const d = sub(to, from); return Math.asin(clamp(d[1] / (len(d) || 1), -1, 1)); };

  // --- the human limits ------------------------------------------------------
  const HUMAN = {
    react: [0.18, 0.26],     // s before a newly seen target is acted on
    omega: 13,               // rad/s: the hand's spring; settles a flick in ~0.3 s
    zeta: 0.72,              // a little overshoot
    maxTurn: 11,             // rad/s: the fastest swipe across the pad (~630 deg/s)
    flickErr: 0.09,          // a new target's first landing is off by this share of the swing
    flickSettle: 0.22,       // s for that error to wash out
    tremor: 0.0007,          // rad of hand shake
    fireTol: 0.9,            // pull when within this many target-radii of the aim point
  };

  // Which gun at which range, and the band of distance each is happiest in.
  const SLOT = { rifle: 0, shotgun: 1, sniper: 2, katana: 3, stapler: 4 };
  const BAND = { 0: [9, 26], 1: [3, 9], 2: [22, 70], 4: [6, 20] };

  const mind = {
    seen: new Map(),        // id -> { first, last, pos }
    target: null,           // id
    targetSince: 0,
    readyAt: 0,             // reaction delay over
    aim: { vy: 0, vp: 0, ey: 0, ep: 0 },   // spring velocity, and the flick's error
    strafe: 1, strafeUntil: 0,
    jumpAt: 0,
    slotSince: 0,
    path: [], goal: null, planAt: -1, lastProgress: { t: 0, pos: null },
    stuckFor: 0, unstickUntil: 0, unstickDir: 1,
    glanceAt: 0, glanceYaw: null, glanceEnd: 0,
    nestClear: new Map(), atVantage: 0,
    hurtYaw: null, hurtUntil: 0,
    nade: null,             // { until, yaw, pitch }
    healAt: 0,
    noThreatSince: 0,
    tapPrev: {},
    explore: new Map(),     // node -> last visited
    shots: 0, burstUntil: 0, restUntil: 0,
    lastSeenAny: 0,
    lastWave: 0,
  };

  // --- routes over the walk grid (navgrid.mjs) ----------------------------------------
  let nav = null;
  function useNav(g) {
    const n = g.xyz.length / 3;
    // the column of each node, for "which node is under me"
    nav = { ...g, n, reach: null };
    // what is reachable on foot from the start, for picking places to go
    const start = nodeAt(g.start || [0, 0, 15]);
    const seen = new Uint8Array(n), q = [start];
    seen[start] = 1;
    for (let h = 0; h < q.length; h++) {
      const u = q[h];
      for (let e = g.off[u]; e < g.off[u + 1]; e++) { const v = g.to[e]; if (!seen[v]) { seen[v] = 1; q.push(v); } }
    }
    nav.reach = q;
    nav.inReach = seen;
  }
  const P = (i) => [nav.xyz[i * 3], nav.xyz[i * 3 + 1], nav.xyz[i * 3 + 2]];
  /** The node under (or nearest to) a point. */
  function nodeAt(p) {
    const { grid, E, N, col, xyz } = nav;
    const ci = Math.round((p[0] + E) / grid), ck = Math.round((p[2] + E) / grid);
    let best = -1, bd = 1e9;
    for (let r = 0; r <= 6 && best < 0; r++) {
      for (let di = -r; di <= r; di++) {
        for (let dk = -r; dk <= r; dk++) {
          if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
          const i = ci + di, k = ck + dk;
          if (i < 0 || k < 0 || i >= N || k >= N) continue;
          const j = i * N + k;
          let id = col[j];
          if (id < 0) continue;
          // the nodes of one column are numbered together
          for (; id < nav.n && Math.round((xyz[id * 3] + E) / grid) === i && Math.round((xyz[id * 3 + 2] + E) / grid) === k; id++) {
            const dy = p[1] - xyz[id * 3 + 1];
            const d = Math.hypot(di, dk) * grid + (dy < -0.7 ? 10 + -dy : Math.abs(dy) * 0.5);
            if (d < bd) { bd = d; best = id; }
          }
        }
      }
    }
    return best;
  }
  function route(from, to) {
    // A* with a binary heap
    const { off, to: T, cost, xyz } = nav;
    const g = new Map([[from, 0]]), came = new Map();
    const tx = xyz[to * 3], tz = xyz[to * 3 + 2];
    const h = (i) => Math.hypot(xyz[i * 3] - tx, xyz[i * 3 + 2] - tz);
    const heap = [[h(from), from]];
    const push = (x) => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    let expanded = 0;
    while (heap.length) {
      const [f, cur] = pop();
      if (cur === to) {
        const out = [cur];
        let c = cur;
        while (came.has(c)) { c = came.get(c); out.push(c); }
        return out.reverse();
      }
      const gc = g.get(cur);
      if (f - h(cur) > gc + 1e-6) continue;
      if (++expanded > 40000) break;
      for (let e = off[cur]; e < off[cur + 1]; e++) {
        const nb = T[e];
        const ng = gc + cost[e];
        if (ng < (g.get(nb) ?? 1e9)) { g.set(nb, ng); came.set(nb, cur); push([ng + h(nb), nb]); }
      }
    }
    return null;
  }

  // --- the output -------------------------------------------------------------------
  function blankOut() {
    return {
      keys: { forward: false, back: false, left: false, right: false, sprint: false, jump: false, crouch: false,
        jet: false, reload: false, melee: false, grenade: false, heal: false,
        slot1: false, slot2: false, slot3: false, slot4: false, slot5: false },
      fire: false, aim: false, look: [0, 0], note: null,
    };
  }

  // A key that must be seen going down: held one frame, then let go for at
  // least one, the way a finger does.
  function tap(out, k) {
    if (mind.tapPrev[k]) return;
    out.keys[k] = true;
  }

  /** Walk toward world-space direction (x, z), with the keys the view allows. */
  function walk(out, s, dx, dz, sprint) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return;
    dx /= l; dz /= l;
    const y = s.me.yaw;
    const fx = -Math.sin(y), fz = -Math.cos(y);
    const rx = Math.cos(y), rz = -Math.sin(y);
    const f = dx * fx + dz * fz, r = dx * rx + dz * rz;
    if (f > 0.38) out.keys.forward = true;
    if (f < -0.38) out.keys.back = true;
    if (r > 0.38) out.keys.right = true;
    if (r < -0.38) out.keys.left = true;
    if (sprint && out.keys.forward) out.keys.sprint = true;
  }

  /** Feel ahead along (dx, dz): turn it round anything in the way, or hop what is low. */
  function steer(s, ray, dx, dz, out) {
    const p = s.me.pos;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const probe = (ax, az, h, d) => ray([p[0], p[1] + h, p[2]], [ax, 0, az], d);
    if (probe(dx, dz, 0.5, 1.4) === null) return [dx, dz];
    // low and clear above: a step or a ledge to vault
    if (probe(dx, dz, 1.6, 1.6) === null && s.me.onGround) { out.keys.jump = !mind.tapPrev.jump; return [dx, dz]; }
    for (const a of [0.6, -0.6, 1.1, -1.1, 1.6, -1.6, 2.3, -2.3]) {
      const sgn = a * mind.unstickDir;
      const c = Math.cos(sgn), sn = Math.sin(sgn);
      const ax = dx * c - dz * sn, az = dx * sn + dz * c;
      if (probe(ax, az, 0.5, 1.4) === null) return [ax, az];
    }
    return [-dx, -dz];
  }

  // --- aim ------------------------------------------------------------------------------
  function lookToward(out, s, yawD, pitchD, dt, steady = 1) {
    const a = mind.aim;
    const ey = wrap(yawD + a.ey - s.me.yaw);
    const ep = pitchD + a.ep - s.me.pitch;
    const w = HUMAN.omega * steady;
    a.vy += (w * w * ey - 2 * HUMAN.zeta * w * a.vy) * dt;
    a.vp += (w * w * ep - 2 * HUMAN.zeta * w * a.vp) * dt;
    const sp = Math.hypot(a.vy, a.vp);
    if (sp > HUMAN.maxTurn) { a.vy *= HUMAN.maxTurn / sp; a.vp *= HUMAN.maxTurn / sp; }
    // the flick's error washes out
    const k = Math.exp(-dt / HUMAN.flickSettle);
    a.ey *= k; a.ep *= k;
    const dyaw = a.vy * dt + gauss() * HUMAN.tremor;
    const dpitch = a.vp * dt + gauss() * HUMAN.tremor;
    // mouse counts: yaw += -dx * gain * lookScale; pitch += -dy * gain * lookScale
    const g = s.me.gain * (s.me.lookScale || 1);
    out.look[0] += -dyaw / g;
    out.look[1] += (s.me.invert ? 1 : -1) * dpitch / g;
  }

  function newTarget(s, id, yawD, pitchD) {
    mind.target = id;
    mind.targetSince = s.t;
    mind.readyAt = s.t + between(...HUMAN.react);
    const swing = Math.hypot(wrap(yawD - s.me.yaw), pitchD - s.me.pitch);
    mind.aim.ey = gauss() * swing * HUMAN.flickErr;
    mind.aim.ep = gauss() * swing * HUMAN.flickErr * 0.6;
    mind.shots = 0;
  }

  // --- choosing -----------------------------------------------------------------------------
  function threat(f, s) {
    let t = 0;
    if (f.boss) t += 3;
    if (f.charging) t += 6;
    if (f.winding) t += 2;
    if (f.aiming) t += 1.5;
    if (f.type === 'punch' && f.dist < 16) t += 2;
    if (f.kind === 'melee') t += f.dist < 12 ? 4 : 1;
    if (f.kind === 'spotter') t += 1.5;      // a highlighter calls the desk on you
    if (f.stationary) t += 1;
    t += clamp(30 / Math.max(2, f.dist), 0, 6);
    // stick with what is already in the sights
    if (mind.target === f.id) t += 2.5;
    // and a wounded one is a quick kill
    t += (1 - f.hp) * 1.5;
    return t;
  }

  function hasRounds(w) { return !w.hidden && (w.mag > 0 || w.reserve > 0); }

  function pickSlot(s, f) {
    const W = s.weapons;
    let want = SLOT.rifle;
    if (f) {
      // a hole punch's blast is the thing to stay out of: rifle it from range
      const close = f.type === 'punch' ? 4 : 7;
      if ((f.dist < close || (f.kind === 'melee' && f.dist < 11)) && hasRounds(W[1])) want = SLOT.shotgun;
      else if (f.dist > 34 && (f.stationary || f.boss) && hasRounds(W[2])) want = SLOT.sniper;
      else if (f.dist > 45 && hasRounds(W[2])) want = SLOT.sniper;
      else if (!W[4].hidden && W[4].mag > 0 && f.dist < 20) want = SLOT.stapler;
    }
    if (!hasRounds(W[want])) want = [0, 1, 2].find((i) => hasRounds(W[i])) ?? SLOT.katana;
    return want;
  }

  /** The way to walk this frame to get to `goal` over the walk grid. */
  function follow(s, ray, goal) {
    const me = s.me;
    // replanned every couple of seconds, or when the goal moves
    if (!mind.path.length || s.t - (mind.pathAt || 0) > 2 || flat(mind.pathGoal || goal, goal) > 3) {
      const a = nodeAt(me.pos), b = nodeAt(goal);
      const r = a >= 0 && b >= 0 ? route(a, b) : null;
      mind.path = r ? r.map(P) : [goal];
      mind.pathAt = s.t; mind.pathGoal = goal;
    }
    // drop what is behind, then aim for the farthest point ahead in a clear line
    while (mind.path.length > 1 && flat(me.pos, mind.path[0]) < 0.8) mind.path.shift();
    let nx = mind.path[0];
    for (let i = Math.min(mind.path.length - 1, 14); i > 0; i--) {
      const q = mind.path[i];
      if (Math.abs(q[1] - me.pos[1]) > 0.5 || flat(me.pos, q) > 6) continue;
      const v = sub(q, me.pos);
      if (ray([me.pos[0], me.pos[1] + 0.5, me.pos[2]], [v[0], 0, v[2]], Math.hypot(v[0], v[2])) === null) { nx = q; break; }
    }
    return [nx[0] - me.pos[0], nx[2] - me.pos[2]];
  }

  /** A place on the walk grid with a clear line up to a sniper nest. */
  const vantages = new Map();
  function vantage(s, ray, nest) {
    const key = nest.join();
    let v = vantages.get(key);
    if (!v) {
      v = [];
      const head = [nest[0], nest[1] + 1.5, nest[2]];
      for (let k = 0; k < 500 && v.length < 14; k++) {
        const a = rnd() * Math.PI * 2, r = between(8, 38);
        const i = nodeAt([nest[0] + Math.cos(a) * r, 0, nest[2] + Math.sin(a) * r]);
        if (i < 0 || !nav.inReach[i]) continue;
        const q = P(i);
        const eye = [q[0], q[1] + 1.6, q[2]];
        const d = sub(head, eye);
        if (ray(eye, d, len(d) - 0.6) === null) v.push(q);
      }
      vantages.set(key, v);
    }
    // the nearest, and the floor rather than a climb
    let best = null, bs = 1e9;
    for (const q of v) {
      const sc = flat(s.me.pos, q) + Math.max(0, q[1] - s.me.pos[1]) * 4 + rnd() * 3;
      if (sc < bs) { bs = sc; best = q; }
    }
    return best;
  }

  /** Somewhere close that none of `threats` can see, and not toward them. */
  function findCover(s, ray, threats) {
    const me = s.me;
    let best = null, bs = -1e9;
    for (let k = 0; k < 28; k++) {
      const a = rnd() * Math.PI * 2, r = between(3, 15);
      const i = nodeAt([me.pos[0] + Math.cos(a) * r, me.pos[1], me.pos[2] + Math.sin(a) * r]);
      if (i < 0 || !nav.inReach[i]) continue;
      const q = P(i);
      if (Math.abs(q[1] - me.pos[1]) > 1.2) continue;
      const eyeQ = [q[0], q[1] + 1.4, q[2]];
      let hidden = true, away = 0;
      for (const f of threats) {
        const v = sub(eyeQ, f.head);
        if (ray(f.head, v, len(v) - 0.3) === null) { hidden = false; break; }
        away += flat(q, f.pos) - flat(me.pos, f.pos);
      }
      if (!hidden) continue;
      const sc = -flat(me.pos, q) + away * 0.4;
      if (sc > bs) { bs = sc; best = q; }
    }
    return best;
  }

  // --- the frame ------------------------------------------------------------------------------
  B.brain = {
    seed(n) { seed = n | 0; },
    reset() {
      mind.seen.clear(); mind.target = null; mind.path = []; mind.goal = null; mind.nade = null;
      mind.explore.clear(); mind.aim = { vy: 0, vp: 0, ey: 0, ep: 0 };
    },
    nav: () => nav,
    debug: () => ({ vantage: mind.vantage, vnest: mind.vantageNest, lookAt: mind.lookAt, goal: mind.goal, path: mind.path.length, next: mind.path[0], moveYaw: mind.moveYaw, target: mind.target, stuck: mind.stuckFor, seen: mind.seen.size, nodes: nav?.n, reach: nav?.reach.length }),
    tick(s, ray, map) {
      const out = blankOut();
      if (!s || s.state !== 'playing' || !s.me.alive) { mind.tapPrev = {}; return out; }
      if (!nav) useNav(map.nav);
      const dt = s.dt;
      const me = s.me;

      // --- memory: what has been on screen, and since when
      for (const f of s.foes) {
        const m = mind.seen.get(f.id);
        if (!m || s.t - m.last > 0.6) mind.seen.set(f.id, { first: s.t, last: s.t, pos: f.center, type: f.type });
        else { m.last = s.t; m.pos = f.center; }
      }
      for (const [id, m] of mind.seen) if (s.t - m.last > 12) mind.seen.delete(id);
      if (s.foes.length) mind.lastSeenAny = s.t;
      if (s.hurt) { mind.hurtYaw = yawTo(me.pos, [s.hurt.from[0], 0, s.hurt.from[1]]); mind.hurtUntil = s.t + 1.2; }
      if (s.wave !== mind.lastWave) { mind.lastWave = s.wave; mind.path = []; }

      // --- the target
      let best = null, bt = -1;
      for (const f of s.foes) { const t = threat(f, s); if (t > bt) { bt = t; best = f; } }
      // a plane is a target only when nothing else is
      let plane = null;
      if (!best && s.planes.length && !s.wrapping && s.t - mind.lastSeenAny > 4 && (s.bandages < 3 || s.waveState === 'breather')) plane = s.planes.reduce((a, b) => (a.dist < b.dist ? a : b));

      const W = s.weapons;
      const held = W[s.slot];
      const hp = me.hp / me.maxHp;

      // --- what to do with the hands
      if (best || plane) {
        const f = best;
        const want = pickSlot(s, f);
        if (want !== s.slot && s.t - mind.slotSince > 0.6 && !mind.nade) { tap(out, `slot${want + 1}`); mind.slotSince = s.t; }
      } else if (s.t - mind.lastSeenAny > 1.5) {
        // nothing in sight: top up, the rifle first
        if (s.slot !== 0 && hasRounds(W[0]) && s.t - mind.slotSince > 1) { tap(out, 'slot1'); mind.slotSince = s.t; }
        else if (held.rounds && held.mag < held.clip && held.reserve > 0 && !held.reloading) tap(out, 'reload');
      }

      // heal when nobody is looking
      if (!best) mind.noThreatSince = mind.noThreatSince || s.t; else mind.noThreatSince = 0;
      const quiet = mind.noThreatSince && s.t - mind.noThreatSince > 0.9;
      if (s.bandages > 0 && !s.wrapping && hp < 0.6 && (quiet || (hp < 0.3 && (!best || best.dist > 18))) && s.t > mind.healAt) {
        tap(out, 'heal');
        mind.healAt = s.t + 0.5;
      }

      // --- the grenade: a crowd at lobbing range
      if (!mind.nade && s.nades > 0 && s.foes.length >= 3 && !s.wrapping) {
        let pick = null;
        for (const f of s.foes) {
          if (f.dist < 10 || f.dist > 19) continue;
          const near = s.foes.filter((g) => flat(g.pos, f.pos) < 6).length;
          if (near >= 3 && (!pick || near > pick.n)) pick = { f, n: near };
        }
        if (!pick && best && best.boss && best.dist > 10 && best.dist < 19) pick = { f: best, n: 1 };
        if (pick) {
          const R = flat(me.pos, pick.f.pos);
          const th = 0.5;
          const v = clamp(Math.sqrt((R * 32) / Math.sin(2 * th)), 8.5, 25);
          mind.nade = { hold: ((v - 8.5) / 16.5) * 0.85, start: s.t + 0.25, yaw: yawTo(me.eye, pick.f.pos), pitch: th };
          out.note = `grenade at ${pick.n} (${R.toFixed(0)} m)`;
        }
      }

      // --- aim and trigger
      if (mind.nade) {
        const n = mind.nade;
        lookToward(out, s, n.yaw, n.pitch, dt);
        if (s.t >= n.start && s.t < n.start + n.hold + 0.05) out.keys.grenade = true;
        else if (s.t >= n.start + n.hold + 0.05) mind.nade = null;
      } else if (best) {
        const f = best;
        // head height when the head is in sight and the gun can make use of it
        const useHead = f.seeHead && (held.slot !== 1) && f.dist < (held.slot === 2 ? 80 : 32);
        const pt = useHead ? f.head : f.center;
        const yawD = yawTo(me.eye, pt), pitchD = pitchTo(me.eye, pt);
        if (mind.target !== f.id) newTarget(s, f.id, yawD, pitchD);
        // a sniper settles before it shoots
        if (held.slot === 2 || (held.slot === 0 && f.dist > 22 && !f.charging)) out.aim = true;
        lookToward(out, s, yawD, pitchD, dt, out.aim ? 0.85 : 1);

        const err = Math.hypot(wrap(yawD - me.yaw) * Math.cos(pitchD), pitchD - me.pitch);
        const r = (useHead ? f.headR : 0.2 * f.scale) / Math.max(0.5, f.dist);
        const onIt = err < Math.max(r * HUMAN.fireTol, 0.004);
        const ready = s.t >= mind.readyAt;
        if (ready && onIt && !(s.wrapping && f.dist > 9)) {
          if (held.slot === 0) {
            // short bursts at range keep the bloom down
            if (s.t >= mind.restUntil) {
              out.fire = true;
              if (f.dist > 20 && s.t > mind.burstUntil) { mind.burstUntil = s.t + 0.35; }
              if (f.dist > 20 && mind.burstUntil && s.t > mind.burstUntil - 0.02) { mind.restUntil = s.t + 0.12; mind.burstUntil = 0; }
            }
          } else if (held.slot === 2) {
            if (held.aimMix > 0.85 && held.cooldown <= 0 && !mind.tapPrev.fire) out.fire = true;
          } else if (held.slot === 3) {
            if (f.dist < 3.2) out.fire = !mind.tapPrev.fire;
          } else if (held.cooldown <= 0 && !mind.tapPrev.fire) {
            out.fire = true;
          }
        }
      } else if (plane) {
        const yawD = yawTo(me.eye, plane.pos), pitchD = pitchTo(me.eye, plane.pos);
        if (mind.target !== 'plane') newTarget(s, 'plane', yawD, pitchD);
        lookToward(out, s, yawD, pitchD, dt);
        const err = Math.hypot(wrap(yawD - me.yaw), pitchD - me.pitch);
        if (s.t >= mind.readyAt && err < 0.5 / plane.dist && held.slot === 0) out.fire = true;
      } else {
        mind.target = null;
        // no one in sight: look where the trouble came from, else where we are going
        let yawD = mind.moveYaw ?? me.yaw, pitchD = -0.05;
        let steady = 0.55;
        if (s.t < mind.hurtUntil && mind.hurtYaw !== null) { yawD = mind.hurtYaw; steady = 1; }
        else if (mind.lookAt && !me.ladder && (!mind.vantage || flat(me.pos, mind.vantage) < 20)) { yawD = yawTo(me.eye, [mind.lookAt[0], mind.lookAt[1] + 1.5, mind.lookAt[2]]); pitchD = pitchTo(me.eye, [mind.lookAt[0], mind.lookAt[1] + 1.5, mind.lookAt[2]]); }
        else if (s.pips.length && s.t > mind.glanceEnd) { yawD = s.pips[0]; }
        else {
          const recent = [...mind.seen.values()].filter((m) => s.t - m.last < 1.5).sort((a, b) => b.last - a.last)[0];
          if (recent) { yawD = yawTo(me.eye, recent.pos); pitchD = clamp(pitchTo(me.eye, recent.pos), -0.25, 0.25); }
          else if (mind.moveYaw !== undefined) {
            // a look over the shoulder now and then
            if (s.t > mind.glanceAt) { mind.glanceYaw = between(-1.1, 1.1); mind.glanceAt = s.t + between(3, 6); mind.glanceEnd = s.t + 0.8; }
            if (s.t < mind.glanceEnd) yawD += mind.glanceYaw;
          }
        }
        lookToward(out, s, yawD, pitchD, dt, steady);
        // nobody seen for a long while and some still out there: a short burst
        // into the air, which anything within earshot comes to (a player's trick)
        if (s.remaining > 0 && s.remaining <= 2 && s.waveState === 'clearing' && s.t - mind.lastSeenAny > 25 && held.slot === 0 && held.mag > 4) {
          if (s.t > (mind.callAt || 0)) mind.callAt = s.t + 12;
          if (s.t > mind.callAt - 12 && s.t < mind.callAt - 11.75) { out.fire = true; out.note = out.note || 'call'; }
        }
      }

      // --- the feet
      let mx = 0, mz = 0, sprint = false;
      const engaged = !!best;
      if (engaged) {
        const f = best;
        const to = sub(f.pos, me.pos);
        const d = Math.hypot(to[0], to[2]) || 1;
        const ux = to[0] / d, uz = to[2] / d;
        const band = f.type === 'punch' ? [15, 28] : (BAND[held.slot] || [2, 5]);
        let radial = 0;
        if (f.dist < band[0]) radial = -1;
        else if (f.dist > band[1] && !f.stationary) radial = 0.8;
        // low on health: get out of its sight, not closer to it
        if (hp < 0.3 && f.dist < 25) radial = -1;
        if (s.t > mind.strafeUntil) { mind.strafe = rnd() < 0.5 ? -1 : 1; mind.strafeUntil = s.t + between(0.6, 1.5); }
        let tx = -uz * mind.strafe, tz = ux * mind.strafe;
        // a gun held on us up close: off its line before it goes
        if (f.aiming && f.dist < 16 && s.t > mind.jumpAt) { mind.strafeUntil = 0; if (me.onGround && rnd() < 0.15) { out.keys.jump = true; mind.jumpAt = s.t + between(1, 2); } }
        // a charge or a blade on its way: sideways, and hard
        if (f.charging && f.chargeDir) { tx = -f.chargeDir[2] * mind.strafe; tz = f.chargeDir[0] * mind.strafe; radial = 0; sprint = true; }
        const strafeW = held.slot === 2 && out.aim ? 0.35 : 1;
        mx = ux * radial + tx * strafeW;
        mz = uz * radial + tz * strafeW;
        // hurt and with a bandage to put on (or nearly dead): break the line of
        // sight, firing on the way, and wrap it on out of view
        if (hp < 0.45 && (s.bandages > 0 || hp < 0.3) && !f.charging) {
          if (!mind.cover || s.t > mind.coverUntil || (flat(me.pos, mind.cover) < 1.2 && s.foes.length)) {
            mind.cover = findCover(s, ray, s.foes);
            mind.coverUntil = s.t + 4;
            if (mind.cover) out.note = 'cover';
          }
          if (mind.cover) { [mx, mz] = follow(s, ray, mind.cover); sprint = false; }
        } else mind.cover = null;
        // rounds in the air coming this way: step across their line
        for (const b of s.bullets) {
          const toMe = sub(me.eye, b.pos);
          const closing = (b.vel[0] * toMe[0] + b.vel[1] * toMe[1] + b.vel[2] * toMe[2]) / (len(b.vel) * len(toMe) || 1);
          if (closing > 0.97 && b.dist < 14) {
            mx += -b.vel[2] * mind.strafe * 0.1; mz += b.vel[0] * mind.strafe * 0.1;
            if (s.t > mind.jumpAt && me.onGround && rnd() < 0.08) { out.keys.jump = true; mind.jumpAt = s.t + between(1.2, 2.5); }
          }
        }
      } else {
        // where to: a pickup worth having, then the last place trouble was, then out to find it
        let goal = null;
        const wantBandage = s.bandages < 3;
        const pk = s.pickups.filter((p) => (p.item === 'bandage' ? wantBandage : true)).sort((a, b) => a.dist - b.dist)[0];
        if (pk) goal = pk.pos;
        if (!goal) {
          const recent = [...mind.seen.values()].filter((m) => s.t - m.last < 8 && s.t - m.last > 0.3).sort((a, b) => b.last - a.last)[0];
          if (recent) goal = recent.pos;
        }
        if (!goal && s.pips.length) {
          const a = s.pips[0];
          // a pip lined up with a sniper nest: it is on the nest, so go where the nest can be seen
          // (one already watched from a vantage and found empty is skipped for a while)
          const nest = map.nests.find((n) => Math.abs(wrap(yawTo(me.pos, n) - a)) < 0.2 && !(s.t < (mind.nestClear.get(n.join()) || 0)));
          if (nest && mind.vantage && mind.vantageNest === nest && flat(me.pos, mind.vantage) < 1.5) {
            mind.atVantage ||= s.t;
            if (s.t - mind.atVantage > 3) { mind.nestClear.set(nest.join(), s.t + 30); mind.atVantage = 0; mind.vantage = null; }
          } else mind.atVantage = 0;
          if (nest && mind.nestClear.get(nest.join()) > s.t) {
            goal = [me.pos[0] - Math.sin(a) * 25, me.pos[1], me.pos[2] - Math.cos(a) * 25];
            mind.lookAt = null;
          } else if (nest) {
            if (!mind.vantage || mind.vantageNest !== nest || (flat(me.pos, mind.vantage) < 1.5 && s.t - mind.vantageAt > 4)) {
              mind.vantage = vantage(s, ray, nest); mind.vantageNest = nest; mind.vantageAt = s.t;
            }
            goal = mind.vantage;
            mind.lookAt = nest;
          } else goal = [me.pos[0] - Math.sin(a) * 25, me.pos[1], me.pos[2] - Math.cos(a) * 25];
        } else mind.lookAt = null;
        if (!goal && s.waveState === 'breather') goal = null;      // hold still, reload, breathe
        if (!goal && s.remaining > 0 && s.t - mind.lastSeenAny > 3) {
          // explore: somewhere on the desk not walked lately, not too far
          if (!mind.goal || flat(me.pos, mind.goal) < 3 || s.t - mind.planAt > 14) {
            let pick = null, ps = -1e9;
            for (let k = 0; k < 40; k++) {
              const q = P(nav.reach[Math.floor(rnd() * nav.reach.length)]);
              const d = flat(me.pos, q);
              if (d < 10 || d > 45) continue;
              const cell = `${Math.round(q[0] / 8)},${Math.round(q[2] / 8)}`;
              const ago = s.t - (mind.explore.get(cell) ?? -99);
              // the floor, and the middle of the desk, are where the fights are
              const sc = Math.min(ago, 60) - d * 0.3 - Math.hypot(q[0], q[2]) * 0.25 - q[1] * 2;
              if (sc > ps) { ps = sc; pick = q; }
            }
            if (pick) { mind.goal = pick; mind.planAt = s.t; mind.path = []; }
          }
          goal = mind.goal;
        }
        if (goal) {
          [mx, mz] = follow(s, ray, goal);
          sprint = true;
          mind.explore.set(`${Math.round(me.pos[0] / 8)},${Math.round(me.pos[2] / 8)}`, s.t);
          // there: forget it, so the next frame looks for somewhere new
          if (flat(me.pos, goal) < 2.5) {
            for (const [id, m] of mind.seen) if (flat(m.pos, goal) < 3) m.last = -99;
            if (mind.goal === goal) mind.goal = null;
          }
        }
      }

      // stuck: wanting to move and going nowhere
      const wantMove = Math.hypot(mx, mz) > 0.01;
      if (wantMove && me.speed < 0.6 && me.onGround) mind.stuckFor += dt; else mind.stuckFor = Math.max(0, mind.stuckFor - dt * 2);
      if (mind.stuckFor > 0.8 && s.t > mind.unstickUntil) {
        mind.unstickUntil = s.t + 0.7; mind.unstickDir *= -1; mind.stuckFor = 0; mind.path = [];
        out.keys.jump = !mind.tapPrev.jump;
        out.note = out.note || 'stuck';
      }
      if (me.ladder && !engaged) {
        // on a ladder: face it and climb, as a player has to
        out.keys.forward = true;
        mind.moveYaw = Math.atan2(-mx, -mz);
      } else if (wantMove) {
        let [dx, dz] = steer(s, ray, mx, mz, out);
        if (s.t < mind.unstickUntil) { const c = Math.cos(1.2 * mind.unstickDir), sn = Math.sin(1.2 * mind.unstickDir); [dx, dz] = [dx * c - dz * sn, dx * sn + dz * c]; }
        walk(out, s, dx, dz, sprint && !engaged);
        if (!engaged) mind.moveYaw = Math.atan2(-dx, -dz);
      }

      // record the keys that must be seen going down, so the next frame lets go
      mind.tapPrev = { ...out.keys, fire: out.fire };
      return out;
    },
  };
})();
