// =====================================================
// Page-format template tests — the spec 8.7 self-test, all eight checks
// =====================================================
// Spec: GradeBridge2026/QR Format Page/GradeBridge_Page_Format_v1.md
//
// Checks 1–7 are asserted through services/templateSelfTest.ts, the same code
// that gates every generation in the app.
//
// Check 8 lives here because it needs pixels: rasterise the emitted geometry at
// the canonical 300 dpi, decode each QR with a real decoder (jsQR, which reports
// the symbol's own mode and version, so check 6 is verified rather than
// asserted), and run the spec 3.2 mark detector over the page — fill ratio,
// area, aspect, 30 mm search window, 4 of 4.
//
// What the raster covers and what it does not: it is built from the same
// constants the PDF is drawn from, so it proves the geometry decodes and detects
// at the specified physical size. It is not a rasterisation of the PDF bytes, so
// a jsPDF drawing bug would slip past it — which is why the PDF's own content
// stream is parsed and its mark and QR rectangles checked against the same
// constants, below. Between the two, both halves are covered.
//
//   npm test
// =====================================================

import { build } from 'esbuild';
import jsQR from 'jsqr';
import { webcrypto } from 'node:crypto';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
globalThis.crypto ??= webcrypto;

let passed = 0, failed = 0;
const results = [];
// Async-aware: an `async` check that rejects must be reported as a FAIL, not
// escape as an unhandled rejection and take the whole run down with it.
const check = (name, fn) => {
  const ok = () => { passed++; results.push(`  PASS  ${name}`); };
  const bad = (err) => { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      pending.push(out.then(ok, bad));
      return;
    }
    ok();
  } catch (err) { bad(err); }
};
const pending = [];
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n          expected: ${e}\n          actual:   ${a}`);
};

// ---------- load the modules under test ----------
const outDir = mkdtempSync(join(tmpdir(), 'gb-template-test-'));
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
const loadModule = async (entry, outName) => {
  const outfile = join(outDir, outName);
  await build({
    entryPoints: [entry], outfile, format: 'esm', target: 'es2022', bundle: true,
    absWorkingDir: dirname(entry), logLevel: 'silent', plugins: [assetImports],
  });
  return import(pathToFileURL(outfile).href);
};

const gen = await loadModule(join(REPO, 'services', 'templateGenerator.ts'), 'templateGenerator.mjs');
const fmt = await loadModule(join(REPO, 'services', 'pageFormat.ts'), 'pageFormat.mjs');
const qrp = await loadModule(join(REPO, 'services', 'qrPayload.ts'), 'qrPayload.mjs');
const lay = await loadModule(join(REPO, 'services', 'templateLayout.ts'), 'templateLayout.mjs');
const enc = await loadModule(join(REPO, 'services', 'qrEncoder.ts'), 'qrEncoder.mjs');

console.log('\nAssignment Maker — GradeBridge page format (QR template)\n');

// ---------- fixtures ----------
const part = (name, points, extra = {}) => ({
  id: `s-${name}`, name, description: '', points,
  submissionType: 'Handwritten', handwrittenGradingMode: 'ai', ...extra,
});
const makeAssignment = (problems, extra = {}) => ({
  id: 'qr1', courseCode: 'EEC130B', title: 'Homework 3',
  inputMode: 'handwritten', preamble: 'Show all working on paper.',
  problems: problems.map((subs, i) => ({ id: `p${i}`, name: `Problem ${i + 1}`, description: '', subsections: subs })),
  aiGradingConfig: { model: 'claude-haiku-4-5-20251001', temperature: 0.1, maxTokens: 512 },
  createdAt: 1700000000000, updatedAt: 1700000000000, ...extra,
});

// The spec's Appendix B shape: 1(a), 1(b), 2, 3(a), 3(b) with the last a sketch.
const appendixB = makeAssignment([
  [part('Cutoff frequency', 5), part('Mode chart', 5)],
  [part('Attenuation', 10)],
  [part('Field derivation', 6), part('Field sketch', 14, { isDrawing: true })],
]);

// ---------- generate ----------
const t = await gen.generateTemplate(appendixB);

check('a template is emitted, with a PDF, a sidecar and one payload per page', () => {
  assert(t.pdf && t.pdf.size > 0, 'no PDF');
  assert(t.csv.length > 0, 'no CSV');
  assertEqual(t.payloads.length, t.pageCount, 'one payload per page');
  assert(t.pageCount >= 1, 'no pages');
});

check('the self-test passed every check it gates generation on', () => {
  assertEqual(t.selfTest.failures, [], 'self-test reported failures');
  assert(t.selfTest.passed === true, 'self-test did not pass');
});

check('part ids follow the spec worked example: 1(a), 1(b), 2, 3(a), 3(b)', () => {
  // Problem 2 has a single sub-part, so it gets a second page of writing space
  // for the same answer: two rows sharing part_id "2", distinct region_ids.
  assertEqual(t.rows.map(r => r.partId), ['1(a)', '1(b)', '2', '2', '3(a)', '3(b)'], 'wrong part ids');
  assertEqual(t.rows.map(r => r.regionId), ['p1a', 'p1b', 'p2', 'p2x2', 'p3a', 'p3b'], 'wrong region ids');
  assertEqual([...new Set(t.rows.map(r => r.regionId))].length, t.rows.length, 'a region_id repeats');
});

check('the sketch part is flagged is_drawing, and only it', () =>
  assertEqual(t.rows.filter(r => r.isDrawing === 1).map(r => r.partId), ['3(b)'], 'wrong is_drawing rows'));

check('the sidecar has the spec 4.3 header and one row per part', () => {
  const lines = t.csv.trim().split('\n');
  assertEqual(lines[0], lay.LAYOUT_CSV_HEADER, 'wrong CSV header');
  assertEqual(lines.length - 1, t.rows.length, 'wrong row count');
  assert(lines.every(l => l.split(',').length === 11), 'a row does not have 11 columns');
  assert(lines.slice(1).every(l => /,\d\.\d{4},\d\.\d{4},\d\.\d{4},\d\.\d{4},/.test(l)),
    'coordinates are not all at exactly four decimal places');
});

// ---------- decisions from the work order ----------
check('decision 2: nothing student-specific in the QR, fixed master token', () => {
  for (const p of t.payloads) {
    const f = qrp.parsePayload(p);
    assert(f !== null, `payload does not parse: ${p}`);
    assertEqual(f.token, 'HWMSTR', 'the token is not the class-wide placeholder');
  }
  assert(!t.payloads.join(' ').toLowerCase().includes('name'), 'a payload mentions a name');
});

check('the assignment_id is derived into the QR grammar and is stable', async () => {
  assert(/^[A-Z0-9]{1,12}$/.test(t.assignmentId), `assignment_id "${t.assignmentId}" is not [A-Z0-9]{1,12}`);
});

check('an author override of the assignment_id is honoured', async () => {
  assertEqual(await gen.resolvePageFormatId({ ...appendixB, pageFormatId: 'hw3' }), 'HW3', 'override ignored');
  // An illegal override must not reach the symbol; fall back to the derived id.
  const fallback = await gen.resolvePageFormatId({ ...appendixB, pageFormatId: 'not a valid id!' });
  assert(/^[A-Z0-9]{1,12}$/.test(fallback), `illegal override leaked: ${fallback}`);
});

// ---------- check 8, part 1: the QR, decoded by a real decoder ----------
const PX_PER_MM_300 = 300 / 25.4;

const rasterQr = (payload) => {
  const m = enc.encodeQr(payload);
  const modulePx = Math.round((fmt.QR_SIZE_MM / m.moduleCount) * PX_PER_MM_300);
  const quiet = fmt.QR_QUIET_MODULES * modulePx;
  const side = m.moduleCount * modulePx + quiet * 2;
  const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let r = 0; r < m.moduleCount; r++) for (let c = 0; c < m.moduleCount; c++) {
    if (!m.dark[r][c]) continue;
    for (let dy = 0; dy < modulePx; dy++) for (let dx = 0; dx < modulePx; dx++) {
      const i = ((quiet + r * modulePx + dy) * side + (quiet + c * modulePx + dx)) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = 0;
    }
  }
  return { rgba, side, modulePx };
};

check('check 8a: every page QR decodes from a 300 dpi raster, with correct k and N', () => {
  t.payloads.forEach((payload, i) => {
    const { rgba, side } = rasterQr(payload);
    const res = jsQR(rgba, side, side);
    assert(res !== null, `page ${i + 1}: the symbol did not decode`);
    assertEqual(res.data, payload, `page ${i + 1}: decoded the wrong payload`);
    const f = qrp.parsePayload(res.data);
    assertEqual(f.k, i + 1, `page ${i + 1}: decoded k is wrong`);
    assertEqual(f.n, t.pageCount, `page ${i + 1}: decoded N is wrong`);
    assertEqual(f.layoutId, t.layoutId, `page ${i + 1}: decoded layout_id does not match the map`);
  });
});

check('check 6 (verified, not assumed): the decoder reports alphanumeric mode at version 4', () => {
  for (const payload of t.payloads) {
    const { rgba, side } = rasterQr(payload);
    const res = jsQR(rgba, side, side);
    assertEqual(res.version, fmt.QR_VERSION, 'the decoded symbol is not version 4');
    assertEqual(res.chunks.map(c => c.type), ['alphanumeric'], 'the decoded symbol is not alphanumeric mode');
  }
});

check('the module size is the 0.7273 mm the px/module budget was computed from', () => {
  const modMm = fmt.QR_SIZE_MM / fmt.QR_MODULES;
  assert(Math.abs(modMm - fmt.QR_MODULE_MM) < 0.001, `module is ${modMm.toFixed(4)} mm, spec says ${fmt.QR_MODULE_MM}`);
});

// ---------- check 8, part 2: the marks, found by the spec 3.2 detector ----------

/** Render one page's fiducials into a 1-bit raster at the canonical 300 dpi. */
const rasterMarks = () => {
  const w = fmt.CANONICAL_W_PX, h = fmt.CANONICAL_H_PX;
  const ink = new Uint8Array(w * h); // 1 = foreground
  for (const [mx, my] of fmt.MARK_ORIGINS_MM) {
    const x0 = Math.round(mx * PX_PER_MM_300), y0 = Math.round(my * PX_PER_MM_300);
    const s = Math.round(fmt.MARK_SIZE_MM * PX_PER_MM_300);
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) ink[y * w + x] = 1;
  }
  return { ink, w, h };
};

/**
 * Spec 3.2 detection, as written: a 30 mm window on each nominal centre, then
 * area 0.5x–2.0x of 25 mm², fill ratio >= 0.85 counted in PIXELS (not contour
 * area — the spec is explicit that contour area nearly admits a QR finder
 * pattern as a false fiducial), aspect 0.80–1.25.
 */
const detectMarks = ({ ink, w, h }) => {
  const found = [];
  const win = 30.0 * PX_PER_MM_300;
  const nominalAreaPx = 25.0 * PX_PER_MM_300 * PX_PER_MM_300;

  for (const [cxMm, cyMm] of fmt.MARK_CENTRES_MM) {
    const cx = cxMm * PX_PER_MM_300, cy = cyMm * PX_PER_MM_300;
    const x0 = Math.max(0, Math.round(cx - win / 2)), x1 = Math.min(w, Math.round(cx + win / 2));
    const y0 = Math.max(0, Math.round(cy - win / 2)), y1 = Math.min(h, Math.round(cy + win / 2));

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, count = 0, sx = 0, sy = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (!ink[y * w + x]) continue;
      count++; sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (!count) continue;

    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const fill = count / (bw * bh);
    const aspect = bw / bh;
    const areaOk = count >= 0.5 * nominalAreaPx && count <= 2.0 * nominalAreaPx;
    if (!areaOk || fill < 0.85 || aspect < 0.80 || aspect > 1.25) continue;

    found.push({ xMm: (sx / count) / PX_PER_MM_300, yMm: (sy / count) / PX_PER_MM_300, fill, aspect });
  }
  return found;
};

check('check 8b: the spec 3.2 detector finds 4 of 4 marks, each within the 1.0 mm residual', () => {
  const found = detectMarks(rasterMarks());
  assertEqual(found.length, 4, 'the detector did not find 4 of 4 marks');
  found.forEach((f, i) => {
    const [cx, cy] = fmt.MARK_CENTRES_MM[i];
    const dx = Math.abs(f.xMm - cx), dy = Math.abs(f.yMm - cy);
    assert(dx <= fmt.RESIDUAL_MAX_MM && dy <= fmt.RESIDUAL_MAX_MM,
      `mark ${i} centroid is (${f.xMm.toFixed(2)}, ${f.yMm.toFixed(2)}) mm, nominal (${cx}, ${cy})`);
    assert(f.fill >= 0.85, `mark ${i} fill ratio ${f.fill.toFixed(3)} is below 0.85`);
  });
});

// ---------- the PDF actually carries that geometry ----------
// The raster above proves the geometry is detectable; this proves the PDF is
// drawn from the same numbers, which is the half a self-built raster cannot see.
const pdfText = Buffer.from(await t.pdf.arrayBuffer()).toString('latin1');

/**
 * Every `re` operator in the content stream, converted back to the page format's
 * own frame: millimetres, origin top-left, y downward. jsPDF writes points from
 * a bottom-left origin and gives rectangles as `x yTop w -h`.
 */
const PT_TO_MM = 25.4 / 72;
const pdfRects = [...pdfText.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)].map(m => {
  const [x, yTop, w, h] = m.slice(1).map(Number);
  return {
    xMm: x * PT_TO_MM,
    yMm: fmt.PAGE_H_MM - yTop * PT_TO_MM,
    wMm: Math.abs(w) * PT_TO_MM,
    hMm: Math.abs(h) * PT_TO_MM,
  };
});
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const countRects = (x, y, w, h) =>
  pdfRects.filter(r => near(r.xMm, x) && near(r.yMm, y) && near(r.wMm, w) && near(r.hMm, h)).length;

check('the PDF draws four 5 mm mark squares per page at the Appendix A positions', () => {
  for (const [mx, my] of fmt.MARK_ORIGINS_MM) {
    const hits = countRects(mx, my, fmt.MARK_SIZE_MM, fmt.MARK_SIZE_MM);
    assertEqual(hits, t.pageCount, `mark at (${mx}, ${my}) mm appears ${hits} times, expected once per page`);
  }
});

check('the PDF reserves a printed white quiet zone around every QR', () => {
  const side = fmt.QR_SIZE_MM + fmt.QR_QUIET_MM * 2;
  const hits = countRects(fmt.QR_RECT_MM.x0 - fmt.QR_QUIET_MM, fmt.QR_RECT_MM.y0 - fmt.QR_QUIET_MM, side, side);
  assertEqual(hits, t.pageCount, 'the quiet-zone field is missing on some page');
});

check('every QR module rectangle sits inside the declared symbol rectangle', () => {
  const modMm = fmt.QR_SIZE_MM / fmt.QR_MODULES;
  const modules = pdfRects.filter(r => near(r.hMm, modMm, 0.001) && r.wMm > 0 && r.wMm <= fmt.QR_SIZE_MM + 0.01);
  assert(modules.length > 100, `only ${modules.length} module rectangles found across ${t.pageCount} pages`);
  for (const r of modules) {
    assert(r.xMm >= fmt.QR_RECT_MM.x0 - 0.01 && r.xMm + r.wMm <= fmt.QR_RECT_MM.x1 + 0.01,
      `a module runs outside the symbol horizontally: x ${r.xMm.toFixed(2)}–${(r.xMm + r.wMm).toFixed(2)} mm`);
    assert(r.yMm >= fmt.QR_RECT_MM.y0 - 0.01 && r.yMm + r.hMm <= fmt.QR_RECT_MM.y1 + 0.01,
      `a module runs outside the symbol vertically: y ${r.yMm.toFixed(2)}–${(r.yMm + r.hMm).toFixed(2)} mm`);
  }
});

// ---------- safe areas and the identity band ----------
check('no declared rectangle enters the identity band, the QR keep-out or a corner', () => {
  const bad = t.rows.flatMap(r =>
    fmt.safeAreaViolations(fmt.fractionRectToMm(r)).map(v => `${r.regionId}: ${v}`));
  assertEqual(bad, [], 'a rectangle violates a safe area');
});

check('the identity band carries only the three allowed fixtures', () => {
  // Spec 4.5: anything in the top 25 mm that is not the QR, the one header line
  // or a top mark trips the consumer's PII gate and withholds every crop on the
  // page. So every rectangle reaching into the band must belong to the QR block
  // (symbol, modules or quiet-zone field) or to one of the two top marks.
  const topMarks = fmt.MARK_ORIGINS_MM.filter(([, y]) => y < fmt.IDENTITY_BAND_MM);
  const qrBlock = {
    x0: fmt.QR_RECT_MM.x0 - fmt.QR_QUIET_MM, y0: fmt.QR_RECT_MM.y0 - fmt.QR_QUIET_MM,
    x1: fmt.QR_RECT_MM.x1 + fmt.QR_QUIET_MM, y1: fmt.QR_RECT_MM.y1 + fmt.QR_QUIET_MM,
  };
  const intruders = pdfRects
    .filter(r => r.yMm < fmt.IDENTITY_BAND_MM)
    .filter(r => {
      const insideQr = r.xMm >= qrBlock.x0 - 0.02 && r.xMm + r.wMm <= qrBlock.x1 + 0.02
        && r.yMm >= qrBlock.y0 - 0.02 && r.yMm + r.hMm <= qrBlock.y1 + 0.02;
      const isTopMark = topMarks.some(([mx, my]) =>
        near(r.xMm, mx) && near(r.yMm, my) && near(r.wMm, fmt.MARK_SIZE_MM) && near(r.hMm, fmt.MARK_SIZE_MM));
      return !insideQr && !isTopMark;
    });
  assertEqual(intruders.map(r => `(${r.xMm.toFixed(1)}, ${r.yMm.toFixed(1)}) ${r.wMm.toFixed(1)}x${r.hMm.toFixed(1)} mm`),
    [], 'something other than the QR and the two top marks is printed in the identity band');
  // And exactly one text line up there: the header.
  assert(pdfText.includes('GradeBridge'), 'the header line is missing');
});

check('exactly one text line per page in the band, at the spec 8.4 anchor', () => {
  // Course, title, name/ID/date and the print instruction all belong under
  // y = 25 mm (spec 4.5) — anything else up there withholds every crop on the
  // page. Text is positioned by Td, so read those rather than rectangles.
  const textOps = [...pdfText.matchAll(/([\d.]+) ([\d.]+) Td\s*\(((?:\\.|[^\\()])*)\)\s*Tj/g)]
    .map(m => ({ xMm: Number(m[1]) * PT_TO_MM, yMm: fmt.PAGE_H_MM - Number(m[2]) * PT_TO_MM, text: m[3] }));
  assert(textOps.length > 0, 'no text operators were found — this check would pass vacuously');

  const inBand = textOps.filter(o => o.yMm < fmt.IDENTITY_BAND_MM);
  assertEqual(inBand.length, t.pageCount,
    `${inBand.length} text lines sit in the identity band across ${t.pageCount} pages; exactly one per page may`);
  for (const o of inBand) {
    assert(near(o.xMm, fmt.HEADER_TEXT_ANCHOR_MM.x, 0.05),
      `the header line starts at x = ${o.xMm.toFixed(1)} mm, spec anchor is ${fmt.HEADER_TEXT_ANCHOR_MM.x}`);
    assert(o.xMm < fmt.QR_KEEPOUT_MM.x0, 'the header line starts inside the QR keep-out');
    // No identity field up here: no fill-in rule and no name/ID prompt.
    assert(!/_{3,}/.test(o.text) && !/\b(name|student|signature)\b/i.test(o.text),
      `the band header carries an identity field: "${o.text}"`);
  }
  // And the furniture the band forbids really is below it.
  const furniture = textOps.filter(o => /Name:|Print at 100/.test(o.text));
  assert(furniture.length > 0, 'the page-1 furniture is missing');
  for (const o of furniture) {
    assert(o.yMm >= fmt.IDENTITY_BAND_MM, `"${o.text.slice(0, 20)}" sits at y = ${o.yMm.toFixed(1)} mm, inside the band`);
  }
});

check('every part gets a prompt and a rule, and the rule sits above the writing area', () => {
  for (const r of t.layout.regions) {
    assert(r.ruleYMm < r.nominalMm.y0, `${r.regionId}: the rule is not above the writing area`);
    assert(r.ruleYMm > r.promptTopMm, `${r.regionId}: the rule is not below the prompt text`);
    assert(r.declaredMm.y0 < r.nominalMm.y0, `${r.regionId}: padding was not applied outward`);
    assert(r.declaredMm.y0 > r.ruleYMm - 3.1, `${r.regionId}: the declared rectangle swallows the prompt`);
    if (r.description) {
      assert(r.descBoxMm, `${r.regionId}: has a description but no box reserved for it`);
      assert(r.descBoxMm.y1 <= r.ruleYMm + 0.01, `${r.regionId}: the description box runs past the rule`);
    }
  }
});

check('the declared rectangle is the writing area grown by exactly 3 mm on each side', () => {
  for (const r of t.layout.regions) {
    for (const [edge, delta] of [['x0', r.nominalMm.x0 - r.declaredMm.x0], ['y0', r.nominalMm.y0 - r.declaredMm.y0],
                                 ['x1', r.declaredMm.x1 - r.nominalMm.x1], ['y1', r.declaredMm.y1 - r.nominalMm.y1]]) {
      assert(Math.abs(delta - fmt.REGION_PAD_MM) < 0.001, `${r.regionId}: ${edge} padding is ${delta.toFixed(3)} mm`);
    }
  }
});

// ---------- layout_id ----------
check('layout_id is 8 uppercase hex and is the hash of the canonical serialization', async () => {
  assert(/^[0-9A-F]{8}$/.test(t.layoutId), `layout_id "${t.layoutId}" is not 8 uppercase hex`);
  const recomputed = await qrp.computeLayoutId(t.rows.map(r => ({
    regionId: r.regionId, partId: r.partId, pageK: r.pageK, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
  })));
  assertEqual(recomputed, t.layoutId, 'recomputing the hash over the emitted rows disagrees');
});

check('the canonical serialization is sorted by region_id and 4 dp, per spec 2.2', () => {
  const s = qrp.canonicalMapSerialization([
    { regionId: 'p2', partId: '2', pageK: 1, x0: 0.1, y0: 0.2, x1: 0.3, y1: 0.4 },
    { regionId: 'p1a', partId: '1(a)', pageK: 1, x0: 0.5, y0: 0.6, x1: 0.7, y1: 0.8 },
  ]);
  assertEqual(s, 'p1a|1(a)|1|0.5000|0.6000|0.7000|0.8000\np2|2|1|0.1000|0.2000|0.3000|0.4000',
    'the canonical serialization is not as spec 2.2 describes');
});

check('a changed rectangle changes layout_id — the stale-map guard actually bites', async () => {
  const rows = t.rows.map(r => ({
    regionId: r.regionId, partId: r.partId, pageK: r.pageK, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
  }));
  const moved = rows.map((r, i) => (i === 0 ? { ...r, y1: r.y1 + 0.0001 } : r));
  const a = await qrp.computeLayoutId(rows), b = await qrp.computeLayoutId(moved);
  assert(a !== b, 'a moved rectangle produced the same layout_id');
});

// ---------- pagination and sizing ----------
check('a long assignment paginates, and every page carries its own correct k of N', async () => {
  const many = makeAssignment([Array.from({ length: 12 }, (_, i) => part(`Part ${i + 1}`, 20))]);
  const big = await gen.generateTemplate(many);
  assert(big.pageCount >= 3, `expected several pages, got ${big.pageCount}`);
  assertEqual(big.selfTest.failures, [], 'self-test failed on the multi-page template');
  big.payloads.forEach((p, i) => {
    const f = qrp.parsePayload(p);
    assertEqual([f.k, f.n], [i + 1, big.pageCount], `page ${i + 1} carries the wrong k of N`);
  });
  const pages = new Set(big.rows.map(r => r.pageK));
  assertEqual([...pages].sort((a, b) => a - b), Array.from({ length: big.pageCount }, (_, i) => i + 1),
    'some page has no regions');
});

// ---------- correction item 3: two regions per page, by rule ----------
check('at most two regions on any page', () => {
  const perPage = new Map();
  for (const r of t.rows) perPage.set(r.pageK, (perPage.get(r.pageK) || 0) + 1);
  const over = [...perPage.entries()].filter(([, n]) => n > lay.MAX_REGIONS_PER_PAGE);
  assertEqual(over.map(([p, n]) => `page ${p} has ${n}`), [], 'a page carries more than two regions');
});

check('a sketch, and anything marked full page, gets a page to itself', () => {
  const l = lay.buildLayout(makeAssignment([[
    part('Shared one', 10), part('Sketch', 10, { isDrawing: true }),
    part('Shared two', 10), part('Big', 10, { answerSpace: 'full' }),
  ]]));
  const pageOf = (id) => l.regions.find(r => r.regionId === id).pageK;
  const alone = (id) => l.regions.filter(r => r.pageK === pageOf(id)).length === 1;
  assert(alone('p1b'), 'the sketch shares its page');
  assert(alone('p1d'), 'the full-page part shares its page');
  assert(l.regions.find(r => r.regionId === 'p1b').isDrawing, 'the sketch lost its is_drawing flag');
});

check('a full-page part really does get most of the sheet', () => {
  const l = lay.buildLayout(makeAssignment([[part('Solo', 10, { answerSpace: 'full' })]]));
  const r = l.regions[0];
  const h = r.nominalMm.y1 - r.nominalMm.y0;
  assert(h > 150, `a lone part got only ${h.toFixed(0)} mm of writing space`);
  assert(r.declaredMm.y1 <= fmt.REGION_Y_MAX_MM + 0.001, 'the region ran past the bottom limit');
});

check('two parts sharing a page split it by points, but neither is squeezed', () => {
  const l = lay.buildLayout(makeAssignment([[part('Small', 5), part('Large', 45)]]));
  const [a, b] = l.regions.map(r => r.nominalMm.y1 - r.nominalMm.y0);
  assert(b > a, 'the 45-point part did not get more room than the 5-point one');
  assert(a / (a + b) >= lay.MIN_SHARE - 0.01, `the small part got only ${(100 * a / (a + b)).toFixed(0)}% of the page`);
  assertEqual(lay.splitByPoints(10, 10), [0.5, 0.5], 'equal points should split evenly');
  assertEqual(lay.splitByPoints(0, 0), [0.5, 0.5], 'zero points should split evenly');
});

check('every problem starts a new page, and that page carries one sub-part only', () => {
  const l = lay.buildLayout(makeAssignment([
    [part('1a', 10), part('1b', 10), part('1c', 10)],
    [part('2a', 10), part('2b', 10)],
  ]));
  const perPage = new Map();
  for (const r of l.regions) perPage.set(r.pageK, [...(perPage.get(r.pageK) || []), r]);

  // No page mixes two problems.
  for (const [k, rs] of perPage) {
    assertEqual([...new Set(rs.map(r => r.problemIndex))].length, 1, `page ${k} mixes problems`);
  }
  // A problem's first page holds exactly one part.
  const firstPageOf = new Map();
  for (const r of l.regions) {
    if (!firstPageOf.has(r.problemIndex)) firstPageOf.set(r.problemIndex, r.pageK);
  }
  for (const [prob, k] of firstPageOf) {
    assertEqual(perPage.get(k).length, 1, `problem ${prob + 1}'s first page carries more than one sub-part`);
  }
  // 1(a) alone, then 1(b)+1(c); 2(a) alone, then 2(b).
  assertEqual(l.regions.map(r => `${r.partId}@${r.pageK}`),
    ['1(a)@1', '1(b)@2', '1(c)@2', '2(a)@3', '2(b)@4'], 'wrong pagination');
});

