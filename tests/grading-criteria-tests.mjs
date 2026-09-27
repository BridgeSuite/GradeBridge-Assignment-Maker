// =====================================================
// One rubric: the human marker and the model read the same criteria
// =====================================================
// WORKORDER_AM_ONE_RUBRIC_BOTH_GRADERS_2026-09-27.
//
// Every assignment is marked twice, by a person and independently by a model,
// and the comparison means something only if both work off the same criteria.
// The grader document used to choose between the two authored fields on grading
// type, and the rubric carried the grading prompt only on AI parts, so on a
// human-graded assignment the model was told nothing.
//
// THE DELIVERABLE is `criteriaAgreementProblems` (services/gradingCriteria.ts):
// it reads the two files as produced, not the code that produced them, and
// names every part where the text differs. The checks below prove it passes
// on real exports and fails, by name, when either file loses a part's criteria.

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadExportPath, pinnedAssignment } from './exportHashes.mjs';
import { eng17Plan } from './eng17Sources.mjs';
import { suiteExit } from './suiteExit.mjs';

globalThis.crypto ??= webcrypto;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const req = createRequire(join(REPO, 'package.json'));

let passed = 0, failed = 0, skipped = 0;
const results = [];
const check = async (name, fn) => {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const skip = (name, why) => { skipped++; results.push(`  SKIP  ${name}\n          ${why}`); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n          expected: ${y}\n          actual:   ${x}`);
};

// ---------- load ----------
const outDir = mkdtempSync(join(tmpdir(), 'gb-criteria-'));
// The same stubs and asset loaders `exportHashes.mjs` bundles the export path with.
const plugins = [{
  name: 'criteria', setup(b) {
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
const m = await loadExportPath(REPO);
const gc = await loadTs('services/gradingCriteria.ts', 'gc.mjs');
const render = await loadTs('services/mathRender.ts', 'render.mjs');
const JSZip = (await import(pathToFileURL(req.resolve('jszip')).href)).default;

/** The real export, the two grader files, and the decoded student package. */
const exportOf = async (assignment) => {
  const a = m.normalizePointsConfirmed(assignment);
  const entries = await m.buildExportEntries(a);
  const find = (re) => entries[Object.keys(entries).find(n => re.test(n))];
  const rubricText = find(/_grading_rubric\.json$/);
  const graderHtml = find(/_grader_document\.html$/);
  const { outer, studentZipName } = await m.buildOuterEntries(entries, a);
  const zip = await JSZip.loadAsync(outer[studentZipName]);
  const student = {};
  for (const n of Object.keys(zip.files).filter(n => !zip.files[n].dir)) {
    const raw = await zip.file(n).async('string');
    student[n] = raw.startsWith('gb1:') ? JSON.stringify(await m.decryptJson(raw)) : raw;
  }
  return { a, rubricText, rubric: JSON.parse(rubricText), graderHtml, student };
};

console.log('\nOne rubric, both graders\n');

const fixture = pinnedAssignment(m, readFileSync(join(REPO, 'tests', 'fixtures', 'OneRubric_Fixture.md'), 'utf8'));
let fx;
await check('the fixture exports', async () => { fx = await exportOf(fixture); });
const entry = (id) => fx.rubric.rubrics[id];

// =====================================================
// 3.1 and 3.2: both fields, on every grading type
// =====================================================
await check('3.2: every part with text carries subsection_statement, verbatim where there is no figure', () => {
  assertEqual(entry('p0s0').subsection_statement, fixture.problems[0].subsections[0].description,
    'subsection_statement is not the authored text');
  for (const [id, e] of Object.entries(fx.rubric.rubrics)) assert(e.subsection_statement, `${id} has no subsection_statement`);
});

await check('3.1: a HUMAN-graded part carries its grader note as grading_criteria', () => {
  assertEqual(entry('p0s0').grading_type, 'human_handwritten', 'the fixture part is not human-graded');
  assertEqual(entry('p0s0').grading_criteria, fixture.problems[0].subsections[0].graderNote,
    'the grader note did not reach the rubric');
  assertEqual(entry('p0s0').grading_prompt, '', 'grading_prompt changed on a human part');
});

await check('3.1: an AI part carries BOTH its prompt and its grader note, prompt first', () => {
  const sub = fixture.problems[1].subsections[0];
  assertEqual(entry('p1s0').grading_criteria, `${sub.aiGradingPrompt}\n\n${sub.graderNote}`,
    'the AI part did not carry both fields');
  assertEqual(entry('p1s0').grading_prompt, sub.aiGradingPrompt, 'grading_prompt changed on an AI part');
});

await check('3.1: a part with no criteria has no grading_criteria key, rather than an empty one', () => {
  assert(!('grading_criteria' in entry('p0s2')), 'an absent criterion was written as a value');
});

await check('3.3: the grader document shows both fields on the AI part, and the note on the human parts', () => {
  const shown = gc.criteriaInGraderDocument(fx.graderHtml);
  assertEqual(shown.get('p1s0'), entry('p1s0').grading_criteria, 'the AI part does not show both');
  assertEqual(shown.get('p0s0'), entry('p0s0').grading_criteria, 'the human part does not show its note');
  assert(!shown.has('p0s2'), 'a part with no criteria shows some');
});

// =====================================================
// 3.4: THE CHECK
// =====================================================
await check('3.4: the grader document and the rubric carry the same criteria text on every part', () => {
  assertEqual(gc.criteriaAgreementProblems(fx.graderHtml, fx.rubric), [], 'the two files disagree');
});

await check('3.4: each block renders exactly the text it declares, so the attribute is what a person reads', () => {
  let blocks = 0;
  for (const [p, prob] of fixture.problems.entries()) {
    for (const [s, sub] of prob.subsections.entries()) {
      for (const piece of gc.criteriaPieces(sub)) {
        blocks++;
        const open = `data-criteria-for="p${p}s${s}" data-criteria="${render.escapeHtml(gc.criteriaText(piece))}">`;
        const at = fx.graderHtml.indexOf(open);
        assert(at >= 0, `p${p}s${s}: no ${piece.field} block declares its text`);
        const body = `<p>${render.toHtml(piece.text)}</p></div>`;
        assert(fx.graderHtml.slice(at).includes(body), `p${p}s${s}: the ${piece.field} block does not render its own text`);
      }
    }
  }
  assertEqual(blocks, 4, 'the fixture does not exercise four criteria blocks');
});

// CHECK 5. Deleting the grader note from ONE file must fail by name. (Deleting
// it from the assignment removes it from both files, which agree, correctly.)
await check('CHECK 5: a grader note missing from the grader document fails, naming the part', () => {
  const cut = fx.graderHtml.replace(/<div class="ref-block[^"]*" data-criteria-for="p0s1"[\s\S]*?<\/p><\/div>/, '');
  assert(cut !== fx.graderHtml, 'the probe removed nothing');
  const problems = gc.criteriaAgreementProblems(cut, fx.rubric);
  assertEqual(problems.length, 1, `not exactly one part named: ${problems.join(' | ')}`);
  assert(problems[0].includes('Problem 1(b)') && problems[0].includes('p0s1'), `the part is not named: ${problems[0]}`);
});

await check('CHECK 5: a grader note missing from the rubric fails, naming the part; restored, it passes', () => {
  const r = JSON.parse(fx.rubricText);
  delete r.rubrics.p0s0.grading_criteria;
  const problems = gc.criteriaAgreementProblems(fx.graderHtml, r);
  assert(problems.length === 1 && problems[0].includes('Problem 1(a)'), `not named: ${problems.join(' | ')}`);
  assertEqual(gc.criteriaAgreementProblems(fx.graderHtml, JSON.parse(fx.rubricText)), [], 'restored, it still fails');
});

await check('CHECK 5: text that differs by one character fails', () => {
  const r = JSON.parse(fx.rubricText);
  r.rubrics.p1s0.grading_criteria = r.rubrics.p1s0.grading_criteria.replace('0.5', '0.6');
  assert(gc.criteriaAgreementProblems(fx.graderHtml, r).some(p => /different criteria text/.test(p)),
    'a one-character difference passed');
});

await check('MUTATION: the old branching (the document picks a field by grading type) fails the check', async () => {
  const src = readFileSync(join(REPO, 'services', 'exportService.ts'), 'utf8');
  const from = '      const pieces = criteriaPieces(sub);';
  assert(src.includes(from), 'the mutation anchor is gone');
  // Written beside the original, so its relative imports resolve; never over it.
  const mutantPath = join(REPO, 'services', '__mutant-criteria-exportService.ts');
  writeFileSync(mutantPath, src.replace(from, '      const pieces = criteriaPieces(sub)'
    + ".filter(p => (isAi || isAiHandwritten) ? p.field === 'aiGradingPrompt' : p.field === 'graderNote');"));
  try {
    const outfile = join(outDir, 'mutant.mjs');
    await build({ entryPoints: [mutantPath], outfile, format: 'esm', target: 'es2022', bundle: true,
      platform: 'node', absWorkingDir: REPO, logLevel: 'silent', plugins });
    const broken = await import(pathToFileURL(outfile).href);
    const a = broken.normalizePointsConfirmed(fixture);
    const problems = gc.criteriaAgreementProblems(await broken.generateGraderHTML(a), broken.generateGradingRubric(a));
    assert(problems.some(x => x.includes('p1s0')), `the mutant passed the check: ${problems.join(' | ') || '(none)'}`);
  } finally {
    rmSync(mutantPath, { force: true });
  }
});

// =====================================================
// §4 and CHECK 6: a figure arrives as its words, never as drawing data
// =====================================================
const noDrawingData = (label, text) => {
  assert(!/data:/.test(text), `${label}: a data: URI reached the rubric`);
  assert(!/<svg/i.test(text), `${label}: SVG reached the rubric`);
  assert(!/base64/i.test(text), `${label}: base64 reached the rubric`);
};

await check('CHECK 6: no data: URI, no <svg, no base64 anywhere in the rubric', () => noDrawingData('fixture', fx.rubricText));

await check('CHECK 6: a figure in the sub-part text appears as its description', () => {
  assert(entry('p0s1').subsection_statement.includes('A labelled wave, period T and wavelength lambda marked'),
    `the image's words are missing: ${entry('p0s1').subsection_statement}`);
  assert(entry('p0s0').subsection_statement !== undefined, 'a part lost its statement');
});

