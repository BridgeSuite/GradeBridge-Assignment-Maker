// =====================================================
// CRITERION 6 — a real PNG swap, end to end
// =====================================================
// Extract HW1, replace one figure with a PNG that passes the guards, export,
// open the ZIP, decode the spec, and confirm four things:
//
//   * the PNG is inlined in the student's file,
//   * the grader text still carries the block's own desc,
//   * `layout_id` is unchanged,
//   * and `figures/` travelled with the instructor's `.md`.
//
// Against a real exported artifact rather than a fixture, on purpose: this
// project's rule is never to validate against data you generated yourself. The
// assignment comes from the ENG17 source, the ZIP is the one `Export ZIP`
// builds, and the spec is decrypted the way a student's browser decrypts it.
//
// Runs TWICE since 2026-09-25 (WORKORDER_AM_HWK_CHECKS_ARE_DEAD, Supplement 2):
//
//   1. On HW1, the real-data claim above. The ENG17 sources are found by
//      `tests/eng17Sources.mjs`: a relative default beside this checkout, or
//      GB_ENG17_DIR / ENG17_HWK_DIR; with either set, a missing file FAILS.
//      Until then it had no default and looked for a stale filename, so it
//      skipped on every run, and this suite printed `0 passed, 0 failed`
//      and exited 0.
//   2. On an in-repo assignment with two titled and described figures, the same
//      pipeline with no frozen layout id. (`Figure_Fixture.md` will not do: its
//      figures have no <desc>, so extraction rightly leaves them inline.) It does NOT stand in for the real-data claim; it exists so the
//      pipeline is exercised wherever the course material is absent (CI), and
//      so this suite always runs something. A suite that runs nothing now
//      fails (`tests/suiteExit.mjs`).

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { deflateSync } from 'node:zlib';
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

const outDir = mkdtempSync(join(tmpdir(), 'gb-swap-'));
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
const stubFileSaver = {
  name: 'stub-file-saver',
  setup(b) {
    b.onResolve({ filter: /^file-saver$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const s = new Proxy(function(){}, { get: () => s, apply: () => s, construct: () => s }); export default s;',
      loader: 'js',
    }));
  },
};
const load = async (entry, name, plugins = [assetImports, stubFileSaver]) => {
  const outfile = join(outDir, name);
  await build({
    entryPoints: [entry], outfile, format: 'esm', target: 'es2022', bundle: true,
    absWorkingDir: dirname(entry), logLevel: 'silent', plugins,
  });
  return import(pathToFileURL(outfile).href);
};

const exportSvc = await load(join(REPO, 'services', 'exportService.ts'), 'exportSvc.mjs');
const mdParser = await load(join(REPO, 'services', 'mdParserService.ts'), 'mdParser.mjs', [assetImports]);
const extract = await load(join(REPO, 'services', 'figureExtract.ts'), 'extract.mjs', [assetImports]);
const refs = await load(join(REPO, 'services', 'figureRefs.ts'), 'refs.mjs', [assetImports]);
const guards = await load(join(REPO, 'services', 'figureGuards.ts'), 'guards.mjs', [assetImports]);
const crypto_ = await load(join(REPO, 'services', 'cryptoService.ts'), 'crypto.mjs', [assetImports]);
const gen = await load(join(REPO, 'services', 'templateGenerator.ts'), 'gen.mjs');
const JSZip = (await import(pathToFileURL(requireFromRepo.resolve('jszip')).href)).default;

console.log('\nCriterion 6 — a real PNG swap, end to end\n');

// --- a PNG that passes every guard -----------------------------------------
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
// 2400 x 600, colour type 0 (greyscale), non-interlaced: clears the dpi floor
// at printed size and is greyscale by construction.
const W = 2400, H = 600;
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 0;
const raw = Buffer.alloc(H * (1 + W));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W)] = 0;
  for (let x = 0; x < W; x++) raw[y * (1 + W) + 1 + x] = (x * 7 + y * 3) % 256;
}
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]);

