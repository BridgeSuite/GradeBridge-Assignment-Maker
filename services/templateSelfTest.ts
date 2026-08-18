/**
 * templateSelfTest.ts — spec 8.7, "required before release".
 *
 * "A template failing any check is not emitted." The generator throws on any
 * failure rather than handing back a PDF, because a non-compliant template
 * registers perfectly and then crops the wrong rectangles, with no error raised
 * anywhere downstream.
 *
 * Checks 1–7 run here, on every generation, with no DOM and no rasteriser.
 *
 * Check 8 ("render the PDF and run the real detector over it") is the one check
 * that needs pixels. Its purpose in the spec is to catch a missing xelatex pass
 * — a failure mode the jsPDF path does not have, since coordinates are absolute
 * from the first draw and never converge over passes. It runs in `npm test`
 * instead (tests/templateTests.mjs): a 300 dpi raster of the emitted geometry,
 * a real QR decode asserting alphanumeric mode and version 4, and the spec 3.2
 * mark detector asserting 4 of 4 at the nominal centres. Running it per
 * generation would add a rasteriser to the bundle to re-check geometry that is
 * constant across every template this app can produce; running it per code
 * change, over several assignment shapes, tests the same thing where it can
 * actually regress.
 */

import { Assignment } from '../types';
import {
  IDENTITY_BAND_MM, QR_KEEPOUT_MM, QR_PAYLOAD_MAX_CHARS, REGION_X_MAX_MM, REGION_X_MIN_MM,
  fractionRectToMm, rectsOverlap, safeAreaViolations,
} from './pageFormat';
import {
  PAYLOAD_RE, computeLayoutId, parsePayload, payloadViolations,
} from './qrPayload';
import { LayoutRow, TemplateLayout, csvUnsafeFields, enumerateParts } from './templateLayout';
import { encodeQr } from './qrEncoder';
import { QR_MODULES, QR_VERSION } from './pageFormat';

export interface SelfTestCheck {
  id: number;
  name: string;
  passed: boolean;
  detail?: string;
}

export interface SelfTestReport {
  passed: boolean;
  checks: SelfTestCheck[];
  failures: string[];
  /** Non-fatal notes — clamped region heights and the like. */
  warnings: string[];
}

export interface SelfTestInput {
  assignment: Assignment;
  layout: TemplateLayout;
  rows: LayoutRow[];
  payloads: string[];
  layoutId: string;
  csv: string;
}