// =====================================================
// §6 and CHECK 7: none of it reaches a student. Run, not reasoned.
// =====================================================
const leakProblems = (student, a) => {
  const problems = [];
  const all = Object.entries(student);
  for (const key of ['grading_criteria', 'subsection_statement', 'grading_prompt', 'grader_note', 'aiGradingPrompt', 'graderNote']) {
    for (const [n, text] of all) if (text.includes(`"${key}"`)) problems.push(`${n} carries the key ${key}`);
  }
  for (const prob of a.problems) {
    for (const sub of prob.subsections) {
      for (const piece of gc.criteriaPieces(sub)) {
        // Raw AND as JSON writes it: the student spec is JSON, which escapes the
        // backslash in `$\lambda$`, so a raw probe alone never sees a leak there.
        const probe = piece.text.slice(0, 40);
        const probes = [probe, JSON.stringify(probe).slice(1, -1)];
        for (const [n, text] of all) {
          if (probes.some(x => text.includes(x))) problems.push(`${n} carries criteria text: "${probe}"`);
        }
      }
    }
  }
  return problems;
};

await check('CHECK 7: the student package carries no criteria, statement, prompt or note, by key or by text', () => {
  assert(Object.keys(fx.student).length > 0, 'the student package is empty, so nothing was checked');
  assertEqual(leakProblems(fx.student, fx.a), [], 'grading material reached the student package');
});

