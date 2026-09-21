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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// `node_modules/.cache` is CREATED, not assumed. It exists on a developer's
// machine because Vite has been run there, and does NOT exist on a fresh CI
// checkout after `npm ci` -- so this suite passed locally and failed on CI,
// which is exactly the class of green-here-red-there the deploy gate is for.
const cacheDir = join(REPO, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const outDir = mkdtempSync(join(cacheDir, 'gb-render-'));
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
            const bare = args.path.replace(/\?(raw|dataurl)$/, '');
            // A relative specifier (`../docs/INSTRUCTOR_GUIDE.md?raw`) resolves
            // against the importing file, not against package.json -- resolving
            // it from the repo root walks out of the repo and finds nothing.
            const path = bare.startsWith('.')
              ? resolve(args.resolveDir, bare)
              : requireFromRepo.resolve(bare);
            return { path, namespace: q };
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

// ---------------------------------------------------------------------------
// The conversion offer is a panel with two buttons (Supplement 1, Item 4)
// ---------------------------------------------------------------------------
// It was `window.confirm`, with the two choices spelled out inside the message
// as "OK — convert it" and "Cancel — leave it". The browser's box labels its
// buttons OK and Cancel whatever the message says they mean, so the instructor
// has to hold the mapping in their head — and it blocks the page while they do.
//
// Rendered through the real `FigureCard`, so the buttons asserted here are the
// buttons an instructor sees.
{
  const cardEntry = (refusalLiteral) => `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FigureCard } from './components/FigureCard';

export const renderIt = () => renderToStaticMarkup(
  React.createElement(FigureCard, {
    figureNumber: 1,
    problemNumber: 1,
    refBlock: { id: 'p1-fig1', title: 'Voltage divider', desc: 'Two resistors.' },
    file: undefined,
    refusal: ${refusalLiteral},
    busy: false,
    onReplace: () => {}, onConvert: () => {}, onDismissRefusal: () => {},
    onTitleChange: () => {}, onDescChange: () => {},
  }));
`;

  const COLOUR = "{ messages: ['This image has colour in it. Figures must be black, white and grey only.'], convertible: true }";

  await check('ITEM 4: a refused colour image shows both buttons, by label', async () => {
    const html = await renderWith('refusal-colour', cardEntry(COLOUR));
    assert(html.includes('Convert to greyscale'),
      `no "Convert to greyscale" button in the card:\n${html.slice(0, 500)}`);
    assert(html.includes('Cancel'), 'no "Cancel" button in the card');
    assert(html.includes('This image has colour in it.'),
      'the refusal message is not shown in the card');
    // Both are real buttons, not text: an instructor has to be able to press them.
    assert((html.match(/<button/g) || []).length >= 2,
      'the two choices are not rendered as buttons');
  });

  await check('ITEM 4: a refusal that conversion cannot fix offers only Cancel', async () => {
    const html = await renderWith('refusal-plain',
      cardEntry("{ messages: ['This image is too small: it would print blurry (40 dpi; at least 300 is needed). Use a larger version of the image.'], convertible: false }"));
    assert(!html.includes('Convert to greyscale'),
      'a conversion was offered for something conversion cannot fix');
    assert(html.includes('Cancel'), 'no way to dismiss the refusal');
    assert(html.includes('too small'), 'the refusal message is not shown');
  });

  await check('ITEM 4: a card with no refusal shows neither button', async () => {
    const html = await renderWith('refusal-none', cardEntry('undefined'));
    assert(!html.includes('Convert to greyscale'), 'a conversion is offered with nothing refused');
    assert(html.includes('Replace image'), 'the card lost its Replace control');
  });

  await check('ITEM 4: while converting, the buttons say so and are disabled', async () => {
    const html = await renderWith('refusal-busy', `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FigureCard } from './components/FigureCard';
export const renderIt = () => renderToStaticMarkup(
  React.createElement(FigureCard, {
    figureNumber: 1, problemNumber: 1,
    refBlock: { id: 'p1-fig1', title: 'T', desc: 'D' },
    refusal: ${COLOUR}, busy: true,
    onReplace: () => {}, onConvert: () => {}, onDismissRefusal: () => {},
    onTitleChange: () => {}, onDescChange: () => {},
  }));
`);
    assert(/Converting/.test(html), 'the button does not say it is working');
    assert(/disabled/.test(html), 'the buttons are not disabled while converting');
  });

  await check('ITEM 4: no window.confirm remains on the figure path', () => {
    // Comments stripped: the reason the confirm went is recorded in one, and a
    // raw scan would match that and pass or fail for the wrong reason.
    const code = readFileSync(join(REPO, 'pages', 'Editor.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const handler = code.slice(code.indexOf('const handleReplaceFigure'),
      code.indexOf('const updateFigureWords'));
    assert(handler.length > 200, 'the replace handler could not be located to check it');
    assert(!/window\.confirm|window\.alert\(/.test(handler),
      'the figure replace path still blocks on a browser dialog');
  });

  await check('ITEM 4 MUTATION: removing the panel removes both buttons', async () => {
    const html = await renderWith('refusal-mutant', cardEntry(COLOUR), [[
      'components/FigureCard.tsx',
      '{refusal && (',
      '{false && refusal && (',
    ]]);
    assert(!html.includes('Convert to greyscale'),
      'the mutant still rendered the convert button, so this suite does not exercise the panel');
    assert(!html.includes('This image has colour in it.'),
      'the mutant still rendered the refusal message');
  });
}

// ---------------------------------------------------------------------------
// The instructor guide, inside the app (Supplement 1, Items 1 and 2)
// ---------------------------------------------------------------------------
// The only written instructions were `README.md` on GitHub — a developer's
// file, which said nothing about figures, the finalize lock or the assignment
// kind, and described AI grading in a way the campus rule forbids. **An
// instructor should never need GitHub to learn how to use the tool.**
//
// Rendered through the real `HelpGuide`, so what is asserted here is what an
// instructor reads.
{
  const GUIDE = join(REPO, 'docs', 'INSTRUCTOR_GUIDE.md');
  const guideEntry = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpGuide } from './components/HelpGuide';

export const renderIt = () => renderToStaticMarkup(
  React.createElement(HelpGuide, { isOpen: true, onClose: () => {} }));
`;

  // The eight sections the supplement asks the guide to cover.
  const SECTIONS = [
    'Getting started',
    'Two things to choose first',
    'Who decides the grades',
    'Figures',
    'Finalize and Reopen',
    'What you get when you export',
    'What not to do',
    'Writing mathematics',
  ];

  await check('ITEM 1: every section of the guide is rendered', async () => {
    const html = await renderWith('guide', guideEntry);
    for (const heading of SECTIONS) {
      assert(html.includes(heading), `the guide does not render the "${heading}" section`);
    }
  });

  await check('ITEM 1: the guide is bundled, not fetched — it works with the network off', () => {
    const src = readFileSync(join(REPO, 'components', 'HelpGuide.tsx'), 'utf8');
    assert(/from '\.\.\/docs\/INSTRUCTOR_GUIDE\.md\?raw'/.test(src),
      'the guide is not inlined at build time');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(!/\bfetch\s*\(|XMLHttpRequest/.test(code),
      'the help panel fetches something at runtime; it must open with the network off');
  });

  await check('ITEM 1: each ? link names a section the guide actually has', async () => {
    const src = readFileSync(join(REPO, 'components', 'HelpGuide.tsx'), 'utf8');
    const block = src.slice(src.indexOf('GUIDE_SECTIONS = {'), src.indexOf('} as const;'));
    const headings = [...block.matchAll(/:\s*'([^']+)'/g)].map(m => m[1]);
    assert(headings.length === 8, `expected 8 mapped sections, found ${headings.length}`);
    const guide = readFileSync(GUIDE, 'utf8');
    for (const h of headings) {
      assert(guide.includes(`## ${h}`), `the ? links point at "${h}", which is not a heading in the guide`);
    }
  });

  await check('ITEM 1: the three ? links are wired where Andre had to hunt', () => {
    const card = readFileSync(join(REPO, 'components', 'FigureCard.tsx'), 'utf8');
    const editor = readFileSync(join(REPO, 'pages', 'Editor.tsx'), 'utf8');
    assert(/HelpLink section="figures"/.test(card), 'the figure card has no ? link');
    assert(/HelpLink section="kind"/.test(editor), 'the assignment kind has no ? link');
    assert(/HelpLink section="finalize"/.test(editor), 'Finalize has no ? link');
  });

  await check('ITEM 1: Help is provided above the router, so a page\'s own links work', () => {
    // A provider inside `Layout` sits BELOW a page in the tree, so the page's
    // own useOpenHelp() would read the default no-op. That was the first
    // version, and the ? links in the Editor did nothing.
    const app = readFileSync(join(REPO, 'App.tsx'), 'utf8');
    assert(app.indexOf('<HelpProvider>') !== -1, 'Help is not provided at the app root');
    assert(app.indexOf('<HelpProvider>') < app.indexOf('<Router>'),
      'HelpProvider is below the router, so a page cannot open help at a section');
  });

  await check('ITEM 1: the header offers Help, not just LaTeX Help', () => {
    const raw = readFileSync(join(REPO, 'components', 'Common.tsx'), 'utf8');
    // Comments, stripped before scanning: the comment beside the button says
    // what it used to be called, which is the point of the comment and would
    // otherwise fail the check it explains. Same reason the export-contract
    // guard scans JSON keys rather than the words "temperature" and "model".
    const common = raw.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');
    assert(/>Help</.test(common) || /<span>Help<\/span>/.test(common),
      'the header does not offer a Help button');
    assert(!/LaTeX Help/.test(common),
      'the header still offers only LaTeX help, which is the smallest question an instructor has');
  });

  await check('ITEM 2: no instructor text says the AI grades, scores or awards marks', () => {
    // The campus rule: a person decides every grade. This runs over BOTH the
    // guide and the README, because the README is what a developer hands to an
    // instructor when the app is not in front of them.
    for (const file of ['docs/INSTRUCTOR_GUIDE.md', 'README.md']) {
      const text = readFileSync(join(REPO, file), 'utf8');
      for (const banned of [/awards full marks/i, /auto-award/i, /awards? marks automatically/i]) {
        assert(!banned.test(text), `${file} says the system awards marks: ${banned}`);
      }
      // "AI-graded" used as a grade. The .md TYPE TAGS `[ai-graded:short]` are
      // format names and are allowed; the prose claim is not.
      const prose = text.replace(/`[^`]*`/g, '').replace(/\[ai-graded:[^\]]*\]/g, '');
      assert(!/AI-graded/i.test(prose), `${file} describes something as AI-graded in prose`);
    }
  });

  await check('ITEM 1: the guide carries no pipeline jargon', () => {
    const text = readFileSync(GUIDE, 'utf8');
    for (const jargon of [/marking stage/i, /\bwhitelist\b/i, /layout_id/i, /\bgb1\b|\bgb2\b/i,
      /\bpipeline\b/i, /base64/i, /the scans are/i]) {
      assert(!jargon.test(text), `the guide explains the pipeline instead of the task: ${jargon}`);
    }
  });

  await check('ITEM 1: the guide states plainly that a person decides', () => {
    const text = readFileSync(GUIDE, 'utf8');
    assert(/A person decides every grade/i.test(text),
      'the guide does not state that a person decides every grade');
  });

  await check('ITEM 1 MUTATION: removing a section makes the render test fail', async () => {
    const guide = readFileSync(GUIDE, 'utf8');
    const start = guide.indexOf('## Finalize and Reopen');
    const end = guide.indexOf('## What you get when you export');
    assert(start > 0 && end > start, 'could not locate a section to remove');
    const html = await renderWith('guide-mutant', guideEntry, [[
      'docs/INSTRUCTOR_GUIDE.md', guide.slice(start, end), '',
    ]]);
    assert(!html.includes('Finalize and Reopen'),
      'the mutant still rendered the deleted section, so this suite does not exercise the guide');
    // And the rest still renders, so the failure is the missing section only.
    assert(html.includes('Getting started'), 'the mutation broke more than the one section');
  });

  await check('the guide file is restored after the mutation', () => {
    const guide = readFileSync(GUIDE, 'utf8');
    assert(guide.includes('## Finalize and Reopen'),
      'INSTRUCTOR_GUIDE.md was left mutated — a section is missing');
  });
}

// ---------- report ----------
for (const f of scratch) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* windows handles */ }
process.exit(failed > 0 ? 1 : 0);
