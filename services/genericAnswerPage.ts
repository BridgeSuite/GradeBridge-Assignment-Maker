/**
 * genericAnswerPage.ts — the one answer page every generic-sheet assignment uses.
 *
 * Work order: `workorders/WORKORDER_AM_GENERIC_ANSWER_PAGE_2026-09-24.md`, with
 * the four rulings Andre made on 2026-09-24 recorded at its top.
 *
 * **What this replaces, and what it does not.** Today's handwritten sheet does
 * two jobs at once: it prints the instructor's questions in our format, and it
 * gives the student a surface the software can crop. A generic-sheet assignment
 * separates them. The instructor posts their own questions, in their own format,
 * and every student writes on this page — the same page for every assignment in
 * every course. The printed page therefore no longer says which part an answer
 * belongs to. **The student says so in the Submission app**, which writes
 * `part_source: "student"` beside each crop; today's sheet writes `"layout"`.
 *
 * The existing sheet is untouched. This is a second kind of page, chosen per
 * assignment with `sheet: "generic"`, and it is only ever reached from a
 * handwritten assignment.
 *
 * **Everything here is a constant.** The page is course-independent and is
 * generated once and versioned, so its map, its layout id and its QR payload are
 * fixed, and a test holds them fixed. Changing any number below moves
 * `GENERIC_LAYOUT_ID`, which both apps and the spec hold as a constant: that is
 * a new page version (`GBGEN2`), never an edit to this one.
 */

import jsPDF from 'jspdf';
import {
  PAGE_H_MM, PAGE_W_MM, QR_PAYLOAD_MAX_CHARS, QR_MODULES, QR_VERSION,
  HEADER_TEXT_ANCHOR_MM, RectMm, fractionRectToMm, mmRectToFraction, round4, safeAreaViolations,
} from './pageFormat';
import { MASTER_TOKEN, buildPayload, computeLayoutId, parsePayload, payloadViolations } from './qrPayload';
import { encodeQr } from './qrEncoder';
import { BORDER_MM, LayoutRow, csvUnsafeFields, toLayoutCsv } from './templateLayout';
import { InkBox, drawMarks, drawPlain, drawQr } from './templateGenerator';
import { SelfTestCheck, SelfTestReport, runInkChecks } from './templateSelfTest';

// ---- Identity ------------------------------------------------------------

/**
 * The page's own id. It stands in QR field 2 where a printed sheet carries an
 * assignment id, and in the map's `assignment_id` column — **it names the page,
 * not an assignment.** Ruling 2: the QR keeps today's grammar so the Submission
 * app decodes it unchanged.
 */
export const GENERIC_TEMPLATE_ID = 'GBGEN1';

/** The one region's reserved id, and the display string in its `part_id` column. Ruling 4. */
export const GENERIC_REGION_ID = 'gen';
export const GENERIC_PART_ID = 'generic';

/**
 * **The generic page's layout id.** A constant across both apps and the spec,
 * the way `95438EDF` is for ENG17 HW1. `generateGenericAnswerPage` recomputes it
 * from the map and refuses to emit the page if the two disagree, so this number
 * cannot drift silently from the geometry below.
 */
export const GENERIC_LAYOUT_ID = '5F0B10BC';

export const GENERIC_LAYOUT_CSV_NAME = `layout_${GENERIC_TEMPLATE_ID}.csv`;
export const GENERIC_PDF_NAME = `GradeBridge_answer_page_${GENERIC_TEMPLATE_ID}.pdf`;

// ---- Geometry, mm on US Letter -------------------------------------------

/**
 * The printed writing box, outer edge of its 1 pt border.
 *
 * **Ruling 1: it closes at y 257.0, not the 262.0 first drawn.** Spec 4.4 keeps
 * everything printed out of the registration-corner keep-outs, and the bottom
 * pair begins at y 257.4; a box to 262.0 sat beside the bottom corner marks and
 * the 8.7 self-test refuses it. 257.0 is `REGION_BOTTOM_MM`, where today's sheet
 * closes every box for the same reason. The top and every text position stay as
 * approved; the bands are what tightened, from 8.2 mm to 8.0 mm.
 */
