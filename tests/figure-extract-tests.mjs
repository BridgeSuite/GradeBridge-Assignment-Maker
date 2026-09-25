// =====================================================
// Extract figures — and prove it changed nothing
// =====================================================
// Criterion 2: for HW1 to HW3, the resolved student spec before and after
// extraction must be BYTE-IDENTICAL.
//
// That is the criterion that matters, because it is the one an instructor
// cannot check for themselves. Extraction rewrites every problem stem; the only
// way to know it was invisible is to build the file a student would receive,
// both ways, and compare the bytes.
//
// The ENG17 sources live outside this repository, so those checks SKIP with a
// named reason when they are not present — and the same property is asserted
// against an in-repo fixture, which always runs.

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eng17Plan } from './eng17Sources.mjs';
import { suiteExit } from './suiteExit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
globalThis.crypto ??= webcrypto;

let passed = 0, failed = 0;
const results = [];
const check = async (name, fn) => {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
let skipped = 0;
const skip = (name, why) => { skipped++; results.push(`  SKIP  ${name} (${why})`); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n          expected: ${y}\n          actual:   ${x}`);
};

const outDir = mkdtempSync(join(tmpdir(), 'gb-extract-'));
const requireFromRepo = createRequire(join(REPO, 'package.json'));
const assetImports = {
  name: 'asset-imports',
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
};
const stubHeavy = {
  name: 'stub-heavy',
  setup(b) {
    b.onResolve({ filter: /^(jspdf|jszip|file-saver)$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const s = new Proxy(function(){}, { get: () => s, apply: () => s, construct: () => s }); export default s;',
      loader: 'js',
    }));
  },
};
const load = async (entry, name, plugins = [assetImports]) => {
  const outfile = join(outDir, name);
  await build({
    entryPoints: [entry], outfile, format: 'esm', target: 'es2022', bundle: true,
    absWorkingDir: dirname(entry), logLevel: 'silent', plugins,
  });
  return import(pathToFileURL(outfile).href);
};

const extract = await load(join(REPO, 'services', 'figureExtract.ts'), 'extract.mjs');
const refs = await load(join(REPO, 'services', 'figureRefs.ts'), 'refs.mjs');
const figText = await load(join(REPO, 'services', 'figureText.ts'), 'figText.mjs');
const mdParser = await load(join(REPO, 'services', 'mdParserService.ts'), 'mdParser.mjs');
const exportSvc = await load(join(REPO, 'services', 'exportService.ts'), 'exportSvc.mjs',
  [assetImports, stubHeavy]);
const gen = await load(join(REPO, 'services', 'templateGenerator.ts'), 'gen.mjs',
  [assetImports, {
    name: 'stub-file-saver',
    setup(b) {
      b.onResolve({ filter: /^file-saver$/ }, args => ({ path: args.path, namespace: 'stub' }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
        contents: 'const s = new Proxy(function(){}, { get: () => s, apply: () => s, construct: () => s }); export default s;',
        loader: 'js',
      }));
    },
  }]);

console.log('\nExtract figures — the student spec must not move\n');

// ---------------------------------------------------------------------------
// The property, on a fixture that always runs
// ---------------------------------------------------------------------------
const svgWith = (title, desc) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">`
  + (title ? `<title>${title}</title>` : '')
  + (desc ? `<desc>${desc}</desc>` : '')
  + `<path d="M0 0 L10 10" stroke="#000"/></svg>`;

const fixture = (figures) => ({
  id: 'a1', courseCode: 'DEMO101', title: 'Homework 3', assignmentKind: 'conventional',
  inputMode: 'electronic', preamble: 'Do it.', targetPoints: 100, createdAt: 1, updatedAt: 1,
  problems: figures.map((svg, i) => ({
    id: `p${i + 1}`, name: `Problem ${i + 1}`,
    description: `Given the network.\n\n\`\`\`svg\n${svg}\n\`\`\`\n\nFind Vout.`,
    subsections: [{
      id: `s${i + 1}`, name: 'a', description: 'Work it out.',
      points: Math.round(100 / figures.length), submissionType: 'Text',
    }],
  })),
});

const specTextOf = async (assignment) => {
  const spec = await exportSvc.buildAssignmentSpec(assignment);
  return JSON.stringify(spec);
};

await check('CRITERION 2 (fixture): the student spec is byte-identical after extraction', async () => {
  const before = fixture([svgWith('Divider', 'Two resistors in series.'),
    svgWith('Bridge', 'Four resistors in a bridge.')]);
  const beforeText = await specTextOf(before);
  const { assignment: after, extracted, leftInline } = extract.extractFigures(before);
  assertEqual(extracted.length, 2, 'both figures should have been extracted');
  assertEqual(leftInline, [], 'nothing should have been left inline');
  assert(after.problems[0].description.includes('```figure'), 'the stem was not rewritten');
  assertEqual(await specTextOf(after), beforeText,
    'THE STUDENT SPEC MOVED — extraction is not invisible');
});

await check('the extracted ids are predictable from the assignment', async () => {
  const { extracted } = extract.extractFigures(
    fixture([svgWith('A', 'a'), svgWith('B', 'b')]));
  assertEqual(extracted.map(e => e.id), ['p1-fig1', 'p2-fig1'], 'the ids are not p<problem>-fig<n>');
});

await check('title and desc come from the SVG itself', async () => {
  const { assignment } = extract.extractFigures(fixture([svgWith('Divider', 'Two resistors in series.')]));
  const [seg] = refs.parseFigureRefs(assignment.problems[0].description);
  assertEqual(seg.ref.title, 'Divider', 'the title was not taken from <title>');
  assertEqual(seg.ref.desc, 'Two resistors in series.', 'the desc was not taken from <desc>');
});

await check('the figure file holds the SVG document verbatim', async () => {
  const svg = svgWith('Divider', 'Two resistors in series.');
  const { assignment } = extract.extractFigures(fixture([svg]));
  assertEqual(refs.figureSvgSource(assignment.figures['p1-fig1']), svg,
    'the stored SVG is not the document that was lifted out');
});

await check('the grader text does not move across extraction', async () => {
  const before = fixture([svgWith('Divider', 'Two resistors in series.')]);
  const { assignment: after } = extract.extractFigures(before);
  assertEqual(figText.stemForGrader(after.problems[0].description),
    figText.stemForGrader(before.problems[0].description),
    'the rubric text changed when the figure became a file');
});

for (const [what, svg, reason] of [
  ['no <desc>', svgWith('Divider', ''), /no <desc>/],
  ['no <title>', svgWith('', 'Two resistors.'), /no <title>/],
  ['neither', svgWith('', ''), /neither a <title> nor a <desc>/],
]) {
  await check(`a figure with ${what} is LEFT INLINE and reported`, async () => {
    const before = fixture([svg]);
    const { assignment: after, extracted, leftInline } = extract.extractFigures(before);
    assertEqual(extracted, [], 'it was extracted despite missing words');
    assertEqual(leftInline.length, 1, 'it was not reported');
    assert(reason.test(leftInline[0].reason), `the reason is wrong: ${leftInline[0].reason}`);
    assertEqual(after.problems[0].description, before.problems[0].description,
      'the stem changed even though nothing was extracted');
  });
}

await check('an assignment with nothing extractable is returned unchanged', async () => {
  const before = fixture([svgWith('', '')]);
  const beforeText = await specTextOf(before);
  const { assignment: after } = extract.extractFigures(before);
  assertEqual(await specTextOf(after), beforeText, 'the spec moved with nothing extracted');
});

await check('the report names every file written and every figure left behind', () => {
  const result = extract.extractFigures(
    fixture([svgWith('Divider', 'Two resistors.'), svgWith('Bridge', '')]));
  const text = extract.describeExtraction(result);
  assert(/figures\/p1-fig1\.svg/.test(text), `the written file is not named: ${text}`);
  assert(/left inline/.test(text), `the left-behind figure is not reported: ${text}`);
  assert(/only thing the grader ever sees/.test(text), `the report does not say why: ${text}`);
  assert(/Nothing students see has changed/.test(text), `the report does not reassure: ${text}`);
});

// ---------------------------------------------------------------------------
// CRITERION 2, on the real ENG17 assignments
// ---------------------------------------------------------------------------
// Against the real sources, not a fixture: this project's rule is never to
// validate against data you generated yourself.
// Where the real ENG17 sources are, and what happens when they are absent, is
// decided in `tests/eng17Sources.mjs` (Supplement 2, item 1): a RELATIVE default
// beside this checkout, so no home directory is written into the repository;
// `GB_ENG17_DIR` or `ENG17_HWK_DIR` to name the folder; and with either set, a
// missing file FAILS. Until 2026-09-25 this suite had no default and looked for
// `ENG17_HW{n}_assignment.md`, so it skipped even with the variable set.
//
//   GB_ENG17_DIR=/path/to/New\ HWKs npm test
const FROZEN = { 1: '95438EDF', 2: '8505F1E5', 3: 'B549DC53' };

for (const n of [1, 2, 3]) {
  const name = `CRITERION 2 (ENG17 HW${n}): spec byte-identical, and layout_id unmoved, after extraction`;
  const plan = eng17Plan(n);
  if (plan.action === 'fail') { await check(name, async () => { throw new Error(plan.why); }); continue; }
  if (plan.action === 'skip') { skip(name, plan.why); continue; }
  const path = plan.path;

  await check(name, async () => {
    const before = mdParser.parseMdToAssignment(readFileSync(path, 'utf8'));
    const beforeText = await specTextOf(before);
    const beforeTemplate = await gen.generateTemplate(before);

    const { assignment: after, extracted, leftInline } = extract.extractFigures(before);

    assertEqual(await specTextOf(after), beforeText,
      `THE STUDENT SPEC MOVED for HW${n} — extraction is not invisible`);

    const afterTemplate = await gen.generateTemplate(after);
    assertEqual(afterTemplate.layoutId, beforeTemplate.layoutId,
      `layout_id moved for HW${n}: ${beforeTemplate.layoutId} -> ${afterTemplate.layoutId}`);
    assertEqual(afterTemplate.layoutId, FROZEN[n], `HW${n} is not at its frozen layout_id`);
    assertEqual(afterTemplate.pageCount, beforeTemplate.pageCount, `the page count moved for HW${n}`);

    // Reported for the completion report, not asserted: how many were lifted
    // and how many could not be.
    results.push(`        HW${n}: ${extracted.length} extracted, ${leftInline.length} left inline`);
    for (const f of leftInline) {
      results.push(`          left inline — Problem ${f.problemNumber}, ${f.label}: ${f.reason}`);
    }
  });
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* windows handles */ }
suiteExit(passed, failed);
