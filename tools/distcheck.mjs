// What ships is only the game.
//
//   npm run distcheck
//
// Builds into a scratch directory and reads every file that came out. A
// minifier drops JavaScript comments but keeps strings, and a shader is a
// string, so the build strips the comments inside `/* glsl */` templates
// (vite.config.js). This checks that it did, and that nothing else from the
// workshop rides along: source maps, paths on the machine it was built on,
// working notes.
import { build } from 'vite';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = new URL('..', import.meta.url).pathname;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

// Every comment written inside a shader, taken from the source, so a comment
// that ships is found by its own words rather than by a guess at its shape.
function shaderComments() {
  const out = new Set();
  for (const p of files(join(ROOT, 'src'))) {
    if (!/\.m?js$/.test(p)) continue;
    const src = readFileSync(p, 'utf8');
    for (const [, body] of src.matchAll(/\/\* glsl \*\/ `([\s\S]*?)`/g)) {
      for (const [c] of body.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g)) {
        const text = c.replace(/^\/\/|^\/\*|\*\/$/g, '').trim();
        if (text.length >= 12) out.add(text);
      }
    }
  }
  return [...out];
}

const NOTES = [
  [/\/home\/[a-z]/, 'a path on the build machine'],
  [/(^|[^\w.-])(ref|shots|ai)\/[\w-]+\.(png|md|webm|json)/, 'a path into a working folder'],
  [/\bprompt[ _]\d+\b/i, 'a prompt number'],
  [/\b(plan|next|feedback)_\d+\b/, 'a planning note'],
];

const out = mkdtempSync(join(tmpdir(), 'distcheck-'));
let fail = 0;
const bad = (msg) => { fail++; console.log(' FAIL  ' + msg); };

try {
  await build({ root: ROOT, logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
  const comments = shaderComments();
  let shipped = 0, bytes = 0;
  for (const p of files(out)) {
    const rel = relative(out, p);
    shipped++;
    bytes += statSync(p).size;
    if (extname(p) === '.map') { bad(`${rel}: a source map`); continue; }
    if (!/\.(js|css|html|txt|json|svg)$/.test(p)) continue;
    const text = readFileSync(p, 'utf8');
    for (const c of comments) if (text.includes(c)) bad(`${rel}: a shader comment shipped: "${c.slice(0, 60)}"`);
    for (const [re, why] of NOTES) if (re.test(text)) bad(`${rel}: ${why}`);
  }

  // the source too, so the next build cannot pick a note up
  let read = 0;
  const sources = [...files(join(ROOT, 'src')), ...files(join(ROOT, 'public')), join(ROOT, 'index.html')];
  for (const p of sources) {
    if (!/\.(m?js|css|html|txt|json|svg)$/.test(p)) continue;
    read++;
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      for (const [re, why] of NOTES) if (re.test(line)) bad(`${relative(ROOT, p)}:${i + 1}: ${why}`);
    });
  }
  console.log(`\n  ${shipped} files shipped (${(bytes / 1024).toFixed(0)} KB), ${read} source files read, ${comments.length} shader comments looked for`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(fail ? `\n${fail} problem(s)` : '\nPASS — the build carries the game and nothing else');
process.exit(fail ? 1 : 0);
