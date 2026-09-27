// =====================================================
// Nothing fails silently, and nothing says something that is not true
// =====================================================
// WORKORDER_AM_NOTHING_FAILS_SILENTLY_2026-09-27, items 1 to 4 and 6.
// (Item 5, the image figure card, is rendered in instructor-ui-tests.mjs.)

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { suiteExit } from './suiteExit.mjs';

globalThis.crypto ??= webcrypto;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const req = createRequire(join(REPO, 'package.json'));

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
const code = (rel) => readFileSync(join(REPO, rel), 'utf8')
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------- load ----------
const outDir = mkdtempSync(join(tmpdir(), 'gb-silent-'));
const plugins = [{
  name: 'silent', setup(b) {
    b.onResolve({ filter: /^file-saver$/ }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const s=new Proxy(function(){},{get:()=>s,apply:()=>s,construct:()=>s});export default s;', loader: 'js' }));
    b.onResolve({ filter: /\?(raw|dataurl)$/ }, a => {
      const [, q] = a.path.match(/\?(raw|dataurl)$/);
      return { path: req.resolve(a.path.replace(/\?(raw|dataurl)$/, '')), namespace: q };
    });
    b.onLoad({ filter: /.*/, namespace: 'raw' }, a => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
    b.onLoad({ filter: /.*/, namespace: 'dataurl' }, a => ({
      contents: `export default ${JSON.stringify('data:font/woff2;base64,' + readFileSync(a.path).toString('base64'))};`, loader: 'js' }));
  },
}];
const loadTs = async (rel, name) => {
  const outfile = join(outDir, name);
  await build({ entryPoints: [join(REPO, rel)], outfile, format: 'esm', target: 'es2022', bundle: true,
    platform: 'node', absWorkingDir: REPO, logLevel: 'silent', plugins });
  return import(pathToFileURL(outfile).href);
};

const storage = await loadTs('services/storageService.ts', 'storage.mjs');
const msgs = await loadTs('services/importMessages.ts', 'msgs.mjs');
const gen = await loadTs('services/templateGenerator.ts', 'gen.mjs');
const exportSvc = await loadTs('services/exportService.ts', 'export.mjs');
const parser = await loadTs('services/mdParserService.ts', 'parser.mjs');

console.log('\nNothing fails silently\n');

// =====================================================
// ITEM 1: a save that cannot be written says so
// =====================================================
/** A localStorage whose writes behave as a full browser store does. */
const fakeStorage = (fail) => {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (fail === 'quota') {
        const err = new Error("Failed to execute 'setItem' on 'Storage': Setting the value exceeded the quota.");
        err.name = 'QuotaExceededError'; err.code = 22;
        throw err;
      }
      if (fail === 'other') { const e = new Error('denied'); e.name = 'SecurityError'; throw e; }
      data.set(k, v);
    },
    removeItem: (k) => data.delete(k),
  };
};
const assignment = { id: 'a1', title: 'EEC130A Homework 1', courseCode: 'EEC130A', problems: [], createdAt: 1, updatedAt: 1 };

let quotaResult;
await check('ITEM 1: a full store does not throw out of save(); it returns the failure', () => {
  globalThis.localStorage = fakeStorage('quota');
  try { quotaResult = storage.storageService.save(assignment); }
  catch (err) { throw new Error(`save() threw instead of reporting: ${err.message}`); }
  assertEqual(quotaResult.ok, false, 'a failed write reported success');
});

await check('ITEM 1: the notice names the failure, says nothing was written, and says what to do', () => {
  const { title, body } = quotaResult.notice;
  assert(/was NOT saved/.test(title) && title.includes('EEC130A Homework 1'), `the title does not say it: ${title}`);
  const text = body.join(' ');
  assert(/storage .* is full/.test(text), `it does not say why: ${text}`);
  assert(/nothing was written/.test(text), 'it does not say nothing was written');
  assert(/Export \.md/.test(text) && /delete assignments/.test(text), 'it does not say what to do');
});

