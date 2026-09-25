// Movement regression tests.
//
// Feel is judged by hand. But the things that make it feel wrong — a sprint that
// never reaches its speed, a jump that misses its apex, a slide that never ends,
// a step-up that catches — are all numbers, and numbers can be checked every
// time something in the movement code changes.
import { chromium } from 'playwright';
import * as THREE from 'three';
import { Builder } from '../src/world/build.js';
import { Player, MOVE } from '../src/entities/player.js';

const URL_BASE = process.env.OURS_URL || 'http://localhost:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(26)} ${detail}`);
}

// --- in node: the real Player against shapes built for the purpose ----------
// No browser, no frame timing: 60 fps exactly, so these are not flaky.
function nodePlayer(build, at, yaw) {
  const b = new Builder();
  b.box(0, -1, 0, 120, 1, 120);
  build(b);
  const level = b.finish(new THREE.Scene());
  level.killY = -20;
  level.startPoint = at;
  const p = new Player({ level, camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene() });
  p.yaw = yaw;
  const held = new Set(), taps = new Set();
  const input = { look: () => ({ yaw: 0, pitch: 0 }), down: (k) => held.has(k), pressed: (k) => taps.has(k) };
  return { p, held, taps, step: () => { p.update(1 / 60, input); taps.clear(); } };
}

// Jump into a lip and hold forward: you end up on it, head-on or at an angle.
// At 40 degrees the old vault got you on to nothing between 0.8 and 2.4 m: the
// wall zeroed its forward push, and sliding along the lip had already put you
// over the air-control cap.
{
  const missed = [];
  for (const deg of [0, 40]) {
    for (let h = 0.6; h <= 2.41; h += 0.2) {
      const a = (deg * Math.PI) / 180;
      const { p, held, taps, step } = nodePlayer((b) => b.box(0, 0, -22, 60, h, 40),
        new THREE.Vector3(Math.sin(a) * 4, 0.05, -2 + Math.cos(a) * 4), a);
      held.add('forward');
      let jumped = false, on = false;
      for (let i = 0; i < 120 && !on; i++) {
        if (!jumped && p.body.touchingWall && p.body.onGround) { taps.add('jump'); jumped = true; }
        step();
        on = p.body.onGround && p.body.pos.y > h - 0.05;
      }
      if (!on) missed.push(`${h.toFixed(1)} m at ${deg}`);
    }
  }
  check('mantle, any angle', missed.length === 0,
    missed.length ? `missed ${missed.join(', ')}` : 'every lip 0.6-2.4 m, head-on and at 40 deg');
}

// Down a slope as steep as the stairs you stay on it. Before, you left the
// ground and landed again on 76 frames of 80.
{
  const { p, held, step } = nodePlayer((b) => b.ramp(0, 0, 0, '+z', 14, 6, { rise: 0.75, thick: 0.6 }),
    new THREE.Vector3(0, 11.5, 6.5), 0);
  for (let i = 0; i < 30; i++) step();
  held.add('forward');
  let frames = 0, landings = 0, was = true;
  for (let i = 0; i < 100; i++) {
    step();
    if (p.body.pos.z > -6.5 && p.body.pos.z < 6) { frames++; if (p.body.onGround && !was) landings++; }
    was = p.body.onGround;
  }
  check('downhill stays grounded', frames > 40 && landings === 0, `${landings} landings in ${frames} frames down a 37 deg slope`);
}

// Crouched, you do not walk off an edge, for easier sniping. Standing, you do.
{
  const run = (crouch) => {
    const { p, held, step } = nodePlayer((b) => b.box(0, 0, -5, 10, 2, 10), new THREE.Vector3(0, 2.05, -5), 0);
    if (crouch) held.add('crouch');
    for (let i = 0; i < 30; i++) step();
    held.add('forward');
    for (let i = 0; i < 180; i++) step();
    return p.body.pos;
  };
  const low = run(true), high = run(false);
  // the ledge is at z = -10, and the body is 0.35 m either side of its middle
  check('crouch stops at a ledge', low.y > 1.99 && low.z < -9.6 && low.z > -10.36 && high.y < 1,
    `crouched: on it at z ${low.z.toFixed(2)} (edge -10); standing: walked off to y ${high.y.toFixed(2)}`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--hide-scrollbars', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  [page throw]', e.message));
// Run against the calibration scene: it has a large clear floor. On the real map
// every test walks into the furniture after half a second and measures that
// instead of what it meant to measure.
await page.goto(URL_BASE + '?scene=calib', { waitUntil: 'load' });
await page.waitForFunction(() => window.__inkReady === true, { timeout: 30000 });
await sleep(400);

// Put the player on known flat ground before each test, and WAIT UNTIL IT HAS
// LANDED. Guessing a settle time is how the first version of this file measured
// an air jump and called it a ground jump.
async function reset(yaw = Math.PI, x = PAD_X, z = PAD_Z) {
  await page.evaluate(([px, pz, yw]) => {
    window.__ink.teleport(px, 1.2, pz);
    window.__ink.face(yw, 0);
  }, [x, z, yaw]);
  for (let i = 0; i < 40; i++) {
    await sleep(25);
    const p = await page.evaluate(() => window.__ink.probe());
    if (p.onGround && Math.abs(p.vel[1]) < 0.01 + 2.01) return p;
  }
  throw new Error('player never settled on the ground');
}

