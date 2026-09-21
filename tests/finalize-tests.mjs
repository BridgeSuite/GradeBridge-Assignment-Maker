// =====================================================
// The finalize lock
// =====================================================
// Finalizing stamps the printed layout and a fingerprint of what students see.
// After that an export that would change either is refused until the assignment
// is explicitly reopened. Grader material stays editable.
//
// The two halves catch different things, and the fingerprint is the half that
// is easy to leave out: **a figure replaced after students have printed moves
// nothing in the layout.** Every rectangle is where it was, so a layout-only
// check passes it, while the paper in the student's hand shows the old drawing.

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
globalThis.crypto ??= webcrypto;

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

const outDir = mkdtempSync(join(tmpdir(), 'gb-final-'));
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

const fin = await load(join(REPO, 'services', 'finalize.ts'), 'finalize.mjs');
const exportSvc = await load(join(REPO, 'services', 'exportService.ts'), 'exportSvc.mjs',
  [assetImports, stubHeavy]);
const mdParser = await load(join(REPO, 'services', 'mdParserService.ts'), 'mdParser.mjs');

console.log('\nThe finalize lock\n');

const SVG_A = '<svg xmlns="http://www.w3.org/2000/svg"><title>Divider</title><desc>Two resistors.</desc><path d="M0 0 L1 1"/></svg>';
const SVG_B = '<svg xmlns="http://www.w3.org/2000/svg"><title>Divider</title><desc>Two resistors.</desc><path d="M9 9 L5 5"/></svg>';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const BLOCK = ['```figure', 'id: fig1', 'title: Divider', 'desc: Two resistors.', '```'].join('\n');

const base = (extra = {}) => ({
  id: 'a1', courseCode: 'ENG17', title: 'HW 1', assignmentKind: 'conventional',
  inputMode: 'handwritten', preamble: 'Show your working.', targetPoints: 100,
  createdAt: 1, updatedAt: 1,
  problems: [{
    id: 'p1', name: 'Divider', description: `Given the network.\n\n${BLOCK}`,
    subsections: [{
      id: 's1', name: 'Node equations', description: 'Write them.', points: 100,
      submissionType: 'Handwritten', handwrittenGradingMode: 'ai', answerLines: 6,
      aiGradingPrompt: 'Required elements: (1) one equation per node.',
      graderNote: 'KCL at both nodes.',
    }],
  }],
  figures: { fig1: { format: 'svg', base64: b64(SVG_A), filename: 'fig1.svg' } },
  ...extra,
});

// ---------------------------------------------------------------------------
// The fingerprint: what it covers and what it must not
// ---------------------------------------------------------------------------
await check('the fingerprint is stable for the same content', async () => {
  assertEqual(await fin.contentFingerprint(base()), await fin.contentFingerprint(base()),
    'the same assignment fingerprinted differently twice');
});

await check('createdAt and updatedAt do NOT move the fingerprint', async () => {
  const before = await fin.contentFingerprint(base());
  const after = await fin.contentFingerprint(base({ createdAt: 999, updatedAt: 12345 }));
  assertEqual(after, before,
    'a timestamp moved the fingerprint — every save would then trip the lock');
});

await check('editing a grader note does NOT move the fingerprint (criterion 8)', async () => {
  const before = await fin.contentFingerprint(base());
  const edited = base();
  edited.problems[0].subsections[0].graderNote = 'Completely different note, and a prompt too.';
  edited.problems[0].subsections[0].aiGradingPrompt = 'Required elements: (1) something else.';
  edited.updatedAt = Date.now();
  assertEqual(await fin.contentFingerprint(edited), before,
    'grader material moved the fingerprint — the lock would refuse edits it does not cover');
});

for (const [what, mutate] of [
  ['a stem edit', a => { a.problems[0].description = 'Given a different network.'; }],
  ['a sub-part question edit', a => { a.problems[0].subsections[0].description = 'Do something else.'; }],
  ['a points change', a => { a.problems[0].subsections[0].points = 50; }],
  ['the preamble', a => { a.preamble = 'Different instructions.'; }],
  ['the assignment kind', a => { a.assignmentKind = 'reader'; }],
  ['the answer space', a => { a.problems[0].subsections[0].answerLines = 14; }],
]) {
  await check(`${what} DOES move the fingerprint`, async () => {
    const before = await fin.contentFingerprint(base());
    const changed = base(); mutate(changed);
    assert(await fin.contentFingerprint(changed) !== before, `${what} left the fingerprint alone`);
  });
}

