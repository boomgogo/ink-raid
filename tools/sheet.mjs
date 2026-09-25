// Contact sheet of every spawn-ring pose, so a composition can be chosen by
// looking at a dozen at once instead of guessing coordinates one at a time.
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = path.join(root, 'shots', 'ring');
await mkdir(tmp, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--hide-scrollbars', '--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto(process.env.OURS_URL || 'http://localhost:4173/', { waitUntil: 'load' });
await page.waitForFunction(() => window.__inkReady === true, { timeout: 30000 });
await sleep(500);

// every ringN pose the level generated, plus the fixed overviews
const names = (await page.evaluate(() => window.__ink.shots))
  .filter((n) => /^ring\d+$/.test(n))
  .sort((a, b) => +a.slice(4) - +b.slice(4));
if (!names.length) throw new Error('no ring poses — did the level produce spawns?');
const files = [];
for (const name of names) {
  await page.evaluate((k) => window.__ink.shot(k), name);
  await sleep(220);
  const f = path.join(tmp, `${name}.png`);
  await page.screenshot({ path: f, scale: 'css' });
  files.push(f);
}
await browser.close();

// tile them 4 across at quarter size
const cols = 4, sc = 4;
const cw = 1280 / sc, ch = 800 / sc;
const rows = Math.ceil(files.length / cols);
const out = new PNG({ width: cols * cw, height: rows * ch });
out.data.fill(120);
for (let i = 0; i < files.length; i++) {
  const src = PNG.sync.read(await readFile(files[i]));
  const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const s = ((y * sc) * src.width + x * sc) * 4;
    const d = ((y + oy) * out.width + x + ox) * 4;
    out.data[d] = src.data[s]; out.data[d+1] = src.data[s+1];
    out.data[d+2] = src.data[s+2]; out.data[d+3] = 255;
  }
}
await writeFile(path.join(root, 'shots', 'sheet.png'), PNG.sync.write(out));
console.log('sheet ->', path.join(root, 'shots', 'sheet.png'), `(${files.length} poses, index reads left-to-right)`);