await check('CHECK 7: the leak check can fail (it finds criteria text planted in a student file)', () => {
  const sub = fixture.problems[0].subsections[0];
  const planted = { ...fx.student, 'planted.json': JSON.stringify({ note: sub.graderNote }) };
  assert(leakProblems(planted, fx.a).length > 0, 'the leak check cannot see a leak');
});

// =====================================================
// CHECK 4 on real material: ENG 17 HW1, whose parts are AI-graded
// =====================================================
{
  const plan = eng17Plan(1);
  const name = 'CHECK 4: ENG 17 HW1 (AI-graded): the two files agree on every part, no drawing data, no leak';
  if (plan.action === 'skip') skip(name, plan.why);
  else {
    await check(name, async () => {
      assert(plan.action === 'run', plan.why);
      const hw = await exportOf(pinnedAssignment(m, readFileSync(plan.path, 'utf8')));
      assertEqual(gc.criteriaAgreementProblems(hw.graderHtml, hw.rubric), [], 'the two files disagree');
      const withCriteria = Object.values(hw.rubric.rubrics).filter(e => e.grading_criteria).length;
      assertEqual(withCriteria, Object.keys(hw.rubric.rubrics).length, 'a part carries no criteria');
      noDrawingData('ENG 17 HW1', hw.rubricText);
      assertEqual(leakProblems(hw.student, hw.a), [], 'grading material reached the student package');
    });
  }
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* windows handles */ }
suiteExit(passed, failed);
