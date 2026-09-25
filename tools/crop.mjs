// crop.mjs in.png out.png x y w h [scale]
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
const [,, inF, outF, X, Y, W, H, S] = process.argv;
const src = PNG.sync.read(readFileSync(inF));
const x = +X, y = +Y, w = +W, h = +H, s = +(S || 1);
const dst = new PNG({ width: w * s, height: h * s });
for (let j = 0; j < h * s; j++) for (let i = 0; i < w * s; i++) {
  const si = (((y + (j / s | 0)) * src.width) + (x + (i / s | 0))) * 4;
  const di = (j * w * s + i) * 4;
  dst.data[di] = src.data[si]; dst.data[di+1] = src.data[si+1];
  dst.data[di+2] = src.data[si+2]; dst.data[di+3] = 255;
}
writeFileSync(outF, PNG.sync.write(dst));