export const runSelfTest = async (input: SelfTestInput): Promise<SelfTestReport> => {
  const { assignment, layout, rows, payloads, layoutId } = input;
  const checks: SelfTestCheck[] = [];
  const add = (id: number, name: string, problems: string[]) =>
    checks.push({ id, name, passed: problems.length === 0, detail: problems.join('; ') || undefined });

  // 1. Every part in the source assignment is in the map, nothing else is, and
  //    no region_id repeats.
  //
  //    Note the shape: a part may own MORE THAN ONE region. A problem with a
  //    single sub-part gets a second page of writing space for the same answer,
  //    so two rows share that `part_id` and differ by `region_id`. The spec
  //    requires region_id unique and treats part_id as a display string, so this
  //    is legal — but a consumer that assumed one crop per part would be
  //    surprised, which is why it is called out here and in the map's docs.
  {
    const expected = enumerateParts(assignment);
    const expectedParts = new Set(expected.map(p => p.partId));
    const problems: string[] = [];

    const seen = new Map<string, number>();
    for (const r of rows) seen.set(r.regionId, (seen.get(r.regionId) || 0) + 1);
    for (const [id, n] of seen) if (n > 1) problems.push(`region_id ${id} appears ${n} times`);

    const gotParts = new Set(rows.map(r => r.partId));
    for (const p of expectedParts) if (!gotParts.has(p)) problems.push(`part ${p} is missing from the map`);
    for (const p of gotParts) if (!expectedParts.has(p)) problems.push(`part ${p} is in the map but not in the assignment`);

    add(1, 'every part is in the map, nothing extra is, and every region_id is unique', problems);
  }

  // 2. max_points present and positive on every row.
  add(2, 'max_points present and positive on every row',
    rows.filter(r => !(typeof r.maxPoints === 'number' && isFinite(r.maxPoints) && r.maxPoints > 0))
      .map(r => `${r.regionId} has max_points ${JSON.stringify(r.maxPoints)}`));

  // 3. Every rectangle satisfies every safe-area rule in 4.4.
  add(3, 'every rectangle satisfies the safe areas (spec 4.4)',
    rows.flatMap(r => safeAreaViolations(fractionRectToMm(r)).map(v => `${r.regionId}: ${v}`)));

  // 4. No two rectangles on the same page overlap.
  {
    const problems: string[] = [];
    const byPage = new Map<number, LayoutRow[]>();
    for (const r of rows) byPage.set(r.pageK, [...(byPage.get(r.pageK) || []), r]);
    for (const [page, pageRows] of byPage) {
      for (let i = 0; i < pageRows.length; i++) {
        for (let j = i + 1; j < pageRows.length; j++) {
          if (rectsOverlap(fractionRectToMm(pageRows[i]), fractionRectToMm(pageRows[j]))) {
            problems.push(`page ${page}: ${pageRows[i].regionId} overlaps ${pageRows[j].regionId}`);
          }
        }
      }
    }
    add(4, 'no two rectangles on a page overlap', problems);
  }

  // 5. Every payload is <= 44 chars, matches the 2.1 grammar, alphanumeric charset only.
  {
    const problems = payloads.flatMap((p, i) => payloadViolations(p).map(v => `page ${i + 1}: ${v}`));
    payloads.forEach((p, i) => {
      const f = parsePayload(p);
      if (!f) return; // already reported by payloadViolations
      if (f.k !== i + 1) problems.push(`page ${i + 1}: payload says k=${f.k}`);
      if (f.n !== layout.pageCount) problems.push(`page ${i + 1}: payload says N=${f.n}, expected ${layout.pageCount}`);
    });
    add(5, `every payload is <= ${QR_PAYLOAD_MAX_CHARS} chars, matches the grammar, and is alphanumeric-safe`, problems);
  }

  // 6. The rendered symbol's mode and version.
  //    The encoder pins both at the call rather than letting the library choose,
  //    so this asserts the forced settings took (a wrong module count means the
  //    version pin did not). tests/templateTests.mjs additionally decodes a real
  //    raster and asserts what the decoder reports, per the work order.
  {
    const problems: string[] = [];
    for (let i = 0; i < payloads.length; i++) {
      try {
        const m = encodeQr(payloads[i]);
        if (m.moduleCount !== QR_MODULES) problems.push(`page ${i + 1}: ${m.moduleCount} modules, expected ${QR_MODULES}`);
        if (m.version !== QR_VERSION) problems.push(`page ${i + 1}: version ${m.version}, expected ${QR_VERSION}`);
        if (m.mode !== 'alphanumeric') problems.push(`page ${i + 1}: mode ${m.mode}, expected alphanumeric`);
      } catch (err) {
        problems.push(`page ${i + 1}: ${(err as Error).message}`);
      }
    }
    add(6, 'the symbol encodes in alphanumeric mode at version 4', problems);
  }

  // 7. layout_id in every QR equals the hash of the emitted map.
  {
    const problems: string[] = [];
    const recomputed = await computeLayoutId(rows.map(r => ({
      regionId: r.regionId, partId: r.partId, pageK: r.pageK,
      x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
    })));
    if (recomputed !== layoutId) {
      problems.push(`the map hashes to ${recomputed} but the template carries ${layoutId}`);
    }
    for (const r of rows) {
      if (r.layoutId !== layoutId) problems.push(`row ${r.regionId} carries layout_id ${r.layoutId}`);
    }
    payloads.forEach((p, i) => {
      const f = parsePayload(p);
      if (f && f.layoutId !== layoutId) problems.push(`page ${i + 1} QR carries layout_id ${f.layoutId}`);
    });
    add(7, 'layout_id in every QR equals the hash of the emitted map', problems);
  }

  // Emission hygiene beyond the eight: the CSV is written unquoted, matching the
  // spec's worked example, so a metacharacter in any field would corrupt it.
  add(0, 'no field carries a CSV metacharacter', csvUnsafeFields(rows));

  // Grammar sanity on the id itself, so a bad override fails loudly here rather
  // than producing a symbol nothing can parse.
  add(0, 'the assignment_id matches the QR grammar',
    payloads.length && !PAYLOAD_RE.test(payloads[0])
      ? [`"${payloads[0]}" does not parse into six fields`] : []);

  // Question text is never scaled, so a block the page cannot hold is not a
  // warning about slightly small print any more — it is a template that would
  // print its question over the writing area. Refuse it, and say which part and
  // by how much, because "split the problem" is the only fix and the author is
  // the only one who can make it.
  add(0, 'every question fits the page at full size',
    layout.clamped.map(c =>
      `part ${c.partId} needs ${c.requestedMm} mm of question text; a page has room for ${c.usedMm} mm ` +
      `beside an answer. Text is never shrunk to fit — split the problem, or move detail into the sub-parts.`
    ));

  const failures = checks.filter(c => !c.passed).map(c => `check ${c.id || '–'} — ${c.name}: ${c.detail}`);

  return { passed: failures.length === 0, checks, failures, warnings: [] };
};