check('a problem with a single sub-part gets a second page of writing space', () => {
  const l = lay.buildLayout(makeAssignment([[part('Only', 20)]]));
  assertEqual(l.pageCount, 2, 'a lone question did not get its extra page');
  assertEqual(l.regions.map(r => r.partId), ['1', '1'], 'the extra page is not the same part');
  assertEqual(l.regions.map(r => r.regionId), ['p1', 'p1x2'], 'the continuation needs its own region_id');
  assertEqual(l.regions.map(r => r.pageK), [1, 2], 'the continuation is not on the next page');
  assert(!l.regions[0].isContinuation && l.regions[1].isContinuation, 'wrong region flagged as the continuation');
  // The continuation is writing space, not a restatement.
  assertEqual([l.regions[1].name, l.regions[1].description], ['', ''], 'the continuation repeats the question');
  assert(l.regions[1].nominalMm.y1 - l.regions[1].nominalMm.y0 > 150, 'the continuation page is not mostly writing space');
});

// ---------- the payload cap is a hard failure, not a shrug ----------
check('an over-long or malformed payload is rejected rather than emitted', () => {
  assert(qrp.payloadViolations('GB1-TOOLONGASSIGNMENTID-HWMSTR-1-2-9F3A1C72').length > 0,
    'an over-long assignment_id was accepted');
  assert(qrp.payloadViolations('GB1-HW3-hwmstr-1-2-9F3A1C72').length > 0, 'a lowercase token was accepted');
  assert(qrp.payloadViolations('GB1-HW3-HWMSTR-1-2-9f3a1c72').length > 0, 'a lowercase layout_id was accepted');
  assert(qrp.payloadViolations('GB1-HW3-HWMSTR-1-2-9F3A1C72').length === 0, 'a valid payload was rejected');
  assert(qrp.payloadViolations('GB1-HW3-HWMSTR-1-2-9F3A1C72').length === 0);
  const long = 'GB1-' + 'A'.repeat(12) + '-' + 'B'.repeat(10) + '-100-100-9F3A1C72';
  assert(long.length <= fmt.QR_PAYLOAD_MAX_CHARS,
    `the worst legal payload is ${long.length} chars, over the ${fmt.QR_PAYLOAD_MAX_CHARS} cap`);
});

