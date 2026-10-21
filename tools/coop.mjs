// Co-op through p3p2, in real browsers against a real p3p2 server.
//
//   npm run coop
//
// Needs `npm run preview` on port 4173, like the other browser tools, and a
// p3p2 server. By default it starts one from a checkout of p3p2's repository
// (P3P2_DIR, default ~/Repos/p3p2: `npm install` there first), in memory, on
// port 18190, and stops it at the end. To use one already running instead:
//
//   P3P2_URL=http://127.0.0.1:8080 P3P2_PASSWORD=... npm run coop
//
// A room is made in the server's portal for this game's URL, as its owner
// would, and the pages go in the way players do: FRIENDS, the room URL, the
// invite link, Join. What is asked of each page after that is read off
// `window.__ink.net.status()` and the game's own objects.
//
// The pages are windows of one Chrome. Chrome slows windows that are covered
// or in the background, and the pages would then be "away" to the room, so
// those switches are off. Pointer lock is stubbed: losing it pauses the game,
// and with four windows something always has it.
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

const GAME = process.env.OURS_URL || 'http://localhost:4173/';
const P3P2_DIR = process.env.P3P2_DIR || path.join(homedir(), 'Repos', 'p3p2');
const PORT = 18190;
const PASSWORD = process.env.P3P2_PASSWORD || 'ink raid coop password';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(44)} ${detail}`);
};

// --- the server -----------------------------------------------------------------
let SERVER = process.env.P3P2_URL;
let server = null;
if (!SERVER) {
  SERVER = `http://127.0.0.1:${PORT}`;
  server = spawn(process.execPath, [path.join(P3P2_DIR, 'server', 'src', 'main.ts')], {
    env: {
      ...process.env, P3P2_PORT: String(PORT), P3P2_PUBLIC_URL: SERVER, P3P2_DATA_DIR: ':memory:',
      P3P2_OWNER_PASSWORD: PASSWORD, P3P2_LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  process.on('exit', () => server.kill());
  const deadline = Date.now() + 20000;
  for (;;) {
    const ok = await fetch(`${SERVER}/healthz`).then((r) => r.ok, () => false);
    if (ok) break;
    if (Date.now() > deadline || server.exitCode !== null) {
      console.log(`  no p3p2 server at ${SERVER}: is p3p2 checked out at ${P3P2_DIR}, with npm install done?`);
      process.exit(1);
    }
    await sleep(100);
  }
}
console.log(`  p3p2 server ${SERVER}${server ? ` (started from ${P3P2_DIR})` : ''}, game ${GAME}\n`);

const browser = await chromium.launch({
  channel: 'chrome', headless: false,
  args: ['--hide-scrollbars', '--mute-audio', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
});

const errors = [];
/** A player: a browser profile of its own, on the game. */
async function open(name, o = {}) {
  const ctx = await browser.newContext(o.phone
    ? (({ defaultBrowserType: _, ...d }) => d)(devices['Pixel 7'])
    : { viewport: { width: o.w || 480, height: o.h || 300 }, deviceScaleFactor: o.dsf || 1 });
  await ctx.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = function () {}; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(`${name}: ${m.text()}`); });
  await page.goto(o.url || GAME, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__inkReady === true, null, { timeout: 30000 });
  return { name, ctx, page };
}
/** Wait until `fn(arg)` is true on the page, or `ms` has gone: returns whether it came true. */
const until = (p, fn, arg, ms = 10000) => p.page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);
const st = (p) => p.page.evaluate(() => window.__ink.net.status());
const run = (p, fn, arg) => p.page.evaluate(fn, arg);
const selfId = (p) => run(p, () => window.__ink.net.room?.self.id);

/** The owner's side: a room for this game, made in the portal. */
async function makeRoom(name) {
  const ctx = await browser.newContext();
  const portal = await ctx.newPage();
  await portal.goto(`${SERVER}/`);
  await portal.getByLabel('Password').fill(PASSWORD);
  await portal.getByRole('button', { name: 'Log in' }).click();
  await portal.getByLabel('Game URL').fill(GAME);
  await portal.getByLabel('Room name').fill(name);
  await portal.getByRole('button', { name: 'Create room' }).click();
  const url = await portal.getByLabel('Room URL').inputValue();
  await ctx.close();
  return url;
}

