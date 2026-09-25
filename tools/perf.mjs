// Performance gate, against the budgets in CLAUDE.md.
//
// Measured with CDP CPU throttling rather than on the bare machine: this box is
// far faster than the "average PC without a dedicated GPU" and the "entry level
// phone" the spec actually targets, so an unthrottled 140 fps here says nothing
// at all about either.
//
// Load time is measured from the Navigation Timing API on a cold cache with the
// network throttled, because time-to-interaction is the number in the spec and
// it is dominated by transfer, not by frame rate.
import { chromium } from 'playwright';

const URL_BASE = process.env.OURS_URL || 'http://localhost:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TIERS = [
  { name: 'desktop, no dGPU', cpu: 4, w: 1280, h: 800, dsf: 1, minFps: 50, p99: 33 },
  { name: 'entry phone', cpu: 6, w: 390, h: 844, dsf: 2, minFps: 30, p99: 50, mobile: true },
];

// 10 Mbps down, 40 ms RTT — a fair "current average internet speed"
const NET = { offline: false, downloadThroughput: 10 * 1024 * 1024 / 8, uploadThroughput: 2 * 1024 * 1024 / 8, latency: 40 };

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--hide-scrollbars', '--mute-audio'] });
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(30)} ${detail}`);
};

// --- load time --------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NET);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const t0 = Date.now();
  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__inkReady === true, { timeout: 60000 });
  const tti = (Date.now() - t0) / 1000;

  const transfer = await page.evaluate(() =>
    performance.getEntriesByType('resource').reduce((a, r) => a + (r.transferSize || 0), 0)
    + (performance.getEntriesByType('navigation')[0]?.transferSize || 0));

  check('time to interaction', tti <= 4, `${tti.toFixed(2)} s at 10 Mbps (target 1.5, max 4)`);
  check('transfer size', transfer < 400 * 1024, `${(transfer / 1024).toFixed(0)} KB (budget 310 KB + fonts)`);
  await ctx.close();
}

// --- frame rate under throttling -------------------------------------------
for (const tier of TIERS) {
  const ctx = await browser.newContext({
    viewport: { width: tier.w, height: tier.h },
    deviceScaleFactor: tier.dsf,
    isMobile: !!tier.mobile,
    hasTouch: !!tier.mobile,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(URL_BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__inkReady === true, { timeout: 30000 });

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: tier.cpu });
  // a real fight, not an empty map: enemies, bullets, particles and all
  await page.evaluate(() => {
    window.__ink.game.startRun();
    const G = window.__ink.game;
    for (let i = 0; i < 12; i++) {
      const s = G.ctx.level.spawns[i % G.ctx.level.spawns.length];
      // hunting, so the fight is on from the first frame
      G.ctx.enemies.spawn(i % 4 === 0 ? 'punch' : i % 3 === 0 ? 'cutter' : 'sketch', s, { mind: 'hunt' });
    }
  });
  await sleep(2500);

  // sample real frame times from inside the page
  const frames = await page.evaluate(() => new Promise((resolve) => {
    const out = [];
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      out.push(now - last);
      last = now;
      if (out.length < 220) requestAnimationFrame(tick);
      else resolve(out.slice(20));       // drop the first few, they are warm-up
    };
    requestAnimationFrame(tick);
  }));

  frames.sort((a, b) => a - b);
  const median = frames[frames.length >> 1];
  const p99 = frames[Math.floor(frames.length * 0.99)];
  const fps = 1000 / median;
  const stats = await page.evaluate(() => window.__ink.stats());

  check(`${tier.name} fps`, fps >= tier.minFps,
    `${fps.toFixed(0)} fps median at ${tier.cpu}x CPU throttle (min ${tier.minFps}), ${stats.drawCalls} calls`);
  check(`${tier.name} p99 frame`, p99 <= tier.p99, `${p99.toFixed(1)} ms (max ${tier.p99})`);

  if (tier.mobile) {
    await page.screenshot({ path: 'shots/stills/phone-game.png', scale: 'css' });
    const touchOn = await page.evaluate(() => document.querySelector('.touch')?.classList.contains('on'));
    check('touch controls appear', !!touchOn, 'touch layer enabled on a coarse pointer');
  }

  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