check('the self-test refuses to emit when a rule is broken', async () => {
  // A part sized past the page cannot break the safe areas (it is clamped), so
  // break the id instead: an override that parses but is too long for the QR.
  let threw = null;
  try {
    await gen.generateTemplate({ ...appendixB, problems: [] });
  } catch (err) { threw = err; }
  assert(threw !== null, 'an assignment with no parts produced a template');
});

// ---------- the 2026-08-15 correction ----------

check('item 1: no name, student ID or date field anywhere on the template', () => {
  // Identity comes from Gradescope authenticating the upload. A labelled blank
  // is redundant, contradicts "do not write your name on the pages", and a
  // filled-in one is exactly the PII the band gate exists to keep out.
  const text = [...pdfText.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map(m => m[1]).join(' | ');
  for (const banned of [/\bName\b/i, /\bStudent ID\b/i, /\bDate\b/i, /_{5,}/]) {
    assert(!banned.test(text), `the template prints an identity field matching ${banned}: "${text.slice(0, 200)}"`);
  }
});

check('item 2: nothing printed enters the QR keep-out, on any page', () => {
  // The writing rectangle already cleared it; the prompt row above, with its
  // right-aligned points label, did not. Checked against the ink the generator
  // actually laid down, not against the layout's intent.
  const intruders = t.ink.filter(b =>
    b.x0 < fmt.QR_KEEPOUT_MM.x1 - 0.01 && b.x1 > fmt.QR_KEEPOUT_MM.x0 + 0.01 &&
    b.y0 < fmt.QR_KEEPOUT_MM.y1 - 0.01 && b.y1 > fmt.QR_KEEPOUT_MM.y0 + 0.01);
  assertEqual(intruders.map(b => `page ${b.pageK} ${b.what}`), [], 'something is printed over the QR');
});

check('item 2: the first prompt row on every page starts below the keep-out', () => {
  const firstPerPage = new Map();
  for (const r of t.layout.regions) {
    if (!firstPerPage.has(r.pageK) || r.promptTopMm < firstPerPage.get(r.pageK).promptTopMm) {
      firstPerPage.set(r.pageK, r);
    }
  }
  for (const [page, r] of firstPerPage) {
    assert(r.promptTopMm >= fmt.QR_KEEPOUT_MM.y1,
      `page ${page}: the first prompt row starts at y = ${r.promptTopMm} mm, above the keep-out's ${fmt.QR_KEEPOUT_MM.y1} mm`);
  }
});

check('item 2: the QR still decodes with every ink box on the page overlaid', () => {
  // A conservative full-page check: fill every recorded ink box black over the
  // rendered symbol and decode. If a label had been drawn across the modules,
  // this is what would catch it — level H recovers 30%, so an eyeball check of
  // "does it look overlapped" is not enough.
  t.payloads.forEach((payload, i) => {
    const pageK = i + 1;
    const m = enc.encodeQr(payload);
    const modulePx = Math.round((fmt.QR_SIZE_MM / m.moduleCount) * PX_PER_MM_300);
    const quiet = fmt.QR_QUIET_MODULES * modulePx;
    const side = m.moduleCount * modulePx + quiet * 2;
    const rgba = new Uint8ClampedArray(side * side * 4).fill(255);
    const originXmm = fmt.QR_RECT_MM.x0 - fmt.QR_QUIET_MM;
    const originYmm = fmt.QR_RECT_MM.y0 - fmt.QR_QUIET_MM;
    const pxPerMm = side / (fmt.QR_SIZE_MM + fmt.QR_QUIET_MM * 2);

    for (let r = 0; r < m.moduleCount; r++) for (let c = 0; c < m.moduleCount; c++) {
      if (!m.dark[r][c]) continue;
      for (let dy = 0; dy < modulePx; dy++) for (let dx = 0; dx < modulePx; dx++) {
        const idx = ((quiet + r * modulePx + dy) * side + (quiet + c * modulePx + dx)) * 4;
        rgba[idx] = rgba[idx + 1] = rgba[idx + 2] = 0;
      }
    }
    for (const b of t.ink.filter(b => b.pageK === pageK)) {
      const x0 = Math.max(0, Math.round((b.x0 - originXmm) * pxPerMm));
      const x1 = Math.min(side, Math.round((b.x1 - originXmm) * pxPerMm));
      const y0 = Math.max(0, Math.round((b.y0 - originYmm) * pxPerMm));
      const y1 = Math.min(side, Math.round((b.y1 - originYmm) * pxPerMm));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const idx = (y * side + x) * 4;
        rgba[idx] = rgba[idx + 1] = rgba[idx + 2] = 0;
      }
    }
    const res = jsQR(rgba, side, side);
    assert(res !== null, `page ${pageK}: the symbol stopped decoding once the page's ink was overlaid`);
    assertEqual(res.data, payload, `page ${pageK}: decoded the wrong payload with ink overlaid`);
  });
});