/** FRIENDS, the room URL, and the invite link to send. */
async function hostRoom(p, roomUrl) {
  await p.page.click('[data-a="friends"]');
  await p.page.getByLabel('Your name').fill(p.name);
  await p.page.getByLabel('Room URL').fill(roomUrl);
  await p.page.getByRole('status').filter({ hasText: '✓' }).waitFor({ timeout: 10000 });
  await p.page.getByRole('button', { name: 'Create a multiplayer game room for my friends' }).click();
  const invite = await p.page.getByLabel('Invite link', { exact: true }).inputValue();
  await p.page.keyboard.press('Escape');
  return invite;
}

/** Opens an invite link and says yes. */
async function join(name, invite, o = {}) {
  const p = await open(name, { ...o, url: invite });
  await p.page.getByLabel('Your name').fill(name);
  const yes = p.page.getByRole('button', { name: 'Join', exact: true });
  if (o.phone) await yes.tap(); else await yes.click();
  await until(p, () => window.__ink.net.inRoom(), null, 15000);
  return p;
}

/** Into the room's run from the title screen, as JOIN (or PLAY, for whoever starts it) does. */
const play = (p) => run(p, () => window.__ink.game.startRun());

/**
 * Nobody here dodges: players left standing at the start for a minute are shot
 * down, and a run with everybody down is over. So a player is hardy (a billion
 * health) except where a check means them to go down, and `hardy(p, false)`
 * puts the run's own health back.
 */
const hardy = (p, on = true) => run(p, (o) => {
  const P = window.__ink.player;
  P.maxHp = o ? 1e9 : window.__ink.difficulty.hp;
  P.hp = P.maxHp;
}, on);

/** On the page that runs the horde: this wave done at once, and the next one half a second later. */
async function nextWave(p) {
  const w = await run(p, () => {
    const G = window.__ink.game, en = G.ctx.enemies;
    G.waves.toSpawn = [];
    G.waves.state = 'clearing';
    for (const e of en.list) if (e.alive) en.damage(e, 1e6, { point: e.center.clone(), dir: e.center.clone().normalize(), crit: false });
    return G.waves.wave;
  });
  await until(p, () => window.__ink.game.waves.state === 'breather', null, 5000);
  await run(p, () => { window.__ink.game.waves.timer = 0.5; });
  return w;
}

/** Frame times on a page, the way tools/perf.mjs takes them. */
const frameTimes = (p) => run(p, () => new Promise((resolve) => {
  const out = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    out.push(now - last);
    last = now;
    if (out.length < 220) requestAnimationFrame(tick);
    else resolve(out.slice(20));
  };
  requestAnimationFrame(tick);
}));
const summarise = (f) => {
  f.sort((a, b) => a - b);
  return { fps: 1000 / f[f.length >> 1], p99: f[Math.floor(f.length * 0.99)] };
};

// --- alone ----------------------------------------------------------------------
// An ordinary visit loads the client's small entry, and asks no server anything.
{
  const seen = [];
  const p = await open('alone', { w: 640, h: 400 });
  p.page.on('request', (r) => seen.push(r.url()));
  p.page.on('websocket', (w) => seen.push(w.url()));
  await sleep(3000);
  const loaded = await run(p, () => performance.getEntriesByType('resource').map((r) => r.name));
  const away = [...seen, ...loaded].filter((u) => !u.startsWith(new URL(GAME).origin));
  const core = loaded.filter((u) => /p3p2-(core|panel)/.test(u));
  check('alone: no server asked anything', away.length === 0, away.length ? away.slice(0, 3).join(' ') : 'nothing but the game\'s own files');
  check('alone: the room code stays unloaded', core.length === 0, core.length ? core.join(' ') : 'p3p2-core and the panel never fetched');
  await p.ctx.close();
}

