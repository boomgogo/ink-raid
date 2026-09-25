// Touch controls, driven by emulated touches.
//
//   node tools/touch.mjs
//
// WHAT THIS IS NOT: a substitute for a human thumb on real hardware. It cannot
// tell you whether the stick sits where your hand naturally rests, whether the
// buttons are reachable without regripping, or whether the look sensitivity
// feels right. Those need a person and a phone, and the checklist it prints at
// the end is for that person.
//
// What it CAN tell you, and what has never been checked at all, is whether the
// controls are wired up: that the layer appears on a coarse pointer, that a
// drag on the left half moves the player, that a drag on the right half turns
// the camera WITHOUT firing, that a tap fires, that FIRE holds the trigger and
// aims while held, that the buttons reach their actions, and that every control
// meets the 44 px minimum touch target. Those are exactly the things that rot
// silently, because nothing in `npm run game` touches them.
//
// It also plays a touchscreen LAPTOP, driven by its mouse and a pad: the thumb
// buttons stay away until the screen is touched, and neither the mouse nor the
// pad loses its trigger to them.
import { chromium, devices } from 'playwright';
import path from 'node:path';

const URL_BASE = process.env.OURS_URL || 'http://localhost:4173/';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(28)} ${detail}`);
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--hide-scrollbars', '--mute-audio'],
});
const ctx = await browser.newContext({
  ...devices['Pixel 5'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('THROW ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('ERR ' + m.text()); });

await page.goto(URL_BASE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__inkReady === true, { timeout: 30000 });
await sleep(900);

const probe = () => page.evaluate(() => window.__ink.probe());
const state = () => page.evaluate(() => {
  const G = window.__ink.game;
  return { state: G.state, hp: Math.round(G.ctx.player.hp), kills: G.kills, mag: G.weapon.mag, alive: G.ctx.enemies.alive };
});

// A touch drag, as a real sequence of touch events. Playwright's touchscreen
// API only taps, so the drag goes through CDP-backed dispatchEvent.
async function drag(from, to, steps = 10, holdMs = 0) {
  await page.evaluate(([f, t, n, hold]) => {
    const el = document.elementFromPoint(f.x, f.y) || document.body;
    const mk = (type, x, y) => {
      const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y, pageX: x, pageY: y });
      el.dispatchEvent(new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [touch],
        targetTouches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
        bubbles: true, cancelable: true,
      }));
    };
    mk('touchstart', f.x, f.y);
    return new Promise((res) => {
      let i = 0;
      const tick = () => {
        i++;
        const k = i / n;
        mk('touchmove', f.x + (t.x - f.x) * k, f.y + (t.y - f.y) * k);
        if (i < n) return setTimeout(tick, 16);
        setTimeout(() => { mk('touchend', t.x, t.y); res(); }, hold);
      };
      setTimeout(tick, 16);
    });
  }, [from, to, steps, holdMs]);
}

async function tap(x, y, ms = 60) {
  await page.evaluate(([px, py, hold]) => {
    const el = document.elementFromPoint(px, py) || document.body;
    const mk = (type) => {
      const touch = new Touch({ identifier: 2, target: el, clientX: px, clientY: py, pageX: px, pageY: py });
      el.dispatchEvent(new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [touch],
        targetTouches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch], bubbles: true, cancelable: true,
      }));
    };
    mk('touchstart');
    return new Promise((r) => setTimeout(() => { mk('touchend'); r(); }, hold));
  }, [x, y, ms]);
}

// --- the layer appears ------------------------------------------------------
const shown = await page.evaluate(() => {
  const el = document.querySelector('.touch');
  return !!el && el.classList.contains('on');
});
check('touch layer enabled', shown, 'on a coarse pointer, before the run starts');

// --- touch targets are big enough -------------------------------------------
// 44 CSS px is the floor every platform guideline agrees on, and it is the one
// thing about a touch layout that can be checked without a hand.
const small = await page.evaluate(() => {
  const out = [];
  for (const b of document.querySelectorAll('.touch .tbtn')) {
    if (getComputedStyle(b).display === 'none') continue;      // HEAL, with nothing to heal with
    const r = b.getBoundingClientRect();
    if (r.width < 44 || r.height < 44) out.push(`${b.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
});
check('touch targets >= 44px', small.length === 0, small.length ? small.join(', ') : 'every button clears the 44px floor');