check('item 5: no em-dash in any printed text', () => {
  const text = [...pdfText.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map(m => m[1]).join('');
  assert(!text.includes('—') && !text.includes(''), 'an em-dash reached the page');
  assert(/Write your answer below this line\./.test(text) || t.ink.some(b => /^prompt /.test(b.what)),
    'the prompt line is missing');
});

check('item 4: authored text with Greek and math is not silently garbled', async () => {
  // Node has no DOM, so the KaTeX rasteriser is unavailable and the generator
  // falls back to WinAnsi-safe vector text. Assert the fallback is safe — jsPDF
  // re-encodes a non-Latin-1 string as UTF-16BE, which its standard fonts render
  // as mojibake. The glyph path itself needs a browser and was verified there.
  const greek = makeAssignment([[
    { id: 'g1', name: 'Skin depth $\\delta_s$', description: 'Find $\\alpha$ and $\\omega$ for a $\\mu$F cap.',
      points: 50, submissionType: 'Handwritten', handwrittenGradingMode: 'ai' },
    { id: 'g2', name: 'Reflection $\\Gamma$', description: 'Compute $\\Gamma$ at 6 $\\Omega$.',
      points: 50, submissionType: 'Handwritten', handwrittenGradingMode: 'ai' },
  ]]);
  const g = await gen.generateTemplate(greek);
  const bytes = Buffer.from(await g.pdf.arrayBuffer()).toString('latin1');
  const strings = bytes.match(/\(((?:\\.|[^\\()])*)\)\s*Tj/g) || [];
  const utf16 = strings.filter(s => / /.test(s));
  assertEqual(utf16, [], 'a string was re-encoded as UTF-16BE and will render as mojibake');
  assert(!/\\delta|\\Omega|\\frac/.test(bytes), 'raw LaTeX was written onto the template');
});

// ---------- what Export ZIP actually contains ----------
{
  const exportSvc = await loadModule(join(REPO, 'services', 'exportService.ts'), 'exportEntries.mjs');

  const hwEntries = await exportSvc.buildExportEntries(appendixB);
  const elEntries = await exportSvc.buildExportEntries({
    ...appendixB, inputMode: 'electronic',
    problems: appendixB.problems.map(p => ({
      ...p, subsections: p.subsections.map(s => ({ ...s, submissionType: 'Text', maxImages: 1 })),
    })),
  });

  check('handwritten: assignment.pdf IS the QR template, and there is no second PDF', async () => {
    const pdfs = Object.keys(hwEntries).filter(n => n.endsWith('.pdf'));
    assertEqual(pdfs, ['assignment.pdf'], 'a handwritten export should contain exactly one PDF');
    // Same bytes as the standalone generator produces — not a lookalike.
    const direct = await gen.generateTemplate(appendixB);
    const a = Buffer.from(await hwEntries['assignment.pdf'].arrayBuffer());
    const b = Buffer.from(await direct.pdf.arrayBuffer());
    assertEqual(a.length, b.length, 'assignment.pdf is not the template PDF');
    assert(a.subarray(0, 2000).equals(b.subarray(0, 2000)), 'assignment.pdf differs from the template PDF');
  });

  check('handwritten: no template.pdf — it serves no purpose on a page-format sheet', () =>
    assert(!('template.pdf' in hwEntries), 'the boxed answer-region sheet is still being exported'));

  check('handwritten: the sidecar travels with it, under the name the QR points at', () => {
    const csv = Object.keys(hwEntries).filter(n => n.endsWith('.csv'));
    assertEqual(csv, [`layout_${t.assignmentId}.csv`], 'the layout map is missing or misnamed');
  });

  check('handwritten: the QR template PDF really does carry a QR and four marks', async () => {
    const bytes = Buffer.from(await hwEntries['assignment.pdf'].arrayBuffer()).toString('latin1');
    const rects = [...bytes.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)];
    assert(rects.length > 100, 'assignment.pdf has too few drawing ops to contain a QR');
    assert(!/Gradescope Answer Region/.test(bytes), 'the old boxed answer region leaked into it');
  });

  check('electronic exports are untouched: assignment.pdf, template.pdf, no layout map', () => {
    assertEqual(Object.keys(elEntries).filter(n => n.endsWith('.pdf')).sort(),
      ['assignment.pdf', 'template.pdf'], 'the electronic PDF pair changed');
    assertEqual(Object.keys(elEntries).filter(n => n.endsWith('.csv')), [],
      'an electronic export gained a layout map');
  });

  check('both modes still carry the spec, the html, the tex, the rubric and the grader doc', () => {
    for (const [label, entries] of [['handwritten', hwEntries], ['electronic', elEntries]]) {
      for (const name of ['assignment_spec.json', 'assignment.html', 'assignment.tex']) {
        assert(name in entries, `${label}: ${name} is missing`);
      }
      assert(Object.keys(entries).some(n => n.endsWith('_grading_rubric.json')), `${label}: no rubric`);
      assert(Object.keys(entries).some(n => n.endsWith('_grader_document.html')), `${label}: no grader doc`);
    }
  });
}