// --- two players -------------------------------------------------------------------
const roomUrl = await makeRoom('the desk');
const A = await open('Ann', { w: 640, h: 400 });
const invite = await hostRoom(A, roomUrl);
const B = await join('Bo', invite, { w: 480, h: 300 });
const aId = await selfId(A), bId = await selfId(B);
{
  const s = await st(B);
  check('two players: a guest is in the room', s.inRoom && !s.host && s.crew.some((c) => c.name === 'Ann'), `Bo sees ${s.crew.map((c) => c.name).join(', ')}`);
}
await play(A);
await until(B, () => window.__ink.net.runOn());
await play(B);
await hardy(A);
await hardy(B);
await until(A, () => window.__ink.net.horde.list().length >= 3, null, 30000);
await sleep(1500);
{
  const [ha, hb] = [await st(A), await st(B)];
  const ids = (h) => new Set(h.horde.map((e) => e.id));
  const ia = ids(ha), ib = ids(hb);
  const both = [...ia].filter((i) => ib.has(i));
  let far = 0;
  for (const e of ha.horde) {
    const o = hb.horde.find((x) => x.id === e.id);
    if (o && Math.hypot(o.pos[0] - e.pos[0], o.pos[2] - e.pos[2]) > 3) far++;
  }
  check('two players: the same figures', both.length >= Math.max(ia.size, ib.size) - 1 && far === 0,
    `${ia.size} on the host, ${ib.size} on the guest, ${both.length} the same, ${far} more than 3 m from where the host has them`);
  check('two players: the same run', ha.runId === hb.runId && hb.runId === ha.run.id && ha.state === 'playing' && hb.state === 'playing',
    `run ${ha.run.id}: host in ${ha.runId} (${ha.state}), guest in ${hb.runId} (${hb.state})`);
}
// the guest's hit takes a figure down, and the kill is the guest's
{
  const id = await run(B, () => {
    const en = window.__ink.game.ctx.enemies;
    const e = en.list.find((x) => x.alive && !x.t.role?.boss);
    en.damage(e, 1e5, { point: e.center.clone(), dir: e.center.clone().normalize(), crit: false });
    return e.id;
  });
  const gone = await until(A, (i) => !window.__ink.net.horde.list().some((e) => e.id === i), id);
  await sleep(600);
  const [ka, kb] = [await run(A, () => window.__ink.game.kills), await run(B, () => window.__ink.game.kills)];
  check('two players: a guest\'s hit downs a figure', gone && kb === 1 && ka === 0, `figure ${id} ${gone ? 'down on the host' : 'still up on the host'}; kills: guest ${kb}, host ${ka}`);
}

// --- shot at -----------------------------------------------------------------------
// A figure goes for the nearer player, and its rounds reach a guest on the
// guest's own page.
{
  const spot = await run(A, () => {
    const I = window.__ink, G = I.game, en = G.ctx.enemies, lv = G.ctx.level;
    const V = I.player.body.pos.constructor;
    // two points on the floor 12 m apart with nothing between them
    for (const s of lv.spawnPool) {
      for (let a = 0; a < 6.28; a += 0.5) {
        const q = new V(s.x + Math.cos(a) * 12, s.y + 1.5, s.z + Math.sin(a) * 12);
        const down = I.raycastLevel(q, new V(0, -1, 0), 3);
        if (!down || Math.abs(down.point.y - s.y) > 0.3) continue;
        const eye = new V(s.x, s.y + 1.5, s.z);
        const d = q.clone().sub(eye);
        if (I.raycastLevel(eye, d.clone().normalize(), d.length())) continue;
        en.clear();
        G.waves.toSpawn = [];
        G.waves.state = 'clearing';
        return { gun: [s.x, s.y, s.z], at: [q.x, down.point.y + 0.05, q.z] };
      }
    }
    return null;
  });
  // the host far off, the guest in front of where the gun will be
  await run(A, () => {
    const lv = window.__ink.game.ctx.level;
    const far = lv.spawnPool.reduce((a, s) => (Math.hypot(s.x, s.z) > Math.hypot(a.x, a.z) ? s : a));
    window.__ink.teleport(far.x, far.y + 0.1, far.z);
  });
  await run(B, (at) => window.__ink.teleport(at[0], at[1], at[2]), spot.at);
  // every round the host's page sends is flown here too: count them as they come
  await run(B, () => {
    const h = window.__ink.net.horde;
    const was = h.onShots.bind(h);
    window.__rounds = 0;
    h.onShots = (bytes) => { window.__rounds += bytes[8] || 0; was(bytes); };
  });
  await sleep(800);
  const hp0 = await run(B, () => window.__ink.player.hp);
  await run(A, (gun) => {
    const en = window.__ink.game.ctx.enemies;
    en.spawn('sketch', new (window.__ink.player.body.pos.constructor)(gun[0], gun[1] + 0.1, gun[2]), { mind: 'hunt' });
  }, spot.gun);
  const aimed = await until(A, (b) => window.__ink.net.horde.list().some((e) => e.target === b), bId, 5000);
  const hurt = await until(B, (h) => window.__ink.player.hp < h, hp0, 20000);
  const rounds = await run(B, () => window.__rounds);
  check('shot at: a figure goes for the nearer player', aimed, aimed ? 'its target is the guest, 12 m off; the host is across the desk' : 'never went for the guest');
  check('shot at: its rounds reach a guest', rounds > 0 && hurt, `${rounds} rounds flown on the guest's page, ${Math.round(hp0 - await run(B, () => window.__ink.player.hp))} damage taken`);
  // the gun off the desk, and the guest patched up, before it goes down
  await run(A, () => window.__ink.game.ctx.enemies.clear());
  await hardy(B);
}