export const GENERIC_BOX_MM: RectMm = { x0: 12.0, y0: 57.0, x1: 203.9, y1: 257.0 };

/** 25 writing bands, every one the same height including the first and the last. */
export const GENERIC_BANDS = 25;
export const GENERIC_BAND_MM = 8.0;
/** The feint rules stop this far short of each side of the box. */
export const GENERIC_RULE_INSET_MM = 3.0;

/**
 * The declared rectangle: the box INTERIOR, inside the border stroke, exactly as
 * today's sheet declares its boxes — so no crop carries the border's own ink.
 */
export const GENERIC_DECLARED_MM: RectMm = {
  x0: round4(GENERIC_BOX_MM.x0 + BORDER_MM), y0: round4(GENERIC_BOX_MM.y0 + BORDER_MM),
  x1: round4(GENERIC_BOX_MM.x1 - BORDER_MM), y1: round4(GENERIC_BOX_MM.y1 - BORDER_MM),
};

/** Tops of the printed lines below the identity band, mm. From the approved mockup. */
export const GENERIC_TEXT_TOP_MM = {
  fields: 28.0,
  outsideBox: 37.0,
  identity: 42.5,
  pencil: 47.6,
  printing: 51.6,
} as const;

// ---- The printed strings --------------------------------------------------
//
// **Andre's text, permanent.** A test asserts each one is on the page. None of
// them may grow a label that invites a name, a date or a section: the fields
// line is for the student and for anyone holding loose paper, and nothing ever
// reads it.

export const GENERIC_HEADER_TEXT = `GradeBridge   answer page   ${GENERIC_TEMPLATE_ID}`;
export const GENERIC_FIELDS_TEXT = 'Problem __________   Part __________   Page ______ of ______';
/**
 * FINAL WORDING, 2026-09-25 (WORKORDER_AM_PAGE_FINAL_WORDING_2026-09-25). The
 * page is frozen from this line on: it is printed in bulk and posted to
 * students, and a later change puts two versions in circulation.
 *
 * "One part per page." replaced the morning's "One answer per page.", which did
 * not say whether parts (a) and (b) are one answer or two. "Part" is the word
 * the fields line, the Submission app and the instructor handouts all use.
 * Appended to this line, never a new one: a new line pushes the box down and
 * moves `5F0B10BC`. At 10 pt bold it ends at x ~147.1 mm.
 */
export const GENERIC_OUTSIDE_BOX_TEXT =
  'Write only inside the box. Anything outside it is not collected. One part per page.';
/**
 * The note that "one part per page" is not "one page per part". The work order
 * asked for it on the fields line, beside `Page ___ of ___`; it does not fit
 * there (the line ends at x ~136 mm and the QR keep-out starts at 166, while
 * the note needs ~48 mm even at 8 pt), so it follows the bold line, the order's
 * named fallback. Smaller and lighter than that line, so it reads as a note:
 * 8 pt at grey 90, baseline-aligned, ending at x ~197 mm inside the box width.
 */
export const GENERIC_MORE_PAGES_NOTE = '(a long answer can run to more pages)';
export const GENERIC_MORE_PAGES_NOTE_PT = 8;
export const GENERIC_MORE_PAGES_NOTE_GREY = 90;
const PT_TO_MM = 25.4 / 72;
/** How far below a `baseline: 'top'` anchor jsPDF puts the baseline, as a
 *  fraction of the font size. Measured from the PDF: 10 pt drawn at y 37.0 has
 *  its baseline at 40.0. Used to put two sizes on one baseline. */
const TOP_TO_BASELINE_EM = 0.85;
/** The space between the bold line and the note, mm. */
export const GENERIC_MORE_PAGES_NOTE_GAP_MM = 2.0;
/** The identity warning. This page has no instructions page in front of it, so it says it here. */
export const GENERIC_IDENTITY_TEXT =
  'Do not write your name, student ID or email address anywhere on this page.';