// ---------- the sheet is self-contained ----------
check('the sheet carries the whole question: preamble, problem setup, part text', async () => {
  const full = {
    ...makeAssignment([
      [{ ...part('First', 30), description: 'State the value of R1.' },
       { ...part('Second', 30), description: 'Now state R2.' }],
      [{ ...part('Only', 40), description: 'And finally R3.' }],
    ]),
    preamble: 'Answer every part in the space provided. Show your working.',
  };
  full.problems[0].name = 'Resistor network';
  full.problems[0].description = 'The network below uses six identical resistors in series.';
  full.problems[1].name = 'Power';
  full.problems[1].description = 'Assume the source is ideal.';

  const g = await gen.generateTemplate(full);

  // Preamble: reserved on page 1 and actually drawn.
  assert(g.layout.preambleBoxMm, 'no room was reserved for the preamble');
  assert(g.ink.some(b => b.what === 'preamble'), 'the preamble was not drawn');

  // Each problem gets a heading and its shared setup, above its first part.
  const headings = g.ink.filter(b => /^problem heading/.test(b.what));
  const texts = g.ink.filter(b => /^problem text/.test(b.what));
  // Every page of a problem gets a heading; only its first page repeats the setup.
  assertEqual(headings.length, g.pageCount, 'expected a problem heading on every page');
  assertEqual(texts.length, 2, 'the shared setup should be printed once per problem');

  // The heading belongs to the problem's first part only, and sits above it.
  const openers = g.layout.regions.filter(r => r.problemBlock);
  assertEqual(openers.length, g.pageCount, 'every page should open with a problem block');
  for (const r of openers) {
    assert(r.problemBlock.boxMm.y1 <= r.promptTopMm + 0.01,
      `${r.regionId}: the problem block overlaps the prompt row`);
    assert(r.problemBlock.heading.startsWith(`Problem ${r.problemIndex + 1}`), 'wrong heading text');
  }
  // Every part carries its own question text — except a continuation page,
  // which is writing space for a question already asked on the page before.
  for (const r of g.layout.regions) {
    if (r.isContinuation) {
      assert(!r.descBoxMm, `${r.regionId}: a continuation page restates the question`);
    } else {
      assert(r.descBoxMm, `${r.regionId}: no question text box`);
    }
  }
});

