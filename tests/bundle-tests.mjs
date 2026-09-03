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
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
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

// -----------------------------------------------------------------------------
// No third-party origin at page load
// -----------------------------------------------------------------------------
// index.html used to carry <script src="https://cdn.tailwindcss.com"> and a
// Google Fonts <link>, so every page load told Cloudflare and Google who the
// instructor was, and the Tailwind Play CDN ran third-party JavaScript with full
// page privileges and no Subresource Integrity attribute. Tailwind is now
// compiled at build time and both typefaces are self-hosted.
//
// These judge by POSITION, not presence. A host in a licence header, an XML
// namespace or a documentation comment is inert and fine; what must be zero is a
// host the browser would actually fetch. jsPDF carries one such inert string — a
// cdnjs pdfobject URL reachable only from its `pdfobjectnewwindow` output mode,
// and this app only ever calls doc.output('blob') — which is why a flat
// substring scan for "cdnjs" would be the wrong guard here.

const html = readFileSync(join(outDir, 'index.html'), 'utf8');
const cssFile = files.find(f => /^index-.*\.css$/.test(f));
const jsFiles = files.filter(f => /\.js$/.test(f));
const isRemote = (u) => /^(?:https?:)?\/\//i.test(u);

check('index.html names no host in any fetch position', () => {
  const remote = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)]
    .map(m => m[1]).filter(isRemote);
  assert(remote.length === 0, `index.html still fetches: ${remote.join(', ')}`);
  // The whole document, not only src/href — an @import in an inline <style>, a
  // preconnect hint or a dns-prefetch would each be a page-load origin too, and
  // the file is short enough that it has no business naming a host at all.
  const hosts = [...html.matchAll(/https?:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]{2,}/g)].map(m => m[0]);
  assert(hosts.length === 0, `index.html mentions: ${hosts.join(', ')}`);
});

check('the emitted stylesheet fetches nothing remote', () => {
  const css = readFileSync(join(assets, cssFile), 'utf8');
  const remote = [
    ...[...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map(m => m[1]),
    // Written loosely because the minifier tightens it: `@import url('…')` in
    // the source is emitted as `@import"…";`, with neither the url() nor the
    // space. A pattern requiring either would pass over the one thing this
    // check exists to catch.
    ...[...css.matchAll(/@import\s*(?:url\(\s*)?["']?([^"')\s;]+)/gi)].map(m => m[1]),
  ].filter(isRemote);
  assert(remote.length === 0, `the stylesheet still fetches: ${remote.join(', ')}`);
});

check('no emitted script puts a host in a fetch position', () => {
  // Position, not presence — and the position is precise: a URL that will be
  // fetched *begins* the value it is assigned to. Requiring that, rather than
  // mere nearness, is what separates the two kinds of string minified library
  // code is full of:
  //
  //   caught    A.src = "https://example.com/x.js"
  //   inert     A.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/…'>"
  //   inert     var ze = "https://cdnjs.cloudflare.com/…/pdfobject.min.js"
  //
  // The second is html2canvas probing SVG support; the third is jsPDF's
  // `pdfobjectnewwindow` output mode, which this app never reaches because it
  // only ever calls doc.output('blob'). A guard that failed on either would be
  // deleted within the month, and rightly.
  const TOKEN = /(?:\b(?:src|href)\s*=\s*|\bsetAttribute\(\s*["'](?:src|href)["']\s*,\s*|\b(?:import|fetch)\s*\(\s*|\burl\s*\(\s*)["'`]?(https?:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]{2,})/g;
  const offenders = [];
  for (const f of jsFiles) for (const m of read(f).matchAll(TOKEN)) offenders.push(`${f}: ${m[1]}`);
  assert(offenders.length === 0, offenders.join('; '));
});

check('the three origins this build removed appear nowhere in it', () => {
  // Presence, not position, and deliberately so: these three have no legitimate
  // reason to be named anywhere in the output, so the cheapest guard is total.
  const FORBIDDEN = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];
  const offenders = [];
  for (const f of files.filter(f => /\.(js|css|html)$/.test(f))) {
    const body = read(f);
    for (const host of FORBIDDEN) if (body.includes(host)) offenders.push(`${host} in ${f}`);
  }
  for (const host of FORBIDDEN) if (html.includes(host)) offenders.push(`${host} in index.html`);
  assert(offenders.length === 0, offenders.join('; '));
});

check('Tailwind is compiled into the stylesheet, not fetched and run', () => {
  const css = readFileSync(join(assets, cssFile), 'utf8');
  // The `academic` scale is load-bearing — <body class="bg-academic-50
  // text-academic-900"> wears it — and it exists only because
  // tailwind.config.js carries it. Lose it and the page renders unstyled.
  assert(css.includes('#f8fafc') && css.includes('#0f172a'),
    'the academic palette is missing from the stylesheet');
  assert(/\.bg-academic-50[\s{,]/.test(css) && /\.text-academic-900[\s{,]/.test(css),
    'the two classes <body> actually wears were not generated');
  // Preflight, which the Play CDN used to inject at runtime.
  assert(/box-sizing: ?border-box/.test(css), 'Tailwind preflight is not in the stylesheet');
  // Nothing may reintroduce the runtime compiler.
  const runtime = jsFiles.filter(f => /window\.tailwind|tailwind\.config\s*=/.test(read(f)));
  assert(runtime.length === 0, `a Tailwind runtime survives in: ${runtime.join(', ')}`);
});

check('both typefaces are emitted same-origin, with their OFL notices', () => {
  const woff2 = files.filter(f => /\.woff2$/.test(f));
  for (const face of ['inter', 'merriweather']) {
    assert(woff2.some(f => f.startsWith(`${face}-latin-`)),
      `no ${face} woff2 was emitted — the face is not self-hosted`);
  }
  // OFL 1.1 requires its notice to travel with the binaries the site serves.
  for (const notice of ['fonts/Inter-OFL.txt', 'fonts/Merriweather-OFL.txt']) {
    const path = join(outDir, notice);
    assert(existsSync(path), `${notice} is missing from the build`);
    assert(readFileSync(path, 'utf8').includes('SIL OPEN FONT LICENSE'),
      `${notice} does not carry the licence text`);
  }
  // Those files must be what the @font-face rules point at.
  const css = readFileSync(join(assets, cssFile), 'utf8');
  for (const family of ['Inter', 'Merriweather']) {
    assert(new RegExp(`@font-face[^}]*font-family: ?['"]?${family}`, 'i').test(css),
      `the stylesheet declares no @font-face for ${family}`);
  }
});

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