// ---- Post-draw: what actually landed on the page -------------------------

export interface InkRect { pageK: number; what: string; x0: number; y0: number; x1: number; y1: number }

const intersects = (a: InkRect, b: { x0: number; y0: number; x1: number; y1: number }): boolean =>
  a.x0 < b.x1 - 0.01 && a.x1 > b.x0 + 0.01 && a.y0 < b.y1 - 0.01 && a.y1 > b.y0 + 0.01;

/**
 * Checks 1–7 look at the layout. These look at what was drawn, which is not the
 * same thing: a prompt row can sit at a legal y while its right-aligned points
 * label overruns into the QR's column, and a label over the modules can stop the
 * symbol decoding. The layout cannot see that; the ink can.
 *
 * Runs after the pages are drawn and before the blob is handed back, so a
 * collision is still "a template failing any check is not emitted".
 */
export const runInkChecks = (ink: InkRect[], base: SelfTestReport): SelfTestReport => {
  const checks = [...base.checks];
  const add = (name: string, problems: string[]) =>
    checks.push({ id: 0, name, passed: problems.length === 0, detail: problems.join('; ') || undefined });

  const describe = (b: InkRect) =>
    `page ${b.pageK} ${b.what} at x ${b.x0.toFixed(1)}–${b.x1.toFixed(1)}, y ${b.y0.toFixed(1)}–${b.y1.toFixed(1)} mm`;

  // Nothing the generator draws may touch the QR keep-out. The QR itself and its
  // quiet field are drawn separately and never recorded as ink.
  add('nothing printed enters the QR keep-out (spec 4.4)',
    ink.filter(b => intersects(b, QR_KEEPOUT_MM)).map(describe));

  // The band holds the QR, the header line and the two top marks, nothing else.
  add('nothing but the header line is printed in the identity band (spec 4.5)',
    ink.filter(b => b.y0 < IDENTITY_BAND_MM && b.what !== 'header line').map(describe));

  add('every printed row stays inside the writing column',
    ink.filter(b => b.what !== 'header line')
      .filter(b => b.x0 < REGION_X_MIN_MM - 0.01 || b.x1 > REGION_X_MAX_MM + 0.01)
      .map(describe));

  // Ink against ink. The zone checks above compare what was drawn to fixed
  // rectangles; they cannot see two blocks landing on top of each other, which
  // is how the print instruction ended up inside the preamble. Tolerance is
  // 0.5 mm because vector-text boxes are estimated from font metrics, not
  // measured — enough slack to avoid noise, far less than a real collision.
  {
    const TOL = 0.5;
    const clashes: string[] = [];
    for (let i = 0; i < ink.length; i++) {
      for (let j = i + 1; j < ink.length; j++) {
        const a = ink[i], b = ink[j];
        if (a.pageK !== b.pageK) continue;
        if (a.x0 < b.x1 - TOL && a.x1 > b.x0 + TOL && a.y0 < b.y1 - TOL && a.y1 > b.y0 + TOL) {
          clashes.push(`${describe(a)} overlaps ${describe(b)}`);
        }
      }
    }
    add('no two printed blocks overlap each other', clashes);
  }

  const failures = checks.filter(c => !c.passed).map(c => `check ${c.id || '–'} — ${c.name}: ${c.detail}`);
  return { passed: failures.length === 0, checks, failures, warnings: base.warnings };
};