// --- controls are on screen, not off the edge -------------------------------
const offscreen = await page.evaluate(() => {
  const vw = innerWidth, vh = innerHeight;
  const out = [];
  for (const b of document.querySelectorAll('.touch .tbtn')) {
    if (getComputedStyle(b).display === 'none') continue;
    const r = b.getBoundingClientRect();
    if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) {
      out.push(`${b.textContent.trim()} @${Math.round(r.left)},${Math.round(r.top)}`);
    }
  }
  return out;
});
check('controls within the screen', offscreen.length === 0, offscreen.length ? offscreen.join(', ') : `all inside 390x844`);

// --- into the game ----------------------------------------------------------
await page.evaluate(() => window.__ink.game.startRun());
await sleep(700);
check('run starts', (await state()).state === 'playing', `state=${(await state()).state}`);
// Survival is not under test here, the input path is. With the aiming and FIRE
// checks the session runs long enough for the waves to kill the player before
// the RELOAD and kill checks, which then fail on a death screen ("state dead,
// hp 0") rather than on anything a thumb did.
await page.evaluate(() => { window.__ink.player.damage = () => {}; });

// --- the stick moves you ----------------------------------------------------
const before = await probe();
await drag({ x: 90, y: 620 }, { x: 90, y: 500 }, 8, 900);
const after = await probe();
const moved = Math.hypot(after.pos[0] - before.pos[0], after.pos[2] - before.pos[2]);
check('stick moves the player', moved > 1.5, `moved ${moved.toFixed(2)} m on a left-half drag`);

// --- the look pad turns you -------------------------------------------------
const yaw0 = await page.evaluate(() => window.__ink.player.yaw);
await drag({ x: 300, y: 400 }, { x: 180, y: 400 }, 10, 60);
await sleep(200);
const yaw1 = await page.evaluate(() => window.__ink.player.yaw);
check('look pad turns the camera', Math.abs(yaw1 - yaw0) > 0.15, `yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)}`);

// --- aiming never fires -----------------------------------------------------
// The look pad used to pull the trigger once a touch had been down 260 ms, as
// "hold the thumb still to keep firing" — but nothing checked still, so every
// aim longer than a quarter second fired: two seconds of aiming, twenty rifle
// rounds. The drag above lasts 220 ms, which is why this file never saw it.
{
  const yawA = await page.evaluate(() => { const G = window.__ink.game; G.weapon.mag = G.weapon.stats.ammo.clipSize; return window.__ink.player.yaw; });
  const magA = (await state()).mag;
  await drag({ x: 300, y: 400 }, { x: 200, y: 440 }, 110, 200);
  await sleep(250);
  const magB = (await state()).mag;
  const yawB = await page.evaluate(() => window.__ink.player.yaw);
  check('aiming never fires', magB === magA && Math.abs(yawB - yawA) > 0.15,
    `${magA - magB} rounds in a 2 s aim, view turned ${Math.abs(yawB - yawA).toFixed(2)} rad`);
}

// --- a tap fires ------------------------------------------------------------
const mag0 = (await state()).mag;
await tap(300, 500);
await sleep(400);
const mag1 = (await state()).mag;
check('tap fires the weapon', mag1 < mag0, `mag ${mag0} -> ${mag1}`);

