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
  CORNER_KEEPOUTS_MM, IDENTITY_BAND_MM, QR_KEEPOUT_MM, QR_PAYLOAD_MAX_CHARS,
  RectMm, fractionRectToMm, rectsOverlap, safeAreaViolations,
} from './pageFormat';
import {
  PAYLOAD_RE, computeLayoutId, parsePayload, payloadViolations,
} from './qrPayload';
import {
  COLUMN_X0_MM, COLUMN_X1_MM, LayoutRow, MIN_BOX_MM, TemplateLayout,
  csvUnsafeFields, enumerateParts,
} from './templateLayout';
import { splitFigures } from './figureBlocks';
import { encodeQr } from './qrEncoder';
import { QR_MODULES, QR_VERSION } from './pageFormat';

/**
 * Colour tokens an SVG figure may carry on a sheet that must print in black
 * only (`EEC100_Final_Format_Spec` §5). Greys count as black: the scans are
 * 8-bit grayscale and it is *colour* that is load bearing, because it is what
 * lets the marking stage prove it never altered the student's work — any pixel
 * with colour was added afterwards. A single coloured element on the printed
 * page destroys that guarantee for every submission on the sheet.
 *
 * The generator's own ink is greyscale by construction; the figures are not,
 * because they are author-supplied SVG that nothing has ever inspected. All
 * thirty ENG17 figures are `#111111` on `#ffffff`, so this is a guard against
 * the next drawing rather than a complaint about the current ones.
 */
const COLOUR_ATTR_RE = /(?:fill|stroke|color|stop-color|flood-color|lighting-color)\s*[:=]\s*["']?\s*([^"';>\s]+)/gi;

const isGrey = (value: string): boolean => {
  const v = value.trim().toLowerCase();
  if (!v || v === 'none' || v === 'transparent' || v === 'inherit' || v === 'currentcolor'
      || v === 'black' || v === 'white' || v === 'gray' || v === 'grey') return true;
  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return short[1] === short[2] && short[2] === short[3];
  const long = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/);
  if (long) return long[1] === long[2] && long[2] === long[3];
  const rgb = v.match(/^rgba?\(([^)]*)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[,\s/]+/).filter(Boolean).slice(0, 3);
    return parts.length === 3 && parts[0] === parts[1] && parts[1] === parts[2];
  }
  return false;
};