await check('SWAPPING A FIGURE FILE moves the fingerprint, though the layout does not move', async () => {
  const before = await fin.contentFingerprint(base());
  const swapped = base({ figures: { fig1: { format: 'svg', base64: b64(SVG_B), filename: 'fig1.svg' } } });
  assert(await fin.contentFingerprint(swapped) !== before,
    'a replaced drawing did not move the fingerprint — this is the case a layout check cannot see');
  assertEqual(await fin.currentLayoutId(swapped), await fin.currentLayoutId(base()),
    'the probe is wrong: the layout moved too, so it does not isolate the fingerprint');
});

// ---------------------------------------------------------------------------
// The lock at export (criteria 7, 8, 13)
// ---------------------------------------------------------------------------
const finalizedBase = await fin.finalizeAssignment(base());

await check('an unfinalized assignment exports', async () => {
  const spec = await exportSvc.buildAssignmentSpec(base());
  assert(spec && spec.problems.length === 1, 'a plain assignment was refused');
});

await check('a finalized assignment exports unchanged', async () => {
  const spec = await exportSvc.buildAssignmentSpec(finalizedBase);
  assert(spec && spec.problems.length === 1, 'an unchanged finalized assignment was refused');
});

await check('CRITERION 8: a grader-note edit still exports, and the fingerprint is unchanged', async () => {
  const edited = { ...finalizedBase, updatedAt: Date.now() };
  edited.problems = JSON.parse(JSON.stringify(finalizedBase.problems));
  edited.problems[0].subsections[0].graderNote = 'A different reference answer entirely.';
  assertEqual(await fin.contentFingerprint(edited), finalizedBase.finalized.fingerprint,
    'the grader-note edit moved the fingerprint');
  const spec = await exportSvc.buildAssignmentSpec(edited);
  assert(spec && spec.problems.length === 1, 'the export was refused for a grader-note edit');
});

const refusedBecause = async (assignment) => {
  let threw = null;
  try { await exportSvc.buildAssignmentSpec(assignment); } catch (err) { threw = err; }
  assert(threw !== null, 'the export was NOT refused');
  assert(/this assignment is finalized/.test(threw.message),
    `refused for the wrong reason: ${threw.message}`);
  return threw.message;
};

await check('CRITERION 7: a stem edit on a finalized assignment is refused', async () => {
  const edited = JSON.parse(JSON.stringify(finalizedBase));
  edited.problems[0].description = 'Given a different network entirely.';
  const msg = await refusedBecause(edited);
  assert(/What students see has changed/.test(msg), `the message does not name what changed: ${msg}`);
});

await check('CRITERION 7: a figure swap on a finalized assignment is refused', async () => {
  const swapped = JSON.parse(JSON.stringify(finalizedBase));
  swapped.figures.fig1.base64 = b64(SVG_B);
  const msg = await refusedBecause(swapped);
  assert(/What students see has changed/.test(msg), `the message does not name what changed: ${msg}`);
  assert(/figures/.test(msg), `the message does not mention figures: ${msg}`);
});

await check('CRITERION 7: a change that moves layout_id is refused, and says it means reprinting', async () => {
  const edited = JSON.parse(JSON.stringify(finalizedBase));
  edited.problems[0].subsections[0].answerLines = 20;
  const msg = await refusedBecause(edited);
  assert(/reprint/i.test(msg), `the message does not mention reprinting: ${msg}`);
  assert(new RegExp(finalizedBase.finalized.layoutId).test(msg),
    `the message does not name the stamped layout id: ${msg}`);
});

await check('CRITERION 13: switching a finalized assignment to reader is refused', async () => {
  // Handwritten, so the kind change is legal under Supplement 1 and the only
  // thing stopping it is the lock. That is the point of the check.
  const switched = JSON.parse(JSON.stringify(finalizedBase));
  switched.assignmentKind = 'reader';
  const msg = await refusedBecause(switched);
  assert(/conventional or a reader/.test(msg),
    `the message does not name the kind as covered: ${msg}`);
});