// --- FIRE: hold to keep firing, drag on it to aim while you do ---------------
{
  const fireAt = await page.evaluate(() => {
    const b = document.querySelector('.touch .tfire');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!fireAt) {
    check('FIRE held fires', false, 'no FIRE button found');
    check('FIRE drag aims and fires', false, 'no FIRE button found');
  } else {
    await page.evaluate(() => { const w = window.__ink.game.weapon; w.mag = w.stats.ammo.clipSize; w.reloading = 0; });
    const m0 = (await state()).mag;
    await tap(fireAt.x, fireAt.y, 500);
    await sleep(150);
    const m1 = (await state()).mag;
    check('FIRE held fires', m0 - m1 >= 4, `${m0 - m1} rounds from holding FIRE for 0.5 s`);

    await sleep(300);
    const y0 = await page.evaluate(() => { const w = window.__ink.game.weapon; w.mag = w.stats.ammo.clipSize; return window.__ink.player.yaw; });
    const m2 = (await state()).mag;
    await drag(fireAt, { x: fireAt.x - 120, y: fireAt.y - 20 }, 40, 0);
    await sleep(150);
    const m3 = (await state()).mag;
    const y1 = await page.evaluate(() => window.__ink.player.yaw);
    check('FIRE drag aims and fires', m2 - m3 >= 3 && Math.abs(y1 - y0) > 0.15,
      `${m2 - m3} rounds, view turned ${Math.abs(y1 - y0).toFixed(2)} rad`);
  }
}

// --- buttons reach their actions -------------------------------------------
const btnBoxes = await page.evaluate(() => {
  const out = {};
  for (const b of document.querySelectorAll('.touch .tbtn[data-a]')) {
    const r = b.getBoundingClientRect();
    out[b.dataset.a] = [r.left + r.width / 2, r.top + r.height / 2];
  }
  return out;
});

if (btnBoxes.jump) {
  const y0 = (await probe()).pos[1];
  await tap(btnBoxes.jump[0], btnBoxes.jump[1], 120);
  // Sample the whole arc, not one instant: where the apex falls depends on the
  // frame the press landed on, and a fixed delay reads a different part of the
  // jump every run.
  let peak = y0;
  for (let i = 0; i < 12; i++) { await sleep(60); peak = Math.max(peak, (await probe()).pos[1]); }
  check('JUMP button', peak > y0 + 0.35, `y ${y0.toFixed(2)} -> peak ${peak.toFixed(2)}`);
  await sleep(700);
} else {
  check('JUMP button', false, 'no jump button found');
}

if (btnBoxes.reload) {
  await page.evaluate(() => { window.__ink.game.weapon.mag = 3; });
  await tap(btnBoxes.reload[0], btnBoxes.reload[1], 120);
  await sleep(2200);
  const m = (await state()).mag;
  check('RELOAD button', m > 3, `mag 3 -> ${m}`);
} else {
  check('RELOAD button', false, 'no reload button found');
}

// --- HEAL: there while you carry a bandage, and it wraps one ------------------
{
  const heal = await page.evaluate(() => {
    const G = window.__ink.game;
    G.bandages = 1;
    const b = document.querySelector('.touch .theal');
    return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = b && getComputedStyle(b).display !== 'none' ? b.getBoundingClientRect() : null;
      const clash = r && [...document.querySelectorAll('.touch .tbtn')].some((o) => {
        if (o === b || getComputedStyle(o).display === 'none') return false;
        const q = o.getBoundingClientRect();
        return q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top;
      });
      done(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, on: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, clash } : null);
    })));
  });
  if (!heal) {
    check('HEAL button', false, 'no HEAL button while carrying a bandage');
  } else {
    await page.evaluate(() => { window.__ink.player.hp = 40; window.__ink.player.hurtClock = 0; });
    await tap(heal.x, heal.y, 120);
    await sleep(1400);
    const after = await page.evaluate(() => ({ hp: Math.round(window.__ink.player.hp), n: window.__ink.game.bandages,
      shown: getComputedStyle(document.querySelector('.touch .theal')).display !== 'none' }));
    check('HEAL button', heal.w >= 44 && heal.on && !heal.clash && after.hp >= 90 && after.n === 0 && !after.shown,
      `${Math.round(heal.w)} px, ${heal.on ? 'on screen' : 'OFF SCREEN'}${heal.clash ? ', OVERLAPS a button' : ''}; hp 40 -> ${after.hp}, then ${after.shown ? 'still shown' : 'hidden'} with none left`);
  }
}

