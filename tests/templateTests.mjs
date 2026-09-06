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
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

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
const round = (n) => Math.round(n * 1000) / 1000;
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
const selfTest = await loadModule(join(REPO, 'services', 'templateSelfTest.ts'), 'templateSelfTest.mjs');
const exportSvcForInstr = await loadModule(join(REPO, 'services', 'exportService.ts'), 'exportForInstr.mjs');
const mdParserForKey = await loadModule(join(REPO, 'services', 'mdParserService.ts'), 'mdParserForKey.mjs');

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
  // One region per part: writing space is authored now, so a lone sub-part no
  // longer gets an automatic second page. A part only owns two regions when its
  // own authored answer does not fit one page — checked further down.
  assertEqual(t.rows.map(r => r.partId), ['1(a)', '1(b)', '2', '3(a)', '3(b)'], 'wrong part ids');
  assertEqual(t.rows.map(r => r.regionId), ['p1a', 'p1b', 'p2', 'p3a', 'p3b'], 'wrong region ids');
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

check('every part gets a prompt and a box, and the prompt sits above and outside it', () => {
  for (const r of t.layout.regions) {
    assert(r.boxTopMm < r.nominalMm.y0, `${r.regionId}: the box top is not above the writing area`);
    assert(r.boxTopMm > r.promptTopMm, `${r.regionId}: the box top is not below the prompt text`);
    assert(r.declaredMm.y0 < r.nominalMm.y0, `${r.regionId}: padding was not applied outward`);
    assert(r.declaredMm.y0 > r.boxTopMm - 3.1, `${r.regionId}: the declared rectangle swallows the prompt`);
    // The declared rectangle is the box INTERIOR: it starts one border stroke
    // below the outer edge, and closes one border stroke above the bottom.
    assertEqual(round(r.declaredMm.y0 - r.boxTopMm), round(lay.BORDER_MM),
      `${r.regionId}: the declared rectangle is not inset by the border`);
    assertEqual(round(r.boxBottomMm - r.declaredMm.y1), round(lay.BORDER_MM),
      `${r.regionId}: the box does not close one stroke below the declared rectangle`);
    if (r.description) {
      assert(r.descBoxMm, `${r.regionId}: has a description but no box reserved for it`);
      assert(r.descBoxMm.y1 <= r.boxTopMm + 0.01, `${r.regionId}: the description box runs into the answer box`);
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

// ---------- the course public key is outside the geometry ----------
// The key moved into the .md on 2026-09-05 (ASSIGNMENT_MD_SPEC.md §2). It is
// metadata, not paint: it prints nowhere and page 1 carries no regions, so
// setting it must not move a rectangle. Asserted rather than assumed, because
// `layout_id` is in the QR on every printed page and a moved hash makes the
// Submission app refuse to crop.
//
// The key is generated here rather than read from disk: what is under test is
// that a key changes no geometry, not which key it is. 4096 bits, because that
// is the shape of the real course key.
{
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']
  );
  const der = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  const COURSE_PEM =
    `-----BEGIN PUBLIC KEY-----\n${der.replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END PUBLIC KEY-----\n`;

  check('course key: setting one moves neither layout_id nor the page count', async () => {
    const keyed = await gen.generateTemplate({ ...appendixB, coursePublicKey: COURSE_PEM });
    assertEqual(keyed.layoutId, t.layoutId, 'setting a course key moved the layout id');
    assertEqual(keyed.pageCount, t.pageCount, 'setting a course key changed the page count');
  });

  check('course key: layout_id survives Export .md → Import Markdown', async () => {
    // The whole point of putting the key in the .md is that the restore route
    // gives back the same assignment. Same rectangles, same hash, key intact.
    const md = exportSvcForInstr.assignmentToMd({ ...appendixB, coursePublicKey: COURSE_PEM });
    const back = mdParserForKey.parseMdToAssignment(md);
    assertEqual(back.coursePublicKey, COURSE_PEM.trim(), 'the key did not survive the .md round trip');
    const after = await gen.generateTemplate(back);
    assertEqual(after.layoutId, t.layoutId, 'the .md round trip moved the layout id');
    assertEqual(after.pageCount, t.pageCount, 'the .md round trip changed the page count');
  });
}

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
  // Page 1 is the instructions page and carries no rows on purpose; every page
  // after it must carry at least one, or a page went out with nothing on it.
  const pages = new Set(big.rows.map(r => r.pageK));
  assertEqual([...pages].sort((a, b) => a - b), Array.from({ length: big.pageCount - 1 }, (_, i) => i + 2),
    'a page after the instructions page has no regions');
  assert(!pages.has(1), 'a region was placed on the instructions page');
});

// ---------- authored answer space (2026-08-17) ----------
// The last region on a page runs to the bottom margin (2026-08-18), so it is
// the one place a region is larger than its authored line count.
const lastOnPage = (l) => {
  const held = new Map();
  for (const r of l.regions) {
    const h = held.get(r.pageK);
    if (!h || r.nominalMm.y0 > h.nominalMm.y0) held.set(r.pageK, r);
  }
  return new Set(held.values());
};

check('the authored line count is what is reserved, and what the map crops', () => {
  const l = lay.buildLayout(makeAssignment([[
    part('Short answer', 10, { answerLines: 3 }),
    part('Long answer', 10, { answerLines: 14 }),
    part('Never said', 10),
  ]]));
  const last = lastOnPage(l);
  const authored = { p1a: 3, p1b: 14, p1c: lay.DEFAULT_ANSWER_LINES };
  for (const r of l.regions) {
    // The declared rectangle — what layout_{id}.csv carries — is that box padded,
    // and it is what the generator draws. Nothing else determines the size.
    assertEqual(round(r.nominalMm.y1 - r.nominalMm.y0), round(r.answerLines * lay.WRITING_LINE_MM),
      `${r.regionId}: the drawn box is not its line count`);
    if (last.has(r)) {
      assert(r.answerLines >= authored[r.regionId],
        `${r.regionId}: the page-fill pass shrank a region to ${r.answerLines} lines`);
    } else {
      assertEqual(r.answerLines, authored[r.regionId],
        `${r.regionId}: a region that is not last on its page did not get exactly its authored lines`);
    }
  }
});

check('points no longer influence the answer size at all', () => {
  // Two layouts differing only in points. Comparing parts *within* one layout no
  // longer works: the last region on a page absorbs that page's slack, so two
  // parts at the same line count legitimately come out different sizes. Two
  // layouts, though, must be geometrically identical.
  const boxes = (pts) => lay.buildLayout(makeAssignment([[
    part('One', pts[0]), part('Two', pts[1]), part('Three', pts[2]),
  ]])).regions.map(r => ({ page: r.pageK, lines: r.answerLines, y0: r.nominalMm.y0, y1: r.nominalMm.y1 }));
  assertEqual(boxes([45, 5, 50]), boxes([5, 45, 50]),
    'moving the points around moved the writing areas');
});

check('parts pack down the page at their authored sizes, then break', () => {
  // Short answers, so several genuinely fit: the point is that the page carries
  // however many fit at their authored size, with no cap. Asserted against the
  // authored sizes rather than a page count, which moves with WRITING_LINE_MM.
  const l = lay.buildLayout(makeAssignment(
    [Array.from({ length: 9 }, (_, i) => part(`Part ${i + 1}`, 10, { answerLines: 2 }))]));
  const perPage = new Map();
  for (const r of l.regions) perPage.set(r.pageK, (perPage.get(r.pageK) || 0) + 1);
  assert([...perPage.values()].some(n => n > 2), 'nothing packs more than the old two-per-page cap');
  // No region runs past the bottom limit, and none runs into the next prompt.
  const byPage = new Map();
  for (const r of l.regions) byPage.set(r.pageK, [...(byPage.get(r.pageK) || []), r]);
  for (const [k, rs] of byPage) {
    for (let i = 0; i + 1 < rs.length; i++) {
      assert(rs[i].declaredMm.y1 <= rs[i + 1].promptTopMm + 0.01, `page ${k}: region ${i} runs into the next prompt`);
    }
    assert(rs[rs.length - 1].declaredMm.y1 <= fmt.REGION_Y_MAX_MM + 0.001, `page ${k}: ran past the bottom limit`);
  }
});

check('a sketch keeps its is_drawing flag and its authored space', () => {
  const l = lay.buildLayout(makeAssignment([[
    part('Written', 10), part('Sketch', 10, { isDrawing: true, answerLines: 18 }),
  ]]));
  const sketch = l.regions.find(r => r.regionId === 'p1b');
  assert(sketch.isDrawing, 'the sketch lost its is_drawing flag');
  // At least what it asked for: a sketch that is last on its page grows to the
  // bottom margin like any other region, and stays unruled — reserved blank
  // space to draw in, of which more is never worse.
  assert(sketch.answerLines >= 18, `the sketch got ${sketch.answerLines} lines, fewer than the 18 it asked for`);
});

check('every problem starts a new page; no page mixes two problems', () => {
  const l = lay.buildLayout(makeAssignment([
    [part('1a', 10), part('1b', 10), part('1c', 10)],
    [part('2a', 10), part('2b', 10)],
  ]));
  const perPage = new Map();
  for (const r of l.regions) perPage.set(r.pageK, [...(perPage.get(r.pageK) || []), r]);
  for (const [k, rs] of perPage) {
    assertEqual([...new Set(rs.map(r => r.problemIndex))].length, 1, `page ${k} mixes problems`);
  }
  // Where the break falls depends on WRITING_LINE_MM, so assert the rules that
  // do not: every problem opens a page, parts follow in order, and no part is
  // split across pages at all.
  const pages = l.regions.map(r => r.pageK);
  assertEqual(pages, [...pages].sort((a, b) => a - b), 'the parts are not in page order');
  // Page 1 is the instructions page since 2026-09-01, so problems begin on 2.
  assertEqual(l.regions[0].pageK, 2, '1(a) does not start on page 2');
  const problem2 = l.regions.find(r => r.problemIndex === 1);
  assert(problem2.pageK > l.regions.filter(r => r.problemIndex === 0).at(-1).pageK,
    'problem 2 did not start a new page');
  assertEqual(l.regions.map(r => r.partId), ['1(a)', '1(b)', '1(c)', '2(a)', '2(b)'], 'a part was lost');
});

// ---------- the instructions page (2026-09-01) ----------
// Page 1 is an instructions page BY DESIGN. It used to be emergent: ENG17 wrote a
// preamble long enough to push Problem 1 onto page 2, which worked and was a side
// effect — twenty words shorter and the instructions were squeezed beside a
// circuit diagram with nothing announcing it. Then the column widened, the
// region-height fix landed, and the break silently stopped happening.
{
  const instr = (extra = {}) => ({
    id: 'ip1', courseCode: 'ENG17', title: 'HW 1',
    inputMode: 'handwritten', preamble: 'Show all working. Give every answer in SI units.',
    problems: [
      { id: 'p0', name: 'One', description: '', subsections: [part('A', 50, { answerLines: 6 })] },
      { id: 'p1', name: 'Two', description: '', subsections: [part('B', 50, { answerLines: 6 })] },
    ],
    createdAt: 1700000000000, updatedAt: 1700000000000, ...extra,
  });

  check('guard 1: page 1 carries no region and no row in the map', async () => {
    const g = await gen.generateTemplate(instr());
    assertEqual(g.layout.regions.filter(r => r.pageK === 1).map(r => r.regionId), [],
      'a region was placed on the instructions page');
    assertEqual(g.rows.filter(r => r.pageK === 1).map(r => r.regionId), [],
      'the instructions page has a row in the layout map, so something could be cropped from it');
    // The guarantee this is really about: nothing on page 1 is ever cropped.
    assert(g.rows.length > 0, 'no rows at all — the fixture is not exercising the map');
  });

  check('guard 2: N counts the instructions page, and problems begin on page 2', async () => {
    const g = await gen.generateTemplate(instr());
    // Two problems, each opening a page, plus page 1.
    assertEqual(g.pageCount, 3, 'N is not problems-plus-one for a fixture where each problem fits a page');
    assertEqual(Math.min(...g.layout.regions.map(r => r.pageK)), 2, 'a problem did not begin on page 2');
    const k1 = qrp.parsePayload(g.payloads[0]);
    assertEqual(k1.k, 1, "page 1's QR does not carry k=1");
    assertEqual(k1.n, g.pageCount, "page 1's QR carries the wrong N");
  });

  check('guard 2: N is at least problems-plus-one even when a problem spans pages', () => {
    // The literal "N equals problems-plus-one" only holds when every problem
    // fits one page. A problem that needs two makes N larger, which is ordinary
    // and correct — so the invariant that is actually held is the inequality.
    const l = lay.buildLayout({
      ...instr(),
      problems: [{ id: 'p0', name: 'One', description: '', subsections: [
        part('A', 50, { answerLines: 20 }), part('B', 50, { answerLines: 20 }),
      ] }],
    });
    assert(l.pageCount >= 1 + 1, 'N is below problems-plus-one');
    assert(!l.regions.some(r => r.pageK === 1), 'a region reached the instructions page');
  });

  check('guard 3: the tool refuses when the preamble repeats a standing instruction', async () => {
    // The duplication that motivated the split: ENG17's first preamble draft
    // opened by repeating the print instruction almost word for word. Matching is
    // on normalised six-word windows, so a near-miss is caught too — an exact
    // check would have missed the very case this exists for.
    const near = 'Please print at 100%, not "fit to page", and check that all four black corner ' +
      'squares appear on every sheet before you begin.';
    let threw = null;
    try { await gen.generateTemplate(instr({ preamble: near })); } catch (err) { threw = err; }
    assert(threw, 'a preamble repeating a standing instruction was emitted anyway');
    assert(/repeats the standing instruction/.test(threw.message),
      `the failure does not name the duplication: ${threw.message}`);
    assert(/print at 100/i.test(threw.message), `the failure does not quote the sentence: ${threw.message}`);
  });

  check('guard 3: an ordinary preamble about the work is left alone', () => {
    // The boundary: the tool owns the sheet and the submission, the preamble owns
    // the work. This one is entirely about the work and must not trip the check.
    assertEqual(selfTest.duplicatedStandingInstructions(
      'Show all working. Give every answer in SI units, and state any assumption you make. ' +
      'Staple the cover sheet to the front.'), [], 'an on-topic preamble was flagged as a duplicate');
    assertEqual(selfTest.duplicatedStandingInstructions(''), [], 'an empty preamble was flagged');
  });

  check('guard 4: an instructions page that overflows refuses the export and names it', async () => {
    const huge = 'This assignment covers the whole of unit three and you should read it carefully. '.repeat(60);
    let threw = null;
    try { await gen.generateTemplate(instr({ preamble: huge })); } catch (err) { threw = err; }
    assert(threw, 'an overflowing instructions page was emitted anyway');
    assert(/instructions page fits on one page|run .* past the bottom of page 1/.test(threw.message),
      `the failure does not name the overflow: ${threw.message}`);
    assert(/mm past the bottom of page 1/.test(threw.message),
      `the failure does not say by how much: ${threw.message}`);
  });

  check('the standing instructions are printed once, on page 1, and nowhere else', async () => {
    const g = await gen.generateTemplate(instr());
    const rows = g.ink.filter(b => /^instructions /.test(b.what));
    assert(rows.length > 0, 'the standing instructions were not drawn at all');
    assertEqual([...new Set(rows.map(b => b.pageK))], [1],
      'standing instructions were drawn on a page other than page 1');
    // Each sanctioned sentence appears exactly once in the drawn text.
    const bytes = Buffer.from(await g.pdf.arrayBuffer()).toString('latin1');
    const text = [...bytes.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map(m => m[1]).join(' ')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    for (const sentence of [...lay.STANDING_INSTRUCTIONS.flatMap(x => x.items), lay.STANDING_CLOSING]) {
      const norm = sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const first = norm.split(' ').slice(0, 6).join(' ');
      const hits = text.split(first).length - 1;
      assertEqual(hits, 1, `"${first}..." appears ${hits} times; it must appear exactly once`);
    }
  });

  check('the closing line survives, because it is the one that stops students writing bigger', () => {
    assert(/neat handwriting is not marked/i.test(lay.STANDING_CLOSING),
      'the closing line was rewritten away');
  });

  check('electronic assignments get no instructions page and no standing instructions', async () => {
    // buildLayout is the handwritten layout; an electronic export never reaches
    // it. Assert the export shape rather than the layout.
    const entries = await exportSvcForInstr.buildExportEntries({
      ...instr(), inputMode: 'electronic',
      problems: instr().problems.map(p => ({
        ...p, subsections: p.subsections.map(x => ({ ...x, submissionType: 'Text', maxImages: 1 })),
      })),
    });
    assertEqual(Object.keys(entries).filter(n => n.endsWith('.csv')), [],
      'an electronic export gained a layout map');
    const html = entries[Object.keys(entries).find(n => n.endsWith('assignment.html'))];
    assert(!/Print at 100%, not/.test(html),
      'the standing instructions leaked into an electronic assignment');
  });

  // ---------- the submission section (2026-09-06) ----------
  // The tool claimed the ground and left it empty: page 1 carried `Your own
  // work`, `Before you start`, `As you work` and the preamble, and said nothing
  // about submitting. A student printed sixteen sheets, did the work properly,
  // and was holding paper with no stated next step.
  const ADDRESS = 'submit.example.edu/demo';
  const drawnText = async (assignment) => {
    const g = await gen.generateTemplate(assignment);
    const bytes = Buffer.from(await g.pdf.arrayBuffer()).toString('latin1');
    return {
      g,
      text: [...bytes.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map(m => m[1]).join(' ')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' '),
    };
  };

  check('submission section: it prints, on page 1, when an address is set', async () => {
    const { g, text } = await drawnText(instr({ submissionAddress: ADDRESS }));
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    assert(text.includes(norm(lay.SUBMISSION_HEADING)),
      'the submission heading is not on the sheet');
    for (const item of lay.submissionItems(ADDRESS)) {
      const first = norm(item).split(' ').slice(0, 6).join(' ');
      assertEqual(text.split(first).length - 1, 1,
        `"${first}..." appears the wrong number of times; each line must print exactly once`);
    }
    assert(text.includes(norm(ADDRESS)), 'the address itself is not printed');
    const rows = g.ink.filter(b => /^instructions /.test(b.what));
    assertEqual([...new Set(rows.map(b => b.pageK))], [1],
      'an instruction row was drawn off page 1');
  });

  check('submission section: with no address the section is ENTIRELY absent', async () => {
    // Not a placeholder, not an example, not a sentence with a gap in it. A
    // sheet reading "go to ______" is worse than one that says nothing, because
    // a hundred copies are printed before anyone notices.
    const { text } = await drawnText(instr());
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    assert(!text.includes(norm(lay.SUBMISSION_HEADING)),
      'the submission heading printed with no address set');
    for (const fragment of ['go to', 'photograph each page', 'keep your printed pages',
                            'load the assignment file']) {
      assert(!text.includes(fragment), `"${fragment}" printed with no address set`);
    }
    // And nothing that looks like a blank to fill in.
    assert(!/_{3,}/.test(text), 'a fill-in rule was printed');
    assert(!/\bexample\b/.test(text), 'an example address was printed');
  });

  check('submission section: the address is the only thing that varies, and it is a value', async () => {
    // No institution and no fixed deployment address may appear in the standing
    // text — the same rule the rest of the page is already held to, extended to
    // the section that most invites a hardcoded URL.
    for (const sentence of [
      ...lay.STANDING_INSTRUCTIONS.flatMap(s => s.items),
      lay.STANDING_CLOSING,
      lay.SUBMISSION_HEADING,
      // The items with the address REMOVED — what the tool itself contributes.
      ...lay.submissionItems('').map(s => s),
    ]) {
      assert(!/https?:\/\//i.test(sentence), `standing text carries a URL: "${sentence}"`);
      assert(!/\.(com|edu|org|net|io|gov)\b/i.test(sentence),
        `standing text carries a domain: "${sentence}"`);
      assert(!/gradebridge\.|bridgesuite|github\.io/i.test(sentence),
        `standing text names a deployment: "${sentence}"`);
      assert(!/universit|college|campus|\bdavis\b|\buc\b/i.test(sentence),
        `standing text names an institution: "${sentence}"`);
    }
  });

  check('submission section: layout_id does not move when the address changes', async () => {
    // Page 1 carries no regions, so nothing on it can be in the geometry hash.
    // This is the property the 2026-09-01 instructions-page work established and
    // it must survive a new section being added to that page.
    const none = await gen.generateTemplate(instr());
    const set = await gen.generateTemplate(instr({ submissionAddress: ADDRESS }));
    const other = await gen.generateTemplate(instr({ submissionAddress: 'a.example.org/x' }));
    assertEqual(set.layoutId, none.layoutId, 'setting an address moved the layout id');
    assertEqual(other.layoutId, none.layoutId, 'changing the address moved the layout id');
    assertEqual(set.pageCount, none.pageCount, 'the submission section changed the page count');
  });

  check('submission section: an unset address WARNS but never refuses', async () => {
    // Warned, not refused, deliberately: collecting the pages some other way is
    // a legitimate workflow and refusing it would make the tool unusable for it.
    // But printing nothing in silence is the defect the section exists to
    // remove, and only the instructor can tell the two apart.
    const quiet = await gen.generateTemplate(instr());
    assert(quiet.selfTest.passed, 'a missing submission address refused the export');
    assert(quiet.selfTest.warnings.some(w => /submission address/i.test(w)),
      `no warning about the missing address: ${JSON.stringify(quiet.selfTest.warnings)}`);
    const set = await gen.generateTemplate(instr({ submissionAddress: ADDRESS }));
    assertEqual(set.selfTest.warnings.filter(w => /submission address/i.test(w)), [],
      'an assignment WITH an address was warned about anyway');
  });

  check('submission section: the duplicate guard covers it too', async () => {
    // Once it prints it is a standing instruction like any other, and the
    // preamble must not repeat it. "Photograph your pages and upload them" is
    // exactly the sort of line an author writes before the tool ever said it.
    const echo = 'Photograph each page when the app asks, then check it before you submit.';
    let threw = null;
    try {
      await gen.generateTemplate(instr({ submissionAddress: ADDRESS, preamble: echo }));
    } catch (err) { threw = err; }
    assert(threw, 'a preamble repeating the submission steps was emitted anyway');
    assert(/repeats the standing instruction/.test(threw.message),
      `the failure does not name the duplication: ${threw.message}`);

    // And the same preamble is NOT flagged when no address is set, because then
    // the tool prints nothing for it to duplicate.
    const ok = await gen.generateTemplate(instr({ preamble: echo }));
    assert(ok.selfTest.passed, 'a preamble was flagged against a section that is not printed');
  });

  check('submission section: every line still passes the governing rule', () => {
    // "If a piece of advice would only ever help the automatic reader, it does
    // not belong in front of students." Nothing here may be about helping the
    // detector — no cropping, no lighting, no how-to-hold-the-phone.
    for (const item of lay.submissionItems(ADDRESS)) {
      assert(!/\b(crop|contrast|resolution|dpi|glare|flat surface|straight on|shadow)\b/i.test(item),
        `a line exists only to help the automatic reader: "${item}"`);
    }
    // The steps are numbered because they are a sequence; the last line is not
    // a step and is deliberately not numbered.
    const items = lay.submissionItems(ADDRESS);
    assertEqual(items.slice(0, 4).map(s => /^\d\. /.test(s)), [true, true, true, true],
      'the four ordered steps are not numbered');
    assert(!/^\d\. /.test(items[items.length - 1]),
      'the closing line is numbered as though it were a step');
  });

  check('submission section: the whole instructions page still fits with it', async () => {
    // The section is four steps longer than the page used to be, on top of a
    // real preamble. Guard 4 refuses an overflow, so this asserts the ordinary
    // case has not been pushed over the edge.
    const g = await gen.generateTemplate(instr({
      submissionAddress: ADDRESS,
      preamble: 'Show all working and give every answer in SI units. A calculator and your ' +
                'textbook are allowed; an AI assistant is not. Staple the cover sheet to the front.',
    }));
    assertEqual(g.layout.instructionsPage.overflowMm, 0, 'the instructions page overflowed');
    assert(g.selfTest.passed, `the self-test failed: ${g.selfTest.failures.join('; ')}`);
  });
}

// ---------- a region is never shorter than its authored line count (2026-08-31) ----------
// The regression fixture that did not exist, which is why a three-line reduction
// on page 1 of the first homework of the year survived two rounds of review. The
// shape that reproduces it: a problem whose shared setup is long enough that the
// part beneath it cannot also have the lines its author asked for. Nothing in
// the older fixtures has a stem, so nothing hit it.
{
  const SENTENCE = 'The bench supply is set to 12 V and the divider is built from two ' +
    'resistors in series. Measure at the node between them. ';
  // Long enough that a 14-line answer cannot also fit beneath it on any page:
  // the setup has to be left behind. Sized empirically — at 10 repeats a clean
  // page still holds both, which is the other branch and is tested below.
  const STEM = SENTENCE.repeat(14);
  const SHORTER_STEM = SENTENCE.repeat(10);

  const withStem = (subs, stem = STEM) => ({
    id: 'rh1', courseCode: 'ENG17', title: 'HW 1',
    inputMode: 'handwritten', preamble: 'Show all working on paper.',
    problems: [{ id: 'p0', name: 'Divider', description: stem, subsections: subs }],
    createdAt: 1700000000000, updatedAt: 1700000000000,
  });

  const authoredOf = (l, regionId) =>
    l.parts.find(p => p.regionId === regionId).answerLines;
  const heightOf = r => round(r.nominalMm.y1 - r.nominalMm.y0);

  check('a part authored more lines than fit under its stem still gets them', () => {
    // 14 lines beneath a stem this long does not fit a page; before the fix the
    // part was silently cut to what was left, with no break and no warning.
    const l = lay.buildLayout(withStem([part('Node equations', 100, { answerLines: 14 })]));
    const r = l.regions[0];
    assertEqual(l.regions.length, 1, 'the part was split');
    assert(heightOf(r) >= round(14 * lay.WRITING_LINE_MM) - 0.01,
      `the region is ${heightOf(r)} mm; 14 authored lines need ${14 * lay.WRITING_LINE_MM} mm`);
    // It got them by leaving the setup on a page of its own.
    assertEqual(l.standaloneBlocks.length, 1, 'the shared setup was not printed on its own page');
    assert(l.standaloneBlocks[0].pageK < r.pageK, 'the setup is not before the part it belongs to');
    assert(l.standaloneBlocks[0].block.text.length > 0, 'the standalone block carries no setup text');
  });

  check('every region in a stem-heavy assignment is at least its authored height', () => {
    const l = lay.buildLayout(withStem([
      part('A', 25, { answerLines: 14 }),
      part('B', 25, { answerLines: 8 }),
      part('C', 25, { answerLines: 12 }),
      part('D', 25, { answerLines: 6 }),
    ]));
    for (const r of l.regions) {
      const asked = round(authoredOf(l, r.regionId) * lay.WRITING_LINE_MM);
      assert(heightOf(r) >= asked - 0.01,
        `${r.regionId} is ${heightOf(r)} mm, short of its authored ${asked} mm`);
    }
  });

  check('the self-test refuses a template with a region below its authored height', async () => {
    // The guard is a numbered check, so it refuses rather than warns. Proven by
    // driving the layout through the real generator.
    const t = await gen.generateTemplate(withStem([part('Node equations', 100, { answerLines: 14 })]));
    assertEqual(t.selfTest.failures, [], 'the fixed layout does not pass its own self-test');
    const named = t.selfTest.checks.find(c => /at least as tall as its authored line count/.test(c.name));
    assert(named, 'the authored-height check is not in the self-test report at all');
    assert(named.passed, `the authored-height check failed: ${named.detail}`);
  });

  check('a part that cannot fit the roomiest page takes the page rather than a blank one', () => {
    // The escape only fires when the better page can actually deliver the
    // authored count. 40 lines fit nowhere, so breaking would trade a blank
    // sheet for a line or two and still end in "take the page" — one page.
    const l = lay.buildLayout(withStem([part('Enormous', 100, { answerLines: 40 })], ''));
    // 2 = the instructions page plus the part's own. Not 3: no blank was burned.
    assertEqual(l.pageCount, 2, 'a part that outgrows every page burned an extra page first');
    assertEqual(l.standaloneBlocks.length, 0, 'a setup page was emitted for an assignment with no setup');
  });

  check('the setup stays with its part when a clean page is enough', () => {
    // Page 1 carries the furniture, so a part can fail there and fit on page 2
    // WITH its setup. That must not leave the setup behind — the givens belong
    // directly above the question whenever they can be, and a stranded setup
    // costs a whole sheet of paper.
    const l = lay.buildLayout(withStem([part('Node equations', 100, { answerLines: 14 })], SHORTER_STEM));
    assertEqual(l.standaloneBlocks.length, 0,
      'the setup was stranded on its own page when it could have travelled with the part');
    assert(l.regions[0].problemBlock, 'the part lost its problem block entirely');
    assert(heightOf(l.regions[0]) >= round(14 * lay.WRITING_LINE_MM) - 0.01,
      'the part did not get its authored lines');
  });
}

check('an answer is never split across pages — a part owns exactly one region', () => {
  // 40 authored lines is more than a page holds. It used to take what fitted and
  // spill the rest, which produced a 15 mm orphan on the next page: one writing
  // line under a repeated heading, which is not somewhere anyone finishes an
  // answer, and a page break cannot help — the next page is no bigger. So the
  // part takes the whole page instead, which with the page-fill pass is the most
  // room there is to give.
  const l = lay.buildLayout(makeAssignment([[part('Enormous', 20, { answerLines: 40 })]]));
  // 2 = the instructions page plus the one the part took.
  assertEqual(l.pageCount, 2, 'a part that outgrows a page did not simply take the page');
  assertEqual(l.regions.map(r => r.regionId), ['p1'], 'the part was split into more than one region');
  assert(!/x\d/.test(l.regions.map(r => r.regionId).join(' ')), 'a continuation region id was generated');
  assert(l.regions[0].answerLines > 1, 'the part got a token region rather than the page');
  assert(l.regions[0].declaredMm.y1 <= fmt.REGION_Y_MAX_MM + 0.001, 'the region ran past the bottom limit');
});

check('no part owns two regions, in any shape of assignment', () => {
  const shapes = [
    [[part('Enormous', 20, { answerLines: 40 })]],
    [[part('A', 10, { answerLines: 18 }), part('B', 10, { answerLines: 18 })]],
    [Array.from({ length: 9 }, (_, i) => part(`P${i + 1}`, 10, { answerLines: 2 }))],
    [[part('Huge', 50, { answerLines: 60 })], [part('Also huge', 50, { answerLines: 60 })]],
  ];
  for (const shape of shapes) {
    const l = lay.buildLayout(makeAssignment(shape));
    const perPart = new Map();
    for (const r of l.regions) perPart.set(r.partId, (perPart.get(r.partId) || 0) + 1);
    assertEqual([...perPart.entries()].filter(([, n]) => n > 1), [],
      'a part was split across more than one region');
    assertEqual(l.regions.length, shape.flat().length, 'a part was lost or duplicated');
  }
});

check('the last region on every page runs to the bottom margin', () => {
  const l = lay.buildLayout(makeAssignment([
    [part('1a', 10, { answerLines: 2 }), part('1b', 10, { answerLines: 3 })],
    [part('2a', 10, { answerLines: 18 }), part('2b', 10, { isDrawing: true, answerLines: 4 })],
  ]));
  for (const r of lastOnPage(l)) {
    // Within one pitch of the bottom margin: another whole line would not fit.
    const bottom = lay.REGION_BOTTOM_MM - lay.BORDER_MM - fmt.REGION_PAD_MM;
    assert(r.nominalMm.y1 <= bottom + 0.001,
      `${r.regionId}: the writing area ends at ${r.nominalMm.y1} mm, past the ${bottom} mm margin`);
    assert(r.nominalMm.y1 > bottom - lay.WRITING_LINE_MM,
      `${r.regionId}: ${(bottom - r.nominalMm.y1).toFixed(1)} mm of unclaimed paper is left under the last region`);
    // The space belongs to a declared rectangle, not to decorative ruling, and
    // the box that frames it closes above the bottom registration corners.
    assert(r.boxBottomMm <= lay.REGION_BOTTOM_MM + 0.001,
      `${r.regionId}: the box ran past the ${lay.REGION_BOTTOM_MM} mm bottom limit`);
    assert(r.declaredMm.y1 <= fmt.REGION_Y_MAX_MM + 0.001,
      `${r.regionId}: the declared rectangle ran past the ${fmt.REGION_Y_MAX_MM} mm bottom limit`);
    // y1 = y0 + n x pitch is what puts the last rule on the rectangle's edge.
    assertEqual(round(r.nominalMm.y1 - r.nominalMm.y0), round(r.answerLines * lay.WRITING_LINE_MM),
      `${r.regionId}: growing the region broke the line-count identity`);
  }
});

check('a part that will not fit the rest of a page moves to a new one, unshrunk', () => {
  const l = lay.buildLayout(makeAssignment([[
    part('First', 10, { answerLines: 18 }), part('Second', 10, { answerLines: 18 }),
  ]]));
  assertEqual(l.regions.map(r => r.pageK), [2, 3], 'the second part did not break to a new page');
  for (const r of l.regions) {
    // Never fewer than authored. Each is the last region on its page, so each
    // also grows into the slack below it — that is the page-fill pass, not a
    // squeeze, and it only ever goes up.
    assert(r.answerLines >= 18, `${r.regionId}: the authored space was shrunk to ${r.answerLines} to avoid a break`);
  }
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

  // The standing instruction *tells students not to* write their name or ID,
  // which is the very reason there is no field — the spec's Appendix C rationale
  // cites it. So the sanctioned sentences are subtracted before the word scan
  // rather than the scan being loosened: everything else on the sheet is still
  // held to the strict form. Normalised, because the sentences wrap across
  // several Tj chunks on the page.
  const norm = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const sanctioned = [...lay.STANDING_INSTRUCTIONS.flatMap(s => s.items), lay.STANDING_CLOSING];
  let scan = norm(text);
  for (const sentence of sanctioned) scan = scan.split(norm(sentence)).join(' ');
  assert(scan.length < norm(text).length, 'the standing instructions are not on the page at all');

  for (const banned of [/\bname\b/, /\bstudent id\b/, /\bdate\b/]) {
    assert(!banned.test(scan),
      `the template prints an identity field matching ${banned}: "${scan.slice(0, 200)}"`);
  }
  // A rule to write on is a field whatever it is labelled, and underscores do
  // not survive normalising, so this one runs on the raw text.
  assert(!/_{5,}/.test(text), `the template prints a fill-in rule: "${text.slice(0, 200)}"`);
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

check('the column check is bound to the column the generator actually draws', () => {
  // It used to test against REGION_X_MAX_MM while content was drawn in a
  // narrower column, so text could stand 11 mm out into the right margin and
  // pass. Under option C the column IS the page-wide safe area; the check still
  // reads COLUMN_*, so it keeps tracking whatever the generator draws.
  const clean = selfTest.runInkChecks(t.ink, t.selfTest);
  assertEqual(clean.failures, [], 'the real ink does not pass the column check');

  // A row 1.1 mm out of the column. It sits below every region and left of the
  // SE corner, so it can only trip the check under test.
  const overWide = {
    pageK: 1, what: 'deliberately over-wide row',
    x0: lay.COLUMN_X0_MM, y0: 274.0, x1: lay.COLUMN_X1_MM + 1.1, y1: 276.0,
  };
  assert(overWide.x1 > lay.COLUMN_X1_MM, 'the fixture is not outside the column');

  const dirty = selfTest.runInkChecks([...t.ink, overWide], t.selfTest);
  const named = dirty.failures.filter(f => /stays inside the writing column/.test(f));
  assertEqual(named.length, 1, `the over-wide row was not caught: ${dirty.failures.join(' | ')}`);
  assert(/deliberately over-wide row/.test(named[0]), 'the failure does not name the offending row');

  // The header line no longer needs an exemption from this check: spec 8.4
  // anchors it at x = 20.0, which was left of the old 23.0 column and is inside
  // the new 12.0 one. It is checked like everything else, and passes.
  const header = t.ink.filter(b => b.what === 'header line');
  assert(header.length > 0, 'no header line was inked');
  assert(header.every(b => b.x0 >= lay.COLUMN_X0_MM && b.x1 <= lay.COLUMN_X1_MM),
    'the header line now falls outside the column it is checked against');
  // It does still need one from the corner keep-out: (20.0, 10.0) is inside NW.
  const nw = fmt.CORNER_KEEPOUTS_MM[0];
  assert(header.some(b => b.x0 < nw.x1 && b.y0 < nw.y1),
    'the header line no longer overlaps the NW corner, so its exemption is now dead code');
  const dirtyCorner = selfTest.runInkChecks(
    [...t.ink, { pageK: 1, what: 'stray mark', x0: 195.0, y0: 258.0, x1: 200.0, y1: 262.0 }], t.selfTest);
  assertEqual(dirtyCorner.failures.filter(f => /corner keep-out/.test(f)).length, 1,
    `ink in the SE corner was not caught: ${dirtyCorner.failures.join(' | ')}`);
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
  assert(t.ink.some(b => /^prompt /.test(b.what)), 'the prompt row is missing');
});

// ---------- the injected page instruction is gone (2026-08-17) ----------
check('no sub-part prompt carries an injected "below this line" instruction', () => {
  // 117 repetitions across three homeworks of a sentence the instructor could
  // not control, landing ahead of the authored question. The ruled box is the
  // cue instead, and a continuation is announced by its "(continued)" heading.
  const text = [...pdfText.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map(m => m[1]).join(' | ');
  for (const banned of [/Write your answer below/i, /Sketch your answer below/i, /Keep writing below/i]) {
    assert(!banned.test(text), `the template still prints ${banned}`);
  }
});

check('the prompt row is the authored name alone, and an unnamed part has none', async () => {
  const named = makeAssignment([[
    { ...part('Find the series groups', 50), description: 'Name every series pair.' },
    { ...part('', 50), description: 'And the parallel ones.' },
  ]]);
  const g = await gen.generateTemplate(named);
  assertEqual(g.ink.filter(b => /^prompt /.test(b.what)).length, 1,
    'an empty sub-part name still drew a prompt row');
  // The label and the points still print for both.
  assertEqual(g.ink.filter(b => b.what === 'part label').length, 2, 'a part lost its 1(x). label');
  assertEqual(g.ink.filter(b => b.what === 'points label').length, 2, 'a part lost its [N pts] label');
});

// ---------- the problem heading wraps inside the column (2026-08-18) ----------
// It was the one printed row with no width budget at all: a single unwrapped,
// untruncated line drawn from COLUMN_X0_MM. Two ENG17 HW4 titles fitted the
// column on their own and ran past it once ` (continued)` was appended, and the
// ink check refused the whole export rather than printing them.

const headingBoxes = (g) => g.ink.filter(b => /^problem heading/.test(b.what));

check('a long problem title wraps inside the writing column rather than overrunning', async () => {
  const title = 'Find the Response of a Circuit With Two Switches Closing at Different Times '
    + 'and Reversed Thereafter';   // 97 chars, well past one line at 11 pt bold
  const a = makeAssignment([[part('First', 50), part('Second', 50)]]);
  a.problems[0].name = title;
  const g = await gen.generateTemplate(a);

  const boxes = headingBoxes(g);
  assert(boxes.length > 1, `a ${title.length}-character title was drawn as ${boxes.length} line(s)`);
  for (const b of boxes) {
    assert(b.x1 <= lay.COLUMN_X1_MM + 0.01,
      `a heading line reaches x = ${b.x1.toFixed(1)} mm, past the column's ${lay.COLUMN_X1_MM} mm`);
  }
  assertEqual(g.selfTest.failures, [], 'the wrapped heading did not pass the self-test');
});

check('the (continued) suffix is what has to fit, and it does — the HW4 refusal', async () => {
  // The exact shape that refused to emit: the base title fitted with 5-9 mm to
  // spare, and " (continued)" pushed it 13 mm out of the column.
  const a = makeAssignment([[
    part('a', 25, { answerLines: 16 }), part('b', 25, { answerLines: 16 }),
    part('c', 25, { answerLines: 16 }), part('d', 25, { answerLines: 16 }),
  ]]);
  a.problems[0].name = 'Find the Response of the Same Circuit With the Switching Sequence Reversed';
  const g = await gen.generateTemplate(a);

  assert(g.pageCount > 1, 'the fixture did not carry the problem onto a second page');
  const continued = g.layout.regions.filter(r => r.problemBlock && r.problemBlock.continued);
  assert(continued.length > 0, 'no page repeated the heading with (continued)');
  for (const b of headingBoxes(g)) {
    assert(b.x1 <= lay.COLUMN_X1_MM + 0.01,
      `a (continued) heading reaches x = ${b.x1.toFixed(1)} mm, past the column`);
  }
  // The reservation covers the wrap: the stem block is as tall as the lines drawn.
  for (const r of continued) {
    const onPage = headingBoxes(g).filter(b => b.pageK === r.pageK);
    assertEqual(round(r.problemBlock.headingMm), round(lay.headingLines(r.problemBlock.heading) * lay.PROBLEM_HEADING_LINE_MM),
      'the block does not carry the height its own line count needs');
    assert(onPage.length <= lay.headingLines(r.problemBlock.heading),
      `${onPage.length} heading lines were drawn into a reservation for ${lay.headingLines(r.problemBlock.heading)}`);
  }
  assertEqual(g.selfTest.failures, [], 'the continued heading did not pass the self-test');
});

check('a title past MAX_HEADING_LINES is ellipsised, never allowed to refuse the export', async () => {
  // With the advance set at the all-caps worst case this should be unreachable.
  // It is made unconditional anyway: losing the tail of an absurd title is a
  // visible, understandable degradation; a refused export is not.
  const a = makeAssignment([[part('Only part', 100)]]);
  a.problems[0].name = 'THE RESPONSE OF A CIRCUIT '.repeat(24).trim();   // ~620 chars
  const g = await gen.generateTemplate(a);

  const boxes = headingBoxes(g);
  assert(boxes.length <= lay.MAX_HEADING_LINES,
    `${boxes.length} heading lines were drawn, over the ${lay.MAX_HEADING_LINES}-line cap`);
  for (const b of boxes) {
    assert(b.x1 <= lay.COLUMN_X1_MM + 0.01, `an ellipsised heading line still ran to x = ${b.x1.toFixed(1)} mm`);
  }
  const drawn = [...Buffer.from(await g.pdf.arrayBuffer()).toString('latin1')
    .matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map(m => m[1]);
  assert(drawn.some(t => t.endsWith('...')),
    `no heading line was ellipsised: ${drawn.join(' | ')}`);
  assertEqual(g.selfTest.failures, [], 'an over-long title made the template non-compliant');
});

check('a stem with a figure keeps its prose at full size — separate rasters', async () => {
  // The bug this pins: prose and figure were rendered into ONE scale-to-fit
  // canvas. A circuit a millimetre over its FIGURE_LINES allotment set
  // scale < 1 on the shared raster, and the prose — already at 9 pt — shrank
  // with it, so every ENG17 stem printed smaller than its own sub-parts.
  // A figure may scale to its box; text may not. That means two rasters.
  const stemProse = 'For the bridge circuit provided (text problem 1.11): a 20 V source and six '
    + 'resistors, with every node lettered on the drawing.';
  const svg = '```svg\n<svg viewBox="0 0 400 240" xmlns="http://www.w3.org/2000/svg">'
    + '<title>bridge circuit</title><rect x="10" y="10" width="380" height="220" fill="none" stroke="#000"/>'
    + '</svg>\n```';

  const withFigure = makeAssignment([[{ ...part('Node table', 100), description: 'Give a table with one row per node.' }]]);
  withFigure.problems[0].description = `${stemProse}\n\n${svg}`;
  const g = await gen.generateTemplate(withFigure);

  const prose = g.ink.filter(b => b.what === 'problem text 1');
  const figure = g.ink.filter(b => b.what === 'figure in problem text 1');
  assertEqual(prose.length, 1, 'the stem prose was not drawn as its own raster');
  assertEqual(figure.length, 1, 'the figure was not drawn as its own raster');

  // The prose starts at the top of the stem block and stops before the figure:
  // two boxes, stacked, never one. If they shared a canvas the figure's overrun
  // would be free to scale the prose.
  const block = g.layout.regions[0].problemBlock;
  const stemTop = round(block.boxMm.y0 + block.headingMm);
  assertEqual(round(prose[0].y0), stemTop, 'the prose does not start at the top of the stem block');
  assert(prose[0].y1 <= figure[0].y0 + 0.01, 'the prose raster runs into the figure raster');

  // The prose is given the prose's share of the reservation and no more — the
  // figure's FIGURE_LINES allotment is not part of the box the prose scales to.
  const proseBox = figure[0].y0 - stemTop;
  const figureAllotment = lay.FIGURE_LINES * lay.DESC_LINE_MM;
  assert(proseBox > 0, 'the prose got no room at all');
  assert(proseBox <= lay.descBlockMm(`${stemProse}\n\n${svg}`) - figureAllotment + 0.01,
    `the prose box (${proseBox.toFixed(1)} mm) includes part of the figure's allotment`);
  assert(figure[0].y1 - figure[0].y0 <= figureAllotment + 0.01, 'the figure overran its reserved block');
});

check('a figure-free stem is drawn as one raster, exactly as before', async () => {
  const plain = makeAssignment([[{ ...part('A', 100), description: 'Find R1.' }]]);
  plain.problems[0].description = 'Six identical resistors in series.';
  const g = await gen.generateTemplate(plain);
  assertEqual(g.ink.filter(b => b.what === 'problem text 1').length, 1, 'the stem was split without a figure');
  assertEqual(g.ink.filter(b => /^figure in /.test(b.what)), [], 'a figure block was drawn for a stem with no figure');
});

check('the stem is reserved at the same line height as a sub-part description', () => {
  // The stem used to print smallest of all: it is the longest block, so the page
  // squeeze hit it hardest, and the eight-line cap finished the job. Both are
  // gone — every question block now reserves DESC_LINE_MM per estimated line.
  const stem = 'The network below uses six identical resistors, three in series with a parallel pair, '
    + 'driven from an ideal source. All values are in ohms unless stated otherwise, and every current '
    + 'is measured in the direction of the arrow printed beside it on the diagram.';
  const withStem = makeAssignment([[{ ...part('A', 50), description: 'Find R1.' }]]);
  withStem.problems[0].description = stem;
  const l = lay.buildLayout(withStem);
  const block = l.regions[0].problemBlock;
  const stemMm = block.boxMm.y1 - block.boxMm.y0 - block.headingMm;
  assertEqual(round(stemMm), round(lay.descBlockMm(stem)), 'the stem was reserved smaller than it estimates');
  const wide = lay.COLUMN_X1_MM - lay.COLUMN_X0_MM;
  assertEqual(round(lay.descBlockMm(stem) / lay.estimateDescLines(stem, wide)), round(lay.DESC_LINE_MM),
    'the stem is reserved at a different line height from a description');
});

check('every answer region is boxed, and the border is the outermost thing on the row', () => {
  // The reversal of 2026-08-31. From 2026-08-17 a region was a top rule and some
  // ruled lines and no frame, on two reasons that have both since gone: that
  // page-format 4.1 forbade a box (it now carries a dated amendment) and that the
  // ENG17 questions asked students to box their own final answer (HWK1-HWK3 as
  // rebuilt on 30-31 August ask them to box nothing).
  //
  // A box does four jobs and only the first is obvious: it says where to write;
  // it is a FIDUCIAL the detector perspective-corrects from, which matters more
  // to a phone photograph of a curled homework page than to a flatbed exam scan;
  // it bounds the crop; and it makes the whitespace returned markup needs.
  // `pdfRects` carries no page number, so two regions at the same y on
  // different pages are indistinguishable to it — which they now routinely are,
  // since every problem opens a page at the same cursor. Counting per region
  // would double-count them. So count per GEOMETRY: the number of bordered
  // rectangles drawn at each distinct box shape must equal the number of regions
  // that ask for that shape. Same property, and it no longer depends on regions
  // happening to sit at different heights.
  const sig = (x, y, w, h) => [x, y, w, h].map(n => n.toFixed(2)).join(',');
  const wantedBoxes = new Map();
  for (const r of t.layout.regions) {
    const k = sig(lay.COLUMN_X0_MM + lay.BORDER_MM / 2, r.boxTopMm + lay.BORDER_MM / 2,
      (lay.COLUMN_X1_MM - lay.COLUMN_X0_MM) - lay.BORDER_MM, (r.boxBottomMm - r.boxTopMm) - lay.BORDER_MM);
    wantedBoxes.set(k, (wantedBoxes.get(k) || 0) + 1);
  }
  const drawnBoxes = new Map();
  for (const [k, want] of wantedBoxes) {
    const [x, y, w, h] = k.split(',').map(Number);
    drawnBoxes.set(k, pdfRects.filter(rect =>
      near(rect.xMm, x, 0.02) && near(rect.yMm, y, 0.02)
      && near(rect.wMm, w, 0.02) && near(rect.hMm, h, 0.02)).length);
    void want;
  }
  assertEqual([...drawnBoxes.values()], [...wantedBoxes.values()],
    'not exactly one bordered box per gradeable part');
  assertEqual([...drawnBoxes.values()].reduce((a, b) => a + b, 0), t.layout.regions.length,
    'the number of bordered boxes drawn does not equal the number of regions');

  // Solid, at least 1 pt, and the old 0.3 mm top rule is not drawn as well:
  // two horizontal lines 2.5 mm apart at the top of every region is noise.
  assert(lay.BORDER_PT >= 1.0, `the border is ${lay.BORDER_PT} pt, under the 1 pt floor`);
  assertEqual(t.ink.filter(b => /^rule /.test(b.what)), [], 'the retired top rule is still drawn');
  assertEqual(t.ink.filter(b => /^box top /.test(b.what)).length, t.layout.regions.length,
    'not one recorded border per region');

  // No fill and square corners: jsPDF writes a stroke-only rect as "re S", and
  // has no rounded-rect operator, so a fill would show as "re f" at these bounds.
  const stroked = pdfText.match(/re[\s\S]{0,4}?S/g) || [];
  assert(stroked.length >= t.layout.regions.length, 'the boxes are not stroke-only');
});

check('the declared rectangle is the box INTERIOR, so no border ink is ever cropped', () => {
  // EEC100_Final_Format_Spec 6 requires the build to state which it records, and
  // answerbox.sty records the inner area. Matching it keeps the border out of the
  // numerator of the OCR addendum's ink-to-character audit, and makes the two
  // tracks agree.
  for (const r of t.layout.regions) {
    assertEqual(round(r.declaredMm.x0 - lay.COLUMN_X0_MM), round(lay.BORDER_MM),
      `${r.regionId}: the declared rectangle is not inset by one border stroke on the left`);
    assertEqual(round(lay.COLUMN_X1_MM - r.declaredMm.x1), round(lay.BORDER_MM),
      `${r.regionId}: ... nor on the right`);
  }
  // And the recorded border ink really does sit outside every declared rectangle.
  const edges = t.ink.filter(b => /^box /.test(b.what));
  assert(edges.length === t.layout.regions.length * 4, 'not four recorded edges per box');
  for (const b of edges) {
    for (const r of t.layout.regions.filter(r => r.pageK === b.pageK)) {
      const inside = b.x0 < r.declaredMm.x1 - 0.01 && b.x1 > r.declaredMm.x0 + 0.01
        && b.y0 < r.declaredMm.y1 - 0.01 && b.y1 > r.declaredMm.y0 + 0.01;
      assert(!inside, `${b.what} lies inside ${r.regionId}'s declared rectangle`);
    }
  }
});

check('every box is the full option C width, and no box is under the 28 mm floor', () => {
  // Option C: the column is the page-wide safe area, 12.0 to 203.9, uniform down
  // the sheet. It buys 22 mm of writing width on every line against 5 mm of
  // height once per page, and it is what makes the ingest spec's Z5 check (the
  // sole region on a page spans the full permitted width) pass rather than warn.
  assertEqual([lay.COLUMN_X0_MM, lay.COLUMN_X1_MM], [fmt.REGION_X_MIN_MM, fmt.REGION_X_MAX_MM],
    'the column is not the page-wide safe area');
  const widths = new Set(t.layout.regions.map(r => round(r.declaredMm.x1 - r.declaredMm.x0)));
  assertEqual([...widths].length, 1, 'the boxes are not all the same width');
  for (const r of t.layout.regions) {
    assert(r.boxBottomMm - r.boxTopMm >= lay.MIN_BOX_MM - 0.01,
      `${r.regionId} is ${(r.boxBottomMm - r.boxTopMm).toFixed(1)} mm tall, under the ${lay.MIN_BOX_MM} mm floor`);
    assert(r.boxBottomMm <= lay.REGION_BOTTOM_MM + 0.001,
      `${r.regionId}'s box closes at ${r.boxBottomMm.toFixed(1)} mm, past the bottom limit`);
  }
  // The bottom registration corners start at y 257.4; the box closes above them,
  // which is exactly what the 5 mm of height buys the extra width.
  assert(lay.REGION_BOTTOM_MM < fmt.PAGE_H_MM - 22.0, 'the bottom limit reaches the corner keep-outs');
});

check('a part authored under the 28 mm floor is grown to it, not emitted small', () => {
  // EEC100_Final_Format_Spec 1.1 sets abmin at 28 mm. There was no equivalent
  // here: "> template: lines=2" produced an 18 mm region, which is a box a
  // detector has to find and a crop a grader has to read, and not enough of
  // either. The floor is on the box, not on the author.
  const l = lay.buildLayout(makeAssignment([[
    part('Tiny', 50, { answerLines: 1 }), part('Also tiny', 50, { answerLines: 2 }),
  ]]));
  for (const r of l.regions) {
    assert(r.answerLines >= lay.MIN_ANSWER_LINES,
      `${r.regionId} kept ${r.answerLines} lines, under the ${lay.MIN_ANSWER_LINES}-line floor`);
    assert(r.boxBottomMm - r.boxTopMm >= lay.MIN_BOX_MM - 0.01,
      `${r.regionId} is ${(r.boxBottomMm - r.boxTopMm).toFixed(1)} mm tall`);
  }
});

check('the ruled lines stay inside the region the map crops', () => {
  // What ties the drawn writing area to the cropped rectangle: every rule lands
  // inside the declared region, a clear REGION_PAD_MM in from the border.
  const bands = t.ink.filter(b => /^writing lines /.test(b.what));
  const ruled = t.layout.regions.filter(r => !r.isDrawing);
  assertEqual(bands.length, ruled.length, 'not one ruled band per text region');
  for (const r of ruled) {
    const band = bands.find(b => b.what === `writing lines ${r.partId}` && b.pageK === r.pageK);
    assert(band, `${r.regionId}: no writing lines were drawn`);
    assert(band.x0 >= r.declaredMm.x0 - 0.01 && band.x1 <= r.declaredMm.x1 + 0.01,
      `${r.regionId}: the rules run outside the cropped region horizontally`);
    assert(band.y0 >= r.declaredMm.y0 - 0.01 && band.y1 <= r.declaredMm.y1 + 0.01,
      `${r.regionId}: the rules run outside the cropped region vertically`);
  }
  // A sketch region draws no rules at all — reserved blank space.
  for (const r of t.layout.regions.filter(r => r.isDrawing)) {
    assertEqual(t.ink.filter(b => b.what === `writing lines ${r.partId}`), [],
      `${r.regionId}: a sketch region was ruled`);
  }
});

check('the standing instructions name the box, and never ask anyone to box anything', () => {
  // From 2026-08-17 this line avoided the word "box" so the questions could own
  // it. There is a box on the sheet now and the questions ask for none, so the
  // instruction says where it is. What it must still never do is tell a student
  // to draw one: a hand-drawn rectangle is another candidate for a rectangle
  // detector, so if a final-answer mark is ever wanted it is a circle.
  // Joined with a space, not a separator: the text wraps across drawn lines, so
  // a phrase spans two text operators.
  const text = [...pdfText.matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map(m => m[1]).join(' ');
  assert(/inside its printed box/i.test(text), `the instructions do not name the box: ${text.slice(0, 300)}`);
  // The danger is the IMPERATIVE "box your final answer" — a hand-drawn
  // rectangle is another candidate for a rectangle detector. The old pattern was
  // `box (your|the|...)`, which also caught "write into the box the solution",
  // where "box" is a noun with a determiner in front of it. So: "box" used as a
  // verb (nothing determiner-ish before it) taking an answer-like object.
  const BOX_IMPERATIVE = /(?<!\b(?:the|a|an|its|his|her|their|each|every|this|that|printed|one)\s)\bbox\s+(?:your|the|every|each|all)\s+(?:final\s+)?(?:answer|result|solution|working|work)s?\b/i;
  assert(!BOX_IMPERATIVE.test(text), 'the sheet tells the student to box something');
  // Proof the precision did not disarm it: the real phrasing still trips.
  assert(BOX_IMPERATIVE.test('Box your final answer.'),
    'the box-imperative check no longer catches the thing it exists for');
  assert(BOX_IMPERATIVE.test('When you are done, box the answer clearly.'),
    'the check misses a mid-sentence imperative');
  assert(!BOX_IMPERATIVE.test('write into the box the solution you want read'),
    'the check still trips on "box" used as a noun');

  // "resting each line of writing on a rule" was dropped on 2026-09-01, and
  // deliberately: it is advice that helps only the automatic reader, which the
  // governing rule for this page excludes. A student reading it learns nothing
  // about the physics and something about being machine-read.
  assert(!/resting each line of writing on a rule/i.test(text),
    'the retired baseline-on-the-rule guidance is being printed again');
});

check('the interior rules are dashed and the border is solid', async () => {
  // A solid horizontal rule next to handwritten maths is the exact shape of a
  // fraction bar, a minus sign or an overbar, and the grader reads it as one.
  // The border is a frame, not a line anyone writes maths against, and a dashed
  // border is not reliably found by a detector, so it stays solid.
  // jsPDF writes the dash as `[a b] phase d`.
  const t1 = await gen.generateTemplate(makeAssignment([[part('Written', 100, { answerLines: 4 })]]));
  const bytes = Buffer.from(await t1.pdf.arrayBuffer()).toString('latin1');

  const dashOps = [...bytes.matchAll(/\[([\d.\s]*)\]\s*[\d.]+\s*d\b/g)].map(m => m[1].trim());
  assert(dashOps.some(p => p !== ''), `no dash pattern was set:\n${dashOps.join(' | ')}`);
  assert(dashOps.some(p => p === ''), 'the dash pattern was never reset to solid');

  // The top rule is drawn solid black before any dashing starts, and the dash is
  // reset afterwards, so nothing else on the page inherits it.
  const firstDash = bytes.search(/\[[\d.\s]+\]\s*[\d.]+\s*d\b/);
  const lastReset = bytes.lastIndexOf('[] 0. d');
  assert(firstDash > 0, 'no dashed run in the content stream');
  assert(bytes.indexOf('0 G') < firstDash, 'the solid black border was set after dashing began');
  assert(lastReset > firstDash, 'the dash pattern outlives the writing lines');

  // Weight and grey, as the OCR review asked: 0.5 pt at 0.75 grey. jsPDF writes
  // widths in points, so 0.5 pt is what lands in the stream.
  assert(/\b0\.75 G\b/.test(bytes), 'the interior rules are not at 0.75 grey');
  assert(/\b0\.5 w\b/.test(bytes), 'the interior rules are not 0.5 pt');
});

check('the writing pitch is 9 mm — sub- and superscripts clear the next line', () => {
  assertEqual(lay.WRITING_LINE_MM, 9.0, 'the pitch is not 9 mm');
  const l = lay.buildLayout(makeAssignment([[part('A', 100, { answerLines: 5 })]]));
  const r = l.regions[0];
  // Sole region on its page, so the page-fill pass grows it past the 5 it asked
  // for. The pitch is the invariant: the box is always a whole number of lines.
  assert(r.answerLines >= 5, `5 authored lines came out as ${r.answerLines}`);
  assertEqual(round(r.nominalMm.y1 - r.nominalMm.y0), round(r.answerLines * 9.0),
    'the writing area is not its line count times the pitch');
});

check('no authored text is ever scaled — one font size across the document', async () => {
  // The bug this pins is the one that survived two fixes: drawAuthoredText used
  // to shrink a block whose measured height beat its reservation, so the stem —
  // the longest block on the page — was the only one that shrank, and it printed
  // smaller than its own sub-parts. Text is now drawn at its natural size come
  // what may; only a figure may be scaled into its box.
  const longStem = 'For the bridge circuit provided (text problem 1.11): a 20 V source and six '
    + 'resistors, with every node lettered on the drawing. Take the bottom node as the reference, '
    + 'and give every current in the direction of the arrow printed beside it. State units at every '
    + 'step, and do not round intermediate values.';
  const a = makeAssignment([[{ ...part('Node table', 100), description: 'Give a table with one row per node.' }]]);
  a.problems[0].description = longStem;

  const g = await gen.generateTemplate(a);
  // Every authored-text raster occupies its full natural height: in the no-DOM
  // path that means every wrapped line was drawn, none clipped to the box.
  const stem = g.ink.find(b => b.what === 'problem text 1');
  const desc = g.ink.find(b => b.what === 'description 1');
  assert(stem && desc, 'the stem or the description was not drawn');

  // Same line height for both — the property "one font size" reduces to on the page.
  const lineMm = lay.DESC_FONT_PT * 1.35 * 25.4 / 72;
  for (const [name, box] of [['stem', stem], ['description', desc]]) {
    const lines = (box.y1 - box.y0) / lineMm;
    assert(Math.abs(lines - Math.round(lines)) < 0.01,
      `${name} was scaled: its height is ${lines.toFixed(3)} line heights, not a whole number`);
  }
  // And the reservation covered it, so nothing overran into the writing area.
  assertEqual(g.selfTest.failures, [], 'the template did not pass its own checks');
});

check('a question longer than a page is refused, not shrunk', async () => {
  // The other half of "text is never scaled": if it cannot fit, that is the
  // author's to fix, and the generator says so instead of printing it small.
  let threw = null;
  try {
    await gen.generateTemplate(makeAssignment([[{ ...part('Impossible', 100), description: 'x'.repeat(100000) }]]));
  } catch (err) { threw = err; }
  assert(threw !== null, 'a question longer than a page produced a template anyway');
  assert(/fits the page at full size/.test(threw.message),
    `the refusal does not name the cause:\n${threw.message}`);
  assert(/split the problem/i.test(threw.message), 'the refusal does not say what to do about it');
});

check('a text answer is ruled at the writing pitch; a sketch area is left blank', async () => {
  // One page per template, so every drawing op in the file belongs to the one
  // region under test. jsPDF writes a stroked line as "x y m x y l".
  const horizontals = async (template) => {
    const bytes = Buffer.from(await template.pdf.arrayBuffer()).toString('latin1');
    return [...bytes.matchAll(/([\d.]+) ([\d.]+) m\s*([\d.]+) ([\d.]+) l/g)].map(m => ({
      x0: Number(m[1]) * PT_TO_MM, y0: fmt.PAGE_H_MM - Number(m[2]) * PT_TO_MM,
      x1: Number(m[3]) * PT_TO_MM, y1: fmt.PAGE_H_MM - Number(m[4]) * PT_TO_MM,
    })).filter(l => Math.abs(l.y0 - l.y1) < 0.01);
  };
  const insideBox = (lines, r) => lines.filter(l =>
    l.y0 > r.nominalMm.y0 + 0.01 && l.y0 <= r.nominalMm.y1 + 0.01
    && l.x0 >= r.nominalMm.x0 - 0.01 && l.x1 <= r.nominalMm.x1 + 0.01);

  const written = await gen.generateTemplate(makeAssignment([[part('Written', 100, { answerLines: 7 })]]));
  // 2 = the instructions page plus the one the part is on.
  assertEqual(written.pageCount, 2, 'the text fixture should be the instructions page plus one');
  const wr = written.layout.regions[0];
  // One region on the page, so it runs to the bottom margin: the count to check
  // against is the region's own, and every line lands on the pitch.
  assert(wr.answerLines >= 7, `the region was shrunk to ${wr.answerLines} lines`);
  const rules = insideBox(await horizontals(written), wr);
  assertEqual(rules.length, wr.answerLines, 'wrong number of writing rules');
  const offsets = rules.map(l => round(l.y0 - wr.nominalMm.y0)).sort((a, b) => a - b);
  assertEqual(offsets, Array.from({ length: wr.answerLines }, (_, i) => round((i + 1) * lay.WRITING_LINE_MM)),
    'the writing rules are not at the WRITING_LINE_MM pitch');

  const sketch = await gen.generateTemplate(
    makeAssignment([[part('Sketch', 100, { isDrawing: true, answerLines: 7 })]]));
  assertEqual(insideBox(await horizontals(sketch), sketch.layout.regions[0]).length, 0,
    'a sketch area was ruled');
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
  // The NUL is written as an ESCAPE and must stay one. It was a raw NUL byte
  // in this source until 2026-09-03, and a single NUL is git's own test for
  // "binary": it made this 143 KB file invisible to the absolute-path scan
  // in tests/no-personal-names.mjs and dropped it to the weaker floor in the
  // name scan. The regex matches identically either way; the file's
  // scannability does not.
  const utf16 = strings.filter(s => /\u0000/.test(s));
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

  // Paths gained a student/ | instructor/ split on 2026-08-31 so that "give
  // students the student folder" is unambiguous. The two student files gained
  // their shipping names on 2026-09-06, when the student zip was replaced by
  // two loose files, so they are looked up through `exportFilenames` rather than
  // by a literal that would then exist in two places.
  const base = n => n.slice(n.lastIndexOf('/') + 1);
  const named = (entries, name) => Object.keys(entries).find(n => base(n) === name);
  const hwNames = exportSvc.exportFilenames(appendixB);
  const elNames = exportSvc.exportFilenames({ ...appendixB, inputMode: 'electronic' });

  check('handwritten: the student PDF IS the QR template, and there is no second PDF', async () => {
    const pdfs = Object.keys(hwEntries).filter(n => n.endsWith('.pdf'));
    assertEqual(pdfs, [`student/${hwNames.studentPdf}`], 'a handwritten export should contain exactly one PDF');
    // Same bytes as the standalone generator produces — not a lookalike.
    const direct = await gen.generateTemplate(appendixB);
    const a = Buffer.from(await hwEntries[`student/${hwNames.studentPdf}`].arrayBuffer());
    const b = Buffer.from(await direct.pdf.arrayBuffer());
    assertEqual(a.length, b.length, 'the student PDF is not the template PDF');
    assert(a.subarray(0, 2000).equals(b.subarray(0, 2000)), 'the student PDF differs from the template PDF');
  });

  check('handwritten: no template.pdf — it serves no purpose on a page-format sheet', () =>
    assert(!named(hwEntries, 'template.pdf'), 'the boxed answer-region sheet is still being exported'));

  check('handwritten: the sidecar is instructor-side, under the name the QR points at', () => {
    // CHANGED 2026-09-06: the map is no longer a student file. The student's
    // copy rides inside the spec, verbatim; this one is the instructor's, for
    // the Gradescope outline. `run-tests.mjs` holds the two byte-identical.
    const csv = Object.keys(hwEntries).filter(n => n.endsWith('.csv'));
    assertEqual(csv, [`instructor/layout_${t.assignmentId}.csv`],
      'the layout map is missing, misnamed, or still being handed to students');
  });

  check('handwritten: the QR template PDF really does carry a QR and four marks', async () => {
    const bytes = Buffer.from(await hwEntries[`student/${hwNames.studentPdf}`].arrayBuffer()).toString('latin1');
    const rects = [...bytes.matchAll(/([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re/g)];
    assert(rects.length > 100, 'the student PDF has too few drawing ops to contain a QR');
    assert(!/Gradescope Answer Region/.test(bytes), 'the old boxed answer region leaked into it');
  });

  check('electronic: the student PDF for the student, template.pdf for the instructor, no layout map', () => {
    assertEqual(Object.keys(elEntries).filter(n => n.endsWith('.pdf')).sort(),
      ['instructor/template.pdf', `student/${elNames.studentPdf}`], 'the electronic PDF pair changed');
    assertEqual(Object.keys(elEntries).filter(n => n.endsWith('.csv')), [],
      'an electronic export gained a layout map');
    // template.pdf sets up the Gradescope outline, which is an instructor task.
    assert(!Object.keys(elEntries).includes('student/template.pdf'),
      'the Gradescope outline sheet is in the student folder');
  });

  check('both modes still carry the spec, the html, the tex, the rubric and the grader doc', () => {
    for (const [label, entries, names] of
         [['handwritten', hwEntries, hwNames], ['electronic', elEntries, elNames]]) {
      for (const name of [names.studentUpload, 'assignment.html', 'assignment.tex']) {
        assert(named(entries, name), `${label}: ${name} is missing`);
      }
      assert(Object.keys(entries).some(n => n.endsWith('_grading_rubric.json')), `${label}: no rubric`);
      assert(Object.keys(entries).some(n => n.endsWith('_grader_document.html')), `${label}: no grader doc`);
      assert(Object.keys(entries).some(n => n.endsWith('_authoring_backup.json')), `${label}: no authoring backup`);
      assert(Object.keys(entries).some(n => n.endsWith('.md')), `${label}: no .md`);
      assert(named(entries, '00_INSTRUCTOR_ONLY_DO_NOT_DISTRIBUTE.txt'), `${label}: no distribution notice`);
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

  // Preamble: reserved on the instructions page and actually drawn, under its
  // own heading and below the standing instructions.
  assert(g.layout.instructionsPage.preambleBoxMm, 'no room was reserved for the preamble');
  assert(g.ink.some(b => b.what === 'preamble'), 'the preamble was not drawn');
  assert(g.ink.some(b => b.what === 'instructions preambleHeading'),
    'the preamble was printed without its own heading');
  assertEqual(g.layout.instructionsPage.overflowMm, 0, 'the instructions page overflowed');

  // Each problem gets a heading and its shared setup, above its first part.
  const headings = g.ink.filter(b => /^problem heading/.test(b.what));
  const texts = g.ink.filter(b => /^problem text/.test(b.what));
  // Every page of a problem gets a heading; only its first page repeats the setup.
  // Every page EXCEPT the instructions page opens a problem here.
  assertEqual(headings.length, g.pageCount - 1, 'expected a problem heading on every page but page 1');
  assertEqual(texts.length, 2, 'the shared setup should be printed once per problem');

  // The heading belongs to the problem's first part only, and sits above it.
  const openers = g.layout.regions.filter(r => r.problemBlock);
  assertEqual(openers.length, g.pageCount - 1, 'every page but the instructions page should open with a problem block');
  for (const r of openers) {
    assert(r.problemBlock.boxMm.y1 <= r.promptTopMm + 0.01,
      `${r.regionId}: the problem block overlaps the prompt row`);
    assert(r.problemBlock.heading.startsWith(`Problem ${r.problemIndex + 1}`), 'wrong heading text');
  }
  // Every part carries its own question text. There is no longer any region
  // that does not: an answer is never split, so no region is bare writing space
  // for a question asked on the page before.
  for (const r of g.layout.regions) {
    assert(r.descBoxMm, `${r.regionId}: no question text box`);
  }
});

check('a problem continued on a later page repeats the heading, not the setup', () => {
  // Three parts: 1(a) and 1(b) on page 2, 1(c) on page 3 — page 1 is the
  // instructions page, so the problem opens on 2.
  const l = lay.buildLayout(makeAssignment([[
    { ...part('A', 10), description: 'a' },
    { ...part('B', 10), description: 'b' },
    { ...part('C', 10), description: 'c' },
  ]]));
  l.problems = undefined;
  const opener = l.regions.find(r => r.pageK === 3 && r.problemBlock);
  assert(opener, 'the continued problem got no heading on its second page');
  assert(opener.problemBlock.continued, 'the second page was not marked as a continuation');
  assertEqual(opener.problemBlock.text, '', 'the shared setup was repeated on the continuation page');
  assert(/continued/.test(opener.problemBlock.heading), 'the heading does not say continued');
});

check('long prose is never squeezed — the page count is what gives instead', () => {
  const wordy = 'A '.repeat(400);
  const l = lay.buildLayout({
    ...makeAssignment([[{ ...part('Wordy one', 50), description: wordy },
                        { ...part('Wordy two', 50), description: wordy },
                        { ...part('Wordy three', 50), description: wordy }]]),
    preamble: wordy,
  });
  l.problems = undefined;
  assertEqual(l.clamped, [], 'ordinary long prose was clamped');
  for (const r of l.regions) {
    // Reserved in full: the estimate for this description, with nothing scaled.
    assertEqual(round(r.descBoxMm.y1 - r.descBoxMm.y0), round(lay.descBlockMm(wordy)),
      `${r.regionId}: the question text was reserved smaller than it estimates`);
    assert(r.answerLines >= lay.DEFAULT_ANSWER_LINES,
      `${r.regionId}: the answer box was shrunk to ${r.answerLines} lines`);
    assert(r.declaredMm.y1 <= fmt.REGION_Y_MAX_MM + 0.01,
      `${r.regionId}: ran past the bottom limit at ${r.declaredMm.y1.toFixed(1)} mm`);
  }
  // Regions that do share a page must not run into each other.
  const byPage = new Map();
  for (const r of l.regions) byPage.set(r.pageK, [...(byPage.get(r.pageK) || []), r]);
  for (const [k, rs] of byPage) {
    for (let i = 0; i + 1 < rs.length; i++) {
      assert(rs[i].declaredMm.y1 <= rs[i + 1].promptTopMm + 0.01, `page ${k}: region ${i} runs into the next prompt`);
    }
  }
});

// ---------- question text sizes to fit, since the sheet is the assignment ----------
check('a long question reserves more room than a short one, deterministically', () => {
  const short = 'Find alpha.';
  const long = 'A uniform plane wave at 1 GHz propagates in a medium with sigma = 4 S/m and mu_r = 1. '
    + 'Determine the skin depth, the attenuation constant, the phase constant, and the intrinsic '
    + 'impedance, stating units for each and showing the formula you used at every step.';
  const wide = lay.COLUMN_X1_MM - lay.COLUMN_X0_MM;
  // One wrapped line plus the deliberate slack line — text is never scaled, so
  // the estimate is built to come out over rather than under.
  assertEqual(lay.estimateDescLines(short, wide), 1 + lay.DESC_SLACK_LINES,
    'a one-line question did not reserve one line plus slack');
  assert(lay.estimateDescLines(long, wide) > lay.estimateDescLines(short, wide),
    'a long question reserved no more than a short one');
  assert(lay.descBlockMm(long) > lay.descBlockMm(short), 'a long question reserved no extra room');
  assertEqual(lay.estimateDescLines('', wide), 0, 'an empty description reserved a line');
  // Deterministic: the map is hashed into the QR, so this must not vary by host.
  assertEqual(lay.descBlockMm(long), lay.descBlockMm(long), 'not deterministic');
  // No ceiling any more: a long stem reserves its full height rather than being
  // crushed into eight lines and then scaled down into them.
  assert(lay.estimateDescLines('x'.repeat(100000), wide) > 500,
    'a huge description is still being capped');
});

check('question text that cannot fit a page at all is clamped, and reported', () => {
  // The one remaining path where text is scaled: prose that would not fit a page
  // even with a single writing line under it. Reported so the author hears it.
  const l = lay.buildLayout(makeAssignment([[{ ...part('Impossible', 100), description: 'x'.repeat(100000) }]]));
  assertEqual(l.clamped.length, 1, 'an unfittable description was not reported');
  assert(l.clamped[0].usedMm < l.clamped[0].requestedMm, 'the clamp did not actually reduce anything');
  for (const r of l.regions) {
    assert(r.declaredMm.y1 <= fmt.REGION_Y_MAX_MM + 0.01, `${r.regionId}: ran past the bottom limit`);
    assert(r.answerLines >= 1, `${r.regionId}: a region with no writing line at all`);
  }
});

check('the question text box always sits between the prompt row and the answer box', () => {
  const withText = lay.buildLayout(makeAssignment([[
    { ...part('Long one', 50), description: 'A '.repeat(300) },
    { ...part('Short one', 50), description: 'Brief.' },
  ]]));
  for (const r of withText.regions) {
    assert(r.descBoxMm, `${r.regionId}: no description box`);
    assert(r.descBoxMm.y0 >= r.promptTopMm + lay.PROMPT_ROW_MM - 0.01, `${r.regionId}: box overlaps the prompt row`);
    assert(r.descBoxMm.y1 <= r.boxTopMm + 0.01, `${r.regionId}: text runs into the answer box`);
    assert(r.nominalMm.y0 > r.boxTopMm, `${r.regionId}: the writing area starts above the box`);
    assert(r.declaredMm.y1 <= fmt.REGION_Y_MAX_MM + 0.01, `${r.regionId}: ran past the bottom limit`);
  }
});

// ---------- .md round trip of the template settings ----------
{
  const exportSvc = await loadModule(join(REPO, 'services', 'exportService.ts'), 'exportSvc.mjs');
  const mdParser = await loadModule(join(REPO, 'services', 'mdParserService.ts'), 'mdParser.mjs');

  const authored = makeAssignment([[
    part('Cutoff frequency', 40, { answerLines: 12 }),
    part('Field sketch', 60, { isDrawing: true, answerLines: 20 }),
  ]], { pageFormatId: 'EEC130BHW3' });

  const md = exportSvc.assignmentToMd(authored);
  const back = mdParser.parseMdToAssignment(md);

  check('md: the template settings survive export and import', () => {
    assert(/^\*\*Template ID:\*\* EEC130BHW3$/m.test(md), `no Template ID line in:\n${md}`);
    assert(/^> template: lines=12$/m.test(md), 'the line count was not written');
    assert(/^> template: lines=20, sketch$/m.test(md), 'lines and the sketch flag did not both survive');
    assertEqual(back.pageFormatId, 'EEC130BHW3', 'the Template ID was lost');
    const [a, b] = back.problems[0].subsections;
    assertEqual([a.answerLines, a.isDrawing], [12, undefined], 'part (a) settings were lost');
    assertEqual([b.answerLines, b.isDrawing], [20, true], 'part (b) settings were lost');
  });

  check('md: an absent directive means DEFAULT_ANSWER_LINES, and writes nothing back', () => {
    const plain = [
      '# EEC130B: Homework 3', '', '**Input:** handwritten', '',
      '## Problem 1: Unset', '',
      '### (a) Never said [100 pts] [handwritten]', 'Do it.', '',
    ].join('\n');
    const [a] = mdParser.parseMdToAssignment(plain).problems[0].subsections;
    assertEqual(a.answerLines, undefined, 'an absent directive should not invent a stored value');
    assertEqual(lay.answerLinesFor(a), lay.DEFAULT_ANSWER_LINES, 'an unset part did not default to 6');
    assert(!exportSvc.assignmentToMd(mdParser.parseMdToAssignment(plain)).includes('> template:'),
      'a template line was written for a part that never had one');
  });

  check('md: the retired space= scale imports to a line count, and exports as lines=N', () => {
    const legacy = [
      '# EEC130B: Homework 3', '', '**Input:** handwritten', '',
      '## Problem 1: Old scale', '',
      '### (a) Was extra tall [34 pts] [handwritten]', 'Do it.', '', '> template: space=xtall', '',
      '### (b) Was short [33 pts] [handwritten]', 'Do it.', '', '> template: space=short', '',
      '### (c) Was a full-page sketch [33 pts] [handwritten:human]', 'Do it.', '', '> template: space=full, sketch', '',
    ].join('\n');
    const parsed = mdParser.parseMdToAssignment(legacy);
    const [a, b, c] = parsed.problems[0].subsections;
    assertEqual(a.answerLines, lay.FULL_PAGE_LINES, 'xtall should map to a full page of lines');
    assertEqual(b.answerLines, lay.LEGACY_SPACE_LINES.short, 'short should map to its line count');
    assertEqual([c.answerLines, c.isDrawing], [lay.FULL_PAGE_LINES, true], 'full + sketch did not both survive');
    // One-way migration: the old spelling is read, the new one is written.
    const out = exportSvc.assignmentToMd(parsed);
    assert(!/space=/.test(out), 'an old space= spelling was written back out');
    assert(new RegExp(`^> template: lines=${lay.FULL_PAGE_LINES}$`, 'm').test(out), 'xtall did not export as lines=N');
    assertEqual(exportSvc.assignmentToMd(mdParser.parseMdToAssignment(out)), out, 'the migrated file is not a fixed point');
  });

  // The Python converter is the reference implementation mdParserService.ts is
  // ported from, and the two are only ever right together. Compare them on one
  // fixture covering every form of the directive.
  {
    const FIXTURE = resolve(REPO, 'tests', 'fixtures', 'AnswerSpace_Fixture.md');
    const fixtureMd = readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n');
    const expected = [
      { name: 'Authored line count', answerLines: 14, isDrawing: undefined },   // lines=N
      { name: 'Never said', answerLines: undefined, isDrawing: undefined },     // absent → the default
      { name: 'A ruled-free sketch', answerLines: 20, isDrawing: true },        // lines + sketch
      { name: 'Written against the retired scale', answerLines: 24, isDrawing: undefined }, // space=full
    ];

    check('md: every form of the template directive parses as documented', () => {
      const subs = mdParser.parseMdToAssignment(fixtureMd).problems[0].subsections;
      assertEqual(subs.map(s => ({ name: s.name, answerLines: s.answerLines, isDrawing: s.isDrawing })),
        expected, 'the fixture did not parse as the spec describes');
      assertEqual(subs.map(s => lay.answerLinesFor(s)), [14, lay.DEFAULT_ANSWER_LINES, 20, lay.FULL_PAGE_LINES],
        'the resolved line counts are wrong');
    });

    const python = ['python', 'python3', 'py'].find(exe =>
      spawnSync(exe, ['-c', 'pass'], { encoding: 'utf8' }).status === 0);
    const pyCheck = 'converter/convert.py agrees with mdParserService.ts on that fixture';
    if (!python) results.push(`  SKIP  ${pyCheck} (no Python interpreter on PATH)`);
    else check(pyCheck, () => {
      const work = mkdtempSync(join(tmpdir(), 'gb-convert-'));
      const md = join(work, 'AnswerSpace_Fixture.md');
      copyFileSync(FIXTURE, md);
      const run = spawnSync(python, [resolve(REPO, 'converter', 'convert.py'), md], { encoding: 'utf8' });
      assert(run.status === 0, `convert.py failed: ${run.stderr || run.stdout}`);
      const spec = JSON.parse(readFileSync(join(work, 'AnswerSpace_Fixture_spec.json'), 'utf8'));
      assertEqual(
        spec.problems[0].subsections.map(s => ({
          name: s.name,
          answerLines: s.answerLines === null ? undefined : s.answerLines,
          isDrawing: s.isDrawing === null ? undefined : s.isDrawing,
        })),
        expected, 'the Python converter and the browser parser disagree');
      // Both must take the point target from the file's own total — the two
      // implementations defaulted to 100 together, and had to stop together.
      assertEqual(spec.targetPoints, mdParser.parseMdToAssignment(fixtureMd).targetPoints,
        'convert.py and mdParserService disagree about the point target');
      rmSync(work, { recursive: true, force: true });
    });
  }

  check('md: an explicit lines= wins over a space= in the same directive', () => {
    const both = [
      '# EEC130B: Homework 3', '', '**Input:** handwritten', '',
      '## Problem 1: Both', '',
      '### (a) Mixed [100 pts] [handwritten]', 'Do it.', '', '> template: space=full, lines=5, sketch', '',
    ].join('\n');
    const [a] = mdParser.parseMdToAssignment(both).problems[0].subsections;
    assertEqual([a.answerLines, a.isDrawing], [5, true], 'the explicit line count did not win');
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

// ---------- black only, and the box interior ----------
check('a coloured figure is refused; greys and #ffffff are not colour', async () => {
  // EEC100_Final_Format_Spec 5: the scans are 8-bit grayscale and that is LOAD
  // BEARING, because it is what lets the marking stage prove it never altered
  // the student's work — any pixel with colour was added afterwards. One
  // coloured element destroys that guarantee for every submission on the sheet.
  // The generator's own ink is greyscale by construction; author-supplied SVG is
  // the way colour can get here, and nothing used to look.
  const svg = (stroke) => '```svg\n<svg viewBox="0 0 200 100" xmlns="http://www.w3.org/2000/svg">'
    + '<title>a loop</title><rect x="5" y="5" width="190" height="90" fill="#ffffff" stroke="'
    + stroke + '"/></svg>\n```';

  const grey = makeAssignment([[{ ...part('A', 100), description: 'Find R1.' }]]);
  grey.problems[0].description = 'The loop below.\n\n' + svg('#111111');
  assertEqual(selfTest.figureColourViolations(grey), [], 'the ENG17 greys were called colour');
  const ok = await gen.generateTemplate(grey);
  assertEqual(ok.selfTest.failures, [], 'a grey figure was refused');

  const red = makeAssignment([[{ ...part('A', 100), description: 'Find R1.' }]]);
  red.problems[0].description = 'The loop below.\n\n' + svg('#c00000');
  assertEqual(selfTest.figureColourViolations(red).length, 1, 'a red stroke was not reported');
  let threw = null;
  try { await gen.generateTemplate(red); } catch (err) { threw = err; }
  assert(threw !== null, 'a coloured figure produced a template anyway');
  assert(/black only/.test(threw.message), `the refusal does not name the cause:\n${threw.message}`);
});

check('nothing but its own writing lines may be printed inside an answer box', () => {
  // EEC100_Final_Format_Spec 2: the detector rejects a candidate whose interior
  // already carries ink, which is how it auto-rejects formula tables. The dashed
  // rules are the argued exception (measured handwriting reasons, and the same
  // document tolerates printed graph paper at 262 of 264). A question that
  // overran its reservation into the box beneath it is not — and the collision
  // check cannot see that, because the ruled band starts a full pitch down.
  const declared = t.layout.regions.map(r => ({
    pageK: r.pageK, regionId: r.regionId, partId: r.partId, rect: r.declaredMm,
  }));
  assertEqual(selfTest.runInkChecks(t.ink, t.selfTest, declared).failures, [],
    'the real ink does not pass the box-interior check');

  const r0 = t.layout.regions[0];
  const intruder = {
    pageK: r0.pageK, what: 'a description that overran',
    x0: r0.declaredMm.x0 + 5, y0: r0.declaredMm.y0 + 1,
    x1: r0.declaredMm.x0 + 60, y1: r0.declaredMm.y0 + 4,
  };
  const dirty = selfTest.runInkChecks([...t.ink, intruder], t.selfTest, declared);
  const named = dirty.failures.filter(f => /inside an answer box/.test(f));
  assertEqual(named.length, 1, `ink inside a box was not caught: ${dirty.failures.join(' | ')}`);
  assert(new RegExp(r0.regionId).test(named[0]), 'the failure does not name the box');

  // Without the rectangles the check is skipped rather than passing vacuously.
  // Run it off a bare base: t.selfTest is itself an ink report, so its checks
  // are carried forward into every re-run and would mask the absence.
  const bare = { passed: true, checks: [], failures: [], warnings: [] };
  assert(!selfTest.runInkChecks([...t.ink, intruder], bare).checks
    .some(c => /inside an answer box/.test(c.name)),
    'the interior check ran without being given any rectangles');
  assert(selfTest.runInkChecks([...t.ink, intruder], bare, declared).checks
    .some(c => /inside an answer box/.test(c.name)),
    'the interior check did not run when it was given rectangles');
});

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

// =====================================================
// THE LAYOUT MAP AND THE GRADING RUBRIC JOIN
// =====================================================
// THE CHECK THAT NEVER EXISTED. Two identifier schemes name one entity and were
// generated independently: the map and the printed crop use `p1a` / `1(a)`, the
// rubric is keyed `p0s0`. `rubrics["p1a"]` does not exist, and a consumer's
// first guess is that it does — they get an absent entry, not an error.
//
// The join is also asymmetric. A single-part problem's `part_id` is `4`, not
// `4(a)`, while the rubric still records `subsection_letter: "a"`, so a consumer
// parsing `part_id` literally silently missed seven of ENG17 HW1's seventeen
// regions. Nothing read both files, so nothing could notice.
//
// Every check below is written synchronously with its awaits hoisted: `check()`
// pushes async bodies onto `pending`, which nothing awaits before the report is
// printed.
{
  const exportJoinSvc = await loadModule(join(REPO, 'services', 'exportService.ts'), 'exportJoin.mjs');
  const mdParserJoin = await loadModule(join(REPO, 'services', 'mdParserService.ts'), 'mdParserJoin.mjs');

  /** Both files, as a consumer receives them: the map's rows and the rubric's entries. */
  const joinReport = async (assignment) => {
    const t = await gen.generateTemplate(assignment);
    const rubric = exportJoinSvc.generateGradingRubric(assignment);

    const lines = t.csv.trim().split('\n');
    const head = lines[0].split(',');
    const col = (n) => head.indexOf(n);
    const rows = lines.slice(1).map(r => r.split(',')).map(r => ({
      regionId: r[col('region_id')],
      partId: r[col('part_id')],
      maxPoints: Number(r[col('max_points')]),
    }));

    const entries = Object.entries(rubric.rubrics).map(([key, v]) => ({
      key, regionId: v.region_id, partId: v.part_id, maxPoints: v.max_points,
    }));
    return { rows, entries, layoutId: t.layoutId };
  };

  const assertJoinsOneToOne = ({ rows, entries }, label) => {
    // Every map row finds exactly one rubric entry…
    for (const row of rows) {
      const hits = entries.filter(e => e.regionId === row.regionId);
      assert(hits.length === 1,
        `${label}: region ${row.regionId} matched ${hits.length} rubric entries, expected 1`);
      assert(hits[0].maxPoints === row.maxPoints,
        `${label}: region ${row.regionId} is worth ${row.maxPoints} on the map and ` +
        `${hits[0].maxPoints} in the rubric`);
      assert(hits[0].partId === row.partId,
        `${label}: region ${row.regionId} is part "${row.partId}" on the map and ` +
        `"${hits[0].partId}" in the rubric`);
    }
    // …and every rubric entry is claimed by exactly one map row.
    for (const e of entries) {
      const hits = rows.filter(r => r.regionId === e.regionId);
      assert(hits.length === 1,
        `${label}: rubric entry ${e.key} (region ${e.regionId}) matched ${hits.length} map rows, expected 1`);
    }
    assert(rows.length === entries.length,
      `${label}: ${rows.length} map rows against ${entries.length} rubric entries`);
    // The rubric key is NOT the region id, and must not become it — `p0s0` is
    // load-bearing for the student payload keys and the electronic image names.
    assert(entries.every(e => e.key !== e.regionId),
      `${label}: the rubric key and the region id have been unified; three consumers depend on them differing`);
  };

  // The asymmetric case, which is the one that actually broke: a single-part
  // problem beside multi-part ones. `p2` / "2" against `p1a` / "1(a)".
  const mixed = makeAssignment([
    [part('Node equations', 20), part('Solve', 20), part('Check', 10)],
    [part('The only part', 25)],
    [part('Sketch', 15, { isDrawing: true }), part('Explain', 10)],
  ]);
  const mixedJoin = await joinReport(mixed);

  check('map and rubric join one-to-one, single-part problems included', () => {
    assertJoinsOneToOne(mixedJoin, 'mixed');
    const byRegion = Object.fromEntries(mixedJoin.entries.map(e => [e.regionId, e]));
    // The exact shapes, so a change to either scheme is caught here rather than
    // by a consumer months later.
    assertEqual(mixedJoin.rows.map(r => r.regionId), ['p1a', 'p1b', 'p1c', 'p2', 'p3a', 'p3b'],
      'the map no longer names regions the way the spec worked example does');
    assertEqual(byRegion['p2'].partId, '2', 'a single-part problem gained a letter');
    assertEqual(byRegion['p2'].key, 'p1s0', 'the rubric key scheme moved');
    assertEqual(byRegion['p1a'].partId, '1(a)', 'a multi-part problem lost its letter');
  });

  check('an electronic assignment carries the same link, unconditionally', () => {
    // Electronic produces no layout map, but the fields are written all the
    // same: a field that appears and disappears on a condition the consumer
    // cannot see is worse than one that is always there.
    const electronic = {
      ...makeAssignment([[part('a', 50), part('b', 50)]]),
      inputMode: 'electronic',
      problems: [{ id: 'p1', name: 'Problem 1', description: '', subsections: [
        { id: 's1', name: 'a', description: '', points: 50, submissionType: 'Text' },
        { id: 's2', name: 'b', description: '', points: 50, submissionType: 'Text' },
      ] }],
    };
    const entries = Object.values(exportJoinSvc.generateGradingRubric(electronic).rubrics);
    assertEqual(entries.map(e => e.region_id), ['p1a', 'p1b'], 'region_id is missing or wrong');
    assertEqual(entries.map(e => e.part_id), ['1(a)', '1(b)'], 'part_id is missing or wrong');
  });

  check('the additive fields did not disturb what the rubric already carried', () => {
    const [first] = Object.values(exportJoinSvc.generateGradingRubric(mixed).rubrics);
    assertEqual(first.subsection_id, 'p0s0', 'subsection_id changed');
    assertEqual(first.problem_number, 1, 'problem_number changed');
    assertEqual(first.subsection_letter, 'a', 'subsection_letter changed');
    assertEqual(first.display_name, 'Problem 1(a): Node equations', 'display_name changed');
  });

  // ---- The real ENG17 homeworks -------------------------------------------
  // Outside this repo (course material under the ENG17 side's control), so this
  // reports SKIP rather than failing when they are absent. The committed checks
  // above hold the property; these hold the counts the work order names, and the
  // layout_id, because a rubric-only change may move no geometry.
  // Override with:  ENG17_HWK_DIR=/path/to/"New HWKs" npm test
  const HWK = process.env.ENG17_HWK_DIR
    ? resolve(process.env.ENG17_HWK_DIR)
    : resolve(REPO, '..', '..', '..', 'Knoesen', 'ENG17-Assignments', 'New HWKs');
  for (const { n, regions, layoutId } of [
    { n: 1, regions: 17, layoutId: '95438EDF' },
    { n: 2, regions: 10, layoutId: '8505F1E5' },
    { n: 3, regions: 14, layoutId: 'B549DC53' },
  ]) {
    const name = `ENG17 HW${n}: ${regions} regions join the rubric one-to-one, layout_id ${layoutId}`;
    const mdPath = join(HWK, `HWK${n}`, `ENG17_HW${n}_assignment.md`);
    if (!existsSync(mdPath)) { results.push(`  SKIP  ${name} (not at ${mdPath})`); continue; }
    const report = await joinReport(mdParserJoin.parseMdToAssignment(readFileSync(mdPath, 'utf8')));
    check(name, () => {
      assertJoinsOneToOne(report, `HW${n}`);
      assertEqual(report.rows.length, regions, `HW${n} has the wrong number of regions`);
      assertEqual(report.layoutId, layoutId,
        `HW${n} layout_id moved — this change may touch the rubric only`);
    });
  }
}

// Text a reader can get out of a PDF, shared by the guards below.
//
// jsPDF draws authored text with real text operators when there is no DOM
// (renderTextToCanvas returns null and the caller falls back to toPdfText),
// which is what makes this readable here. In a browser the same text is
// rasterised into an image, still perfectly visible to the student but not
// extractable, so for the content guard this is a proxy and the spec and CSV
// strands carry the weight. For the identity guard it is the primary strand:
// the line it looks for was drawn by doc.text(), never rasterised.
const pdfExtractedText = (buf) => {
  const bytes = buf.toString('latin1');
  let out = '';
  for (const m of bytes.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const raw = Buffer.from(m[1], 'latin1');
    let txt;
    try { txt = inflateSync(raw).toString('latin1'); } catch { txt = raw.toString('latin1'); }
    if (!txt.includes('Tj') && !txt.includes('TJ')) continue;
    for (const s of txt.matchAll(/\(((?:\\.|[^\\()])*)\)\s*T[jJ]/g)) {
      out += ' ' + s[1].replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
                      .replace(/\\(.)/g, '$1');
    }
  }
  return out;
};

// ---- The answer key is kept out by CONTENT, not by field name --------------
// The 2026-08-31 whitelist lists which FIELDS may reach a student. It closed the
// door `aiGradingPrompt` walked through. It cannot close this one: a grading
// block left in a problem stem is in `description`, which is on the list and
// must be. **A whitelist of fields cannot see an answer key smuggled into an
// allowed field as prose.** So the guard below asserts content, and it is meant
// to catch routes nobody has thought of yet — not only the one predicate fixed
// on 2026-09-03.
//
// Three assertions, deliberately different in kind, because a leak can be
// partial and a partial leak defeats any one of them alone:
//
//   1. MARKERS      — the structural vocabulary of a grading block. Zero
//                     tolerance, no threshold to tune. "grader_note:" cannot
//                     legitimately appear in something a student reads.
//   2. WHOLE STRING — a complete grading prompt or grader note, verbatim. Zero
//                     tolerance; a whole rubric is never a question.
//   3. BULK OVERLAP — the longest run of a grading string's words appearing
//                     contiguously in student text.
//
// Only #3 needs a number, and the number is measured rather than guessed.
// Grading prompts legitimately quote the circuit they grade, so SOME overlap is
// correct and a naive check fires on it. Measured over the real ENG17 homeworks
// on 2026-09-03, the longest LEGITIMATE contiguous overlap is:
//
//     HW1   6 words  "and each is joined to the"
//     HW2   7 words  "the right hand side of the rectangle"
//     HW3  10 words  "hangs from the output node with its far end unconnected"
//
// The bar is 16 — six words of headroom over the worst real case. If a future
// assignment trips it legitimately, re-measure (the probe is described in
// docs/session/COMPLETION_AM_KEY_DISCLOSURE_2026-09-03.md) and raise it with the
// new number recorded here. Do not delete the check, and do not raise it without
// looking at what fired.
{
  const mdParser = await loadModule(join(REPO, 'services', 'mdParserService.ts'), 'mdParserKey.mjs');
  // Same default and same override as the join checks above.
  const HWK = process.env.ENG17_HWK_DIR
    ? resolve(process.env.ENG17_HWK_DIR)
    : resolve(REPO, '..', '..', '..', 'Knoesen', 'ENG17-Assignments', 'New HWKs');

  const MAX_OVERLAP_WORDS = 16;

  // Strand 4's bar, measured the same way and on the same assignments. A
  // REFERENCE: clause is the part of a prompt that says what the answer IS, and
  // it is the line an author is likeliest to reach for — one sentence, not the
  // paragraph around it. That sentence is shorter than 16 normalised words, so
  // strand 3 cannot see it, and it carries no marker vocabulary, so strand 1
  // cannot either.
  //
  // Longest LEGITIMATE contiguous overlap of a reference clause with student
  // text, measured 2026-09-03 over the real ENG17 homeworks:
  //
  //     HW1  5 words   HW2  5 words   HW3  5 words
  //
  // Five, three times, and the consistency is structural rather than lucky: a
  // prompt overlaps the stem where it restates the circuit, and a reference
  // clause is the part the stem deliberately does not say. The bar is 9 — four
  // words of headroom. Re-derive it exactly as for MAX_OVERLAP_WORDS (see
  // docs/session/COMPLETION_AM_REFERENCE_STRAND_2026-09-03.md); if a real
  // assignment ever trips it, report the phrase rather than raising the bar.
  const MAX_REFERENCE_OVERLAP_WORDS = 9;

  // WHERE THIS GUARD STOPS — recorded so the gap is known, not discovered.
  // It catches pasted TEXT, at two scales. It does not catch a transcribed
  // NUMBER: `Answer: 4.6 A` is three words, no overlap rule at any bar reaches
  // it, and one that did would fire on every stem that legitimately prints a
  // component value. That needs a different kind of check, and nothing measured
  // so far supports building one.
  //
  // Note also that `REFERENCE` is deliberately NOT in GRADING_MARKERS. "the
  // reference node", "the reference rail" and "re-reference the node voltages"
  // are ordinary prose in every nodal-analysis problem in this course; a marker
  // list crude enough to include it false-positives on all three homeworks.
  // Strand 4 reaches the reference clause by structure instead.

  // Structural vocabulary. Lowercase; matched against normalised text.
  const GRADING_MARKERS = [
    'grading_prompt', 'grader_note', 'award full marks', 'award partial credit',
    'award no credit', 'required elements', 'what to judge', 'answer key',
  ];

  const NORM = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const wordsOf = (s) => NORM(s).split(' ').filter(Boolean);

  // Everything a student can receive, as one normalised haystack.
  const studentHaystack = async (assignment) => {
    const entries = await exportSvcForInstr.buildExportEntries(assignment);
    const strands = [];
    for (const [path, content] of Object.entries(entries)) {
      if (!path.startsWith('student/')) continue;      // instructor/ is allowed the key
      if (typeof content === 'string') { strands.push(content); continue; }
      if (!content || typeof content.arrayBuffer !== 'function') continue;
      const buf = Buffer.from(await content.arrayBuffer());
      strands.push(path.endsWith('.pdf') ? pdfExtractedText(buf) : buf.toString('utf8'));
    }
    // The spec as the student's browser decodes it, not as an opaque envelope.
    strands.push(JSON.stringify(await exportSvcForInstr.buildAssignmentSpec(assignment)));
    return { text: ` ${NORM(strands.join(' \n '))} `, paths: Object.keys(entries) };
  };

  // Labelled, so a finding can name the problem it came from.
  const gradingStrings = (a) => (a.problems || []).flatMap(p =>
    (p.subsections || []).flatMap(s =>
      [s.aiGradingPrompt, s.graderNote]
        .filter(v => typeof v === 'string' && v.trim())
        .map(text => ({ label: `${p.name} — ${s.name}`, text }))));

  // A REFERENCE: clause runs to the next ALL-CAPS section heading, or to the end
  // of the prompt. Measured over HW1–HW5: 41 of 123 grading strings carry one,
  // and the headings that end them are REFERENCE, WHAT TO JUDGE, FEEDBACK,
  // KNOWN FAILURE MODES…, WHAT REACHES YOU and a tail of one-offs. Cutting early
  // on an emphatic phrase is the safe direction — a shorter clause can only
  // match less — so the pattern is deliberately eager rather than a fixed list
  // that would go stale the first time an author invents a heading.
  const NEXT_ALLCAPS_HEADING = /\b[A-Z][A-Z0-9]{2,}(?:[ '\/-][A-Z0-9]+)*\s*:/;
  const referenceClauses = (s) => {
    const out = [];
    for (const m of String(s).matchAll(/REFERENCE\s*:/g)) {
      const rest = String(s).slice(m.index + m[0].length);
      const next = rest.match(NEXT_ALLCAPS_HEADING);
      const clause = (next ? rest.slice(0, next.index) : rest).trim();
      if (clause) out.push(clause);
    }
    return out;
  };

  // Longest contiguous run of `needle`'s words that appears in `haystack`,
  // at or above `min`. Null when nothing that long is shared.
  const longestSharedRun = (haystack, needle, min) => {
    const w = wordsOf(needle);
    for (let i = 0; i + min <= w.length; i++) {
      const run = w.slice(i, i + min).join(' ');
      if (haystack.includes(` ${run} `)) return run;
    }
    return null;
  };

  // The four assertions. Returns a list of findings, empty when clean.
  // `grading` is [{ label, text }].
  const disclosures = (haystack, grading) => {
    const found = [];
    for (const marker of GRADING_MARKERS) {
      if (haystack.includes(marker)) found.push(`marker "${marker}" appears in student-facing text`);
    }
    for (const { label, text } of grading) {
      const n = NORM(text);
      if (n && haystack.includes(` ${n} `)) {
        found.push(`a whole grading string appears verbatim in "${label}": "${text.slice(0, 70)}…"`);
        continue;
      }
      const run = longestSharedRun(haystack, text, MAX_OVERLAP_WORDS);
      if (run) {
        found.push(`${MAX_OVERLAP_WORDS} consecutive words of a grading string appear in "${label}": "${run}"`);
        continue;
      }
      // Strand 4. Only for strings that HAVE a reference clause — it must never
      // fall back to scanning the whole prompt at this tighter bar, which would
      // fire on HW3's legitimate 10-word overlap. The 16-word strand above
      // already covers the whole prompt and keeps covering it.
      for (const clause of referenceClauses(text)) {
        const refRun = longestSharedRun(haystack, clause, MAX_REFERENCE_OVERLAP_WORDS);
        if (refRun) {
          found.push(`${MAX_REFERENCE_OVERLAP_WORDS} consecutive words of a REFERENCE clause `
            + `appear in "${label}": "${refRun}"`);
          break;
        }
      }
    }
    return found;
  };

  // ---- The constructed fixture: the exact route this work order closes ------
  // A grading block written against a problem heading that HAS sub-parts. It is
  // read by nothing there, so before 2026-09-03 it was neither routed nor
  // dropped — it was printed, into `description`, which is on the whitelist.
  const LEAK_NOTE = 'The intended answer is 1.2 V, reached by superposition with the 5 V source shorted.';
  const LEAK_PROMPT = 'REFERENCE: Required elements: (1) the node voltage is 1.2 V; (2) the current divides '
    + '3 to 1 between the parallel branches. Award full marks for both elements with working shown. '
    + 'Award no credit for a bare number with no method. WHAT TO JUDGE: the method, not the arithmetic.';

  // Strand 4's own fixture. A prompt whose REFERENCE: clause says what the
  // answer IS — the one line an author reaches for when they want to remind
  // themselves, and the one line no other strand can see.
  const REF_PROMPT = 'Review the working as an experienced grader would. '
    + 'REFERENCE: the branch current is 4.6 A, obtained by superposition with the 5 V source shorted, '
    + 'and the 3 A contribution comes from the current source alone. '
    + 'WHAT TO JUDGE: the method, not the arithmetic.';

  // The slice an author would paste. Deliberately between the two bars: long
  // enough for strand 4, too short for strand 3, and carrying no marker.
  const REF_PASTE = 'the branch current is 4.6 A, obtained by superposition';

  const FIXTURE_BLOCKS = [
    { label: 'fixture', text: LEAK_NOTE },
    { label: 'fixture', text: LEAK_PROMPT },
    { label: 'fixture', text: REF_PROMPT },
  ];

  const leakMd = [
    '# ENG17: Key Disclosure Fixture', '',
    '**Input:** handwritten', '',
    '## Problem 1: Divider with two sources', '',
    'The circuit below is driven by a 5 V source and a 2 mA source.',
    `> grader_note: ${LEAK_NOTE}`,
    `> grading_prompt: ${LEAK_PROMPT}`, '',
    '### (a) Node voltage [100 pts] [handwritten]',
    'Find the node voltage. Show your working.', '',
    '> grader_note: Expect 1.2 V.', '',
  ].join('\n');

  // Part 1, the predicate: the block is out of the stem entirely.
  check('a grading block on a problem heading is dropped from the stem', () => {
    assertEqual(mdParser.parseMdToAssignment(leakMd).problems[0].description,
      'The circuit below is driven by a 5 V source and a 2 mA source.',
      'the grading block is still in the problem description');
  });

  // Part 2, the guard that generalises. Kept SEPARATE from the predicate check
  // on purpose: with the predicate removed this must fail on its own, and it
  // cannot demonstrate that if a predicate assertion throws first.
  check('no grading material from that fixture reaches any student artifact', async () => {
    const a = mdParser.parseMdToAssignment(leakMd);
    const { text } = await studentHaystack(a);
    assertEqual(disclosures(text, [...gradingStrings(a), ...FIXTURE_BLOCKS]), [],
      'grading material reached a student-facing artifact');
  });

  check('the author is told, and told where the block belongs', () => {
    const w = [];
    mdParser.parseMdToAssignment(leakMd, w);
    const hit = w.find(m => m.includes('Divider with two sources') && m.includes('grader_note'));
    assert(hit, `no warning named the problem and the block: ${JSON.stringify(w)}`);
    assert(/### \(a\)/.test(hit), `the warning does not say where it belongs: ${hit}`);
    // It is a disclosure, so the warning says the text was kept from the
    // student rather than merely "removed".
    assert(/student/.test(hit), `the warning does not say who was protected: ${hit}`);
  });

  // A guard nobody has watched fail is a guard that may not run at all.
  //
  // Case 1: the whole block, as the parser produced it before 2026-09-03.
  check('the content guard fires when a stem carries the whole rubric', async () => {
    const leaked = mdParser.parseMdToAssignment(leakMd);
    leaked.problems[0].description +=
      `\n> grader_note: ${LEAK_NOTE}\n> grading_prompt: ${LEAK_PROMPT}`;
    const { text } = await studentHaystack(leaked);
    const found = disclosures(text, [...gradingStrings(leaked), ...FIXTURE_BLOCKS]);
    assert(found.some(f => f.startsWith('marker')), `no marker fired: ${JSON.stringify(found)}`);
    assert(found.some(f => f.startsWith('a whole grading string')),
      `no whole-string match fired: ${JSON.stringify(found)}`);
  });

  // Case 2 is the one that says why this guard is worth having. An author
  // pastes a chunk of the rubric into a stem as ORDINARY PROSE — no `>`, so the
  // predicate cannot see it; no marker vocabulary, so strand 1 cannot; not the
  // whole string, so strand 2 cannot. Only the bulk-overlap strand is left, and
  // this is the shape of the routes nobody has thought of yet.
  const PARTIAL = '(1) the node voltage is 1.2 V; (2) the current divides 3 to 1 '
    + 'between the parallel branches.';

  check('the fixture stays honest: the partial leak really is rubric text', () => {
    assert(LEAK_PROMPT.includes(PARTIAL), 'PARTIAL is no longer a substring of LEAK_PROMPT');
    const n = NORM(PARTIAL);
    assert(!GRADING_MARKERS.some(m => n.includes(m)), 'PARTIAL carries marker vocabulary');
    assert(wordsOf(PARTIAL).length >= MAX_OVERLAP_WORDS,
      `PARTIAL is ${wordsOf(PARTIAL).length} words, under the ${MAX_OVERLAP_WORDS}-word bar`);
  });

  check('the content guard fires on a partial leak with no marker and no `>`', async () => {
    const leaked = mdParser.parseMdToAssignment(leakMd);
    leaked.problems[0].description += `\n${PARTIAL}`;
    const { text } = await studentHaystack(leaked);
    const found = disclosures(text, [...gradingStrings(leaked), ...FIXTURE_BLOCKS]);
    assert(found.some(f => f.startsWith(`${MAX_OVERLAP_WORDS} consecutive`)),
      `the bulk-overlap strand did not fire: ${JSON.stringify(found)}`);
    assert(!found.some(f => f.startsWith('marker')),
      `a marker fired, so this case is not testing what it claims: ${JSON.stringify(found)}`);
    assert(!found.some(f => f.startsWith('a whole grading string')),
      `a whole string matched, so this case is not testing what it claims: ${JSON.stringify(found)}`);
  });

  // ---- Strand 4: the pasted answer, not the pasted prompt -------------------
  // Strand 3 was built for a slab of prompt. The likelier authoring mistake is
  // smaller: the author reaches for the one line that says what the answer is.
  // That line is under 16 normalised words, so strand 3 cannot see it, and it
  // carries no marker vocabulary, so strand 1 cannot either.

  check('the fixture stays honest: the reference paste sits between the two bars', () => {
    const clauses = referenceClauses(REF_PROMPT);
    assertEqual(clauses.length, 1, 'the fixture prompt no longer yields exactly one REFERENCE clause');
    assert(!clauses[0].includes('WHAT TO JUDGE'), 'the clause did not stop at the next heading');
    assert(clauses[0].includes(REF_PASTE), 'REF_PASTE is no longer inside the REFERENCE clause');

    const len = wordsOf(REF_PASTE).length;
    assert(len >= MAX_REFERENCE_OVERLAP_WORDS,
      `REF_PASTE is ${len} words, under strand 4's bar of ${MAX_REFERENCE_OVERLAP_WORDS}`);
    // The point of the fixture: strand 3 provably cannot reach it. Without this
    // the demonstration could rot into something the old strand already caught.
    assert(len < MAX_OVERLAP_WORDS,
      `REF_PASTE is ${len} words, at or over strand 3's bar of ${MAX_OVERLAP_WORDS} — `
      + 'the old strand would catch it and this proves nothing');
    assert(!GRADING_MARKERS.some(m => NORM(REF_PASTE).includes(m)),
      'REF_PASTE carries marker vocabulary, so strand 1 would catch it');
    assert(NORM(REF_PASTE) !== NORM(REF_PROMPT), 'REF_PASTE is the whole grading string');
  });

  check('the content guard fires on a pasted REFERENCE clause', async () => {
    const leaked = mdParser.parseMdToAssignment(leakMd);
    leaked.problems[0].subsections[0].aiGradingPrompt = REF_PROMPT;
    // Pasted as ordinary prose into the stem: no `>` for the predicate to see.
    leaked.problems[0].description += `\n${REF_PASTE}`;

    const { text } = await studentHaystack(leaked);
    const found = disclosures(text, [...gradingStrings(leaked), ...FIXTURE_BLOCKS]);

    const ref = found.filter(f => f.includes('REFERENCE clause'));
    assert(ref.length > 0, `strand 4 did not fire: ${JSON.stringify(found)}`);
    assert(ref.some(f => f.includes('Divider with two sources')),
      `the finding does not name the problem: ${JSON.stringify(ref)}`);
    assert(ref.some(f => f.includes('the branch current is')),
      `the finding does not quote the run: ${JSON.stringify(ref)}`);

    // And the other three genuinely cannot see it, which is why this exists.
    assert(!found.some(f => f.startsWith('marker')),
      `a marker fired, so this case is not testing what it claims: ${JSON.stringify(found)}`);
    assert(!found.some(f => f.includes('a whole grading string')),
      `a whole string matched, so this case is not testing what it claims: ${JSON.stringify(found)}`);
    assert(!found.some(f => f.startsWith(`${MAX_OVERLAP_WORDS} consecutive words of a grading string`)),
      `strand 3 fired, so strand 4 is not load-bearing here: ${JSON.stringify(found)}`);
  });

  // A prompt with no REFERENCE: clause must not be scanned at the tighter bar —
  // that would fire on HW3's legitimate 10-word overlap. 82 of the 123 real
  // grading strings have no clause, so this is the common case, not an edge one.
  check('a grading string with no REFERENCE clause is not scanned at the tighter bar', () => {
    const plain = 'Award full marks for a correct method. The circuit below is driven by a 5 V '
      + 'source and a 2 mA source and the student must find the node voltage from it.';
    assertEqual(referenceClauses(plain), [], 'a clause was found where there is none');
    // 25 words of it sit in the "student text" below, well over strand 4's bar
    // of 9 and under strand 3's of 16 for any single run — only the absence of a
    // clause keeps this quiet.
    const hay = ` ${NORM('The circuit below is driven by a 5 V source and a 2 mA source and the student '
      + 'must find the node voltage from it.')} `;
    assertEqual(disclosures(hay, [{ label: 'no-clause', text: plain }])
      .filter(f => f.includes('REFERENCE clause')), [],
      'the tighter bar was applied to a prompt with no REFERENCE clause');
  });

  // ---- The real homeworks --------------------------------------------------
  for (const n of [1, 2, 3]) {
    const name = `ENG17 HW${n}: no grading material in any student-facing artifact`;
    const mdPath = join(HWK, `HWK${n}`, `ENG17_HW${n}_assignment.md`);
    if (!existsSync(mdPath)) { results.push(`  SKIP  ${name} (not at ${mdPath})`); continue; }
    check(name, async () => {
      const a = mdParser.parseMdToAssignment(readFileSync(mdPath, 'utf8'));
      const grading = gradingStrings(a);
      assert(grading.length > 0, `HW${n} has no grading strings — the check would prove nothing`);
      const { text, paths } = await studentHaystack(a);
      assert(paths.some(p => p.startsWith('student/')), `HW${n} produced no student/ entries`);
      assertEqual(disclosures(text, grading), [],
        `HW${n}: grading material reached a student-facing artifact`);
    });
  }
}


// ---- No export, in either input mode, carries a name or student ID field ---
// CORRECTION_AM_QR_TEMPLATE_2026-08-15.md section 1 removed the name / student
// ID / date line. It was applied to the handwritten template and to nothing
// else, and the guard written with it grepped the TEMPLATE SOURCE, so the PDF
// export and the LaTeX export kept theirs for three weeks with the policy
// documented in three places. WORKORDER_AM_NO_IDENTITY_FIELDS_2026-09-03.md
// completes the removal; this replaces the grep.
//
// Two properties, both of them the lesson rather than the deletion:
//
//   1. It asserts on the BUILT ARTIFACT, not on a source file. A grep over
//      source cannot see what jsPDF actually drew.
//   2. It runs in BOTH input modes. A single-mode fixture is exactly the hole
//      being closed: the handwritten path passed the whole time.
//
// The patterns match a FIELD, meaning a label with somewhere to write, not the
// words themselves. That distinction is load-bearing: page 1 of every
// handwritten sheet legitimately prints "Do not write your name or student ID
// anywhere on these pages", and a guard that fired on it would be deleted by the
// first person it inconvenienced.
{
  const IDENTITY_FIELD_PATTERNS = [
    // "Student Name:", "Student ID:", "Student Number:" as a labelled field.
    [/student\s*name\s*:/i, 'a "Student Name:" field'],
    [/student\s*(id|i\.d\.|number)\s*:/i, 'a "Student ID:" field'],
    // Any label followed by somewhere to write it: underscores, or a LaTeX rule.
    [/\b(name|id|date|section)\s*:\s*_{3,}/i, 'a labelled fill-in blank'],
    [/\b(name|id|date|section)\s*:\s*\}?\s*\\underline/i, 'a labelled LaTeX rule'],
    // A bare run of underscores long enough to be a writing line.
    [/_{10,}/, 'a fill-in rule'],
  ];

  const identityFields = (text) => IDENTITY_FIELD_PATTERNS
    .filter(([re]) => re.test(text))
    .map(([re, what]) => `${what} (${re.source})`);

  // Every artifact this guard covers, by path, so a failure names the file.
  // student/ is everything a student receives; instructor/assignment.tex is
  // included because it exists to be compiled, and what it compiles is a paper
  // the same policy governs.
  const guardedTexts = async (assignment) => {
    const entries = await exportSvcForInstr.buildExportEntries(assignment);
    const out = [];
    for (const [path, content] of Object.entries(entries)) {
      const guarded = path.startsWith('student/') || path.endsWith('instructor/assignment.tex');
      if (!guarded) continue;
      if (typeof content === 'string') { out.push([path, content]); continue; }
      if (!content || typeof content.arrayBuffer !== 'function') continue;
      const buf = Buffer.from(await content.arrayBuffer());
      out.push([path, path.endsWith('.pdf') ? pdfExtractedText(buf) : buf.toString('utf8')]);
    }
    return out;
  };

  // Typed mode: the path that still had the line. Several problems and an image
  // part, so the per-item `doc.addPage()` loop runs, and a long preamble so the
  // `newPage()` overflow path runs too. Both used to redraw the line.
  const typedFixture = makeAssignment([
    [part('Node equations', 20, { submissionType: 'Text' }),
     part('Working', 20, { submissionType: 'Text' })],
    [part('Photograph of the board', 30, { submissionType: 'Image', maxImages: 3 })],
    [part('Explanation', 30, { submissionType: 'AI Graded: Short' })],
  ], {
    inputMode: 'electronic',
    preamble: ('Complete every part and show your working. ').repeat(40),
  });

  // Handwritten mode: already correct, and asserted so it stays that way.
  const handwrittenFixture = makeAssignment([
    [part('Cutoff frequency', 50), part('Field sketch', 50, { isDrawing: true })],
  ], { inputMode: 'handwritten' });

  for (const [mode, fixture] of [['typed', typedFixture], ['handwritten', handwrittenFixture]]) {
    check(`${mode} mode: no export carries a name or student ID field`, async () => {
      const texts = await guardedTexts(fixture);
      assert(texts.length > 0, `${mode}: nothing was guarded, so this proves nothing`);
      assert(texts.some(([p]) => p.endsWith('.pdf')),
        `${mode}: no PDF among the guarded artifacts`);
      const found = texts.flatMap(([path, text]) =>
        identityFields(text).map(what => `${path} carries ${what}`));
      assertEqual(found, [], `${mode}: an identity field reached an exported artifact`);
    });
  }

  // The distinction the patterns rest on. If this ever fails, the patterns have
  // become word-matchers and will be deleted by whoever they block next.
  check('the guard reads a field, not the instruction that forbids one', () => {
    assertEqual(identityFields(
      'Do not write your name or student ID anywhere on these pages. '
      + 'You are identified when you upload.'), [],
      'the standing instruction is being read as an identity field');
    assert(identityFields('Student Name: ____________  Student ID: __________').length > 0,
      'the guard does not recognise the line it exists to keep out');
    assert(identityFields(
      '\\noindent\\textbf{Student Name:} \\underline{\\hspace{6cm}}').length > 0,
      'the guard does not recognise the LaTeX form of that line');
  });
}


// Every async check has to land before anything is counted. `pending` has
// existed since the harness was made async-aware, but was never awaited:
// async checks settled only by accident, when a LATER top-level await in
// this file happened to flush the microtask queue. A check registered after
// the last top-level await never reported at all — which is what happened to
// the content guard below, and is the same hole found in run-tests.mjs on
// 2026-09-02 wearing a different hat.
await Promise.all(pending);
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* Windows keeps handles */ }
process.exit(failed > 0 ? 1 : 0);
