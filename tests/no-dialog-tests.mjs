// =====================================================
// No browser dialogs, and a privacy notice that matches the export
// =====================================================
// WORKORDER_AM_NO_BROWSER_DIALOGS_2026-09-24, items 1 and 2.
//
// Item 1: the six questions the app asked with `window.confirm` are asked in
// the page. Each is driven here with NO ANSWER, which is what a suppressed
// dialog used to hand the code: the two deletes must leave the assignment
// intact, and the two imports, the input-mode switch and Reopen must report
// what they did not do. The built-bundle scan lives in `bundle-tests.mjs`,
// which is the suite that builds the production bundle.
//
// Item 2: the privacy notice is rendered through the real component and every
// file it names is held to what the export actually writes, on each path.

import { suiteExit } from './suiteExit.mjs';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadExportPath, pinnedAssignment } from './exportHashes.mjs';

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
const code = (rel) => read(rel).replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');

// ---- rendering the real components (see figure-render-tests.mjs) ------------
const cacheDir = join(REPO, 'node_modules', '.cache');
mkdirSync(cacheDir, { recursive: true });
const outDir = mkdtempSync(join(cacheDir, 'gb-dialog-'));
const requireFromRepo = createRequire(join(REPO, 'package.json'));
const run = async (name, entrySource) => {
  const entry = join(REPO, `__dialog-entry-${name}.tsx`);
  writeFileSync(entry, entrySource, 'utf8');
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
            const [, kind] = args.path.match(/\?(raw|dataurl)$/);
            const bare = args.path.replace(/\?(raw|dataurl)$/, '');
            const path = bare.startsWith('.') ? resolve(args.resolveDir, bare) : requireFromRepo.resolve(bare);
            return { path, namespace: kind };
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

console.log('\nNo browser dialogs; the privacy notice matches the export\n');

const q = await run('questions', `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChoicePanel } from './components/ChoicePanel';
import { PrivacyNoticeBody, STUDENT_PACKAGE_BY_PATH } from './components/PrivacyNotice';
export * from './services/questions';
export { REOPEN_WARNING } from './services/finalize';
export const panel = (question) => renderToStaticMarkup(React.createElement(ChoicePanel,
  { question, onAnswer: () => {}, onDismiss: () => {} }));
export const notice = renderToStaticMarkup(React.createElement(PrivacyNoticeBody));
export { STUDENT_PACKAGE_BY_PATH };
`);

/** A panel closed without an answer: what a suppressed dialog used to be. */
const unanswered = async () => null;
/** A panel answered with a given button's value. */
const answering = (value) => async () => value;

// =====================================================
// ITEM 1: each question, driven with no answer
// =====================================================

await check('DELETE (dashboard and editor): no answer deletes nothing, and a notice is not needed', async () => {
  assertEqual(await q.askDelete(unanswered, 'HW 1'), false, 'an unanswered delete question deleted');
  assertEqual(await q.askDelete(answering(false), 'HW 1'), false, 'Keep it deleted');
  assertEqual(await q.askDelete(answering(true), 'HW 1'), true, 'Delete did not delete');
});

await check('IMPORT OVERWRITE (JSON and .md): no answer imports NOTHING, and says so', async () => {
  const r = await q.askImportCollision(unanswered, 'EEC130A: Homework 1');
  assertEqual(r.choice, null, 'an unanswered overwrite question still chose something');
  assert(r.notice, 'an unanswered overwrite question returned silently');
  const text = [r.notice.title, ...r.notice.body].join(' ');
  assert(/Nothing was imported/.test(text) && /not imported/.test(text) && /EEC130A: Homework 1/.test(text)
    && /existing assignment is unchanged/.test(text),
    `the notice does not say what was not done: ${text}`);
  assertEqual((await q.askImportCollision(answering('overwrite'), 'X')).choice, 'overwrite', 'Replace not honoured');
  assertEqual((await q.askImportCollision(answering('copy'), 'X')).choice, 'copy', 'Keep both not honoured');
});

await check('MODE SWITCH: no answer does not switch, and says so', async () => {
  const r = await q.askModeSwitch(unanswered, 'Electronic text and images', 'Handwritten', 'Handwritten', ['1a. Q — Text']);
  assertEqual(r.proceed, false, 'an unanswered switch question switched');
  assert(r.notice, 'an unanswered switch question returned silently');
  const text = [r.notice.title, ...r.notice.body].join(' ');
  assert(/Still Electronic text and images/.test(text) && /was not made/.test(text),
    `the notice does not say what was not done: ${text}`);
  const stay = await q.askModeSwitch(answering('stay'), 'A', 'B', 'B', ['x']);
  assertEqual([stay.proceed, stay.notice], [false, null], 'an explicit Stay was reported as unanswered');
  assertEqual((await q.askModeSwitch(answering('switch'), 'A', 'B', 'B', ['x'])).proceed, true, 'the switch was refused');
});

await check('REOPEN: no answer does not reopen, and says the assignment is still finalized', async () => {
  const r = await q.askReopen(unanswered, q.REOPEN_WARNING);
  assertEqual(r.proceed, false, 'an unanswered reopen question reopened');
  assert(r.notice, 'an unanswered reopen question returned silently');
  const text = [r.notice.title, ...r.notice.body].join(' ');
  assert(/Still finalized/.test(text) && /not reopened/.test(text), `the notice does not say what was not done: ${text}`);
  const keep = await q.askReopen(answering(false), q.REOPEN_WARNING);
  assertEqual([keep.proceed, keep.notice], [false, null], 'an explicit Keep it finalized was reported as unanswered');
  assertEqual((await q.askReopen(answering(true), q.REOPEN_WARNING)).proceed, true, 'Reopen was refused');
  // The warning itself is carried whole into the panel.
  const body = q.reopenQuestion(q.REOPEN_WARNING).body.join(' ');
  assert(/printed copies/.test(body) && /recorded/.test(body), 'the reopen warning lost its content');
});

await check('every question\'s buttons say what they do: no bare OK or Cancel', () => {
  const qs = [
    q.deleteQuestion('HW 1'), q.importCollisionQuestion('HW 1'),
    q.modeSwitchQuestion('A', 'B', 'B', ['x']), q.reopenQuestion(q.REOPEN_WARNING),
  ];
  for (const question of qs) {
    for (const o of question.options) {
      assert(!/^(OK|Cancel|Yes|No)$/i.test(o.label), `"${question.title}" has a button labelled only "${o.label}"`);
    }
    assert(question.options.length >= 2, `"${question.title}" offers no choice`);
  }
});

await check('the panel renders the question in the page, with a labelled close and every button', () => {
  const html = q.panel(q.importCollisionQuestion('EEC130A: Homework 1'));
  assert(/role="dialog"/.test(html) && /data-choice-panel/.test(html), 'not rendered as an in-page dialog');
  assert(/aria-label="Close without choosing"/.test(html), 'no labelled way to close without choosing');
  for (const label of ['Keep both', 'Replace the existing one']) {
    assert(html.includes(`>${label}<`), `the button "${label}" is not rendered`);
  }
});

// The wiring: each handler asks through the module above, and on an unanswered
// constructive question tells and returns BEFORE it saves or changes anything.
const handlerBetween = (src, start, end) => {
  const a = src.indexOf(start);
  assert(a >= 0, `cannot find ${start}`);
  const b = src.indexOf(end, a + start.length);
  return src.slice(a, b < 0 ? undefined : b);
};

await check('WIRING: no window.confirm, globalThis.confirm or self.confirm remains in any source file', () => {
  const files = ['pages/Dashboard.tsx', 'pages/Editor.tsx', 'components/Preview.tsx', 'components/Common.tsx',
    'components/FigureCard.tsx', 'components/HelpGuide.tsx', 'components/RescaleChoice.tsx',
    'components/ChoicePanel.tsx', 'services/exportService.ts', 'App.tsx'];
  for (const f of files) {
    assert(!/(window|globalThis|self)\.confirm\b|(^|[^.\w$])confirm\s*\(/m.test(code(f)), `${f} still calls confirm`);
  }
});

await check('WIRING: both deletes ask in the page and delete only on a pressed Delete', () => {
  const dash = code('pages/Dashboard.tsx');
  const d1 = handlerBetween(dash, 'const handleDelete', 'const handleExport');
  assert(/if \(await askDelete\(ask, title\)\) \{\s*storageService\.delete\(id\)/.test(d1), 'the dashboard delete is not gated by askDelete');
  const ed = code('pages/Editor.tsx');
  const d2 = handlerBetween(ed, 'const handleDeleteAssignment', 'const updateProblem');
  assert(/if \(await askDelete\(ask, assignment\.title\)\) \{\s*storageService\.delete\(assignment\.id\)/.test(d2),
    'the editor delete is not gated by askDelete');
});

await check('WIRING: both imports tell and return before saving when the question is unanswered', () => {
  const dash = code('pages/Dashboard.tsx');
  for (const [name, from] of [['JSON', 'const existing = storageService.get(importedAssignment.id)'],
                              ['.md', 'const existing = storageService.getAll().find(']]) {
    const body = handlerBetween(dash, from, 'storageService.save(');
    assert(/askImportCollision\(ask,/.test(body), `the ${name} import does not ask through askImportCollision`);
    assert(/if \(notice\) \{[\s\S]*?await tell\(notice\);[\s\S]*?return;\s*\}/.test(body),
      `the ${name} import does not tell and return before saving on an unanswered question`);
  }
});

await check('WIRING: the mode switch and Reopen tell and return before changing anything', () => {
  const ed = code('pages/Editor.tsx');
  const sw = handlerBetween(ed, 'const changeInputMode', 'const removeProblem');
  assert(/await askModeSwitch\(ask,/.test(sw), 'the switch does not ask through askModeSwitch');
  assert(/if \(notice\) \{ await tell\(notice\); return; \}\s*if \(!proceed\) return;/.test(sw),
    'the switch does not tell and return on an unanswered question');
  assert(sw.indexOf('askModeSwitch') < sw.indexOf('setAssignment('), 'the switch changes the assignment before asking');
  const re = handlerBetween(ed, 'const handleReopen', 'const handleDeleteAssignment');
  assert(/await askReopen\(ask, REOPEN_WARNING\)/.test(re), 'Reopen does not ask through askReopen');
  assert(/if \(notice\) \{ await tell\(notice\); return; \}\s*if \(!proceed\) return;/.test(re),
    'Reopen does not tell and return on an unanswered question');
});

await check('WIRING: both pages render the panel', () => {
  for (const f of ['pages/Dashboard.tsx', 'pages/Editor.tsx']) {
    assert(/useChoice\(\)/.test(code(f)) && /\{choicePanel\}/.test(code(f)), `${f} does not render the question panel`);
  }
});

// =====================================================
// ITEM 2: the privacy notice names what the export writes, per path
// =====================================================
{
  const m = await loadExportPath(REPO);
  const JSZip = (await import(pathToFileURL(requireFromRepo.resolve('jszip')).href)).default;
  const exportOf = async (fixture, extra = {}) => {
    const a = m.normalizePointsConfirmed({ ...pinnedAssignment(m, read(`tests/fixtures/${fixture}`)), ...extra });
    const entries = await m.buildExportEntries(a);
    const { outer, studentZipName } = await m.buildOuterEntries(entries, a);
    const zip = await JSZip.loadAsync(outer[studentZipName]);
    const student = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
    const stem = m.exportFilenames(a).studentPdf.replace(/\.pdf$/, '');
    const everything = new Set([...Object.keys(outer), m.exportFilenames(a).instructorZip, ...student]);
    return { stem, student, everything };
  };
  const paths = {
    'Electronic': await exportOf('Math_Fixture.md'),
    'Handwritten, on the printed sheet': await exportOf('Handwritten_HW_Fixture.md'),
    'Handwritten, on the generic answer page': await exportOf('GenericSheet_Fixture.md'),
  };

  await check('NOTICE: for each path, it names exactly the files the student package holds', () => {
    assertEqual(q.STUDENT_PACKAGE_BY_PATH.map(p => p.path), Object.keys(paths), 'the notice does not cover the three paths');
    for (const p of q.STUDENT_PACKAGE_BY_PATH) {
      const real = paths[p.path];
      const named = p.files.map(f => f.name.replace('{stem}', real.stem)).sort();
      assertEqual(named, real.student, `the notice misdescribes the student package on the path "${p.path}"`);
    }
  });

  await check('NOTICE: every file it names is one an export actually writes', () => {
    const codes = [...q.notice.matchAll(/<code[^>]*>([^<]*)<\/code>/g)].map(x => x[1].replace(/&quot;/g, '"'));
    assert(codes.length > 5, `found only ${codes.length} file names in the notice`);
    const unknown = codes.filter(c => !Object.values(paths).some(({ stem, everything }) => {
      const name = c.replace(/\{stem\}/g, stem);
      if (everything.has(name)) return true;
      if (name.endsWith('/')) return [...everything].some(e => e.startsWith(name));   // a folder
      if (name.startsWith('.')) return [...everything].some(e => e.endsWith(name));   // a type
      return false;
    }));
    assertEqual(unknown, [], 'the notice names a file no export writes');
  });

  await check('NOTICE: it no longer names the files that stopped existing on 2026-09-06', () => {
    for (const gone of ['assignment_spec.json', 'layout_', 'student/', 'Export ZIP']) {
      assert(!q.notice.includes(gone), `the notice still mentions ${gone}`);
    }
  });

  await check('NOTICE: the generic path says no question text, and the student list names no instructor file', () => {
    const list = q.notice.slice(q.notice.indexOf('data-student-package'));
    const generic = list.slice(list.indexOf('on the generic answer page'));
    assert(/no question text/.test(generic), 'the generic path does not say it carries no question text');
    assert(/sheet: "generic"|sheet: &quot;generic&quot;/.test(generic), 'the generic path does not name sheet: "generic"');
    assert(!/instructor\//.test(list.slice(0, list.indexOf('</ul>'))), 'the student list describes the instructor folder');
  });
}

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
try {
  rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (err) {
  console.log(`  note: could not remove ${outDir} (${err.code}); it is a temp directory and is left behind`);
}
// A suite that ran no checks has not passed (tests/suiteExit.mjs).
suiteExit(passed, failed);