const sim = (actions, ms) => page.evaluate(([a, m]) => window.__ink.sim(a, m), [actions, ms]);
const probe = () => page.evaluate(() => window.__ink.probe());
const hold = (a) => page.evaluate((k) => { for (const x of k) window.__ink.input.state[x] = true; }, a);
const release = (a) => page.evaluate((k) => { for (const x of k) window.__ink.input.state[x] = false; }, a);

// A wide clear patch of the calibration floor, far from every test object, so a
// nine-metre run has somewhere to go.
const PAD_X = -70, PAD_Z = 40;
await page.evaluate(() => window.__ink.resetWorst());

// --- ground speeds ---------------------------------------------------------
await reset();
let r = await sim(['forward'], 900);
check('walk speed', Math.abs(r.speed - MOVE.walkSpeed) < 0.6, `${r.speed} m/s (want ${MOVE.walkSpeed})`);

await reset();
r = await sim(['forward', 'sprint'], 900);
check('sprint speed', Math.abs(r.speed - MOVE.sprintSpeed) < 0.8, `${r.speed} m/s (want ${MOVE.sprintSpeed})`);

await reset();
r = await sim(['forward', 'crouch'], 900);
check('crouch speed', Math.abs(r.speed - MOVE.crouchSpeed) < 0.7, `${r.speed} m/s (want ${MOVE.crouchSpeed})`);
check('crouch lowers eye', r.eyeY - r.pos[1] < 1.25, `eye ${(r.eyeY - r.pos[1]).toFixed(2)} above feet (want ~1.0)`);

// --- jump ------------------------------------------------------------------
await reset();
const ground = (await probe()).pos[1];
await page.evaluate(() => window.__ink.tap('jump'));
let apex = ground;
for (let i = 0; i < 26; i++) {
  await sleep(16);
  const p = await probe();
  if (p.pos[1] > apex) apex = p.pos[1];
}
// v^2 / 2g
const hop = MOVE.jumpSpeed ** 2 / (2 * MOVE.gravity);
check('jump height', Math.abs((apex - ground) - hop) < 0.22, `${(apex - ground).toFixed(2)} m (want ${hop.toFixed(2)})`);

// --- double jump -----------------------------------------------------------
await reset();
await page.evaluate(() => window.__ink.tap('jump'));
await sleep(220);
const beforeDouble = await probe();
await page.evaluate(() => window.__ink.tap('jump'));
await sleep(60);
const afterDouble = await probe();
check('double jump', afterDouble.vel[1] > beforeDouble.vel[1] + 3 && afterDouble.hopsLeft === 0,
  `vy ${beforeDouble.vel[1]} -> ${afterDouble.vel[1]}, hopsLeft ${afterDouble.hopsLeft}`);
await sleep(900);
const landed = await probe();
check('hopsLeft restored', landed.onGround && landed.hopsLeft === 1, `onGround ${landed.onGround}, hopsLeft ${landed.hopsLeft}`);

// --- ground contact --------------------------------------------------------
const settled = await reset();
check('lands on ground', settled.onGround, `settled at y=${settled.pos[1]}`);

// --- slide -----------------------------------------------------------------
await reset();
await page.evaluate(() => { window.__ink.input.state.forward = true; window.__ink.input.state.sprint = true; });
await sleep(800);
const preSlide = await probe();
await page.evaluate(() => { window.__ink.input.state.crouch = true; });
await sleep(90);
const inSlide = await probe();
await sleep(1400);
const postSlide = await probe();
await page.evaluate(() => {
  const s = window.__ink.input.state;
  s.forward = s.sprint = s.crouch = false;
});
check('slide boosts', inSlide.sliding && inSlide.speed > preSlide.speed,
  `${preSlide.speed} -> ${inSlide.speed} m/s, sliding=${inSlide.sliding}`);
check('slide ends', !postSlide.sliding, `speed decayed to ${postSlide.speed}, sliding=${postSlide.sliding}`);

// --- air dash --------------------------------------------------------------
await reset();
await page.evaluate(() => window.__ink.tap('jump'));
await sleep(160);
await page.evaluate(() => window.__ink.tap('crouch'));
await sleep(70);
const dashed = await probe();
check('air dash', dashed.speed > 18, `${dashed.speed} m/s (want ~${MOVE.dashSpeed})`);

// --- no falling through the world -----------------------------------------
await page.evaluate(([x, z]) => { window.__ink.teleport(x, 40, z); }, [PAD_X, PAD_Z]);
await sleep(2200);
const dropped = await probe();
check('survives a long drop', dropped.onGround && dropped.pos[1] > -5,
  `y=${dropped.pos[1]}, onGround=${dropped.onGround}`);