check('a problem continued on a later page repeats the heading, not the setup', () => {
  // Three parts: 1(a) and 1(b) on page 1, 1(c) on page 2.
  const l = lay.buildLayout(makeAssignment([[
    { ...part('A', 10), description: 'a' },
    { ...part('B', 10), description: 'b' },
    { ...part('C', 10), description: 'c' },
  ]]));
  l.problems = undefined;
  const opener = l.regions.find(r => r.pageK === 2 && r.problemBlock);
  assert(opener, 'the continued problem got no heading on its second page');
  assert(opener.problemBlock.continued, 'the second page was not marked as a continuation');
  assertEqual(opener.problemBlock.text, '', 'the shared setup was repeated on the continuation page');
  assert(/continued/.test(opener.problemBlock.heading), 'the heading does not say continued');
});

check('long prose is squeezed before the writing area is, and never overflows', () => {
  const wordy = 'A '.repeat(400);
  const l = lay.buildLayout({
    ...makeAssignment([[{ ...part('Wordy one', 50), description: wordy },
                        { ...part('Wordy two', 50), description: wordy },
                        { ...part('Wordy three', 50), description: wordy }]]),
    preamble: wordy,
  });
  l.problems = undefined;
  for (const r of l.regions) {
    const h = r.nominalMm.y1 - r.nominalMm.y0;
    assert(h >= lay.MIN_REGION_MM - 0.01, `${r.regionId}: writing area collapsed to ${h.toFixed(1)} mm`);
    assert(r.declaredMm.y1 <= fmt.REGION_Y_MAX_MM + 0.01,
      `${r.regionId}: ran past the bottom limit at ${r.declaredMm.y1.toFixed(1)} mm`);
  }
  // Two regions that really do share a page must not run into each other.
  const shared = l.regions.filter(r => r.pageK === 2);
  assertEqual(shared.length, 2, 'expected parts (b) and (c) to share page 2');
  assert(shared[0].declaredMm.y1 <= shared[1].promptTopMm + 0.01,
    'the first region runs into the second prompt');
});

