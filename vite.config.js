import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Shaders live in template literals marked /* glsl */, and a minifier leaves a
// string's contents alone: every comment in a shader used to ship as written,
// essays and all. The build takes them out, with the blank lines and the
// indentation. Dev keeps them, so a shader error still points at a line that
// has its comment next to it.
export function stripGlsl(src) {
  return src.replace(/\/\* glsl \*\/ `([\s\S]*?)`/g, (m, body) => '`'
    + body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    + '\n`');
}

// The commit the build is made from: Cloudflare's build says which, otherwise git does. `dirty`:
// the working tree has changes the commit does not, so the commit alone does not name this code.
function commit() {
  const git = (cmd) => execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  if (process.env.WORKERS_CI_COMMIT_SHA) return { sha: process.env.WORKERS_CI_COMMIT_SHA, dirty: false };
  try {
    return { sha: git('git rev-parse HEAD'), dirty: git('git status --porcelain') !== '' };
  } catch {
    return { sha: 'dev', dirty: false };
  }
}

const { sha, dirty } = commit();
// What a player sees, in a corner: `v.` and the commit's first four characters.
const VERSION = `v.${sha.slice(0, 4)}`;
// The game's version for p3p2, which keeps players on different builds in different rooms, as
// their pages would not understand each other's messages: the commit (twelve characters, as p3p2
// takes 32 at most), and the time of the build when the tree has changes of its own, so two builds
// of different code never share a room.
const BUILD = `${sha.slice(0, 12)}${dirty ? `+${Date.now().toString(36)}` : ''}`;

export default defineConfig({
  define: { __VERSION__: JSON.stringify(VERSION), __BUILD__: JSON.stringify(BUILD) },
  // The p3p2 client is served as the files it is made of, on the dev server too: its small entry
  // on every visit, and the rest only when a room is opened.
  optimizeDeps: { exclude: ['@p3p2/client'] },
  plugins: [{
    name: 'strip-glsl-comments',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/src/') || !code.includes('/* glsl */')) return null;
      return { code: stripGlsl(code), map: null };
    },
  }, {
    // The version on the boot splash is in the page itself, there from the first paint.
    name: 'version',
    configResolved(config) {
      if (config.command === 'build' && dirty) {
        config.logger.warn(`\n  the working tree has uncommitted changes: this build shows ${VERSION}, the last commit\n`);
      }
    },
    transformIndexHtml: { order: 'pre', handler: (html) => html.replaceAll('__INK_VERSION__', VERSION) },
  }],
});