// ---------------------------------------------------------------------------
// Reopening is explicit and recorded
// ---------------------------------------------------------------------------
await check('reopening drops the stamp and appends it to the history', async () => {
  const reopened = fin.reopenAssignment(finalizedBase);
  assert(!reopened.finalized, 'the stamp survived the reopen');
  assertEqual(reopened.finalizeHistory, [finalizedBase.finalized], 'the history is wrong');
});

await check('reopening never overwrites an earlier history entry', async () => {
  const once = fin.reopenAssignment(finalizedBase);
  const again = await fin.finalizeAssignment({ ...once, preamble: 'Changed.' });
  const twice = fin.reopenAssignment(again);
  assertEqual(twice.finalizeHistory.length, 2, 'the history did not grow');
  assertEqual(twice.finalizeHistory[0], finalizedBase.finalized, 'the first entry was overwritten');
});

await check('a reopened assignment exports again', async () => {
  const reopened = fin.reopenAssignment(finalizedBase);
  reopened.problems = JSON.parse(JSON.stringify(finalizedBase.problems));
  reopened.problems[0].description = 'Given a different network entirely.';
  const spec = await exportSvc.buildAssignmentSpec(reopened);
  assert(spec && spec.problems.length === 1, 'a reopened assignment was still refused');
});

await check('the reopen warning states the consequence in plain terms', () => {
  assert(/printed copies/.test(fin.REOPEN_WARNING), 'the warning does not mention printed copies');
  assert(/recorded/.test(fin.REOPEN_WARNING), 'the warning does not say it is recorded');
});

// ---------------------------------------------------------------------------
// Where the stamp travels, and where it must not (criterion 9)
// ---------------------------------------------------------------------------
await check('CRITERION 9: the stamp survives Export .md -> Import Markdown', async () => {
  const md = exportSvc.assignmentToMd(finalizedBase);
  assert(/\*\*Finalized:\*\*/.test(md), 'Export .md did not write the stamp');
  const back = mdParser.parseMdToAssignment(md);
  assertEqual(back.finalized, finalizedBase.finalized, 'the stamp did not survive the round trip');
  const again = exportSvc.assignmentToMd(back);
  assertEqual(again, md, 'the second export differs from the first');
});

await check('CRITERION 9: the history survives the .md round trip too', async () => {
  const reopened = fin.reopenAssignment(finalizedBase);
  const refinalized = await fin.finalizeAssignment(reopened);
  const back = mdParser.parseMdToAssignment(exportSvc.assignmentToMd(refinalized));
  assertEqual(back.finalizeHistory, refinalized.finalizeHistory, 'the history did not survive');
  assertEqual(back.finalized, refinalized.finalized, 'the current stamp did not survive');
});

await check('CRITERION 9: the stamp is NOT on the student whitelist', () => {
  for (const field of ['finalized', 'finalizeHistory']) {
    assert(!exportSvc.STUDENT_SPEC_FIELDS.assignment.includes(field),
      `${field} is on the student whitelist; the lock is instructor workflow, not student content`);
  }
});

await check('CRITERION 9: a real exported spec carries no stamp', async () => {
  const spec = await exportSvc.buildAssignmentSpec(finalizedBase);
  assert(!('finalized' in spec) && !('finalizeHistory' in spec),
    'the finalize stamp reached the student spec');
});

await check('an .md with no Finalized line imports unfinalized', () => {
  const back = mdParser.parseMdToAssignment(exportSvc.assignmentToMd(base()));
  assert(!('finalized' in back), 'an assignment that was never finalized came back finalized');
});

await check('deleting the Finalized line turns the lock off, deliberately', () => {
  const md = exportSvc.assignmentToMd(finalizedBase).replace(/^\*\*Finalized:\*\*.*\n\n/m, '');
  const back = mdParser.parseMdToAssignment(md);
  assert(!back.finalized,
    'the stamp survived being deleted — this is a guard against accident, and removing '
    + 'the line by hand is meant to work');
});

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* windows handles */ }
process.exit(failed > 0 ? 1 : 0);
