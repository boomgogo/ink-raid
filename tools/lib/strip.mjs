// Pull frames out of a webm and tile them into one image.
//
// Rubric line 7 is MOTION, and no reviewer has ever been shown
// any: every review round has been still images, so the line has been scored on
// imagination. A strip of four frames 150 ms apart is not video, but it does
// show what a still cannot — how far the world moves between frames, what the
// recoil does, whether the hatching stays glued to a surface as the camera
// passes it, how a hit reads.
//
// Playwright ships an ffmpeg and it decodes webm; there is no system ffmpeg
// here. Its build is stripped, so `-vf fps=` is unavailable ("No option name
// near '2'") and frames are selected by seeking instead.
import { mkdir, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PNG } from 'pngjs';

export const FFMPEG = path.join(process.env.HOME, '.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux');

export function haveFfmpeg() { return existsSync(FFMPEG); }

/** Grab one frame at `t` seconds. Seek before -i, so it is a keyframe seek and fast. */
export function frameAt(video, t, out) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-v', 'error', '-ss', String(t),
    '-i', video, '-frames:v', '1', '-y', out]);
  return r.status === 0 && existsSync(out);
}

/** Duration in seconds, or null. */
export function duration(video) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', video]);
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stderr?.toString() || '');
  if (!m) return null;
  return +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]);
}

/**
 * Four frames, `gap` seconds apart from `t0`, tiled 2x2 with hairline gutters.
 * 2x2 rather than a row: a 4-wide strip of 1280px frames is unreadable at any
 * size a reviewer actually views it, and the point is that they can see detail.
 */
export async function motionStrip(video, t0, out, { gap = 0.15, scale = 0.5, tmp } = {}) {
  if (!haveFfmpeg()) return false;
  const dir = tmp || path.join(path.dirname(out), '_strip');
  await mkdir(dir, { recursive: true });
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const f = path.join(dir, `s${i}.png`);
    if (!frameAt(video, t0 + i * gap, f)) { await rm(dir, { recursive: true, force: true }); return false; }
    frames.push(PNG.sync.read(await readFile(f)));
  }
  const sw = Math.round(frames[0].width * scale);
  const sh = Math.round(frames[0].height * scale);
  const gut = 6;
  const outPng = new PNG({ width: sw * 2 + gut, height: sh * 2 + gut });
  outPng.data.fill(200);
  frames.forEach((src, i) => {
    const ox = (i % 2) * (sw + gut);
    const oy = (i >> 1) * (sh + gut);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        // nearest-neighbour: the whole subject is fine line work, and a box
        // filter turns a one-pixel pen stroke into grey mush
        const si = ((Math.round(y / scale) * src.width) + Math.round(x / scale)) * 4;
        const di = ((y + oy) * outPng.width + (x + ox)) * 4;
        outPng.data[di] = src.data[si];
        outPng.data[di + 1] = src.data[si + 1];
        outPng.data[di + 2] = src.data[si + 2];
        outPng.data[di + 3] = 255;
      }
    }
  });
  await writeFile(out, PNG.sync.write(outPng));
  await rm(dir, { recursive: true, force: true });
  return true;
}

// node tools/lib/strip.mjs <video> <t0> <out>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , video, t0, out] = process.argv;
  console.log(await motionStrip(video, parseFloat(t0 || '5'), out || 'strip.png') ? `-> ${out}` : 'failed');
}
