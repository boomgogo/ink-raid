import { defineConfig } from 'vite';

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

export default defineConfig({
  plugins: [{
    name: 'strip-glsl-comments',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('/src/') || !code.includes('/* glsl */')) return null;
      return { code: stripGlsl(code), map: null };
    },
  }],
});
