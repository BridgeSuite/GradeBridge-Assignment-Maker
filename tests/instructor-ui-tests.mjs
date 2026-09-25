// =====================================================
// What an instructor meets: help, the way home, the rescale question, figures
// =====================================================
// WORKORDER_AM_GENERIC_ANSWER_PAGE_2026-09-24_SUPPLEMENT_2, items 1 to 6.
// (Item 7 is a change to two other suites' cleanup, and the completion report.)
//
// Rendered through the real components with React's server renderer wherever
// the item is about what appears on screen, as `figure-render-tests.mjs` does,
// so what is asserted is what an instructor sees.

import { suiteExit } from './suiteExit.mjs';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadExportPath } from './exportHashes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

let passed = 0, failed = 0;
const results = [];
const check = async (name, fn) => {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n          expected: ${y}\n          actual:   ${x}`);
};
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
/** Source with comments removed, so a comment that names a thing does not satisfy or trip a check. */
const code = (rel) => read(rel).replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');

// ---- rendering the real components -----------------------------------------
// Built inside the repo so `react` resolves against its node_modules; see the
// same note in figure-render-tests.mjs.
const cacheDir = join(REPO, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const outDir = mkdtempSync(join(cacheDir, 'gb-ui-'));
const requireFromRepo = createRequire(join(REPO, 'package.json'));
const scratch = [];

const run = async (name, entrySource) => {
  const entry = join(REPO, `__ui-entry-${name}.tsx`);
  writeFileSync(entry, entrySource, 'utf8');
  scratch.push(entry);
  const outfile = join(outDir, `${name}.mjs`);
  try {
    await build({
      entryPoints: [entry], outfile, format: 'esm', target: 'es2022', bundle: true,
      absWorkingDir: REPO, logLevel: 'silent', jsx: 'automatic',
      external: ['react', 'react-dom', 'react-dom/server', 'react-router-dom'],
      loader: { '.ttf': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl' },
      plugins: [{
        name: 'assets',
        setup(b) {
          b.onResolve({ filter: /\?(raw|dataurl)$/ }, args => {
            const [, q] = args.path.match(/\?(raw|dataurl)$/);
            const bare = args.path.replace(/\?(raw|dataurl)$/, '');
            const path = bare.startsWith('.') ? resolve(args.resolveDir, bare) : requireFromRepo.resolve(bare);
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
  } finally {
    rmSync(entry, { force: true });
  }
  return import(pathToFileURL(outfile).href + `?v=${Date.now()}`);
};

// A browser-shaped global the storage service can read in a server render.
// React warns once per Link that useLayoutEffect does nothing on the server.
// True and irrelevant here; filtered so it cannot bury a warning that matters.
const STORAGE_STUB = `
const realError = console.error;
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('Warning: useLayoutEffect does nothing on the server')) return;
  realError(...args);
};
const mem = {};
globalThis.localStorage ??= {
  getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; },
};`;

console.log('\nWhat an instructor meets (Supplement 2)\n');

// =====================================================
// ITEM 1: the Help panel describes the generic answer page
// =====================================================
{
  const mod = await run('guide', `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HelpGuide, GUIDE_SECTIONS, slugFor, scrollTopToShow } from './components/HelpGuide';