await check('ITEM 1: nothing already stored is lost by the failed write', () => {
  const s = fakeStorage(null);
  globalThis.localStorage = s;
  assertEqual(storage.storageService.save({ ...assignment, id: 'kept', title: 'Kept' }).ok, true, 'the first save failed');
  const before = s.data.get('gradebridge_assignments_v1');
  s.setItem = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  assertEqual(storage.storageService.save(assignment).ok, false, 'the second save did not fail');
  assertEqual(s.data.get('gradebridge_assignments_v1'), before, 'the stored assignments changed');
  assertEqual(storage.storageService.getAll().map(a => a.id), ['kept'], 'a stored assignment was lost');
});

await check('ITEM 1: a failure that is not quota still says so, and names the error', () => {
  globalThis.localStorage = fakeStorage('other');
  const r = storage.storageService.save(assignment);
  assert(!r.ok && /was NOT saved/.test(r.notice.title) && r.notice.body.join(' ').includes('SecurityError'),
    `not reported: ${JSON.stringify(r)}`);
});

await check('ITEM 1: delete reports a failed write too, instead of pretending', () => {
  globalThis.localStorage = fakeStorage('quota');
  const r = storage.storageService.delete('a1');
  assert(!r.ok && /was NOT deleted/.test(r.notice.title), `not reported: ${JSON.stringify(r)}`);
});

await check('ITEM 1: the editor shows the notice and does NOT navigate when Save fails', () => {
  const ed = code('pages/Editor.tsx');
  const save = ed.slice(ed.indexOf('const handleSave'), ed.indexOf('const handleExtractFigures') > 0 ? ed.indexOf('const handleExtractFigures') : undefined);
  assert(/const saved = storageService\.save\(toSave\);\s*if \(!saved\.ok\) \{ await tell\(saved\.notice\); return; \}\s*navigate\('\/'\);/.test(save),
    'Save does not check the write before navigating away');
});