// The whole pipeline, for one assignment. `frozenLayoutId` is asserted when given.
const swapEndToEnd = async (imported, label, frozenLayoutId) => {
    // 1. Extract the assignment's inline SVGs into files.
    const { assignment: extracted, extracted: list } = extract.extractFigures(imported);
    assert(list.length > 0, `${label} produced no figure files to swap`);
    const beforeTemplate = await gen.generateTemplate(extracted);

    // 2. Replace one figure with the PNG, keeping its id, title and desc.
    const target = list[0].id;
    const swapFile = { format: 'png', base64: PNG.toString('base64'), filename: `${target}.png` };

    const problems = await guards.figureFileProblems(swapFile);
    assertEqual(problems.map(p => p.guard), [],
      `the replacement PNG does not pass the guards: ${problems.map(p => p.message).join(' | ')}`);

    const swapped = { ...extracted, figures: { ...extracted.figures, [target]: swapFile } };

    // 3. Export, for real.
    const entries = await exportSvc.buildExportEntries(swapped);

    // 4. Open the student file and decode it the way a student's browser does.
    const specName = Object.keys(entries).find(n => /_OPEN_IN_APP\.json$/.test(n));
    assert(specName, 'the export produced no student spec');
    const specEntry = entries[specName];
    const specText = typeof specEntry === 'string'
      ? specEntry : Buffer.from(await specEntry.arrayBuffer()).toString('utf8');
    assert(crypto_.isEncoded(specText), 'the student spec is not gb1-encoded');
    const spec = await crypto_.decryptJson(specText);

    // --- the PNG is inlined, and no reference survived ----------------------
    const stems = spec.problems.map(p => p.description).join('\n');
    assert(stems.includes(`data:image/png;base64,${PNG.toString('base64')}`),
      'the replacement PNG is not inlined in the student spec');
    assert(!stems.includes('```figure'), 'a figure block reached the student spec');
    assert(!('figures' in spec), 'the figure map reached the student spec');

    // --- the grader still gets the block's own words ------------------------
    const rubricName = Object.keys(entries).find(n => /_grading_rubric\.json$/.test(n));
    const rubricText = typeof entries[rubricName] === 'string'
      ? entries[rubricName] : Buffer.from(await entries[rubricName].arrayBuffer()).toString('utf8');
    const rubric = JSON.parse(rubricText);
    const statements = Object.values(rubric.rubrics).map(r => r.problem_statement || '').join('\n');
    const swappedTitle = list[0].title;
    assert(statements.includes(swappedTitle),
      `the grader text lost the swapped figure's title (${swappedTitle})`);
    assert(!/data:image|<svg|<path/.test(statements),
      'the drawing itself reached the grader');

    // --- layout_id unchanged ------------------------------------------------
    const afterTemplate = await gen.generateTemplate(swapped);
    assertEqual(afterTemplate.layoutId, beforeTemplate.layoutId,
      `layout_id moved when the figure was swapped: ${beforeTemplate.layoutId} -> ${afterTemplate.layoutId}`);
    if (frozenLayoutId) {
      assertEqual(afterTemplate.layoutId, frozenLayoutId, `${label} is not at its frozen layout_id`);
    }
    assertEqual(afterTemplate.pageCount, beforeTemplate.pageCount, 'the page count moved');

    // --- the instructor's .md travelled with its figures --------------------
    const figureEntries = Object.keys(entries).filter(n => /instructor\/figures\//.test(n));
    assert(figureEntries.length === list.length,
      `the export carries ${figureEntries.length} figure files for ${list.length} figures`);
    assert(figureEntries.some(n => n.endsWith(`${target}.png`)),
      `the swapped figure is not in instructor/figures/ as a .png: ${figureEntries.join(', ')}`);

    // --- and the cost of inlining a raster, for the report ------------------
    const plain = await exportSvc.buildExportEntries(extracted);
    const sizeOf = async (e) => {
      const v = e[Object.keys(e).find(n => /_OPEN_IN_APP\.json$/.test(n))];
      return typeof v === 'string' ? v.length : (await v.arrayBuffer()).byteLength;
    };
    results.push(`        ${label} student spec: ${await sizeOf(plain)} bytes with the SVG, `
      + `${await sizeOf(entries)} bytes with the PNG (${PNG.length} byte source)`);
};

// 1. The real-data claim, on HW1.
{
  const NAME = 'CRITERION 6: extract HW1, swap a figure for a PNG, export, decode the spec';
  const plan = eng17Plan(1);
  if (plan.action === 'fail') await check(NAME, async () => { throw new Error(plan.why); });
  else if (plan.action === 'skip') skip(NAME, plan.why);
  else await check(NAME, () =>
    swapEndToEnd(mdParser.parseMdToAssignment(readFileSync(plan.path, 'utf8')), 'HW1', '95438EDF'));
}

// 2. The same pipeline on an in-repo assignment, which runs everywhere.
{
  const svgWith = (title, desc) =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${title}</title>`
    + `<desc>${desc}</desc><path d="M0 0 L10 10" stroke="#000"/></svg>`;
  const fixture = {
    id: 'a1', courseCode: 'DEMO101', title: 'Swap Fixture', assignmentKind: 'conventional',
    inputMode: 'handwritten', preamble: 'Do it.', targetPoints: 100, createdAt: 1, updatedAt: 1,
    problems: [['Divider', 'Two resistors in series.'], ['Bridge', 'Four resistors in a diamond.']]
      .map(([t, d], i) => ({
        id: `p${i + 1}`, name: `Problem ${i + 1}`,
        description: `Given the network.\n\n\`\`\`svg\n${svgWith(t, d)}\n\`\`\`\n\nFind Vout.`,
        subsections: [{ id: `s${i + 1}`, name: 'a', description: 'Work it out.', points: 50,
          submissionType: 'Handwritten', handwrittenGradingMode: 'human' }],
      })),
  };
  await check('the swap pipeline, on an in-repo assignment (runs everywhere; not a stand-in for HW1)', () =>
    swapEndToEnd(fixture, 'the in-repo assignment', null));
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* windows handles */ }
suiteExit(passed, failed);