// --- on the desk -------------------------------------------------------------------
// A bandage the host drops is on both pages, and goes to whoever walks over it.
{
  const at = await run(B, () => window.__ink.player.body.pos.toArray());
  await run(A, (p) => {
    const G = window.__ink.game;
    G.ctx.pickups.drop('bandage', new (window.__ink.player.body.pos.constructor)(p[0] + 3, p[1] + 0.5, p[2]));
  }, at);
  const there = await until(B, () => window.__ink.game.ctx.pickups.list.some((q) => q.item === 'bandage' && q.life !== Infinity));
  const before = await run(B, () => window.__ink.game.bandages);
  await run(B, () => { window.__ink.game.bandages = 0; });
  await run(B, (p) => window.__ink.teleport(p[0] + 3, p[1] + 0.2, p[2]), at);
  const took = await until(B, () => window.__ink.game.bandages === 1);
  const goneHost = await until(A, () => !window.__ink.game.ctx.pickups.list.some((q) => q.item === 'bandage' && q.life !== Infinity));
  await run(B, (n) => { window.__ink.game.bandages = n; }, before);
  check('on the desk: one bandage, for whoever gets there', there && took && goneHost,
    `on the guest's page ${there}, taken by the guest ${took}, gone from the host's ${goneHost}`);
}

// --- a friend's jetpack ------------------------------------------------------------
{
  await run(B, () => { window.__ink.input.state.jet = true; });
  const lit = await until(A, (b) => window.__ink.net.crew.mates.get(b)?.said?.j === 1, bId, 4000);
  const puffs = await run(A, (b) => {
    const m = window.__ink.net.crew.mates.get(b);
    const at = m.fig.root.position;
    return window.__ink.game.effects.particles.filter((q) => q.pos.distanceTo(at) < 4).length;
  }, bId);
  await run(B, () => { window.__ink.input.state.jet = false; });
  const out = await until(A, (b) => window.__ink.net.crew.mates.get(b)?.said?.j === 0, bId, 4000);
  check('a friend\'s jetpack is seen burning', lit && puffs > 0 && out, `lit on the host's page ${lit}, ${puffs} puffs round the figure, out again ${out}`);
}