await check('ITEM 1: every write in the app acts on its result; none is a bare statement', () => {
  for (const f of ['pages/Editor.tsx', 'pages/Dashboard.tsx']) {
    const bare = code(f).split('\n').filter(l => /^\s*storageService\.(save|delete)\(/.test(l));
    assertEqual(bare, [], `${f} has a write whose failure is ignored`);
  }
});

// =====================================================
// ITEMS 2 to 4: the import notices
// =====================================================
await check('ITEM 2: the first two lines say it was not imported and what to do', () => {
  const problems = Array.from({ length: 12 }, (_, i) => `Problem ${i + 1}: the image figs/Fig-${i}.png is not among the files chosen.`);
  const [first, second] = msgs.figureRefusalMessage(12, problems).split('\n');
  assertEqual(first, 'This was not imported.', 'line 1');
  assert(/^Choose the folder that holds the \.md and its images/.test(second), `line 2 is not the remedy: ${second}`);
});

const hw1Paths = ['master/EEC130A_Homework1.md', 'master/README.md', 'master/main.tex',
  'master/figs/Fig-3.png', 'master/figs/Fig-3a.png', 'master/figs/Fig-4.png',
  'master/figs/Fig-5a.png', 'master/figs/Fig-5b.png', 'master/figs/wiki-rg59.jpg'];
const used = ['master/figs/Fig-4.png', 'master/figs/Fig-3a.png', 'master/figs/wiki-rg59.jpg'];

await check('ITEM 3: the Homework 1 folder names Fig-3, Fig-5a and Fig-5b as unused, and nothing else', () => {
  assertEqual(msgs.unusedImages(hw1Paths, used, []),
    ['master/figs/Fig-3.png', 'master/figs/Fig-5a.png', 'master/figs/Fig-5b.png'], 'the wrong files were named');
});

await check('ITEM 3: the notice lists them one per line and does not refuse', () => {
  const n = msgs.unusedImagesNotice(msgs.unusedImages(hw1Paths, used, []));
  const lines = n.split('\n');
  for (const f of ['Fig-3.png', 'Fig-5a.png', 'Fig-5b.png']) {
    assert(lines.some(l => /^  • /.test(l) && l.endsWith(f)), `${f} is not on a line of its own`);
  }
  assert(!/^This was not imported/.test(n), 'it reads as a refusal of the whole import');
  assert(/Nothing is wrong if these are spare drawings/.test(n), 'it does not say spare drawings are fine');
});

await check('ITEM 3: an image a figure block uses is not called unused', () => {
  assertEqual(msgs.unusedImages(['figures/p1-circuit.png', 'figures/spare.png'], [], ['p1-circuit']),
    ['figures/spare.png'], 'a block-referenced image was called unused');
});

await check('ITEM 4: six set-aside files, one per line', () => {
  const six = Array.from({ length: 6 }, (_, i) => `master/2026-09-27 note ${i + 1} to the Assignment Maker lane.md`);
  const lines = msgs.setAsideNotice('master/EEC130A_Homework1.md', six).split('\n');
  assertEqual(lines.length, 7, 'not a heading plus one line per file');
  six.forEach((f, i) => assertEqual(lines[i + 1], `  • ${f}`, `file ${i + 1} is not on its own line`));
});

// =====================================================
// ITEM 6: the print guards are called where a sheet is printed
// =====================================================
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c;
});
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const colourPng = (w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0, o = 0; y < h; y++) { raw[o++] = 0; for (let x = 0; x < w; x++) { raw[o++] = 200; raw[o++] = 30; raw[o++] = 30; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};
const uri = `data:image/png;base64,${colourPng(120, 40).toString('base64')}`;
const md = (sheet) => [
  '# DEMO101: Printed Figure', '', '**Input:** handwritten', '', ...(sheet ? [`**Sheet:** ${sheet}`, ''] : []),
  '## Problem 1: A circuit', '', 'The circuit below.', '', `![Transmission line circuit](${uri})`, '',
  '### (a) Find it [1 pts] [handwritten:human]', 'Find the current.', '', '> grader_note: 3 A.', '',
].join('\n');

let refusal = null;
await check('ITEM 6: a printed-sheet assignment carrying a colour raster is refused at template generation', async () => {
  try { await gen.generateTemplate(parser.parseMdToAssignment(md(null))); }
  catch (err) { refusal = err; }
  assert(refusal, 'the colour raster was printed');
  const [first, second] = refusal.message.split('\n');
  assert(/printed sheet was not generated/.test(first), `line 1: ${first}`);
  assert(/Replace each figure/.test(second), `line 2 is not the remedy: ${second}`);
  assert(refusal.message.includes('Problem 1, figure 1 ("Transmission line circuit")'), 'the figure is not named');
  assert(/colour/.test(refusal.message) && /blurry/.test(refusal.message), 'the causes are not named');
});

await check('ITEM 6: a generic-sheet assignment carrying the same figure exports as before', async () => {
  const a = exportSvc.normalizePointsConfirmed(parser.parseMdToAssignment(md('generic')));
  const entries = await exportSvc.buildExportEntries(a);
  assert(Object.keys(entries).some(n => n.endsWith('_OPEN_IN_APP.json')), 'the generic export did not complete');
});

await check('ITEM 6: the authoring path still never applies the print guards', () => {
  for (const rel of ['services/figureImport.ts', 'services/figureConvert.ts', 'pages/Editor.tsx', 'pages/Dashboard.tsx']) {
    assert(!readFileSync(join(REPO, rel), 'utf8').includes('figurePrintProblems'), `${rel} applies the print guards`);
  }
  assert(readFileSync(join(REPO, 'services/templateGenerator.ts'), 'utf8').includes('await printedFigureProblems(assignment)'),
    'generateTemplate does not call the print guards');
});

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* windows handles */ }
suiteExit(passed, failed);