export const html = renderToStaticMarkup(React.createElement(HelpGuide, { isOpen: true, onClose: () => {} }));
export { GUIDE_SECTIONS, slugFor, scrollTopToShow };
`);
  const { html, GUIDE_SECTIONS, slugFor, scrollTopToShow } = mod;

  // The section's own text, from its heading to the next h2.
  const start = html.indexOf('id="the-generic-answer-page"');
  const section = start < 0 ? '' : html.slice(start, html.indexOf('<h2', start + 10));
  const text = section.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

  await check('ITEM 1: the guide renders a section on the generic answer page, and it names GBGEN1', () => {
    assert(section.length > 0, 'the Help panel has no "The generic answer page" section');
    assert(text.includes('GBGEN1'), 'the section does not name GBGEN1');
    assertEqual(GUIDE_SECTIONS.generic, 'The generic answer page', 'the ? links cannot reach the section');
    assertEqual(slugFor(GUIDE_SECTIONS.generic), 'the-generic-answer-page', 'the section id moved');
  });

  // Each of the seven points the item lists, by what an instructor must learn.
  const POINTS = [
    ['one page, the same for every assignment and course', /same for every assignment\s+and every course/],
    ['exported on its own from the home screen', /Generic answer page on the Assignment Dashboard/],
    ['handwritten only; electronic untouched, dropped on import, refused on export', /Handwritten assignments only[\s\S]*dropped when the file is imported[\s\S]*refused/],
    ['the student writes the problem and part, and the app asks', /problem, the part and the page number[\s\S]*submission app asks which problem and part/],
    ['the export: one file, sheet: "generic", the parts, the map, no question text', /holds one file[\s\S]*sheet: "generic"[\s\S]*problems and parts[\s\S]*map[\s\S]*no question text/],
    ['the instructor folder and the rubric are unchanged', /instructor folder is the same as always, and the grading rubric keeps every part with its points and its grading prompt/],
    ['the reader kind works, at 0 points, graded by nothing', /Reader assignments work too[\s\S]*0 points and nothing grades it/],
    ['copies from the ECE front desk, or electronically for a tablet', /ECE front desk[\s\S]*tablet/],
    ['the solution and the rubric must be supplied, and are not optional', /you must supply, for every assignment[\s\S]*not optional[\s\S]*worked solution[\s\S]*rubric, or the grading guidance for each part/],
  ];
  for (const [what, re] of POINTS) {
    await check(`ITEM 1: the section says ${what}`, () => {
      assert(re.test(text), `not found in the rendered section:\n          ${text.slice(0, 300)}…`);
    });
  }

  await check('ITEM 1: the section is reachable from the home screen control and the editor control', () => {
    assert(/HelpLink section="generic"/.test(code('pages/Dashboard.tsx')),
      'the Generic answer page button on the dashboard has no ? link to the section');
    const editor = code('pages/Editor.tsx');
    const at = editor.indexOf('What students write on');
    assert(at >= 0 && /HelpLink section="generic"/.test(editor.slice(at, at + 400)),
      'the "What students write on" control has no ? link to the section');
  });

  // =====================================================
  // ITEM 2: the ? links put the heading at the top of the panel body
  // =====================================================
  await check('ITEM 2: the scroll target puts the heading at the top of the body', () => {
    // Body's top edge at y 100, not scrolled; the heading drawn at y 400.
    assertEqual(scrollTopToShow({ top: 100, scrollTop: 0 }, 400), 300, 'did not scroll the heading to the top');
    // Already scrolled 250: the heading is 69 px below the top, so 69 more.
    assertEqual(scrollTopToShow({ top: 100, scrollTop: 250 }, 169), 319, 'ignored the current scroll');
    // Above the body (scrolled past it): scroll back up to it.
    assertEqual(scrollTopToShow({ top: 100, scrollTop: 500 }, 40), 440, 'could not scroll back up');
    // Never below zero.
    assertEqual(scrollTopToShow({ top: 100, scrollTop: 0 }, 60), 0, 'scrolled to a negative position');
  });

  await check('ITEM 2: it is measured, with no offsetTop and no offset constant', () => {
    const src = code('components/HelpGuide.tsx');
    assert(!/offsetTop/.test(src), 'offsetTop is back: it is measured from the overlay, not from the body');
    const fn = src.slice(src.indexOf('export const scrollTopToShow'), src.indexOf('export const HelpGuide'));
    assert(fn.length > 0, 'scrollTopToShow is gone');
    assert(!/[-+]\s*\d+(?!\s*\))/.test(fn.replace(/Math\.max\(0,/, '')),
      `a literal offset appears in the scroll computation: ${fn.trim()}`);
    const effect = src.slice(src.indexOf('React.useEffect'), src.indexOf('if (!isOpen) return null'));
    assert(/scrollTopToShow\(/.test(effect) && /getBoundingClientRect\(\)/.test(effect),
      'the panel does not use the measured computation');
    assert(!/scrollTop\s*=\s*[^;]*[-+]\s*\d/.test(effect), 'the effect adds a literal offset');
  });
}

// =====================================================
// ITEM 3: every cross-reference in the guide names a section that exists
// =====================================================
await check('ITEM 3: every cross-reference in the guide resolves to a section', () => {
  const guide = read('docs/INSTRUCTOR_GUIDE.md');
  const headings = new Set([...guide.matchAll(/^#{1,4}\s+(.+)$/gm)].map(m => m[1].trim()));
  // A cross-reference is an italic name the text points the reader to:
  // "*X* below", "*X* above", "see *X*".
  const refs = [...guide.replace(/\n/g, ' ').matchAll(/(?:\bsee\s+)?\*([^*]+)\*\s+(below|above)|\bsee\s+\*([^*]+)\*/gi)]
    .map(m => (m[1] || m[3]).trim());
  assert(refs.length >= 2, `expected at least two cross-references, found ${JSON.stringify(refs)}`);
  const broken = refs.filter(r => !headings.has(r));
  assertEqual(broken, [], 'a cross-reference names a section the guide does not have');
  assert(/the two questions in \*Two things to choose first\*/.test(guide.replace(/\s+/g, ' ')),
    'Getting started does not point at the section holding the two questions');
});

await check('ITEM 1: no bold or italic in the guide is split across two lines, which renders as asterisks', () => {
  // The guide is rendered one source line at a time (components/HelpGuide.tsx),
  // so emphasis opened on one line and closed on the next is printed as
  // literal asterisks. It happened in the new section's first draft.
  const bad = read('docs/INSTRUCTOR_GUIDE.md').split(/\r?\n/)
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => !/^\s*\|/.test(line))
    .filter(([, line]) => {
      const noCode = line.replace(/`[^`]*`/g, '');
      const bold = (noCode.match(/\*\*/g) || []).length;
      const single = (noCode.replace(/\*\*/g, '').match(/\*/g) || []).length;
      return bold % 2 !== 0 || single % 2 !== 0;
    })
    .map(([n, line]) => `line ${n}: ${line.trim()}`);
  assertEqual(bad, [], 'emphasis is split across lines in the guide');
});