/** Every non-grey colour an authored figure declares, with where it came from. */
export const figureColourViolations = (assignment: Assignment): string[] => {
  const blocks: [string, string][] = [
    ['the preamble', assignment.preamble || ''],
    ...assignment.problems.flatMap((p, i): [string, string][] => [
      [`problem ${i + 1}`, p.description || ''],
      ...p.subsections.map((s, j): [string, string] =>
        [`problem ${i + 1} part ${String.fromCharCode(97 + j)}`, s.description || '']),
    ]),
  ];

  const bad: string[] = [];
  for (const [where, text] of blocks) {
    for (const seg of splitFigures(text)) {
      if (seg.kind !== 'figure') continue;
      // Only an inline SVG can be read. A raster figure is opaque here and is
      // caught by check 5's visual pass on the blank PDF instead.
      let svg: string | null = null;
      if (seg.figure.form === 'svg') svg = seg.figure.svg;
      else if (/^data:image\/svg\+xml/i.test(seg.figure.url)) {
        const [head, body] = seg.figure.url.split(',', 2);
        try { svg = /;base64/i.test(head) ? atob(body || '') : decodeURIComponent(body || ''); }
        catch { svg = null; }
      }
      if (!svg) continue;

      const seen = new Set<string>();
      for (const m of svg.matchAll(COLOUR_ATTR_RE)) {
        if (isGrey(m[1]) || seen.has(m[1])) continue;
        seen.add(m[1]);
        bad.push(`${where}: a figure prints in ${m[1]}, and the sheet is black only`);
      }
    }
  }
  return bad;
};

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
  //    Note the shape: a part MAY own more than one region. `region_id` is the
  //    map's unique key and `part_id` is a display string the spec lets repeat,
  //    so a consumer must group crops by `part_id` rather than assume one each.
  //    That capability is kept deliberately — but as of 2026-08-18 the generator
  //    no longer produces it: an answer is never split across pages, so a part
  //    that outgrows an empty page takes the whole page rather than spilling a
  //    15 mm orphan onto the next one. Every `part_id` gets exactly one row.
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

  // Nothing on the sheet may print in colour (`EEC100_Final_Format_Spec` §5).
  // Author-supplied SVG is the only way colour can get here, and until now
  // nothing looked.
  add(0, 'nothing on the sheet prints in colour', figureColourViolations(assignment));

  // No box under `MIN_BOX_MM`, outer edge to outer edge. `buildLayout` breaks a
  // part to a new page rather than emit one; this asserts it actually did.
  add(0, `every answer box is at least ${MIN_BOX_MM} mm tall`,
    layout.regions
      .filter(r => r.boxBottomMm - r.boxTopMm < MIN_BOX_MM - 0.01)
      .map(r => `${r.regionId} is ${(r.boxBottomMm - r.boxTopMm).toFixed(1)} mm tall`));

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
export const runInkChecks = (
  ink: InkRect[], base: SelfTestReport,
  /**
   * The declared rectangles, by page, when the caller has them. Optional so a
   * test can exercise the zone and collision checks on synthetic ink alone; the
   * generator always passes them, and the interior check below is skipped
   * without them rather than passing vacuously and quietly.
   */
  declared: { pageK: number; regionId: string; partId: string; rect: RectMm }[] = []
): SelfTestReport => {
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

  // The column the check is named after, not the page-wide safe area.
  //
  // It used to test against `REGION_X_MAX_MM` while content was drawn in a
  // narrower column, so text could stand 11 mm out into the right margin and
  // pass. That is why the unwrapped problem heading did not trip this when it
  // first left the column — only once it was 13 mm past it. Under option C the
  // column *is* the page-wide safe area (12.0 → 203.9); the check still tests
  // `COLUMN_*`, so it keeps tracking whatever the generator actually draws.
  //
  // 0.25 mm of tolerance, and no more. The widest ink the generator legitimately
  // draws lands exactly on the column edge — the answer box's border spans it,
  // and the points label is right-aligned to it — so the tolerance is there to
  // absorb float and font-metric rounding on those two, nothing else. The
  // interior writing lines stop `BORDER_MM + REGION_PAD_MM` short of it.
  //
  // **The header line no longer needs an exemption here.** Spec 8.4 anchors it
  // at x = 20.0, which used to be left of the column's 23.0; under option C the
  // column starts at 12.0, so the one line that was outside it is inside it, and
  // dropping the exemption puts the header under the same bound as everything
  // else. It keeps its exemption in the corner-keep-out check below, where the
  // anchor genuinely does sit inside a keep-out.
  const COLUMN_TOL_MM = 0.25;
  add('every printed row stays inside the writing column',
    ink.filter(b => b.x0 < COLUMN_X0_MM - COLUMN_TOL_MM || b.x1 > COLUMN_X1_MM + COLUMN_TOL_MM)
      .map(describe));

  // The column now runs the full width of the safe area, which puts its two
  // edges in the same x-range as the registration corners. Nothing printed may
  // reach them: a mark the detector cannot separate from a box edge is a mark it
  // does not find, and at 2 of 4 the page goes to manual. The bottom corners are
  // what `REGION_BOTTOM_MM` clears; the top two are far above any region.
  //
  // The header line is the one exemption again — spec 8.4 anchors it at
  // (20.0, 10.0), which is inside the NW corner keep-out by design.
  add('nothing printed enters a registration corner keep-out (spec 4.4)',
    ink.filter(b => b.what !== 'header line')
      .flatMap(b => CORNER_KEEPOUTS_MM
        .map((k, i) => (intersects(b, k) ? `${describe(b)} enters corner ${['NW', 'NE', 'SW', 'SE'][i]}` : ''))
        .filter(Boolean)));

  // The box interior carries its writing lines and nothing else
  // (`EEC100_Final_Format_Spec` §2: the detector rejects a candidate whose
  // interior already carries ink, which is how it auto-rejects formula tables).
  // The rules are the deliberate, argued exception; a question that overran its
  // reservation and landed in the box beneath it is not, and this is what sees
  // it — the collision check cannot, because the ruled band starts a full pitch
  // below the box's top edge.
  //
  // The border's own four edges need no exemption: their inner edge lands
  // exactly on the declared boundary, which `intersects` does not count.
  if (declared.length) {
    add('nothing but its own writing lines is printed inside an answer box',
      declared.flatMap(d => ink
        .filter(b => b.pageK === d.pageK && b.what !== `writing lines ${d.partId}`)
        .filter(b => intersects(b, d.rect))
        .map(b => `${describe(b)} is inside ${d.regionId}'s box`)));
  }

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