/**
 * Ruling 3: **deliberately not** today's standing sentence, which ends "scan
 * badly. Darker beats bigger." Today's sheet is left as it is.
 */
export const GENERIC_PENCIL_TEXT =
  'Write with a soft pencil (2B or B) or a pen. Hard pencils come out faint and photograph badly.';
/** The printing rule. */
export const GENERIC_PRINTING_TEXT =
  'Print on US Letter at 100%, not "fit to page", single or double sided. All four black corner squares must appear.';

// ---- The map and the QR ---------------------------------------------------

export const genericLayoutRows = (layoutId: string = GENERIC_LAYOUT_ID): LayoutRow[] => {
  const fr = mmRectToFraction(GENERIC_DECLARED_MM);
  return [{
    assignmentId: GENERIC_TEMPLATE_ID, layoutId,
    regionId: GENERIC_REGION_ID, partId: GENERIC_PART_ID, pageK: 1,
    x0: fr.x0, y0: fr.y0, x1: fr.x1, y1: fr.y1,
    // Not a drawing region. A student may sketch over the feint rules, and the
    // part they chose decides the modality, not the page.
    isDrawing: 0,
    // The page grades nothing; the part the student chose carries the points.
    maxPoints: 0,
  }];
};

/**
 * The generic map's text, byte for byte what every generic-sheet spec embeds
 * and what the Submission app parses. `GBGEN1,5F0B10BC,gen,generic,1,…`.
 */
export const GENERIC_LAYOUT_CSV: string = toLayoutCsv(genericLayoutRows());

/** The layout id recomputed from the map, for the guard and the tests. */
export const computeGenericLayoutId = (): Promise<string> =>
  computeLayoutId(genericLayoutRows().map(r => ({
    regionId: r.regionId, partId: r.partId, pageK: r.pageK, x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1,
  })));

/**
 * `GB1-GBGEN1-HWMSTR-1-1-5F0B10BC`. Today's grammar, unchanged (ruling 2): no
 * assignment identity, no part, no student identifier, no geometry. It is still
 * what orients the page — the corner marks are identical and unkeyed, so a
 * flipped page is detected and corrected only from the QR.
 *
 * It is still a version-4 symbol at 24 mm, because the version is pinned. The
 * work order's first draft claimed a shorter payload bought photographic margin;
 * with the grammar unchanged it buys none, and the claim was struck.
 */
export const GENERIC_QR_PAYLOAD = buildPayload({
  assignmentId: GENERIC_TEMPLATE_ID, token: MASTER_TOKEN, k: 1, n: 1, layoutId: GENERIC_LAYOUT_ID,
});

// ---- Self-test ------------------------------------------------------------

/**
 * Spec 8.7, applied to this page. The assignment-shaped checks of
 * `runSelfTest` (every authored part in the map, page 1 an instructions page)
 * have nothing to hold here, so each numbered check is restated for a page with
 * exactly one region and no assignment behind it. The ink checks are
 * `runInkChecks` itself, unchanged.
 */