// =====================================================
// ITEM 4: the rescale question is asked in the page, never by a dialog
// =====================================================
{
  const m = await loadExportPath(REPO);
  const needsRescale = () => ({
    id: 'rs-1', courseCode: 'DEMO101', title: 'Rescale Probe', inputMode: 'electronic',
    assignmentKind: 'conventional', preamble: '', targetPoints: 100,
    problems: [{ id: 'p0', name: 'One', description: '', subsections: [
      { id: 's0', name: 'A', description: 'Say a.', points: 60, submissionType: 'Text', graderNote: 'a' },
      { id: 's1', name: 'B', description: 'Say b.', points: 30, submissionType: 'Text', graderNote: 'b' },
    ] }],
    createdAt: 1700000000000, updatedAt: 1700000000000,
  });

  // The browser that has started ignoring dialogs: `confirm` exists and
  // answers false without showing anything.
  let confirmCalls = 0;
  const realConfirm = globalThis.confirm;
  globalThis.confirm = () => { confirmCalls += 1; return false; };
  m.setRescaleConfirm(null);
  try {
    await check('ITEM 4: with confirm answering false, an undecided export REFUSES VISIBLY, and confirm is never called', async () => {
      let err = null;
      try { await m.exportService.downloadZIP(needsRescale()); } catch (e) { err = e; }
      assert(err, 'the export went ahead with no decision, which would rescale marks nobody agreed to');
      assert(!m.isRescaleDeclined(err), 'it was treated as a quiet decline, which shows the instructor nothing');
      assert(err.rescaleDecisionNeeded === true, `refused for another reason: ${err.message}`);
      assert(/90 points/.test(err.message) && /target is 100/.test(err.message), `the message does not name both numbers: ${err.message}`);
      assertEqual(confirmCalls, 0, 'the export path called confirm');
    });

    await check('ITEM 4: with confirm answering false, the choice made in the page still exports, rescaled', async () => {
      const out = await m.exportService.downloadZIP(needsRescale(), true);
      assert(out && out.blob, 'the export did not complete');
      assertEqual(confirmCalls, 0, 'the export path called confirm');
    });

    await check('ITEM 4: Cancel in the page is a decision: nothing is written, and it is reported as one', async () => {
      let err = null;
      try { await m.exportService.downloadZIP(needsRescale(), false); } catch (e) { err = e; }
      assert(err && m.isRescaleDeclined(err), 'Cancel did not stop the export as a decline');
    });

    await check('ITEM 4: an assignment already at its target exports without any question', async () => {
      const a = { ...needsRescale(), targetPoints: 90 };
      const out = await m.exportService.downloadZIP(a);
      assert(out && out.blob, 'an export needing no rescale did not complete');
      assertEqual(confirmCalls, 0, 'the export path called confirm');
    });
  } finally {
    globalThis.confirm = realConfirm;
  }

  await check('ITEM 4: no confirm() remains on any export path', () => {
    for (const f of ['services/exportService.ts', 'components/RescaleChoice.tsx']) {
      assert(!/\bconfirm\s*\(/.test(code(f)), `${f} still calls confirm`);
    }
    // Every page's call into an export passes the decision made in the page.
    for (const f of ['pages/Dashboard.tsx', 'pages/Editor.tsx', 'components/Preview.tsx']) {
      const calls = [...code(f).matchAll(/exportService\.(downloadZIP|downloadMd|downloadGraderDoc|downloadQrTemplate)\(([^)]*)\)/g)];
      for (const [whole, , args] of calls) {
        assert(/,\s*rescale\s*$/.test(args.trim()), `${f}: ${whole} does not pass the decision made in the page`);
      }
      if (calls.length) assert(/withRescaleChoice\(/.test(code(f)), `${f} exports without asking in the page`);
    }
  });

  const panel = await run('rescale', `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RescaleChoicePanel } from './components/RescaleChoice';
export const html = renderToStaticMarkup(React.createElement(RescaleChoicePanel,
  { notice: { authoredTotal: 90, targetPoints: 100 }, onRescale: () => {}, onCancel: () => {} }));
`);
  await check('ITEM 4: the question in the page names both numbers, and each button says what it does', () => {
    const t = panel.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert(/totals 90 points/.test(t) && /target is 100/.test(t), `the panel does not name both numbers: ${t}`);
    assert(/Rescale to 100 and export/.test(t), 'no button that rescales and exports');
    assert(/Cancel, and set the Target box to 90/.test(t), 'no button that cancels');
    assert(/role="dialog"/.test(panel.html), 'the panel is not announced as a dialog');
  });
}

// =====================================================
// ITEM 5: a labelled way home from every screen but home
// =====================================================
{
  const mod = await run('home', `
${STORAGE_STUB}
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HOME_SCREEN_NAME, Layout } from './components/Common';
import Editor from './pages/Editor';
import Preview from './components/Preview';
import Dashboard from './pages/Dashboard';
const at = (path, route, el) => renderToStaticMarkup(
  React.createElement(MemoryRouter, { initialEntries: [path] },
    React.createElement(Routes, null, React.createElement(Route, { path: route, element: el }))));
export const editor = at('/edit/probe', '/edit/:id', React.createElement(Editor));
export const create = at('/create', '/create', React.createElement(Editor));
export const preview = at('/view/probe', '/view/:id', React.createElement(Preview));
export const home = at('/', '/', React.createElement(Dashboard));
export { HOME_SCREEN_NAME };
`);
  const link = /<a[^>]*data-home-link[^>]*>[\s\S]*?<\/a>/;
  for (const [screen, html] of [['editor', mod.editor], ['new-assignment editor', mod.create], ['preview', mod.preview]]) {
    await check(`ITEM 5: the ${screen} screen has a labelled control back to the ${mod.HOME_SCREEN_NAME}`, () => {
      const a = html.match(link);
      assert(a, `no labelled way home on the ${screen} screen`);
      assert(/href="\/"/.test(a[0]), 'the control does not go to the home screen');
      assert(new RegExp(`aria-label="Go to the ${mod.HOME_SCREEN_NAME}"`).test(a[0]), 'the control has no accessible name');
      assert(a[0].replace(/<[^>]+>/g, '').includes(mod.HOME_SCREEN_NAME), 'the control does not show the home screen\'s name');
      assert(!/BridgeSuite/.test(a[0]), 'the control is the wordmark; it must be a labelled control of its own');
    });
  }
  await check('ITEM 5: the home screen does not offer a way to itself, and its heading is the same word', () => {
    assert(!link.test(mod.home), 'the home screen links to itself');
    assert(mod.home.includes(`>${mod.HOME_SCREEN_NAME}<`), `the home screen is not headed "${mod.HOME_SCREEN_NAME}"`);
  });
  await check('ITEM 5: the wordmark still goes home', () => {
    assert(/<a[^>]*href="\/"[^>]*>[\s\S]*?ridgeSuite/.test(mod.editor), 'the wordmark no longer links home');
  });
}

// =====================================================
// ITEM 6: a figure can be replaced without first running Extract figures
// =====================================================
{
  const m = await load6();
  async function load6() {
    return run('figures', `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { extractFigures, inlineFigureBlocker } from './services/figureExtract';
import { splitFigures } from './services/figureBlocks';
import { parseFigureRefs, resolveAssignmentFigures } from './services/figureRefs';
import { InlineFigureCard, InlineFigureCards } from './components/FigureCard';
export const cards = (description, refCount = 0) => renderToStaticMarkup(React.createElement(InlineFigureCards,
  { problemNumber: 2, description, refCount, onReplace: () => {} }));
export const card = (props) => renderToStaticMarkup(React.createElement(InlineFigureCard,
  { figureNumber: 1, problemNumber: 1, title: 'Divider', svg: '<svg/>', onReplace: () => {}, ...props }));
export { extractFigures, inlineFigureBlocker, splitFigures, parseFigureRefs, resolveAssignmentFigures };
`);
  }
  const svg = (t, d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${t}</title>${d ? `<desc>${d}</desc>` : ''}<path d="M0 0 L10 10"/></svg>`;
  const fence = (s) => '```svg\n' + s + '\n```';
  const assignmentWith = (description, figures) => ({
    id: 'f1', courseCode: 'DEMO101', title: 'Figures', inputMode: 'electronic', assignmentKind: 'conventional',
    preamble: '', problems: [{ id: 'p0', name: 'One', description, subsections: [] }],
    createdAt: 1, updatedAt: 1, ...(figures ? { figures } : {}),
  });

  await check('ITEM 6: Replace on an inline drawing extracts THAT drawing only, and nothing students see changes', () => {
    const text = `Before.\n${fence(svg('First', 'One'))}\nBetween.\n${fence(svg('Second', 'Two'))}\nAfter.`;
    const a = assignmentWith(text);
    const r = m.extractFigures(a, { problemIndex: 0, figureIndex: 1 });
    assertEqual(r.extracted.map(e => [e.id, e.title]), [['p1-fig1', 'Second']], 'the wrong figure was extracted');
    const after = r.assignment.problems[0].description;
    assertEqual(m.parseFigureRefs(after).map(s => s.ref.id), ['p1-fig1'], 'the chosen figure did not become a file');
    assertEqual(m.splitFigures(after).filter(s => s.kind === 'figure').length, 1, 'the other drawing did not stay inline');
    assertEqual(m.resolveAssignmentFigures(r.assignment).problems[0].description, text,
      'extracting one figure changed what students see');
  });

  await check('ITEM 6: a new drawing never takes the id of a file already stored (first free number)', () => {
    const first = m.extractFigures(assignmentWith(`${fence(svg('First', 'One'))}`));
    const grown = { ...first.assignment, problems: [{ ...first.assignment.problems[0],
      description: first.assignment.problems[0].description + '\n' + fence(svg('Second', 'Two')) }] };
    const again = m.extractFigures(grown, { problemIndex: 0, figureIndex: 0 });
    assertEqual(again.extracted.map(e => e.id), ['p1-fig2'], 'the new drawing reused an id already in use');
    assert(again.assignment.figures['p1-fig1'].base64 === first.assignment.figures['p1-fig1'].base64,
      'the file already stored under p1-fig1 was overwritten');
  });

  await check('ITEM 6: an inline drawing\'s card offers Replace, and says it changes nothing students see', () => {
    const html = m.card({ blocker: null });
    assert(/data-inline-figure-card/.test(html), 'no card for an inline drawing');
    assert(/Replace image/.test(html) && /type="file"/.test(html), 'the card offers no Replace');
    assert(/changes nothing students see/.test(html), 'the card does not say replacing is safe');
  });

  await check('ITEM 6: a drawing that cannot become a file says why on its card, before anyone tries', () => {
    const seg = m.splitFigures(fence(svg('Untitled desc', ''))).find(s => s.kind === 'figure');
    const blocker = m.inlineFigureBlocker(seg);
    assert(blocker && /<desc>/.test(blocker), `unexpected blocker: ${blocker}`);
    const html = m.card({ blocker });
    assert(!/Replace image/.test(html), 'a card that cannot replace still offers Replace');
    assert(html.includes('cannot be replaced from here because'), 'the card does not say why');
  });

  await check('ITEM 6: every inline drawing in a problem gets a card, numbered after its figure files', () => {
    const text = `A.\n${fence(svg('First', 'One'))}\nB.\n${fence(svg('Second', 'Two'))}`;
    const html = m.cards(text, 1);
    assertEqual((html.match(/data-inline-figure-card/g) || []).length, 2, 'not one card per inline drawing');
    assert(html.includes('Figure 2 in Problem 2') && html.includes('Figure 3 in Problem 2'),
      'the cards are not numbered after the problem\'s figure files');
    assertEqual(m.cards('No drawing here.'), '', 'a problem with no drawing shows a card');
  });

  await check('ITEM 6: the editor renders those cards and replaces through extraction', () => {
    const editor = code('pages/Editor.tsx');
    assert(/<InlineFigureCards\s[^>]*?description=\{problem\.description \|\| ''\}/.test(editor),
      'the editor renders no cards for inline drawings');
    const handler = editor.slice(editor.indexOf('const handleReplaceInlineFigure'), editor.indexOf('const handleReplaceFigure'));
    assert(/extractFigures\(assignment,\s*\{\s*problemIndex,\s*figureIndex\s*\}\)/.test(handler),
      'Replace on an inline drawing does not extract it first');
    assert(/handleReplaceFigure\(/.test(handler), 'Replace on an inline drawing does not go through the ordinary replace');
  });
}

// ---------- report ----------
for (const f of scratch) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
try {
  rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (err) {
  console.log(`  note: could not remove ${outDir} (${err.code}); it is a temp directory and is left behind`);
}
// A suite that ran no checks has not passed (tests/suiteExit.mjs).
suiteExit(passed, failed);