// --- grapple ---------------------------------------------------------------
{
  // the calibration wall: a known box, straight ahead, well inside grapple range
  await page.evaluate(() => {
    window.__ink.teleport(-24, 2, -12);
    window.__ink.face(Math.PI * 0, 0.25);      // yaw 0 looks along -z
  });
  await sleep(700);
  const aim = await probe();
  await page.evaluate(() => window.__ink.tap('grapple'));
  await sleep(120);
  const hooked = await probe();
  check('grapple attaches', hooked.grapple.attached, `target=${aim.grapple.target}, attached=${hooked.grapple.attached}`);
  if (hooked.grapple.attached) {
    await sleep(700);
    const pulled = await probe();
    check('grapple pulls', pulled.speed > 3 || pulled.vel[1] > 2, `speed ${pulled.speed}, vy ${pulled.vel[1]}`);
    check('grapple drains stamina', pulled.grapple.stam < hooked.grapple.stam,
      `${hooked.grapple.stam} -> ${pulled.grapple.stam}`);
    await page.evaluate(() => window.__ink.tap('grapple'));
    await sleep(1500);
    const regen = await probe();
    check('stamina regenerates', regen.grapple.stam > pulled.grapple.stam, `${pulled.grapple.stam} -> ${regen.grapple.stam}`);
  }
}

// --- mantle ----------------------------------------------------------------
// The calibration pyramid's first step is 1.4 tall: too tall for step-up, well
// inside mantle range. Walking into it must end up on top of it.
{
  await page.evaluate(() => { window.__ink.teleport(0, 1.2, 26); window.__ink.face(0, 0); });
  await sleep(600);
  const before = await probe();
  await hold(['forward']);
  await sleep(900);
  await page.evaluate(() => window.__ink.tap('jump'));
  await sleep(900);
  const after = await probe();
  await release(['forward']);
  check('mantle onto a ledge', after.pos[1] > before.pos[1] + 1.0,
    `y ${before.pos[1]} -> ${after.pos[1]} (step top is 1.4)`);
}

// --- wall jump -------------------------------------------------------------
{
  // run at the calibration wall, jump into it, then jump again off the face
  await page.evaluate(() => { window.__ink.teleport(-24, 1.2, -22); window.__ink.face(0, 0); });
  await sleep(600);
  await hold(['forward', 'sprint']);
  await sleep(1100);
  const atWall = await probe();
  await page.evaluate(() => window.__ink.tap('jump'));
  await sleep(120);
  await page.evaluate(() => window.__ink.tap('jump'));
  await sleep(90);
  const kicked = await probe();
  await release(['forward', 'sprint']);
  check('wall jump', kicked.vel[1] > 3 && kicked.vel[2] > 1,
    `touching wall at z=${atWall.pos[2]}, then vy=${kicked.vel[1]} vz=${kicked.vel[2]}`);
  await sleep(900);
}

// --- coyote time -----------------------------------------------------------
// Run off the edge of the pyramid's top step and jump a moment AFTER leaving the
// ground. Without coyote time this silently does nothing, and the player blames
// themselves.
{
  await page.evaluate(() => { window.__ink.teleport(0, 8.0, 14); window.__ink.face(0, 0); });
  await sleep(700);
  await hold(['forward', 'sprint']);
  let leftGround = -1;
  for (let i = 0; i < 60; i++) {
    await sleep(16);
    const p = await probe();
    if (!p.onGround) { leftGround = i; break; }
  }
  await sleep(60);                      // ~4 frames of coyote grace
  const preJump = await probe();
  await page.evaluate(() => window.__ink.tap('jump'));
  await sleep(70);
  const postJump = await probe();
  await release(['forward', 'sprint']);
  check('coyote time', leftGround >= 0 && postJump.vel[1] > preJump.vel[1] + 3,
    `left ground, then vy ${preJump.vel[1]} -> ${postJump.vel[1]}`);
  await sleep(900);
}

// --- grapple straight up ---------------------------------------------------
// The case that was broken: hooking something overhead while standing still.
// If the tug does not beat gravity, this does nothing at all.
{
  await page.evaluate(() => {
    window.__ink.teleport(0, 1.2, -6);          // under the calibration overhang
    window.__ink.face(0, 1.35);                 // almost straight up
  });
  await sleep(700);
  await page.evaluate(() => window.__ink.tap('grapple'));
  await sleep(500);
  const up = await probe();
  check('grapple lifts you', up.grapple.attached && up.vel[1] > 3 && up.pos[1] > 0.5,
    `attached=${up.grapple.attached}, vy=${up.vel[1]}, y=${up.pos[1]}`);
  await page.evaluate(() => window.__ink.tap('grapple'));
  await sleep(400);
}

// --- nothing exploded ------------------------------------------------------
const fin = await probe();
const finite = [...fin.pos, ...fin.vel, fin.fov, fin.eyeY].every(Number.isFinite);
check('no NaN anywhere', finite, JSON.stringify({ pos: fin.pos, fov: fin.fov, eyeY: fin.eyeY }));

const stats = await page.evaluate(() => window.__ink.stats());
console.log(`\n  ${stats.fps} fps, ${stats.drawCalls} draw calls, worst frame ${stats.worstFrame} ms`);

await browser.close();
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