// --- can you actually kill something with a thumb ---------------------------
// The whole point. Everything above can pass while the game is unplayable.
// What is under test is the INPUT PATH, not marksmanship: point the camera at
// something the way a player would, then fire with a thumb and see whether the
// enemy dies. The first version swept the look pad blindly and hoped, which
// tests nothing except luck — it failed while tap-to-fire was working.
let killed = false;
const k0 = (await state()).kills;
for (let i = 0; i < 40 && !killed; i++) {
  await page.evaluate(() => {
    const G = window.__ink.game;
    const p = G.ctx.player;
    let best = null, bd = 1e9;
    for (const e of G.ctx.enemies.list) {
      if (!e.alive) continue;
      const d = e.center.distanceTo(p.eye);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return;
    const dx = best.center.x - p.eye.x, dy = best.center.y - p.eye.y, dz = best.center.z - p.eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.asin(dy / Math.hypot(dx, dy, dz));
  });
  await tap(300, 470, 80);
  await sleep(180);
  if ((await state()).kills > k0) killed = true;
}
{
  const st = await state();
  check('a kill by touch alone', killed, killed ? 'tap-to-fire killed one'
    : `no kill in 40 taps (state ${st.state}, hp ${st.hp}, ${st.alive} alive, mag ${st.mag})`);
}

await page.screenshot({ path: path.join(root, 'shots', 'stills', 'touch-game.png'), scale: 'css' });

// --- a laptop with a touchscreen, played with its mouse -----------------------
//
// The layer used to switch on for any `maxTouchPoints > 1`, which is every
// touchscreen laptop, and it wrote the one shared trigger flag every frame — so
// on such a laptop the mouse could not fire at all, and neither could a pad.
// Now the layer comes up when the screen is touched and goes when the mouse
// moves, and every device has a trigger flag of its own.
//
// Playwright's `hasTouch` makes the primary pointer coarse, which is a phone,
// not this. So the context is a plain desktop with a test pad, and the touch
// is an event carrying `changedTouches` — all the game reads from one.
{
  const hctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await hctx.addInitScript(() => {
    window.__padTrigger = 0;
    const buttons = Array.from({ length: 17 }, (_, i) => ({
      get pressed() { return i === 7 && window.__padTrigger > 0.5; },
      get value() { return i === 7 ? window.__padTrigger : 0; },
      touched: false,
    }));
    navigator.getGamepads = () => [{ id: 'test pad', index: 0, connected: true, mapping: 'standard', timestamp: performance.now(), axes: [0, 0, 0, 0], buttons }];
  });
  const hp = await hctx.newPage();
  hp.on('pageerror', (e) => errors.push('THROW (laptop) ' + e.message));
  await hp.goto(URL_BASE, { waitUntil: 'load' });
  await hp.waitForFunction(() => window.__inkReady === true, { timeout: 30000 });
  await sleep(600);

  const layerOn = () => hp.evaluate(() => document.querySelector('.touch').classList.contains('on'));
  const rounds = () => hp.evaluate(() => window.__rounds);
  await hp.mouse.move(640, 400);
  check('laptop: no thumb buttons', !(await layerOn()), 'hidden at load on a fine pointer');

  await hp.evaluate(() => {
    const G = window.__ink.game;
    G.startRun();
    G.waves.stop();
    G.ctx.enemies.clear();
    window.__rounds = 0;
    const rifle = G.weapons[0];
    const f = rifle.fire.bind(rifle);
    rifle.fire = () => { window.__rounds++; return f(); };
  });
  await sleep(500);

  // a tap on the left half: the stick, not a shot
  await hp.evaluate(() => {
    const c = document.getElementById('c');
    for (const type of ['touchstart', 'touchend']) {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'changedTouches', { value: [{ identifier: 9, clientX: 200, clientY: 600 }] });
      c.dispatchEvent(ev);
    }
  });
  await sleep(200);
  const shown = await layerOn();
  check('laptop: a touch shows them', shown, shown ? 'thumb buttons up after a touch' : 'still hidden after a touch');
  // If that failed, put the layer up by hand, so the two trigger checks below
  // still test what they are named for rather than failing along with it.
  if (!shown) await hp.evaluate(() => window.__ink.game.touch.enable());

  // Pointer lock is stood in for, as in tools/game.mjs: a test browser on this
  // desktop is granted the real thing unreliably, and the mousedown handler is
  // what is under test.
  await hp.evaluate(() => { window.__ink.input.locked = true; window.__rounds = 0; });
  await hp.mouse.down();
  await sleep(500);
  await hp.mouse.up();
  await sleep(100);
  const mouseRounds = await rounds();
  check('laptop: mouse fires', mouseRounds >= 4 && (await layerOn()), `${mouseRounds} rounds from LMB held 0.5 s with the thumb buttons up`);

  await hp.evaluate(() => { window.__rounds = 0; window.__padTrigger = 1; });
  await sleep(500);
  await hp.evaluate(() => { window.__padTrigger = 0; });
  await sleep(100);
  const padRounds = await rounds();
  check('laptop: pad trigger fires', padRounds >= 4, `${padRounds} rounds from the right trigger held 0.5 s`);

  await hp.evaluate(() => { window.__ink.input.locked = false; });
  await hp.mouse.move(700, 430, { steps: 6 });
  await sleep(150);
  const hidden = !(await layerOn());
  check('laptop: mouse hides them', hidden, hidden ? 'thumb buttons gone once the mouse moved' : 'still up after the mouse moved');
  await hctx.close();
}

check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | ') || 'clean');

await browser.close();

const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} passed`);
console.log(`
Still needs a human with a phone — none of the above can answer these:
  [ ] can you reach JUMP and HOOK without regripping?
  [ ] does the floating stick appear under your thumb, or somewhere you have to reach for?
  [ ] is look sensitivity right, and can you make a small correction?
  [ ] does tap-to-fire misfire while you are turning?
  [ ] can you reach FIRE, and still see what you are shooting at while you hold it?
  [ ] can you reach HEAL mid-fight without letting go of the stick?
  [ ] does anything important sit under the notch or the home indicator?
  [ ] does your thumb cover the thing you are shooting at?
`);
process.exit(passed === results.length ? 0 : 1);
