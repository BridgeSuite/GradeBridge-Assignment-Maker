// =====================================================
// A referred figure is DRAWN on screen
// =====================================================
// The defect this exists for: after **Extract figures**, every drawing vanished
// from the editor preview and the Preview page and stayed gone after a
// successful Replace. Exports were fine throughout — so the app showed the
// instructor something no student would ever receive, which is the worst shape
// a rendering bug can take.
//
// `WORKORDER_AM_FIGURES_AND_FINALIZE_2026-09-21` §3.2 required every surface
// that renders a stem to resolve figure blocks first. Every export path did.
// No on-screen path did.
//
// **This renders through the real component**, `components/FormattedText.tsx`,
// with React's server renderer, and asserts an `<svg>` or an `<img>` comes out.
// A test that called `resolveFigureRefsInText` directly would have passed on
// the broken build, because that function was never the thing that was wrong.

import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

let passed = 0, failed = 0;
const results = [];
const check = async (name, fn) => {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

// Built INSIDE the repo, under node_modules/.cache, so the bundle's `import
// 'react'` resolves against this repo's node_modules. A bundle in the system
// temp directory cannot see them, and react is left external on purpose: the
// point is to render the real component, not a copy of React.
const outDir = mkdtempSync(join(REPO, 'node_modules', '.cache', 'gb-render-'));
const requireFromRepo = createRequire(join(REPO, 'package.json'));

/**
 * Bundle a tiny React entry that renders the real component to a string.
 *
 * `patch` lets a mutation run be built from altered sources: the file is
 * written beside the original so its relative imports still resolve, and
 * removed afterwards.
 */
const scratch = [];
const renderWith = async (name, entrySource, patch) => {
  const restore = [];
  try {
    if (patch) {
      for (const [file, from, to] of patch) {
        const path = join(REPO, file);
        const original = readFileSync(path, 'utf8');
        assert(original.includes(from), `mutation anchor missing in ${file}: ${from}`);
        restore.push([path, original]);
        writeFileSync(path, original.replace(from, to), 'utf8');
      }
    }
    const entry = join(REPO, `__render-entry-${name}.tsx`);
    writeFileSync(entry, entrySource, 'utf8');
    scratch.push(entry);
    const outfile = join(outDir, `${name}.mjs`);
    await build({
      entryPoints: [entry], outfile, format: 'esm', target: 'es2022', bundle: true,
      absWorkingDir: REPO, logLevel: 'silent', jsx: 'automatic',
      external: ['react', 'react-dom', 'react-dom/server'],
      loader: { '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
      plugins: [{
        name: 'assets',
        setup(b) {
          b.onResolve({ filter: /\?(raw|dataurl)$/ }, args => {
            const [, q] = args.path.match(/\?(raw|dataurl)$/);
            return { path: requireFromRepo.resolve(args.path.replace(/\?(raw|dataurl)$/, '')), namespace: q };
          });
          b.onLoad({ filter: /.*/, namespace: 'raw' }, a => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
          b.onLoad({ filter: /.*/, namespace: 'dataurl' }, a => ({
            contents: `export default ${JSON.stringify(`data:font/woff2;base64,${readFileSync(a.path).toString('base64')}`)};`,
            loader: 'js',
          }));
        },
      }],
    });
    rmSync(entry, { force: true });
    const mod = await import(pathToFileURL(outfile).href + `?v=${Date.now()}`);
    return mod.renderIt();
  } finally {
    for (const [path, original] of restore) writeFileSync(path, original, 'utf8');
  }
};

// --- the figures ------------------------------------------------------------
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
  + '<title>Voltage divider</title><desc>Two resistors in series.</desc>'
  + '<path d="M0 0 L10 10" stroke="#000"/></svg>';

const crc32 = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
})();
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4); ihdr[8] = 8; ihdr[9] = 0;
const rawPix = Buffer.alloc(8 * (1 + 8));
const PNG_B64 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rawPix)), chunk('IEND', Buffer.alloc(0)),
]).toString('base64');

