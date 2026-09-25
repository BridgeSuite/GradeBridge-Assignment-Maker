// =====================================================
// The generic answer page, and an assignment that carries no printed sheet
// =====================================================
// WORKORDER_AM_GENERIC_ANSWER_PAGE_2026-09-24, with the four rulings at its top.
//
// Three things are held here, and the third is the one most easily lost:
//
//   1. THE PAGE. One PDF of two identical pages (2026-09-25, so it can be
//      printed double sided), every string Andre approved on it, the box
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
import {
  GOLDEN_FIXTURES, hashExport, katexVersion, loadExportPath, pinnedAssignment,
} from './exportHashes.mjs';
import { suiteExit } from './suiteExit.mjs';

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
const selfTestMod = await load(join(REPO, 'services', 'templateSelfTest.ts'), 'templateSelfTest.mjs');
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
  // Twice since 2026-09-25: the PDF carries two identical pages
  // (WORKORDER_AM_PAGE_TWO_SIDES), so the 24 rules appear once per page.
  assertEqual(rules, [...want, ...want], 'the rules are not at y = 57 + 8.0k for k = 1 to 24, on each page');
});

await check('Supplement 1, item 1: the 24 rules are drawn with NO dash pattern active, 0.5 pt, 75% grey', () => {
  // Walk the content stream in order, tracking the graphics state jsPDF sets
  // (dash `d`, width `w`, stroke grey `G` or RGB `RG`), and read it at each rule.
  const k = 72 / 25.4, H = fmt.PAGE_H_MM;
  const xs = (gp.GENERIC_BOX_MM.x0 + gp.GENERIC_RULE_INSET_MM) * k;
  const ops = [...pdfBytes.matchAll(
    /\[([^\]]*)\]\s+([-\d.]+)\s+d\b|([-\d.]+)\s+w\b|([-\d.]+)\s+G\b|([-\d.]+) ([-\d.]+) ([-\d.]+) RG\b|([-\d.]+) ([-\d.]+) m\s+([-\d.]+) ([-\d.]+) l/g)];
  let dash = '', width = null, grey = null;
  const seen = [];
  for (const o of ops) {
    if (o[2] !== undefined) dash = o[1].trim();
    else if (o[3] !== undefined) width = Number(o[3]);
    else if (o[4] !== undefined) grey = Number(o[4]);
    else if (o[5] !== undefined) grey = o[5] === o[6] && o[6] === o[7] ? Number(o[5]) : -1;
    else if (Math.abs(Number(o[8]) - xs) < 0.05) {
      seen.push({ y: Math.round((H - Number(o[9]) / k) * 100) / 100, dash, width, grey });
    }
  }
  // 48: the 24 rules on each of the two identical pages (2026-09-25).
  assertEqual(seen.length, 48, 'did not find the 24 rules on each page');
  const bad = seen.filter(r => r.dash !== '');
  assertEqual(bad.map(r => `${r.y}: [${r.dash}]`), [], 'a rule is drawn with a dash pattern active');
  for (const r of seen) {
    assert(Math.abs(r.width - 0.5) < 0.01, `rule at ${r.y} is ${r.width} pt, not 0.5 pt`);
    assert(Math.abs(r.grey - 0.749) < 0.01, `rule at ${r.y} is grey ${r.grey}, not 75%`);
  }
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

// The page's final wording (WORKORDER_AM_PAGE_FINAL_WORDING_2026-09-25, which
// replaced this morning's "One answer per page."). Nothing is ever added as a
// new line: a new line pushes the box down, moves 5F0B10BC and makes this
// GBGEN2. So every string is held literally, at its position and size.
// Page 1 is the reference. The PDF carries a second, identical page since
// 2026-09-25, and the two-pages check below holds page 2 equal to it.
const inkOf = (what) => {
  const all = page.ink.filter(x => x.what === what && x.pageK === 1);
  assertEqual(all.length, 1, `${what} was not drawn exactly once`);
  return all[0];
};
const ptOf = (b) => (b.y1 - b.y0) / (1.2 * 25.4 / 72);

await check('FINAL: the bold line says "One part per page.", one line, at y 37.0, 10 pt bold', () => {
  const line = 'Write only inside the box. Anything outside it is not collected. One part per page.';
  assertEqual(gp.GENERIC_OUTSIDE_BOX_TEXT, line, 'the outside-box line is not the approved text');
  assert(pdfStrings.includes(line), `the line is not printed whole on one line\n          found: ${JSON.stringify(pdfStrings)}`);
  assert(!pdfStrings.some(t => /One answer per page/.test(t)), 'the superseded wording is still printed');
  const b = inkOf('outside-box line');
  assertEqual([b.x0, b.y0], [12.0, 37.0], 'the line moved');
  assert(Math.abs(ptOf(b) - 10) < 1e-6, 'the line is not 10 pt');
});

// The note could not go on the fields line: that line ends at x ~136 mm and the
// QR keep-out starts at 166, leaving ~30 mm for a note that needs ~48 even at
// 8 pt. The work order's fallback is the bold line, which "One part per page."
// shortened. It is a note, so it is smaller and lighter than the line it follows.
await check('FINAL: "(a long answer can run to more pages)" sits on the bold line, 8 pt, lighter, inside the box width', () => {
  const note = '(a long answer can run to more pages)';
  assertEqual(gp.GENERIC_MORE_PAGES_NOTE, note, 'the note is not the approved text');
  assert(pdfStrings.includes(note), `the note is not printed whole\n          found: ${JSON.stringify(pdfStrings)}`);
  const n = inkOf('more-pages note'), bold = inkOf('outside-box line');
  assert(Math.abs(ptOf(n) - 8) < 1e-6, `the note is ${ptOf(n).toFixed(1)} pt, not 8`);
  assert(n.x0 > bold.x1, 'the note does not follow the bold line');
  assert(n.y0 >= bold.y0 && n.y1 <= bold.y1, 'the note is not on the bold line\'s row');
  assert(n.x1 <= gp.GENERIC_BOX_MM.x1, `the note runs to x ${n.x1.toFixed(2)}, past the box`);
  assert(/0\.35\d* g/.test(pdfBytes), 'the note is not drawn in the lighter grey');
});

await check('FINAL: the fields line is unchanged and carries no note; nothing below the bold line moved', () => {
  assertEqual(gp.GENERIC_FIELDS_TEXT, 'Problem __________   Part __________   Page ______ of ______', 'the fields line changed');
  const f = inkOf('fields line');
  assertEqual([f.x0, f.y0], [12.0, 28.0], 'the fields line moved');
  assert(Math.abs(ptOf(f) - 12) < 1e-6, 'the fields line is not 12 pt');
  const at = (what) => { const b = inkOf(what); return [b.x0, b.y0, Math.round(ptOf(b) * 1000) / 1000]; };
  assertEqual([at('identity line'), at('pencil line'), at('printing line')],
    [[12.0, 42.5, 10], [12.0, 47.6, 9], [12.0, 51.6, 9]], 'a line below the bold line moved or changed size');
  assertEqual(gp.GENERIC_PRINTED_STRINGS.length, 7, 'the page prints a string it did not before, or lost one');
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
  // Per page: each of the two identical pages has its own header line.
  for (const k of [1, 2]) {
    const inBand = page.ink.filter(b => b.pageK === k && b.y0 < fmt.IDENTITY_BAND_MM).map(b => b.what);
    assertEqual(inBand, ['header line'], `something else is printed in page ${k}'s identity band`);
  }
  assert(pdfStrings.includes('GradeBridge   answer page   GBGEN1'), 'the header line is not the approved text');
});

// WORKORDER_AM_PAGE_TWO_SIDES_2026-09-25. This check read "one page, one PDF"
// until then. A one-page PDF cannot be printed double sided, yet the page says
// "single or double sided": duplex gave an answer page and a blank back. Two
// identical pages print duplex as one usable sheet. Each side carries its own
// marks and QR and registers on its own, and the QR names the format, not the
// sheet, so the two sides MUST be indistinguishable: no page number, no mark.
const pageStreams = (() => {
  const objs = new Map([...pdfBytes.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)].map(x => [x[1], x[2]]));
  return [...pdfBytes.matchAll(/\/Type \/Page\b[\s\S]*?\/Contents (\d+) 0 R/g)].map(x => {
    const body = objs.get(x[1]);
    return body.slice(body.indexOf('stream') + 6, body.lastIndexOf('endstream'));
  });
})();