export const runGenericSelfTest = async (): Promise<SelfTestReport> => {
  const rows = genericLayoutRows();
  const checks: SelfTestCheck[] = [];
  const add = (id: number, name: string, problems: string[]) =>
    checks.push({ id, name, passed: problems.length === 0, detail: problems.join('; ') || undefined });

  add(1, 'exactly one region, with the reserved region id and part id, on page 1',
    rows.length !== 1 ? [`the map has ${rows.length} rows`]
    : rows[0].regionId !== GENERIC_REGION_ID || rows[0].partId !== GENERIC_PART_ID || rows[0].pageK !== 1
      ? [`the row is ${rows[0].regionId} / ${rows[0].partId} / page ${rows[0].pageK}`] : []);

  add(2, 'max_points present and not negative (the page itself is not marked)',
    rows.filter(r => !(Number.isFinite(r.maxPoints) && r.maxPoints >= 0))
      .map(r => `${r.regionId} has max_points ${JSON.stringify(r.maxPoints)}`));

  add(3, 'the rectangle satisfies the safe areas (spec 4.4)',
    rows.flatMap(r => safeAreaViolations(fractionRectToMm(r)).map(v => `${r.regionId}: ${v}`)));

  add(4, 'no two rectangles overlap', []);

  {
    const problems = payloadViolations(GENERIC_QR_PAYLOAD);
    const f = parsePayload(GENERIC_QR_PAYLOAD);
    if (f && (f.k !== 1 || f.n !== 1)) problems.push(`payload says k=${f.k}, N=${f.n}; the page is 1 of 1`);
    if (f && f.assignmentId !== GENERIC_TEMPLATE_ID) problems.push(`payload names ${f.assignmentId}`);
    add(5, `the payload is <= ${QR_PAYLOAD_MAX_CHARS} chars, matches the grammar, and is alphanumeric-safe`, problems);
  }

  {
    const problems: string[] = [];
    try {
      const m = encodeQr(GENERIC_QR_PAYLOAD);
      if (m.moduleCount !== QR_MODULES) problems.push(`${m.moduleCount} modules, expected ${QR_MODULES}`);
      if (m.version !== QR_VERSION) problems.push(`version ${m.version}, expected ${QR_VERSION}`);
      if (m.mode !== 'alphanumeric') problems.push(`mode ${m.mode}, expected alphanumeric`);
    } catch (err) {
      problems.push((err as Error).message);
    }
    add(6, 'the symbol encodes in alphanumeric mode at version 4', problems);
  }

  {
    const problems: string[] = [];
    const recomputed = await computeGenericLayoutId();
    if (recomputed !== GENERIC_LAYOUT_ID) {
      problems.push(`the map hashes to ${recomputed} but the page carries ${GENERIC_LAYOUT_ID}. ` +
        'The geometry changed: that is a new page version, not an edit to this one');
    }
    const f = parsePayload(GENERIC_QR_PAYLOAD);
    if (f && f.layoutId !== GENERIC_LAYOUT_ID) problems.push(`the QR carries layout_id ${f.layoutId}`);
    for (const r of rows) if (r.layoutId !== GENERIC_LAYOUT_ID) problems.push(`row carries ${r.layoutId}`);
    add(7, 'layout_id in the QR equals the hash of the emitted map', problems);
  }

  add(0, 'no field carries a CSV metacharacter', csvUnsafeFields(rows));

  const failures = checks.filter(c => !c.passed).map(c => `check ${c.id || '–'} — ${c.name}: ${c.detail}`);
  return { passed: failures.length === 0, checks, failures, warnings: [] };
};

// ---- Drawing --------------------------------------------------------------

/** Every string the page prints, in order, for the test that asserts them. */
export const GENERIC_PRINTED_STRINGS: readonly string[] = [
  GENERIC_HEADER_TEXT, GENERIC_FIELDS_TEXT, GENERIC_OUTSIDE_BOX_TEXT, GENERIC_MORE_PAGES_NOTE,
  GENERIC_IDENTITY_TEXT, GENERIC_PENCIL_TEXT, GENERIC_PRINTING_TEXT,
];

