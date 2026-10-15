// What the bot knows: a plain snapshot of what is on the player's screen,
// rebuilt every frame.
//
// This is the bot's only window on the game, and it only copies: no write to
// anything in the game happens here. The brain (brain.js) never sees the game
// objects at all, only this snapshot, so whatever it decides it decided from
// what a player could have seen:
//
// - enemies inside the view frustum with a clear line from the eye to them;
// - the cues the HUD gives a player: the hurt direction, the pips that point
//   at the last few enemies, the count left, ammo, health;
// - incoming rounds that are on screen;
// - pickups and paper planes in sight;
// - the map itself (open floor, ladders), which a player learns by playing it.
//
// Loaded with page.addInitScript after clock.js; it waits for the game.
(() => {
  const B = (window.__bot = window.__bot || {});
  const W = (x) => [+x.x.toFixed(3), +x.y.toFixed(3), +x.z.toFixed(3)];

  let V = null, ndc = null, dir = null, eye = null;
  let lastHp = null;
  let hurt = null;            // { from: [x,z], t }
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (o) => { let i = ids.get(o); if (!i) { i = nextId++; ids.set(o, i); } return i; };

  function inView(cam, p, margin = 1.0) {
    ndc.copy(p).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
    // behind the camera the projected w is negative, and three's applyMatrix4
    // divides by it; test the view-space z instead
    const vz = p.clone().applyMatrix4(cam.matrixWorldInverse).z;
    return vz < -0.1 && Math.abs(ndc.x) <= margin && Math.abs(ndc.y) <= margin;
  }

  function clearLine(I, from, to, slack = 0.3) {
    dir.copy(to).sub(from);
    const d = dir.length();
    if (d < 1e-3) return true;
    dir.multiplyScalar(1 / d);
    return !I.raycastLevel(from, dir, Math.max(0, d - slack));
  }

  // The map, once: open floor points a player could stand on, for the route
  // finder. A player knows the desk after a run or two; the bot is given it.
  B.map = () => {
    const I = window.__ink, L = I.level;
    return {
      start: W(L.startPoint),
      // the sniper nests are part of the map: a player knows where they are
      nests: (L.snipers || []).map(W),
      nav: B.navData ? { ...B.navData, start: W(L.startPoint) } : null,
    };
  };

  /** A line test the brain may ask for, from where the player stands: it reads the level and nothing else. */
  B.ray = (o, d, max) => {
    const I = window.__ink;
    if (!V) return null;
    const h = I.raycastLevel(new V(o[0], o[1], o[2]), new V(d[0], d[1], d[2]).normalize(), max);
    return h ? +h.dist.toFixed(3) : null;
  };

  B.sense = (dt) => {
    const I = window.__ink, G = I && I.game;
    if (!G) return null;
    const P = G.ctx.player, cam = G.ctx.camera;
    if (!V) {
      V = P.eye.constructor;
      ndc = new V(); dir = new V(); eye = new V();
      // the hurt direction the HUD shows: chained, never replaced
      const prevHit = G.enemies.onPlayerHit;
      G.enemies.onPlayerHit = (from) => {
        if (from) hurt = { from: [from.center.x, from.center.z], t: performance.now() };
        return prevHit?.(from);
      };
    }
    eye.copy(P.eye);
    const s = {
      t: performance.now() / 1000,
      dt,
      state: G.state,
      wave: G.waves.wave,
      waveState: G.waves.state,
      remaining: G.waves.remaining,
      score: G.score,
      kills: G.kills,
      combo: G.combo,
      me: {
        pos: W(P.body.pos), eye: W(P.eye), vel: W(P.body.vel),
        yaw: P.yaw, pitch: P.pitch, hp: P.hp, maxHp: P.maxHp, alive: P.alive,
        onGround: P.body.onGround, ladder: !!P.ladder, sliding: P.sliding, crouching: P.crouching, speed: P.speed,
        lookScale: P.lookScale, gain: (13.7 * Math.PI / 180 / 100) * (G.ctx.input.sens / 100),
        invert: G.ctx.input.invert,
        grapple: { attached: P.grapple.attached, stam: P.grapple.stam, target: P.grapple.targetValid },
        fov: cam.fov,
      },
      slot: G.heldSlot,
      weapons: G.weapons.map((w, i) => ({
        slot: i, name: w.name || w.stats?.name || '', hidden: !!w.hidden, rounds: !!w.firesRounds,
        mag: w.firesRounds ? w.mag : Infinity, reserve: w.firesRounds ? w.reserveLeft : Infinity,
        clip: w.firesRounds ? w.stats.ammo.clipSize : Infinity,
        reloading: w.firesRounds ? w.reloading > 0 : false,
        cooldown: w.cooldown || 0, aimMix: w.aimMix || 0,
      })),
      nades: G.grenades.count,
      nadeHeld: G.grenades.held,
      bandages: G.bandages,
      wrapping: G.wrapT > 0,
      foes: [],
      bullets: [],
      pickups: [],
      planes: [],
      pips: [],
      hurt: null,
      hpDrop: lastHp === null ? 0 : Math.max(0, lastHp - P.hp),
    };
    lastHp = P.hp;
    if (hurt && s.t - hurt.t / 1000 < 1.5) s.hurt = { from: hurt.from, ago: s.t - hurt.t / 1000 };

    cam.updateMatrixWorld();
    const head = new V();
    for (const e of G.enemies.list) {
      if (!e.alive) continue;
      const h = e.fig.hit.find((x) => x.part === 'head');
      if (h) h.node.getWorldPosition(head); else head.copy(e.center);
      const seeHead = inView(cam, head) && clearLine(I, eye, head);
      const seeBody = inView(cam, e.center) && clearLine(I, eye, e.center);
      if (!seeHead && !seeBody) continue;
      s.foes.push({
        id: idOf(e), type: e.type, kind: e.t.attack.kind,
        boss: !!e.t.role?.boss, stationary: !!e.t.role?.stationary,
        pos: W(e.body.pos), center: W(e.center), head: W(head), vel: W(e.body.vel),
        seeHead, seeBody,
        dist: +e.center.distanceTo(eye).toFixed(2),
        hp: e.hp / e.maxHp, scale: e.t.frame.scale || 1,
        headR: h ? h.r : 0.15,
        // the tells a player reads off the pose
        winding: e.windT > 0 || e.chargeState === 'wind',
        // a gun held on you: the tell, drawn in the pose before it fires
        aiming: e.aimClock > 0,
        charging: e.chargeState === 'run',
        chargeDir: e.chargeState ? W(e.chargeDir) : null,
        hunting: e.mind === 'hunt',
      });
    }
    for (const b of G.enemies.bullets) {
      if (b.returned) continue;
      const d = b.pos.distanceTo(eye);
      if (d > 30 || !inView(cam, b.pos, 1.15)) continue;
      s.bullets.push({ pos: W(b.pos), vel: W(b.vel), dist: d });
    }
    for (const p of G.pickups.list) {
      const d = p.pos.distanceTo(eye);
      if (d > 40) continue;
      // a pickup you walked past is remembered; one you never saw is not
      if (!inView(cam, p.pos) && d > 6) continue;
      if (!clearLine(I, eye, p.pos, 0.5)) continue;
      s.pickups.push({ item: p.item, pos: W(p.pos), dist: d });
    }
    for (const p of G.planes.list) {
      if (p.mode !== 'fly' && p.mode !== 'enter') continue;
      const d = p.pos.distanceTo(eye);
      if (d > 50 || !inView(cam, p.pos) || !clearLine(I, eye, p.pos)) continue;
      s.planes.push({ pos: W(p.pos), vel: W(p.vel), dist: d, carry: p.carry });
    }
    // the HUD's pips: bearings only, the same numbers the HUD draws
    for (const e of G.enemies.pips) s.pips.push(Math.atan2(-(e.center.x - P.center.x), -(e.center.z - P.center.z)));
    return s;
  };
})();