// --- stragglers --------------------------------------------------------------------
// One left, unfound for longer than AWARE.straggle: it goes looking for the
// nearer of the two players, who here is the guest.
{
  const r = await run(A, async (b) => {
    const I = window.__ink, G = I.game, en = G.ctx.enemies, lv = G.ctx.level;
    const V = I.player.body.pos.constructor;
    en.clear();
    G.waves.toSpawn = [];
    G.waves.state = 'clearing';
    en.mods.alwaysHunt = false;
    en.highlightT = 0;
    const pool = lv.spawnPool;
    const s = pool[0];
    const e = en.spawn('cutter', new V(s.x, s.y + 0.1, s.z), { mind: 'roam' });
    // the guest 15 m from it, the host 40 m or more
    const byDist = (d) => pool.reduce((a, q) => (Math.abs(Math.hypot(q.x - s.x, q.z - s.z) - d) < Math.abs(Math.hypot(a.x - s.x, a.z - s.z) - d) ? q : a));
    const near = byDist(15), far = byDist(45);
    I.teleport(far.x, far.y + 0.1, far.z);
    return { id: e.id, near: [near.x, near.y + 0.1, near.z], far: [far.x, far.z], from: [s.x, s.z] };
  });
  // crouched and still, so it does not simply see the guest from 15 m and hunt
  await run(B, (p) => { window.__ink.input.state.crouch = true; window.__ink.teleport(p[0], p[1], p[2]); }, r.near);
  await sleep(1200);
  const seen = await run(A, async (id) => {
    const en = window.__ink.game.ctx.enemies;
    const e = en.byId(id);
    const proxy = [...window.__ink.net.crew.mates.values()][0].proxy;
    for (let i = 0; i < 40 && e.mind !== 'search'; i++) {
      en.contactT = 40;
      en.highlightT = 0;
      await new Promise((r) => setTimeout(r, 50));
    }
    return { mind: e.mind, home: e.home ? [e.home.x, e.home.z] : null, guest: [proxy.center.x, proxy.center.z] };
  }, r.id);
  await run(B, () => { window.__ink.input.state.crouch = false; });
  await run(A, () => window.__ink.game.ctx.enemies.clear());
  const off = seen.home ? Math.hypot(seen.home[0] - seen.guest[0], seen.home[1] - seen.guest[1]) : Infinity;
  check('stragglers look for the nearer player', seen.mind === 'search' && off < 1.5,
    `${seen.mind}, toward a point ${off.toFixed(1)} m from the guest (the host is ${Math.hypot(r.far[0] - r.from[0], r.far[1] - r.from[1]).toFixed(0)} m off)`);
}

// --- down, and up ------------------------------------------------------------------
// Down is out of the run until the next wave, and nothing lands on you meanwhile.
{
  await hardy(B, false);
  await run(B, () => window.__ink.player.damage(1e6));
  const down = await until(B, () => window.__ink.game.state === 'down', null, 3000);
  const onHost = await until(A, (b) => window.__ink.net.crew.mates.get(b)?.proxy.alive === false, bId, 3000);
  // a round straight through where the guest is: not judged, and no harm done
  const shot = await run(B, async () => {
    const I = window.__ink, G = I.game, en = G.ctx.enemies, p = I.player;
    G.effects.hurt = 0;
    const from = p.center.clone().add(new p.center.constructor(0, 0, 4));
    const vel = new p.center.constructor(0, 0, -40);
    en.bullets.push({ pos: from, vel, dmg: 20, life: 1, from: null, returned: false, origin: null, falloff: null, sticks: 0, lag: 0 });
    const b = en.bullets[en.bullets.length - 1];
    await new Promise((r) => setTimeout(r, 300));
    return { hurt: G.effects.hurt, past: b.pos.z < p.center.z - 1 || !en.bullets.includes(b) };
  });
  const target = await run(A, (b) => window.__ink.net.targets([]).some((q) => q.remote === b), bId);
  check('down: out until the next wave', down && onHost && !target, `guest down ${down}, down on the host's page ${onHost}, still a target ${target}`);
  check('down: no round lands on a downed player', shot.hurt === 0 && shot.past, `hurt flash ${shot.hurt}, the round flew on ${shot.past}`);
  // the next wave: the host clears this one
  const wave = await nextWave(A);
  const up = await until(B, () => window.__ink.game.state === 'playing' && window.__ink.player.alive, null, 20000);
  await hardy(B);
  check('down: back up when the next wave starts', up, `wave ${wave} -> ${await run(B, () => window.__ink.game.waves.wave)}, guest ${await run(B, () => window.__ink.game.state)}`);
}