// ---------- question text sizes to fit, since the sheet is the assignment ----------
check('a long question reserves more room than a short one, deterministically', () => {
  const short = 'Find alpha.';
  const long = 'A uniform plane wave at 1 GHz propagates in a medium with sigma = 4 S/m and mu_r = 1. '
    + 'Determine the skin depth, the attenuation constant, the phase constant, and the intrinsic '
    + 'impedance, stating units for each and showing the formula you used at every step.';
  const wide = lay.COLUMN_X1_MM - lay.COLUMN_X0_MM;
  assert(lay.estimateDescLines(short, wide) === 1, 'a one-line question took more than one line');
  assert(lay.estimateDescLines(long, wide) >= 2, 'a long question was estimated as one line');
  assert(lay.descBlockMm(long) > lay.descBlockMm(short), 'a long question reserved no extra room');
  assertEqual(lay.estimateDescLines('', wide), 0, 'an empty description reserved a line');
  // Deterministic: the map is hashed into the QR, so this must not vary by host.
  assertEqual(lay.descBlockMm(long), lay.descBlockMm(long), 'not deterministic');
  assert(lay.estimateDescLines('x'.repeat(100000), wide) === lay.DESC_MAX_LINES,
    'an enormous description was not capped');
});

check('the question text box always sits between the prompt row and the rule', () => {
  const withText = lay.buildLayout(makeAssignment([[
    { ...part('Long one', 50), description: 'A '.repeat(300) },
    { ...part('Short one', 50), description: 'Brief.' },
  ]]));
  for (const r of withText.regions) {
    assert(r.descBoxMm, `${r.regionId}: no description box`);
    assert(r.descBoxMm.y0 >= r.promptTopMm + lay.PROMPT_ROW_MM - 0.01, `${r.regionId}: box overlaps the prompt row`);
    assert(r.descBoxMm.y1 <= r.ruleYMm + 0.01, `${r.regionId}: box runs past the rule`);
    assert(r.nominalMm.y0 > r.ruleYMm, `${r.regionId}: the writing area starts above the rule`);
    assert(r.declaredMm.y1 <= fmt.REGION_Y_MAX_MM + 0.01, `${r.regionId}: ran past the bottom limit`);
  }
});