const drawBox = (doc: jsPDF, ink: InkBox[], pageK: number) => {
  const b = GENERIC_BOX_MM;
  // Solid, black, 1 pt, square corners, stroke inset half a width so the ink
  // lands exactly between the outer edge and the declared interior — the same
  // drawing as `drawAnswerBox` on today's sheet.
  doc.setDrawColor(0);
  doc.setLineWidth(BORDER_MM);
  doc.setLineDashPattern([], 0);
  doc.rect(b.x0 + BORDER_MM / 2, b.y0 + BORDER_MM / 2,
    (b.x1 - b.x0) - BORDER_MM, (b.y1 - b.y0) - BORDER_MM, 'S');
  const edge = (what: string, x0: number, y0: number, x1: number, y1: number) =>
    ink.push({ pageK, what: `box ${what} ${GENERIC_PART_ID}`, x0, y0, x1, y1 });
  edge('top', b.x0, b.y0, b.x1, round4(b.y0 + BORDER_MM));
  edge('bottom', b.x0, round4(b.y1 - BORDER_MM), b.x1, b.y1);
  edge('left', b.x0, b.y0, round4(b.x0 + BORDER_MM), b.y1);
  edge('right', round4(b.x1 - BORDER_MM), b.y0, b.x1, b.y1);

  // 24 feint rules make 25 equal bands, none on the border. SOLID, 0.5 pt, 75%
  // grey, as in the approved drawing.
  //
  // They shipped dashed on 2026-09-24, the same stroke as the printed sheet's
  // writing lines, and Supplement 1 to the work order put them back
  // (WORKORDER_AM_GENERIC_ANSWER_PAGE_2026-09-24_SUPPLEMENT_1, item 1). The
  // approved drawing is the artifact, and a change after approval comes back
  // as a question, not as a commit. A sketch drawn over the rule reads because
  // the rule is faint, not because it is broken. And at phone-photograph
  // resolution a pale 1.2 mm dash degrades into specks that look like pencil
  // grit, where a pale solid line degrades into a fainter line, which is easy
  // to filter. That last point is reasoning, not measurement: a print test
  // may overturn it, and nothing else should.
  //
  // The dash pattern is reset explicitly rather than assumed, and a test
  // asserts no dash is active when these rules are drawn.
  const x0 = b.x0 + GENERIC_RULE_INSET_MM, x1 = b.x1 - GENERIC_RULE_INSET_MM;
  doc.setDrawColor(191);
  doc.setLineWidth(0.5 * 25.4 / 72);
  doc.setLineDashPattern([], 0);
  for (let k = 1; k < GENERIC_BANDS; k++) {
    const y = round4(b.y0 + k * GENERIC_BAND_MM);
    doc.line(x0, y, x1, y);
  }
  doc.setDrawColor(0);
  ink.push({
    pageK, what: `writing lines ${GENERIC_PART_ID}`,
    x0, y0: round4(b.y0 + GENERIC_BAND_MM - 0.2),
    x1, y1: round4(b.y0 + (GENERIC_BANDS - 1) * GENERIC_BAND_MM + 0.2),
  });
};

/**
 * The download is TWO identical pages (WORKORDER_AM_PAGE_TWO_SIDES_2026-09-25).
 *
 * The page tells students they may print "single or double sided", and a
 * one-page PDF cannot be printed double sided: duplex gave an answer page with
 * a blank back. Two identical pages print duplex as one sheet with a usable
 * answer page on each side, and six pages are three copies. Nothing distinguishes
 * the two, no page number and no mark, so a student can use either side without
 * knowing which it is. Each side carries its own corner marks and QR and is
 * registered on its own, which is the case the format was designed for.
 */
export const GENERIC_PDF_PAGES = 2;

/** One side of the page, drawn onto the PDF's current page. */
const drawGenericSide = (doc: jsPDF, ink: InkBox[], pageK: number) => {
  drawMarks(doc);
  drawQr(doc, GENERIC_QR_PAYLOAD);
  // The one line allowed in the identity band (spec 4.5).
  drawPlain(doc, GENERIC_HEADER_TEXT, HEADER_TEXT_ANCHOR_MM.x, HEADER_TEXT_ANCHOR_MM.y,
    { fontPt: 9 }, ink, pageK, 'header line');

  const x = GENERIC_BOX_MM.x0;
  const T = GENERIC_TEXT_TOP_MM;
  drawPlain(doc, GENERIC_FIELDS_TEXT, x, T.fields, { fontPt: 12 }, ink, pageK, 'fields line');
  // The two bold lines are legible at arm's length on purpose: this page has no
  // instructions page in front of it.
  const boldPt = 10;
  const boldW = drawPlain(doc, GENERIC_OUTSIDE_BOX_TEXT, x, T.outsideBox, { fontPt: boldPt, bold: true }, ink, pageK, 'outside-box line');
  // The note shares the bold line's row. Both are drawn top-anchored, so the
  // smaller one is lowered so the two share a baseline.
  const notePt = GENERIC_MORE_PAGES_NOTE_PT;
  drawPlain(doc, GENERIC_MORE_PAGES_NOTE, x + boldW + GENERIC_MORE_PAGES_NOTE_GAP_MM,
    round4(T.outsideBox + (boldPt - notePt) * PT_TO_MM * TOP_TO_BASELINE_EM),
    { fontPt: notePt, grey: GENERIC_MORE_PAGES_NOTE_GREY }, ink, pageK, 'more-pages note');
  drawPlain(doc, GENERIC_IDENTITY_TEXT, x, T.identity, { fontPt: 10, bold: true }, ink, pageK, 'identity line');
  drawPlain(doc, GENERIC_PENCIL_TEXT, x, T.pencil, { fontPt: 9 }, ink, pageK, 'pencil line');
  drawPlain(doc, GENERIC_PRINTING_TEXT, x, T.printing, { fontPt: 9 }, ink, pageK, 'printing line');
  drawBox(doc, ink, pageK);
};