// --- four players ------------------------------------------------------------------
const C = await join('Cy', invite, { w: 360, h: 240 });
const D = await join('Di', invite, { w: 360, h: 240 });
await play(C);
await play(D);
await hardy(C);
await hardy(D);
await sleep(2000);
{
  const r = await run(A, () => {
    const G = window.__ink.game;
    return { players: G.waves.players().length, cap: G.waves.cap(), base: window.__ink.difficulty.crowdCap };
  });
  check('four players: one run, all four in it', r.players === 4, `${r.players} players the horde can go for`);
  check('four players: more alive at once', r.cap === Math.min(Math.max(r.base, 20), r.base + 6), `up to ${r.cap} at once (alone ${r.base})`);
  await until(A, () => window.__ink.net.horde.list().length >= 3, null, 30000);
  await sleep(1500);
  const ids = async (p) => new Set((await st(p)).horde.map((e) => e.id));
  const sets = [await ids(A), await ids(B), await ids(C), await ids(D)];
  const same = sets.slice(1).every((s) => [...sets[0]].filter((i) => s.has(i)).length >= sets[0].size - 1);
  check('four players: one horde', same, sets.map((s) => s.size).join(' / ') + ' figures, host / guests');
}

// --- frame times with friends ------------------------------------------------------
// A phone-sized guest page at a phone's 6x CPU throttle, in the room's run with
// everybody else, against the same page on its own a moment before. The other
// windows are small, but they share this machine's GPU, and they are drawing
// for both measurements: the absolute numbers here say little (tools/perf.mjs
// measures those, one window at a time), the difference says what friends cost.
{
  const P = await open('Ed', { w: 390, h: 844, dsf: 2 });
  const cdp = await P.ctx.newCDPSession(P.page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await run(P, () => {
    const G = window.__ink.game;
    G.startRun();
    for (let i = 0; i < 8; i++) G.ctx.enemies.spawn(i % 3 ? 'sketch' : 'cutter', G.ctx.level.spawns[i % G.ctx.level.spawns.length], { mind: 'hunt' });
  });
  await sleep(2500);
  const alone = summarise(await frameTimes(P));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await P.ctx.close();

  const E = await join('Ed', invite, { w: 390, h: 844, dsf: 2 });
  await play(E);
  await hardy(E);
  const cdp2 = await E.ctx.newCDPSession(E.page);
  await run(A, () => {
    const G = window.__ink.game;
    for (let i = 0; i < 8; i++) G.ctx.enemies.spawn(i % 3 ? 'sketch' : 'cutter', G.ctx.level.spawns[i % G.ctx.level.spawns.length], { mind: 'hunt' });
  });
  await sleep(1500);
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 6 });
  await sleep(2500);
  const crew = summarise(await frameTimes(E));
  await cdp2.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const mates = (await st(E)).crew.length;
  check('with friends: a phone\'s frames cost no more', crew.fps >= alone.fps * 0.85 && crew.p99 <= alone.p99 * 1.15 + 3,
    `${crew.fps.toFixed(0)} fps median, p99 ${crew.p99.toFixed(1)} ms with ${mates} friends; alone ${alone.fps.toFixed(0)} fps, p99 ${alone.p99.toFixed(1)} ms (6x CPU throttle)`);
  await E.ctx.close();
}

// --- a reload ----------------------------------------------------------------------
{
  const was = await st(C);
  const said = [];
  C.page.on('console', (m) => said.push(`${m.type()}: ${m.text()}`));
  await C.page.reload({ waitUntil: 'load' });
  await C.page.waitForFunction(() => window.__inkReady === true, null, { timeout: 30000 });
  const back = await until(C, () => window.__ink.net.inRoom() && window.__ink.net.runOn(), null, 15000);
  if (!back) {
    console.log(`        before: in the room ${was.inRoom}, ${was.state}; session ${await run(C, () => Object.keys(sessionStorage).join(','))}`);
    for (const l of said.filter((x) => !x.includes('404')).slice(0, 8)) console.log(`        ${l}`);
  }
  await play(C);
  await hardy(C);
  const s = await st(C);
  check('a reload: back in the room and the run', back && s.runId === s.run?.id && s.state === 'playing', `in the room ${back}, run ${s.runId} of ${s.run?.id}, ${s.state}`);
}