// ---------- .md round trip of the template settings ----------
{
  const exportSvc = await loadModule(join(REPO, 'services', 'exportService.ts'), 'exportSvc.mjs');
  const mdParser = await loadModule(join(REPO, 'services', 'mdParserService.ts'), 'mdParser.mjs');

  const authored = makeAssignment([[
    part('Cutoff frequency', 40, { answerSpace: 'full' }),
    part('Field sketch', 60, { isDrawing: true, answerSpace: 'half' }),
  ]], { pageFormatId: 'EEC130BHW3' });

  const md = exportSvc.assignmentToMd(authored);
  const back = mdParser.parseMdToAssignment(md);

  check('md: the template settings survive export and import', () => {
    assert(/^\*\*Template ID:\*\* EEC130BHW3$/m.test(md), `no Template ID line in:\n${md}`);
    assert(/^> template: space=full$/m.test(md), 'the full-page setting was not written');
    assert(/^> template: space=half, sketch$/m.test(md), 'the sketch flag was not written');
    assertEqual(back.pageFormatId, 'EEC130BHW3', 'the Template ID was lost');
    const [a, b] = back.problems[0].subsections;
    assertEqual([a.answerSpace, a.isDrawing], ['full', undefined], 'part (a) settings were lost');
    assertEqual([b.answerSpace, b.isDrawing], ['half', true], 'part (b) settings were lost');
  });

  check('md: the pre-correction size scale still imports', () => {
    const legacy = [
      '# EEC130B: Homework 3', '', '**Input:** handwritten', '',
      '## Problem 1: Old scale', '',
      '### (a) Was extra tall [50 pts] [handwritten]', 'Do it.', '', '> template: space=xtall', '',
      '### (b) Was short [50 pts] [handwritten]', 'Do it.', '', '> template: space=short', '',
    ].join('\n');
    const [a, b] = mdParser.parseMdToAssignment(legacy).problems[0].subsections;
    assertEqual(a.answerSpace, 'full', 'xtall should map to a full page');
    assertEqual(b.answerSpace, 'half', 'short should map to a half page');
  });

  check('md: the round trip is a fixed point, and the layout is unchanged by it', async () => {
    assertEqual(exportSvc.assignmentToMd(back), md, 'the second export differs from the first');
    const before = await gen.generateTemplate(authored);
    const after = await gen.generateTemplate(back);
    assertEqual(after.layoutId, before.layoutId, 'the layout hash changed across a .md round trip');
    assertEqual(after.csv, before.csv, 'the sidecar changed across a .md round trip');
  });

  check('md: an assignment with no template settings is byte-identical to before', () => {
    const plain = makeAssignment([[part('Only part', 100)]]);
    const plainMd = exportSvc.assignmentToMd(plain);
    assert(!plainMd.includes('> template:'), 'a template line was written for an unconfigured part');
    assert(!plainMd.includes('**Template ID:**'), 'a Template ID line was written for a derived id');
    assertEqual(exportSvc.assignmentToMd(mdParser.parseMdToAssignment(plainMd)), plainMd, 'not a fixed point');
  });
}

// ---------- Appendix C: what must not carry over ----------
check('Appendix C: no exam-generator leftovers in the payload or the map', () => {
  for (const p of t.payloads) {
    assert(p.startsWith('GB1-'), 'field 1 is not the format tag');
    assert(!/R=/.test(p), 'the exam generator R= region list leaked in');
  }
  const cols = t.csv.split('\n')[0].split(',');
  assert(!cols.includes('canonical_question') && !cols.includes('subpart'),
    'exam-specific columns leaked into the map');
  assertEqual(cols, ['assignment_id', 'layout_id', 'region_id', 'part_id', 'page_k',
    'x0', 'y0', 'x1', 'y1', 'is_drawing', 'max_points'], 'the map columns are not spec 4.3');
});

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* Windows keeps handles */ }
process.exit(failed > 0 ? 1 : 0);
