// pair.mjs a.png b.png out.png [label]  -> stack two shots for comparison
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [,, A, B, OUT] = process.argv;
const a = PNG.sync.read(readFileSync(A));
const b = PNG.sync.read(readFileSync(B));
const gap = 10;
const w = Math.max(a.width, b.width);
const out = new PNG({ width: w, height: a.height + b.height + gap });
out.data.fill(90);
const blit = (src, oy) => {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const s = (y * src.width + x) * 4, d = ((y + oy) * w + x) * 4;
    out.data[d] = src.data[s]; out.data[d+1] = src.data[s+1];
    out.data[d+2] = src.data[s+2]; out.data[d+3] = 255;
  }
};
blit(a, 0); blit(b, a.height + gap);
writeFileSync(OUT, PNG.sync.write(out));