// --- the host leaves mid-wave ------------------------------------------------------
{
  await until(A, () => window.__ink.net.horde.list().length >= 2, null, 30000);
  const before = await st(A);
  await A.ctx.close();
  const guests = [B, C, D];
  let next = null;
  for (let i = 0; i < 100 && !next; i++) {
    for (const g of guests) if ((await st(g)).host) next = g;
    if (!next) await sleep(100);
  }
  const s = next ? await st(next) : null;
  const kept = s ? before.horde.filter((e) => s.horde.some((x) => x.id === e.id)).length : 0;
  check('the host leaves: the next one runs the same figures', !!next && kept >= before.horde.length - 1 && s.run?.on,
    next ? `${next.name} took over with ${kept} of the ${before.horde.length} figures, wave ${s.wave} (${s.waveState})` : 'nobody took over');
  if (next) {
    // and the wave can be finished
    const w0 = await nextWave(next);
    const on = await until(next, (w) => window.__ink.game.waves.wave > w, w0, 15000);
    check('the host leaves: the wave can be finished', on, `wave ${w0} -> ${await run(next, () => window.__ink.game.waves.wave)}`);
  }
}

// --- everybody down ----------------------------------------------------------------
{
  const left = [B, C, D];
  for (const p of left) await hardy(p, false);
  for (const p of left) await run(p, () => window.__ink.player.damage(1e6));
  let over = true;
  for (const p of left) {
    over = (await until(p, () => window.__ink.game.state === 'dead' && !window.__ink.net.runOn(), null, 5000)) && over;
  }
  const states = [];
  for (const p of left) states.push((await st(p)).state);
  check('everybody down: the run is over for everybody', over, states.join(', '));
  if (!over) {
    for (const p of left) {
      const s = await st(p);
      console.log(`        ${p.name}: host ${s.host}, ${s.state}, run ${s.runId} of ${JSON.stringify(s.run)}; sees ${JSON.stringify(s.crew.map((c) => [c.id, c.name, c.state, c.alive, c.run]))}`);
    }
  }
}

// --- a phone -----------------------------------------------------------------------
{
  const F = await join('Fi', invite, { phone: true });
  check('a phone: in by the link, Join by touch', await run(F, () => window.__ink.net.inRoom()), `touch layer ${await run(F, () => window.__ink.game.touch.enabled)}`);
  await F.page.locator('[data-a="friends"]').tap();
  const card = F.page.getByRole('dialog', { name: 'Multiplayer' });
  await card.waitFor({ timeout: 5000 }).catch(() => {});
  const box = await card.boundingBox().catch(() => null);
  const vp = F.page.viewportSize();
  const fits = !!box && box.x >= -1 && box.y >= -1 && box.x + box.width <= vp.width + 1 && box.y + box.height <= vp.height + 1;
  await F.page.screenshot({ path: 'shots/stills/coop-phone-panel.png' });
  check('a phone: FRIENDS by touch, a panel that fits', fits,
    box ? `${Math.round(box.width)}x${Math.round(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)}) in ${vp.width}x${vp.height}` : 'no panel');
  await F.page.getByRole('button', { name: 'Close' }).tap().catch(() => {});
  // a run started by somebody else, and JOIN by touch
  await play(B);
  await until(F, () => window.__ink.net.runOn(), null, 10000);
  await sleep(500);
  await F.page.locator('[data-difficulty]').first().tap();
  const inRun = await until(F, () => window.__ink.game.state === 'playing' && window.__ink.game.runId === window.__ink.net.run.id, null, 8000);
  // the thumb stick walks: a finger down on the left, pushed up
  const before = await run(F, () => window.__ink.player.body.pos.toArray());
  const cdp = await F.ctx.newCDPSession(F.page);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await touch('touchStart', [{ id: 1, x: 80, y: vp.height - 200 }]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ id: 1, x: 80, y: vp.height - 200 - i * 12 }]); await sleep(30); }
  await sleep(900);
  await touch('touchEnd', []);
  const after = await run(F, () => window.__ink.player.body.pos.toArray());
  const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
  check('a phone: JOIN by touch, and the stick walks', inRun && moved > 1, `in the run ${inRun}, walked ${moved.toFixed(1)} m`);
  await F.ctx.close();
}

check('no page errors', errors.length === 0, errors.length ? errors.slice(0, 3).join(' | ') : 'clean');

await browser.close();
server?.kill();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
