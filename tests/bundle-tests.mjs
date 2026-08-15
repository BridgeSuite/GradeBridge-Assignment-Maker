// =====================================================
// Bundle tests — what `vite build` actually emits
// =====================================================
// run-tests.mjs transpiles with esbuild and its own asset shims, so it cannot
// see a Vite-side regression. This one runs the real production build into a
// throwaway directory and checks the output.
//
// It exists because of a specific miss: services/katexFonts.ts first used
// Vite's built-in `?inline`, which works in dev but in a production build emits
// a hashed .woff2 and hands back its URL. The suite was green, the exported
// HTML silently went back to fetching fonts. vite.config.ts now carries an
// explicit `?dataurl` plugin, and this asserts the bytes really land.
//
//   npm test
// =====================================================

import { build } from 'vite';
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

let passed = 0, failed = 0;
const results = [];
const check = (name, fn) => {
  try { fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log('\nAssignment Maker — production bundle\n');

const outDir = mkdtempSync(join(tmpdir(), 'gb-maker-bundle-'));
await build({
  root: REPO,
  logLevel: 'silent',
  build: { outDir, emptyOutDir: true, reportCompressedSize: false },
});

const assets = join(outDir, 'assets');
const files = readdirSync(assets);
const read = (name) => readFileSync(join(assets, name), 'utf8');

const fontChunk = files.find(f => /^katexFonts-.*\.js$/.test(f));

check('the KaTeX fonts are a separate lazy chunk, not part of the main bundle', () => {
  assert(!!fontChunk, `no katexFonts-*.js chunk was emitted; got: ${files.join(', ')}`);
  const entry = files.find(f => /^index-.*\.js$/.test(f));
  assert(!!entry, 'no entry chunk');
  assert(!read(entry).includes('data:font/woff2'),
    'the fonts were folded into the entry chunk — every page load now pays for them');
});

check('every KaTeX face is embedded as a data URI in that chunk', () => {
  const js = read(fontChunk);
  const embedded = (js.match(/data:font\/woff2;base64,/g) || []).length;
  assert(embedded === 20, `expected 20 embedded faces, found ${embedded}`);
  // The map is keyed by plain filenames, so look for the *emitted* form: a
  // hashed asset path is what `?inline` produced instead of the bytes.
  assert(!/-[A-Za-z0-9_-]{8}\.woff2/.test(js) && !js.includes('/assets/'),
    'the chunk still points at an emitted .woff2 file instead of carrying its bytes');
  // ~340 KB of base64. A chunk of a few KB means URLs, not bytes.
  assert(js.length > 300_000, `chunk is only ${Math.round(js.length / 1024)} KB — the fonts are not in it`);
});

check('no MathJax and no KaTeX CDN reference survives anywhere in the build', () => {
  const offenders = files
    .filter(f => /\.(js|css|html)$/.test(f))
    .filter(f => /mathjax|cdn\.jsdelivr\.net\/npm\/katex/i.test(read(f)));
  assert(offenders.length === 0, `found in: ${offenders.join(', ')}`);
});

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