await check('TWO SIDES: one PDF of exactly two pages, same filename', () => {
  assertEqual((pdfBytes.match(/\/Type \/Page\b/g) || []).length, 2, 'the PDF is not two pages');
  assertEqual(pageStreams.length, 2, 'could not read a content stream for each page');
  assertEqual(page.pdfFilename, 'GradeBridge_answer_page_GBGEN1.pdf', 'the filename changed');
});

await check('TWO SIDES: the two pages are byte-identical in content', () => {
  assert(pageStreams[0].length > 1000, 'page 1 has no real content, so the comparison proves nothing');
  assert(pageStreams[0] === pageStreams[1], 'page 2 differs from page 1 — a student must be able to use either side');
  // And therefore the same strings, rules and QR modules, in the same places:
  const strings = (st) => [...st.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map(x => unescapePdf(x[1]));
  assertEqual(strings(pageStreams[1]), strings(pageStreams[0]), 'the pages print different strings');
  assertEqual(strings(pageStreams[0]).length, gp.GENERIC_PRINTED_STRINGS.length, 'page 1 does not print every string once');
  assert(!/\b2 of 2\b|\bpage 2\b/i.test(pageStreams[1]), 'page 2 carries a page number');
});

await check('TWO SIDES: both pages are ink-checked, and page 2 draws exactly what page 1 does', () => {
  const strip = ({ pageK, ...b }) => b;
  const p1 = page.ink.filter(b => b.pageK === 1), p2 = page.ink.filter(b => b.pageK === 2);
  assert(p1.length > 10, 'page 1 recorded almost no ink');
  assertEqual(p2.map(strip), p1.map(strip), 'page 2 does not draw what page 1 draws');
  assertEqual(page.ink.length, p1.length + p2.length, 'ink recorded on a page other than 1 or 2');
  // The checks really look at page 2: the same ink with one page-2 block moved
  // into the QR keep-out must fail, so a pass is not the checks ignoring page 2.
  const moved = page.ink.map(b => b.pageK === 2 && b.what === 'fields line' ? { ...b, x1: 180 } : b);
  const r = selfTestMod.runInkChecks(moved, { passed: true, checks: [], failures: [], warnings: [] });
  assert(!r.passed && r.failures.some(f => /page 2 fields line/.test(f)), 'the ink checks do not see page 2');
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
  // Reversed 2026-09-25: the kind travels, so the Submission app reads it
  // rather than inferring it from the absence of `max_points` above.
  assertEqual(r.spec.assignmentKind, 'reader', 'the reader kind did not reach the student');
  assertEqual(out.spec.assignmentKind, 'conventional', 'the conventional kind did not reach the student');
  for (const p of out.spec.parts) assert('max_points' in p, `${p.part_id} lost its points on a conventional assignment`);
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
// EVERY entry, the two HTML documents included, on every machine
// (Supplement 1, item 2). The tracked lockfile is what makes that possible;
// this check is what notices if it stops being true.
await check('the installed KaTeX is the one the goldens were written with', () => {
  assertEqual(katexVersion(), goldens._katex,
    'KaTeX moved. Either the lockfile was changed deliberately, and the goldens with it, or it is not being honoured');
});
for (const f of GOLDEN_FIXTURES) {
  await check(`byte for byte against d6f4af5 (student spec as of the 2026-09-25 kind change), every entry, the HTML documents compared: ${f}`, async () => {
    const md = readFileSync(join(REPO, 'tests', 'fixtures', f), 'utf8');
    const now = await hashExport(m, pinnedAssignment(m, md));
    const was = goldens[f];
    const diffs = [];
    for (const n of new Set([...Object.keys(was.entries), ...Object.keys(now.entries)])) {
      if (was.entries[n] !== now.entries[n]) diffs.push(`entry ${n}`);
    }
    // Asserted, not assumed: the comparison above really covered them.
    assertEqual(Object.keys(now.entries).filter(n => n.endsWith('.html')).length, 2,
      'the two HTML documents were not both in the export, so they were not compared');
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
    // The export gained `assignmentKind` on 2026-09-25
    // (WORKORDER_AM_ASSIGNMENT_KIND_TRAVELS). The sample is deliberately NOT
    // regenerated: the Student Submission lane holds its own fixture
    // byte-identical to it and was mid-merge, and the work order says that lane
    // must not be disturbed. So the sample is compared with that one field set
    // aside, and the field is asserted on its own. Regenerate the sample, and
    // drop this exemption, with the work order that consumes the field there.
    const { assignmentKind, ...rest } = built;
    assertEqual(assignmentKind, 'conventional', 'the export does not carry the kind');
    assert(!('assignmentKind' in s),
      'the sample now carries the kind; drop this exemption and compare the whole object');
    assertEqual(rest, s, 'the export and the sample the other lane builds against have drifted');
  });
}

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
// Cleanup is not a check. On Windows the directory holding the bundles this
// run imported can still be locked when it ends, and on 2026-09-24 an
// uncaught EBUSY here turned a 39-of-39 run into a failed suite with no FAIL
// line — the same signature as the unexplained intermittents recorded in
// CLAUDE.md. Retry, then say so and move on; the exit code reports the checks.
try {
  rmSync(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (err) {
  console.log(`  note: could not remove ${outDir} (${err.code}); it is a temp directory and is left behind`);
}
// A suite that ran no checks has not passed (tests/suiteExit.mjs).
suiteExit(passed, failed);