const BLOCK = ['```figure', 'id: p1-fig1', 'title: Voltage divider',
  'desc: Two resistors in series.', '```'].join('\n');

const entry = (figuresLiteral) => `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormattedText } from './components/FormattedText';
import { FigureMapProvider } from './components/FigureMapContext';

export const renderIt = () => renderToStaticMarkup(
  React.createElement(FigureMapProvider, { figures: ${figuresLiteral} },
    React.createElement(FormattedText, { text: ${JSON.stringify(`Given the network.\n\n${BLOCK}\n\nFind Vout.`)} })));
`;

const SVG_MAP = `{ 'p1-fig1': { format: 'svg', base64: ${JSON.stringify(Buffer.from(SVG, 'utf8').toString('base64'))}, filename: 'p1-fig1.svg' } }`;
const PNG_MAP = `{ 'p1-fig1': { format: 'png', base64: ${JSON.stringify(PNG_B64)}, filename: 'p1-fig1.png' } }`;

console.log('\nA referred figure is drawn on screen\n');

await check('ITEM 1: an SVG figure block renders as an <svg>', async () => {
  const html = await renderWith('svg', entry(SVG_MAP));
  assert(/<svg[\s>]/.test(html), `no <svg> in the rendered output:\n${html.slice(0, 400)}`);
  assert(html.includes('M0 0 L10 10'), 'the drawing rendered without its path data');
  assert(!html.includes('```figure'), 'the raw figure block was rendered as text');
  assert(!html.includes('id: p1-fig1'), 'the block\'s own lines were rendered as prose');
  assert(html.includes('Given the network.'), 'the prose around the figure was lost');
});

await check('ITEM 1: a PNG figure block renders as an <img>', async () => {
  const html = await renderWith('png', entry(PNG_MAP));
  assert(/<img[\s>]/.test(html), `no <img> in the rendered output:\n${html.slice(0, 400)}`);
  assert(html.includes('data:image/png;base64,'), 'the image rendered without its data URI');
  assert(!html.includes('```figure'), 'the raw figure block was rendered as text');
});

await check('a block whose file is missing does not silently vanish', async () => {
  // Left as text rather than dropped. A visible oddity gets reported; a
  // silently missing figure is the defect this whole suite exists for.
  const html = await renderWith('missing', entry('{}'));
  assert(html.includes('p1-fig1') || html.includes('figure'),
    'an unresolvable block rendered as nothing at all');
});

// ---------------------------------------------------------------------------
// MUTATION — remove the resolve and confirm the test fails
// ---------------------------------------------------------------------------
await check('MUTATION: without the resolve call, no <svg> is rendered', async () => {
  const html = await renderWith('mutant-svg', entry(SVG_MAP), [[
    'components/FormattedText.tsx',
    'const resolved = resolveFigureRefsInText(text, figures);',
    'const resolved = text;',
  ]]);
  assert(!/<svg[\s>]/.test(html),
    'the mutant still rendered an <svg>, so this test does not exercise the resolve');
  assert(html.includes('id: p1-fig1'),
    'the mutant did not reproduce the defect: the block should render as raw text');
});

await check('MUTATION: without the resolve call, no <img> is rendered either', async () => {
  const html = await renderWith('mutant-png', entry(PNG_MAP), [[
    'components/FormattedText.tsx',
    'const resolved = resolveFigureRefsInText(text, figures);',
    'const resolved = text;',
  ]]);
  assert(!/<img[\s>]/.test(html), 'the mutant still rendered an <img>');
});

await check('the shipped component is restored after the mutations', () => {
  const src = readFileSync(join(REPO, 'components', 'FormattedText.tsx'), 'utf8');
  assert(src.includes('const resolved = resolveFigureRefsInText(text, figures);'),
    'FormattedText.tsx was left mutated — the resolve call is missing');
});

// ---------- report ----------
for (const f of scratch) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* windows handles */ }
process.exit(failed > 0 ? 1 : 0);
