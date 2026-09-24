// =====================================================
// The generic answer page, and an assignment that carries no printed sheet
// =====================================================
// WORKORDER_AM_GENERIC_ANSWER_PAGE_2026-09-24, with the four rulings at its top.
//
// Three things are held here, and the third is the one most easily lost:
//
//   1. THE PAGE. One page, one PDF, every string Andre approved on it, the box
//      closing at 257.0 (ruling 1), the QR in today's grammar (ruling 2), the
//      map row GBGEN1 / gen / generic / 1 / 0 / 0 (ruling 4), and the layout id
//      `5F0B10BC`, which both apps and the spec hold as a constant.
//   2. THE EXPORT on `sheet: "generic"`: one student file, the generic map, the
//      parts list, no question text; the grading material unchanged.
//   3. NOTHING ELSE MOVED. An electronic export and a printed-sheet export are
//      hashed entry by entry against goldens written from `d6f4af5`, the
//      deployed build before this existed (`tests/exportHashes.mjs`).

import { build } from 'esbuild';
import jsQR from 'jsqr';
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GOLDEN_FIXTURES, hashExport, loadExportPath, pinnedAssignment } from './exportHashes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
globalThis.crypto ??= webcrypto;

let passed = 0, failed = 0, skipped = 0;
const results = [];
const check = async (name, fn) => {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const skip = (name, why) => { skipped++; results.push(`  SKIP  ${name} (${why})`); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n          expected: ${y}\n          actual:   ${x}`);
};
const rejects = async (fn, pattern, msg) => {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert(err, `${msg}: nothing was refused`);
  assert(pattern.test(err.message), `${msg}: refused for the wrong reason: ${err.message}`);
};

// ---------- load ----------
const requireFromRepo = createRequire(join(REPO, 'package.json'));
const outDir = mkdtempSync(join(tmpdir(), 'gb-generic-'));
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
const load = async (entry, name) => {
  const outfile = join(outDir, name);
  await build({
    entryPoints: [entry], outfile, format: 'esm', target: 'es2022', bundle: true,
    absWorkingDir: dirname(entry), logLevel: 'silent', plugins: [assetImports],
  });
  return import(pathToFileURL(outfile).href);
};

const gp = await load(join(REPO, 'services', 'genericAnswerPage.ts'), 'generic.mjs');
const fmt = await load(join(REPO, 'services', 'pageFormat.ts'), 'pageFormat.mjs');
const qrp = await load(join(REPO, 'services', 'qrPayload.ts'), 'qrPayload.mjs');
const enc = await load(join(REPO, 'services', 'qrEncoder.ts'), 'qrEncoder.mjs');
const gen = await load(join(REPO, 'services', 'templateGenerator.ts'), 'templateGenerator.mjs');
const fin = await load(join(REPO, 'services', 'finalize.ts'), 'finalize.mjs');
const notices = await load(join(REPO, 'services', 'importNotices.ts'), 'importNotices.mjs');
const modes = await load(join(REPO, 'services', 'inputModeService.ts'), 'inputMode.mjs');
const cry = await load(join(REPO, 'services', 'cryptoService.ts'), 'crypto.mjs');
// The export path with the real JSZip, so the package is opened, not trusted.
const m = await loadExportPath(REPO);
const JSZip = (await import(pathToFileURL(requireFromRepo.resolve('jszip')).href)).default;

console.log('\nThe generic answer page\n');

// =====================================================
// 1. THE PAGE
// =====================================================

const page = await gp.generateGenericAnswerPage();
const pdfBytes = Buffer.from(await page.pdf.arrayBuffer()).toString('latin1');
const unescapePdf = (s) => s.replace(/\\([()\\])/g, '$1');
const pdfStrings = [...pdfBytes.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map(x => unescapePdf(x[1]));

await check('THE LAYOUT ID: the generic map hashes to 5F0B10BC', async () => {
  assertEqual(gp.GENERIC_LAYOUT_ID, '5F0B10BC', 'the constant moved');
  assertEqual(await gp.computeGenericLayoutId(), '5F0B10BC', 'the map no longer hashes to the constant');
  assertEqual(page.layoutId, '5F0B10BC', 'the page carries a different layout id');
});

await check('ruling 4: the map is exactly one row, GBGEN1 / gen / generic / 1 / 0 / 0', () => {
  assertEqual(gp.GENERIC_LAYOUT_CSV,
    'assignment_id,layout_id,region_id,part_id,page_k,x0,y0,x1,y1,is_drawing,max_points\n' +
    'GBGEN1,5F0B10BC,gen,generic,1,0.0572,0.2053,0.9428,0.9186,0,0\n',
    'the generic map text changed');
  assertEqual(gp.GENERIC_LAYOUT_CSV_NAME, 'layout_GBGEN1.csv', 'the map name changed');
});

await check('ruling 2: the QR is today\'s grammar, GB1-GBGEN1-HWMSTR-1-1-5F0B10BC, and parses as one', () => {
  assertEqual(page.payload, 'GB1-GBGEN1-HWMSTR-1-1-5F0B10BC', 'the payload changed');
  const f = qrp.parsePayload(page.payload);
  assert(f, 'the payload does not parse under the page-format grammar');
  assertEqual([f.assignmentId, f.token, f.k, f.n, f.layoutId], ['GBGEN1', 'HWMSTR', 1, 1, '5F0B10BC'],
    'the payload fields are wrong');
});

await check('check 8: the QR decodes from a 300 dpi raster, alphanumeric at version 4', () => {
  const PX = 300 / 25.4;
  const q = enc.encodeQr(page.payload);
  const mod = Math.round((fmt.QR_SIZE_MM / q.moduleCount) * PX);
  const quiet = fmt.QR_QUIET_MODULES * mod;
  const side = q.moduleCount * mod + quiet * 2;
  const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < q.moduleCount; r++) for (let c = 0; c < q.moduleCount; c++) {
    if (!q.dark[r][c]) continue;
    for (let dy = 0; dy < mod; dy++) for (let dx = 0; dx < mod; dx++) {
      const i = ((quiet + r * mod + dy) * side + (quiet + c * mod + dx)) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
    }
  }
  const res = jsQR(rgba, side, side);
  assert(res, 'the symbol did not decode');
  assertEqual(res.data, page.payload, 'decoded the wrong payload');
  assertEqual(res.version, fmt.QR_VERSION, 'not version 4');
  assertEqual(res.chunks.map(c => c.type), ['alphanumeric'], 'not alphanumeric mode');
});

await check('the page passes the spec 8.7 self-test and the ink checks', () => {
  assert(page.selfTest.passed, `failures:\n${page.selfTest.failures.join('\n')}`);
  const ids = page.selfTest.checks.filter(c => c.id > 0).map(c => c.id).sort();
  assertEqual(ids, [1, 2, 3, 4, 5, 6, 7], 'a numbered check did not run');
});

await check('ruling 1: the box is x 12.0 to 203.9, y 57.0 to 257.0, and clears the bottom corners', () => {
  assertEqual(gp.GENERIC_BOX_MM, { x0: 12.0, y0: 57.0, x1: 203.9, y1: 257.0 }, 'the box moved');
  const bottom = page.ink.find(b => b.what === 'box bottom generic');
  assert(bottom && bottom.y1 <= 257.0 + 1e-9, 'the box bottom is below 257.0');
  assertEqual(fmt.safeAreaViolations(gp.GENERIC_DECLARED_MM), [], 'the declared interior breaks a safe area');
  // The corner check is what refused 262.0. Assert it would still refuse it,
  // so this test cannot pass merely because the check went quiet.
  const at262 = fmt.safeAreaViolations({ ...gp.GENERIC_DECLARED_MM, y1: 262.0 - 0.3528 });
  assert(at262.some(v => /corner keep-out/.test(v)), 'a box to 262.0 is no longer refused, so this proves nothing');
});

await check('ruling 1: 25 writing bands of exactly 8.0 mm, 24 feint rules, none on the border', () => {
  assertEqual([gp.GENERIC_BANDS, gp.GENERIC_BAND_MM], [25, 8.0], 'the banding changed');
  assertEqual(gp.GENERIC_BANDS * gp.GENERIC_BAND_MM, gp.GENERIC_BOX_MM.y1 - gp.GENERIC_BOX_MM.y0,
    'the bands do not fill the box exactly, so the first or last band is a different height');
  // jsPDF writes each rule as `x y m x y l`; count the ones at the rule inset.
  const k = 72 / 25.4, H = fmt.PAGE_H_MM;
  const xs = (gp.GENERIC_BOX_MM.x0 + gp.GENERIC_RULE_INSET_MM) * k;
  const rules = [...pdfBytes.matchAll(/([-\d.]+) ([-\d.]+) m\s+([-\d.]+) ([-\d.]+) l/g)]
    .filter(x => Math.abs(Number(x[1]) - xs) < 0.05)
    .map(x => Math.round((H - Number(x[2]) / k) * 100) / 100);
  const want = Array.from({ length: 24 }, (_, i) => Math.round((57 + 8 * (i + 1)) * 100) / 100);
  assertEqual(rules, want, 'the rules are not at y = 57 + 8.0k for k = 1 to 24');
});

await check('every approved string is printed, verbatim', () => {
  for (const s of gp.GENERIC_PRINTED_STRINGS) {
    assert(pdfStrings.includes(s), `not on the page: "${s}"\n          found: ${JSON.stringify(pdfStrings)}`);
  }
});

await check('THE IDENTITY WARNING and THE PRINTING RULE are on the page, legible at arm\'s length', () => {
  const identity = 'Do not write your name, student ID or email address anywhere on this page.';
  const printing = 'Print on US Letter at 100%, not "fit to page", single or double sided. All four black corner squares must appear.';
  assert(pdfStrings.includes(identity), 'the identity warning is not printed');
  assert(pdfStrings.includes(printing), 'the printing rule is not printed');
  const pt = (what) => {
    const b = page.ink.find(x => x.what === what);
    return (b.y1 - b.y0) / (1.2 * 25.4 / 72);
  };
  assert(pt('identity line') >= 10 - 1e-6, `the identity warning is ${pt('identity line').toFixed(1)} pt`);
  assert(pt('printing line') >= 9 - 1e-6, `the printing rule is ${pt('printing line').toFixed(1)} pt`);
  assert(/\/Helvetica-Bold/.test(pdfBytes), 'no bold face on the page; the identity warning is meant to be bold');
});

await check('ruling 3: the pencil sentence is the work order\'s, and deliberately not today\'s', () => {
  assertEqual(gp.GENERIC_PENCIL_TEXT,
    'Write with a soft pencil (2B or B) or a pen. Hard pencils come out faint and photograph badly.',
    'the pencil sentence changed');
  assert(!pdfStrings.some(s => /Darker beats bigger/.test(s)), 'today\'s sentence reached the generic page');
});

await check('the fields line invites no identity: no name, date, section or ID label', () => {
  assert(!/name|date|section|\bid\b|student/i.test(gp.GENERIC_FIELDS_TEXT), 'the fields line grew a label');
  assertEqual(gp.GENERIC_FIELDS_TEXT, 'Problem __________   Part __________   Page ______ of ______',
    'the fields line changed');
});

await check('nothing but the header line is in the top 25 mm identity band', () => {
  const inBand = page.ink.filter(b => b.y0 < fmt.IDENTITY_BAND_MM).map(b => b.what);
  assertEqual(inBand, ['header line'], 'something else is printed in the identity band');
  assert(pdfStrings.includes('GradeBridge   answer page   GBGEN1'), 'the header line is not the approved text');
});

await check('one page, one PDF', () => {
  assertEqual((pdfBytes.match(/\/Type \/Page\b/g) || []).length, 1, 'the PDF is not one page');
  assertEqual(page.pdfFilename, 'GradeBridge_answer_page_GBGEN1.pdf', 'the filename changed');
});

// =====================================================
// 2. THE EXPORT, on sheet: "generic"
// =====================================================

const fixtureMd = readFileSync(join(REPO, 'tests', 'fixtures', 'GenericSheet_Fixture.md'), 'utf8');
const QUESTION_TEXT = [
  'A uniform plane wave travels in a lossless dielectric',
  'Find the phase velocity of the wave in the dielectric.',
];
const generic = () => pinnedAssignment(m, fixtureMd);

const exportOf = async (a) => {
  const norm = m.normalizePointsConfirmed(a);
  const entries = await m.buildExportEntries(norm);
  const { outer, studentZipName } = await m.buildOuterEntries(entries, norm);
  const zip = await JSZip.loadAsync(outer[studentZipName]);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir).sort();
  const specFile = names.find(n => n.endsWith('_OPEN_IN_APP.json'));
  const specRaw = specFile ? await zip.file(specFile).async('string') : null;
  const spec = specRaw ? await m.decryptJson(specRaw) : null;
  const rubric = JSON.parse(entries[Object.keys(entries).find(n => n.endsWith('_grading_rubric.json'))]);
  return { entries, outer, names, spec, specText: spec ? JSON.stringify(spec) : '', rubric };
};

await check('.md: **Sheet:** generic is read on a handwritten file, and written back', () => {
  const a = generic();
  assertEqual(a.sheet, 'generic', 'the parser did not read the line');
  const md = m.assignmentToMd(a);
  assert(md.includes('**Sheet:** generic'), 'Export .md did not write the line');
  assertEqual(m.parseMdToAssignment(md).sheet, 'generic', 'the line did not survive a round trip');
});

await check('.md: a sub-part with no question text imports, and the export does not refuse it', async () => {
  const a = generic();
  assertEqual(a.problems[0].subsections[1].description, '', 'the empty description was not empty');
  const out = await exportOf(a);
  assert(out.spec, 'the export produced no spec');
});

// Built inside a check, so a refusal here is reported by name rather than
// taking the whole suite down with it; every check below then fails on it.
let out = {};
await check('the generic export builds, and its package passes every export guard', async () => {
  out = await exportOf(generic());
});

await check('the student package is ONE file: the spec. No printed sheet', () => {
  assertEqual(out.names, ['DEMO101_Generic_Sheet_Homework_OPEN_IN_APP.json'], 'the student package is wrong');
  assert(!Object.keys(out.entries).some(n => n.endsWith('.pdf') && n.startsWith('student/')), 'a student PDF was built');
  assert(!Object.keys(out.entries).some(n => /layout_.*\.csv$/.test(n)), 'a per-assignment map was written');
});

await check('the spec says sheet: "generic" and embeds the generic map, verbatim', () => {
  assertEqual(out.spec.sheet, 'generic', 'sheet is not "generic"');
  assertEqual(out.spec.layoutCsvName, 'layout_GBGEN1.csv', 'the map name is wrong');
  assertEqual(out.spec.layoutCsv, gp.GENERIC_LAYOUT_CSV, 'the embedded map is not the generic map');
});

await check('the parts list: ordered, labelled, with points on a conventional assignment', () => {
  assertEqual(out.spec.parts, [
    { part_id: '1(a)', problem_number: 1, subsection_letter: 'a', label: 'Problem 1, part (a)', max_points: 60 },
    { part_id: '1(b)', problem_number: 1, subsection_letter: 'b', label: 'Problem 1, part (b)', max_points: 40 },
    { part_id: '2',    problem_number: 2, subsection_letter: 'a', label: 'Problem 2',           max_points: 100 },
  ], 'the parts list is wrong');
});

await check('NO QUESTION TEXT anywhere in the student package', () => {
  for (const t of QUESTION_TEXT) assert(!out.specText.includes(t), `question text reached the student: "${t}"`);
  for (const p of out.spec.problems) {
    assertEqual(p.description, '', 'a problem description reached the student');
    for (const s of p.subsections) assertEqual(s.description, '', 'a sub-part description reached the student');
  }
  // Names stay: they are what the student labels a page with.
  assertEqual(out.spec.problems[0].subsections[0].name, 'Phase velocity', 'a part name was lost');
});

await check('the parts join the rubric one to one by part_id, with agreeing max_points', () => {
  const byPart = Object.fromEntries(Object.values(out.rubric.rubrics).map(r => [r.part_id, r]));
  for (const p of out.spec.parts) {
    assert(byPart[p.part_id], `${p.part_id} has no rubric entry`);
    assertEqual(byPart[p.part_id].max_points, p.max_points, `${p.part_id} points disagree`);
  }
  assertEqual(Object.keys(byPart).length, out.spec.parts.length, 'the rubric and the parts differ in count');
});

await check('the grading material is unchanged: every part, its points, its prompt', () => {
  const r = out.rubric.rubrics;
  assertEqual(Object.keys(r), ['p0s0', 'p0s1', 'p1s0'], 'the rubric does not carry every part');
  assert(r.p0s0.grading_prompt.includes('1.5e8 m/s'), 'a grading prompt was lost');
  assertEqual(r.p0s0.grading_type, 'ai_handwritten', 'grading_type changed');
  assertEqual(r.p0s1.grading_type, 'human_handwritten', 'grading_type changed');
  assertEqual(out.rubric.sheet, 'generic', 'the rubric does not tell the grading side about the generic sheet');
  // The question text stays in the instructor's own material.
  const grader = out.entries[Object.keys(out.entries).find(n => n.endsWith('_grader_document.html'))];
  assert(grader.includes('Find the phase velocity'), 'the grader document lost the question');
});

await check('the notice says what to post, the instructor\'s own PDF, and where the answer page is', () => {
  const n = out.entries['00_INSTRUCTOR_ONLY_DO_NOT_DISTRIBUTE.txt'];
  assert(n.includes('Post your own'), 'the notice does not tell the instructor to post their own PDF');
  assert(n.includes('Generic answer page') && n.includes('GradeBridge_answer_page_GBGEN1.pdf'),
    'the notice does not say where the answer page comes from');
  assert(n.includes('Answer sheet: generic (GBGEN1, layout 5F0B10BC).'), 'the greppable line is missing');
  assert(!/the sheet they print/.test(n), 'the notice still describes a sheet this export does not contain');
});

await check('a READER assignment works in generic mode: kind reader, points 0, no grading_type', async () => {
  const a = { ...generic(), assignmentKind: 'reader' };
  const r = await exportOf(a);
  assertEqual(r.rubric.assignment_kind, 'reader', 'the rubric lost the kind');
  for (const [k, item] of Object.entries(r.rubric.rubrics)) {
    assertEqual(item.max_points, 0, `${k} is not worth 0`);
    assert(!('grading_type' in item), `${k} carries a grading_type`);
  }
  for (const p of r.spec.parts) assert(!('max_points' in p), `${p.part_id} carries points on a reader assignment`);
  assertEqual(r.spec.layoutCsv, gp.GENERIC_LAYOUT_CSV, 'the reader spec does not embed the generic map');
  assert(!('assignmentKind' in r.spec), 'the kind reached the student');
});

await check('the QR Template route refuses a generic assignment: it has no printed sheet', async () => {
  await rejects(() => gen.generateTemplate(generic()), /generic answer page/, 'generateTemplate');
});

await check('finalize: the generic layout id is recorded, and the sheet is locked with the content', async () => {
  const a = generic();
  assertEqual(await fin.currentLayoutId(a), '5F0B10BC', 'finalize records the wrong layout id');
  const stamped = await fin.finalizeAssignment(a);
  const { sheet: _s, ...printed } = stamped;
  assert(await fin.finalizeLockProblem(printed), 'switching back to the printed sheet after finalize was not refused');
  assertEqual(await fin.finalizeLockProblem(stamped), null, 'an unchanged finalized assignment was refused');
});

await check('finalize: an assignment with no sheet fingerprints exactly as before', async () => {
  const a = pinnedAssignment(m, readFileSync(join(REPO, 'tests', 'fixtures', 'Handwritten_HW_Fixture.md'), 'utf8'));
  assertEqual(await fin.contentFingerprint(a), await fin.contentFingerprint({ ...a, sheet: undefined }),
    'an absent sheet changed the fingerprint');
});

// ---- the refusal the mutation tests lean on --------------------------------

await check('a generic package carrying a PER-ASSIGNMENT map is refused', async () => {
  const a = m.normalizePointsConfirmed(generic());
  const entries = await m.buildExportEntries(a);
  const upload = Object.keys(entries).find(n => n.endsWith('_OPEN_IN_APP.json'));
  const spec = await m.decryptJson(entries[upload]);
  const hw = pinnedAssignment(m, readFileSync(join(REPO, 'tests', 'fixtures', 'Handwritten_HW_Fixture.md'), 'utf8'));
  const own = await gen.generateTemplate(hw);
  spec.layoutCsv = own.csv;
  spec.layoutCsvName = own.csvFilename;
  const doctored = { ...entries, [upload]: await cry.encryptJson(spec) };
  const problems = await m.embeddedLayoutProblems(doctored, a);
  assert(problems.some(p => /generic answer page's map/.test(p)), `not refused: ${JSON.stringify(problems)}`);
  await rejects(() => m.buildOuterEntries(doctored, a), /layout map/, 'buildOuterEntries');
  await rejects(() => m.buildAssignmentSpec(a, { name: own.csvFilename, csv: own.csv }),
    /must embed the generic answer page/, 'buildAssignmentSpec');
});

// =====================================================
// 3. NOTHING ELSE MOVED
// =====================================================

const goldens = JSON.parse(readFileSync(join(REPO, 'tests', 'fixtures', 'pre_generic_sheet_goldens.json'), 'utf8'));
for (const f of GOLDEN_FIXTURES) {
  await check(`byte for byte against d6f4af5: ${f} exports exactly as it did before`, async () => {
    const md = readFileSync(join(REPO, 'tests', 'fixtures', f), 'utf8');
    const now = await hashExport(m, pinnedAssignment(m, md));
    const was = goldens[f];
    const diffs = [];
    for (const n of new Set([...Object.keys(was.entries), ...Object.keys(now.entries)])) {
      if (was.entries[n] !== now.entries[n]) diffs.push(`entry ${n}`);
    }
    for (const n of new Set([...Object.keys(was.studentPackage), ...Object.keys(now.studentPackage)])) {
      if (was.studentPackage[n] !== now.studentPackage[n]) diffs.push(`student ${n}`);
    }
    assertEqual(diffs, [], `${f} changed`);
  });
}

await check('ELECTRONIC: the spec never carries sheet or parts', async () => {
  const md = readFileSync(join(REPO, 'tests', 'fixtures', 'Math_Fixture.md'), 'utf8');
  const out = await exportOf(pinnedAssignment(m, md));
  assert(!('sheet' in out.spec) && !('parts' in out.spec), 'an electronic spec gained sheet or parts');
  assert(!('sheet' in out.rubric), 'an electronic rubric gained sheet');
});

await check('ELECTRONIC: **Sheet:** generic is reported on import and discarded', () => {
  const md = readFileSync(join(REPO, 'tests', 'fixtures', 'Math_Fixture.md'), 'utf8')
    .replace('**Preamble:**', '**Sheet:** generic\n\n**Preamble:**');
  const warnings = [];
  const a = m.parseMdToAssignment(md, warnings);
  assert(!('sheet' in a), 'the electronic assignment kept the sheet');
  assert(warnings.includes(notices.sheetDiscardedNotice()), `not reported: ${JSON.stringify(warnings)}`);
});

await check('ELECTRONIC: a JSON import with sheet is reported and discarded', () => {
  const rec = { inputMode: 'electronic', sheet: 'generic' };
  assertEqual(notices.adoptSheet(rec), [notices.sheetDiscardedNotice()], 'not reported');
  assert(!('sheet' in rec), 'not discarded');
  const absent = { sheet: 'generic' };
  assertEqual(notices.adoptSheet(absent).length, 1, 'absent inputMode is electronic and must be reported too');
  const hw = { inputMode: 'handwritten', sheet: 'generic' };
  assertEqual(notices.adoptSheet(hw), [], 'a valid generic sheet was reported');
  assertEqual(hw.sheet, 'generic', 'a valid generic sheet was dropped');
});

await check('ELECTRONIC: an export of an electronic assignment that gained sheet is REFUSED', async () => {
  const md = readFileSync(join(REPO, 'tests', 'fixtures', 'Math_Fixture.md'), 'utf8');
  const a = { ...pinnedAssignment(m, md), sheet: 'generic' };
  assert(modes.sheetProblem(a), 'sheetProblem passed an electronic sheet');
  await rejects(() => m.buildExportEntries(m.normalizePointsConfirmed(a)), /handwritten assignments only/,
    'buildExportEntries');
});

await check('PRINTED SHEET: the spec never carries sheet or parts', async () => {
  const md = readFileSync(join(REPO, 'tests', 'fixtures', 'Handwritten_HW_Fixture.md'), 'utf8');
  const out = await exportOf(pinnedAssignment(m, md));
  assert(!('sheet' in out.spec) && !('parts' in out.spec), 'a printed-sheet spec gained sheet or parts');
  assert(out.names.some(n => n.endsWith('.pdf')), 'the printed sheet went missing');
});

// ---- convert.py, the format's second implementation ------------------------
{
  const python = ['python', 'python3', 'py'].find(exe =>
    spawnSync(exe, ['-c', 'pass'], { encoding: 'utf8' }).status === 0);
  const name = 'convert.py reads **Sheet:** generic, reports it in its summary, and drops it on electronic';
  if (!python) skip(name, 'no Python interpreter on PATH');
  else await check(name, () => {
    const work = mkdtempSync(join(tmpdir(), 'gb-sheet-'));
    const run = (file, text) => {
      const p = join(work, file);
      writeFileSync(p, text, 'utf8');
      const r = spawnSync(python, [resolve(REPO, 'converter', 'convert.py'), p], { encoding: 'utf8' });
      assert(r.status === 0, `convert.py failed: ${r.stderr || r.stdout}`);
      return { out: r.stdout, spec: JSON.parse(readFileSync(p.replace(/\.md$/, '_spec.json'), 'utf8')) };
    };
    const g = run('Generic.md', fixtureMd);
    assertEqual(g.spec.sheet, 'generic', 'convert.py did not carry the sheet');
    assert(/Sheet:\s+generic answer page/.test(g.out), `the summary does not report the sheet:\n${g.out}`);
    assertEqual(g.spec.sheet, m.parseMdToAssignment(fixtureMd).sheet, 'the two parsers disagree');
    const e = run('Elec.md', readFileSync(join(REPO, 'tests', 'fixtures', 'Math_Fixture.md'), 'utf8')
      .replace('**Preamble:**', '**Sheet:** generic\n\n**Preamble:**'));
    assert(!('sheet' in e.spec), 'convert.py kept a sheet on an electronic file');
    assert(e.out.includes(notices.sheetDiscardedNotice()), 'convert.py did not report the discarded sheet');
    rmSync(work, { recursive: true, force: true });
  });
}

// ---- the sample the Student Submission lane builds against ----------------
{
  const sample = resolve(REPO, '..', 'app_records', 'assignment_maker', 'samples', 'generic_sheet_sample.json');
  const name = 'the committed sample is what this export produces for the same assignment';
  if (!existsSync(sample)) skip(name, 'the GradeBridge2026 record is not checked out around this repo');
  else await check(name, async () => {
    const s = await m.decryptJson(readFileSync(sample, 'utf8').trim());
    // Rebuild the sample's assignment through the real spec builder.
    const a = {
      id: s.id, courseCode: s.courseCode, title: s.title, preamble: s.preamble,
      inputMode: 'handwritten', assignmentKind: 'conventional', sheet: 'generic',
      createdAt: s.createdAt, updatedAt: s.updatedAt,
      problems: s.problems.map(p => ({
        ...p, description: 'question text that must not survive',
        subsections: p.subsections.map(x => ({ ...x, description: 'nor this', aiGradingPrompt: 'secret' })),
      })),
    };
    const built = await m.buildAssignmentSpec(a, m.GENERIC_EMBEDDED_LAYOUT);
    assertEqual(built, s, 'the export and the sample the other lane builds against have drifted');
  });
}

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