export interface GeneratedGenericPage {
  pdf: Blob;
  pdfFilename: string;
  csv: string;
  csvFilename: string;
  layoutId: string;
  payload: string;
  ink: InkBox[];
  selfTest: SelfTestReport;
}

/**
 * Build the page, as a PDF of `GENERIC_PDF_PAGES` identical sides. Runs the
 * self-test first and the ink checks, on every side, after drawing,
 * and **throws** rather than returning a page that fails either — the same
 * rule as every other template this app emits.
 */
export const generateGenericAnswerPage = async (): Promise<GeneratedGenericPage> => {
  const base = await runGenericSelfTest();
  const fail = (report: SelfTestReport) => {
    const err = new Error(
      'Generic answer page self-test failed (spec 8.7), so nothing was emitted:\n' +
      report.failures.map(f => `  • ${f}`).join('\n'));
    (err as Error & { report?: SelfTestReport }).report = report;
    throw err;
  };
  if (!base.passed) fail(base);

  const ink: InkBox[] = [];
  const doc = new jsPDF({ unit: 'mm', format: [PAGE_W_MM, PAGE_H_MM], orientation: 'portrait' });
  // The sides must be byte-identical, and jsPDF writes the CURRENT line width
  // and stroke colour into the top of each new page's content stream. The
  // document's own first page gets jsPDF's defaults; a page added after drawing
  // gets whatever the drawing left behind. So every side is an added page,
  // added from the same reset state, and the constructor's blank first page is
  // dropped. (Nothing strokes before setting its own width and colour, so this
  // changes no rendering; it is what makes the sides identical byte for byte.)
  // The reset is written into the page that is current when it runs, so it runs
  // at the END of every side too, not only before the next one: otherwise the
  // last side would lack the trailing reset the others carry.
  const resetState = () => { doc.setLineWidth(BORDER_MM); doc.setDrawColor(0); };
  resetState();
  for (let side = 1; side <= GENERIC_PDF_PAGES; side++) {
    doc.addPage([PAGE_W_MM, PAGE_H_MM], 'portrait');
    drawGenericSide(doc, ink, side);
    resetState();
  }
  doc.deletePage(1);

  // Every side is ink-checked, each against its own declared box. `pageK` here
  // is the side of the PDF, for the checks only: the map and the QR still say
  // page 1 of 1 on both, because the QR names the format, not the sheet.
  const report = runInkChecks(ink, base,
    Array.from({ length: GENERIC_PDF_PAGES }, (_, i) => ({
      pageK: i + 1, regionId: GENERIC_REGION_ID, partId: GENERIC_PART_ID, rect: GENERIC_DECLARED_MM,
    })));
  if (!report.passed) fail(report);

  return {
    pdf: doc.output('blob'),
    pdfFilename: GENERIC_PDF_NAME,
    csv: GENERIC_LAYOUT_CSV,
    csvFilename: GENERIC_LAYOUT_CSV_NAME,
    layoutId: GENERIC_LAYOUT_ID,
    payload: GENERIC_QR_PAYLOAD,
    ink,
    selfTest: report,
  };
};
