/**
 * templateGenerator.ts — emits a GradeBridge page-format template.
 *
 * Two artifacts, per the work order:
 *   1. `{assignment_id}_qr_template.pdf` — four corner marks, the pinned QR, one
 *      bordered, ruled answer box per part, one header line, on every page.
 *   2. `layout_{assignment_id}.csv` — the sidecar map, spec 4.3, whose content
 *      hash is written into every page's QR.
 *
 * Spec: `GradeBridge_Page_Format_v1.md` section 8 (GENERATE), Appendix A
 * (geometry), Appendix C (what a homework template must NOT inherit).
 *
 * DECISION 1 (rendering path) — RESOLVED: in-browser jsPDF, not xelatex.
 *   - The app is client-side; xelatex would need a new compile service.
 *   - `qrcode-generator` takes version and mode as arguments, so the two things
 *     spec 8.7 check 6 exists to catch (auto-selected mode, auto-selected
 *     version) cannot happen here — they are pinned at the call, and the
 *     self-test still decodes the result and asserts what came back.
 *   - Spec 8.1's "4 passes of xelatex" requirement exists because TikZ
 *     `remember picture` positions converge over passes; jsPDF coordinates are
 *     absolute from the first draw, so that failure mode does not exist. The
 *     mark geometry it protects is asserted directly instead.
 * Acceptance is output compliance, not the tool (work order, decision 1).
 *
 * DECISION 2 — as resolved in the work order: one class-wide master template per
 * assignment, `TOKEN` a fixed placeholder, nothing student-specific in the QR.
 */

import jsPDF from 'jspdf';
import { Assignment } from '../types';
import { renderTextToCanvas, toPdfText } from './mathRender';
import {
  MARK_ORIGINS_MM, MARK_SIZE_MM, PAGE_H_MM, PAGE_W_MM, QR_KEEPOUT_MM, QR_MODULES,
  QR_QUIET_MM, QR_RECT_MM, QR_SIZE_MM, HEADER_TEXT_ANCHOR_MM,
  RectMm, mmRectToFraction, round4,
} from './pageFormat';
import { encodeQr } from './qrEncoder';
import {
  MASTER_TOKEN, buildPayload, computeLayoutId, derivePageFormatId, isValidPageFormatId,
} from './qrPayload';
import {
  BORDER_MM, COLUMN_X0_MM, COLUMN_X1_MM, FURNITURE_MAX_WIDTH_MM, LayoutRow, PAGE1_FURNITURE_TOP_MM,
  DESC_FONT_PT, DESC_LINE_MM, FIGURE_LINES, HEADING_FONT_PT, PAGE1_INSTRUCTION_LINE_MM,
  PAGE1_INSTRUCTION_LINES, PAGE1_INSTRUCTION_TOP_MM, PAGE1_TITLE_H_MM, PROBLEM_HEADING_LINE_MM,
  PROMPT_ROW_MM, PlacedRegion, TemplateLayout, WRITING_LINE_MM, buildLayout, descBlockMm,
  toLayoutCsv, toLayoutRows,
  ProblemBlock,
} from './templateLayout';
import { splitFigures, trimAroundFigures } from './figureBlocks';
import { SelfTestReport, runInkChecks, runSelfTest } from './templateSelfTest';

const PX_PER_MM = 96 / 25.4;
const RASTER_SCALE = 3;

export interface GeneratedTemplate {
  assignmentId: string;
  layoutId: string;
  pageCount: number;
  pdf: Blob;
  csv: string;
  csvFilename: string;
  pdfFilename: string;
  payloads: string[];
  layout: TemplateLayout;
  rows: LayoutRow[];
  /** Every box the generator put ink in — what the post-draw checks ran over. */
  ink: InkBox[];
  selfTest: SelfTestReport;
}

/** Resolve QR field 2: the author's override if it is legal, otherwise derived. */
export const resolvePageFormatId = async (assignment: Assignment): Promise<string> => {
  const override = (assignment.pageFormatId || '').trim().toUpperCase();
  if (override && isValidPageFormatId(override)) return override;
  return derivePageFormatId(assignment.courseCode, assignment.title);
};

// ---- Drawing -------------------------------------------------------------

/** Four solid 5 mm squares, spec 3.1. Same four on every page, no exceptions. */
const drawMarks = (doc: jsPDF) => {
  doc.setFillColor(0, 0, 0);
  for (const [x, y] of MARK_ORIGINS_MM) {
    doc.rect(x, y, MARK_SIZE_MM, MARK_SIZE_MM, 'F');
  }
};

/**
 * The pinned symbol, drawn as filled module rectangles rather than an image, so
 * the edges stay crisp at any print resolution and no rasteriser sits between
 * the matrix and the paper. The quiet zone is a printed white field (spec 2.3).
 */
const drawQr = (doc: jsPDF, payload: string) => {
  const { dark, moduleCount } = encodeQr(payload);
  const modMm = QR_SIZE_MM / moduleCount;

  doc.setFillColor(255, 255, 255);
  doc.rect(
    QR_RECT_MM.x0 - QR_QUIET_MM, QR_RECT_MM.y0 - QR_QUIET_MM,
    QR_SIZE_MM + QR_QUIET_MM * 2, QR_SIZE_MM + QR_QUIET_MM * 2, 'F'
  );

  doc.setFillColor(0, 0, 0);
  for (let row = 0; row < moduleCount; row++) {
    // Coalesce horizontal runs: fewer, wider rectangles print without hairline
    // seams between adjacent modules and keep the PDF small.
    let run = 0;
    for (let col = 0; col <= moduleCount; col++) {
      const isDark = col < moduleCount && dark[row][col];
      if (isDark) { run += 1; continue; }
      if (run > 0) {
        doc.rect(
          QR_RECT_MM.x0 + (col - run) * modMm, QR_RECT_MM.y0 + row * modMm,
          run * modMm, modMm, 'F'
        );
        run = 0;
      }
    }
  }
};

/**
 * Every box the generator puts ink in, in millimetres. Collected while drawing
 * so the self-test can assert what actually landed on the page rather than what
 * the layout intended — the two diverge exactly when a right-aligned label
 * overruns into the QR's column, which is the collision this exists to catch.
 */
export interface InkBox extends RectMm { pageK: number; what: string }

/**
 * Authored text on the template goes through the shared math renderer, the same
 * one behind the HTML and PDF exports, so `$\delta_s$` and a bare `ω` come out
 * as glyphs. jsPDF's built-in fonts are Latin-1 and silently garble anything
 * outside it — the WinAnsi trap the math deep fix already had to solve once.
 *
 * **One font size across the whole document. Authored text is never scaled.**
 * Every question block — problem stem, sub-part prompt, sub-part description,
 * preamble — renders at exactly `DESC_FONT_PT`, at scale 1, always. A drawing
 * may be scaled into its reserved block (`allowScale`); words may not.
 *
 * There used to be a "backstop" here that shrank a block when its measured
 * height exceeded the reservation. It read as prudent and was the whole bug: the
 * stem is the longest block on the page, so it was the one that overran and the
 * only one that shrank, and it printed smaller than its own sub-parts. A shrink
 * is not a safe fallback for text — it is a silent quality failure that nothing
 * downstream can see.
 *
 * What replaces it: the reservation over-reserves on purpose (`CHAR_ADVANCE_EM`
 * plus `DESC_SLACK_LINES`, both calibrated wider than the render font actually
 * measures), and if a block still overruns, the ink it laid down is recorded at
 * its true size so the post-draw collision check **refuses to emit the
 * template** and names the block. Loud beats quiet.
 *
 * Nothing is wrapped early either: every prose block is handed the full writing
 * column, so a line break happens where the text runs out of column, never
 * because the box was made narrow.
 */
const drawAuthoredText = async (
  doc: jsPDF, text: string, box: RectMm,
  opts: { fontPt: number; bold?: boolean; grey?: number; allowScale?: boolean },
  ink: InkBox[], pageK: number, what: string
): Promise<void> => {
  if (!text.trim()) return;
  const grey = opts.grey ?? 0;
  const widthMm = box.x1 - box.x0;
  const maxHeightMm = box.y1 - box.y0;

  const canvas = await renderTextToCanvas(text, {
    widthPx: widthMm * PX_PER_MM,
    fontSizePx: opts.fontPt * 96 / 72,
    lineHeightPx: opts.fontPt * 1.35 * 96 / 72,
    bold: opts.bold,
    color: `rgb(${grey},${grey},${grey})`,
    scale: RASTER_SCALE,
  });

  if (canvas) {
    const naturalHeightMm = canvas.height / (RASTER_SCALE * PX_PER_MM);
    // Only a figure may be scaled to fit. Text is drawn at its natural size
    // whatever the box says, and the overrun becomes visible ink.
    const scale = opts.allowScale && naturalHeightMm > maxHeightMm ? maxHeightMm / naturalHeightMm : 1;
    const w = widthMm * scale, h = naturalHeightMm * scale;
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', box.x0, box.y0, w, h, undefined, 'FAST');
    ink.push({ pageK, what, x0: box.x0, y0: box.y0, x1: box.x0 + w, y1: box.y0 + h });
    return;
  }

  // No DOM: fall back to WinAnsi-safe vector text, wrapped to the same column.
  // Same rule — every line is drawn, none clipped to the box, so an overrun is
  // caught here too rather than losing a sentence off the bottom in silence.
  applyText(doc, opts.fontPt, !!opts.bold, grey, AUTHORED_TEXT_FONT);
  const lines: string[] = doc.splitTextToSize(toPdfText(text), widthMm);
  const lineMm = opts.fontPt * 1.35 * 25.4 / 72;
  lines.forEach((line, i) => doc.text(line, box.x0, box.y0 + i * lineMm, { baseline: 'top' }));
  ink.push({ pageK, what, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y0 + lines.length * lineMm });
};

/**
 * An authored block that may carry a figure: the prose and each drawing are
 * rasterised **separately**, stacked in authored order inside the reserved box.
 *
 * This is the whole fix for a stem printing smaller than the sub-parts under it.
 * One canvas holding both meant one scale factor for both: a circuit that ran a
 * millimetre over its `FIGURE_LINES` allotment set `scale < 1` on the shared
 * raster, and the prose — already at 9 pt — shrank with the drawing. Sub-part
 * descriptions have no figure to share with, so they stayed at 9 pt, and the
 * stem printed visibly smaller than its own sub-parts. Every ENG17 problem has a
 * circuit, so every ENG17 stem had it.
 *
 * The rule the split enforces: **a figure may scale to its box; text may not.**
 * Each prose run gets a box the height of its own reservation, so its scale is
 * always 1; each figure gets the `FIGURE_LINES` allotment the layout reserved
 * for it, and only the drawing is scaled into it.
 */
const drawAuthoredBlock = async (
  doc: jsPDF, text: string, box: RectMm, opts: { fontPt: number; bold?: boolean; grey?: number },
  ink: InkBox[], pageK: number, what: string
): Promise<void> => {
  const segs = trimAroundFigures(splitFigures(text));
  // No figure, no shared canvas: the block is one raster, exactly as before, so
  // a figure-free stem or description is untouched.
  if (!segs.some(s => s.kind === 'figure')) {
    await drawAuthoredText(doc, text, box, opts, ink, pageK, what);
    return;
  }

  const widthMm = box.x1 - box.x0;
  let cursor = box.y0;
  for (const seg of segs) {
    if (cursor >= box.y1 - 0.01) break;
    const natural = seg.kind === 'figure'
      ? FIGURE_LINES * DESC_LINE_MM
      : descBlockMm(seg.value, widthMm);
    if (natural <= 0) continue;

    const height = Math.min(natural, box.y1 - cursor);
    await drawAuthoredText(
      doc,
      seg.kind === 'figure' ? seg.source : seg.value,
      { x0: box.x0, y0: round4(cursor), x1: box.x1, y1: round4(cursor + height) },
      // A drawing may be scaled into its block. The words beside it may not.
      { ...opts, allowScale: seg.kind === 'figure' },
      ink, pageK,
      seg.kind === 'figure' ? `figure in ${what}` : what
    );
    cursor = round4(cursor + height);
  }
};

/**
 * The face authored question text renders in. The browser rasteriser sets
 * `'Times New Roman', Times, serif` (`renderTextToCanvas`), so the no-DOM
 * fallback names the same family: an estimator calibrated against one font and
 * a renderer using another is how a reservation quietly stops covering its
 * block. Page furniture — the header line, part labels, points — stays
 * helvetica; it is chrome, not authored text, and it is never wrapped.
 */
const AUTHORED_TEXT_FONT = 'times';

const applyText = (doc: jsPDF, fontPt: number, bold: boolean, grey: number, font = 'helvetica') => {
  doc.setFont(font, bold ? 'bold' : 'normal');
  doc.setFontSize(fontPt);
  doc.setTextColor(grey);
};

/** Draw plain ASCII vector text and record the box it occupies. */
const drawPlain = (
  doc: jsPDF, text: string, xMm: number, yMm: number,
  opts: { fontPt: number; bold?: boolean; grey?: number; align?: 'left' | 'right' },
  ink: InkBox[], pageK: number, what: string
): number => {
  applyText(doc, opts.fontPt, !!opts.bold, opts.grey ?? 0);
  const w = doc.getTextWidth(text);
  const x = opts.align === 'right' ? xMm - w : xMm;
  doc.text(text, x, yMm, { baseline: 'top' });
  doc.setTextColor(0);
  ink.push({ pageK, what, x0: x, y0: yMm, x1: x + w, y1: yMm + opts.fontPt * 1.2 * 25.4 / 72 });
  return w;
};

/**
 * The one text line allowed in the identity band (spec 8.4). Identity-free by
 * construction — template id and pagination only. Truncated so it can never
 * reach the QR keep-out at x = 166.
 */
const drawHeaderLine = (doc: jsPDF, assignmentId: string, k: number, n: number, ink: InkBox[]) => {
  applyText(doc, 9, false, 0);
  const maxWidth = QR_KEEPOUT_MM.x0 - HEADER_TEXT_ANCHOR_MM.x - 4.0;
  let text = `GradeBridge  ${assignmentId}  page ${k} of ${n}`;
  while (text.length > 8 && doc.getTextWidth(text) > maxWidth) text = text.slice(0, -1);
  drawPlain(doc, text, HEADER_TEXT_ANCHOR_MM.x, HEADER_TEXT_ANCHOR_MM.y, { fontPt: 9 }, ink, k, 'header line');
};

/**
 * Course, title and the print instruction, between the band and the first
 * prompt row. All of it below 25 mm and left of the QR keep-out — put any of it
 * in the band and the consumer's PII gate withholds every crop on every page
 * (spec 4.5).
 *
 * **There is deliberately no name / student ID / date line.** Identity comes
 * from Gradescope authenticating the upload, so a blank for it is redundant;
 * students are told not to write their name on the pages, so a labelled blank is
 * a mixed message that will get filled in; a filled-in name is exactly the PII
 * the band gate and gb2 exist to keep out of the graded artifact; and grading is
 * meant to be blind to identity. Appendix C says the same — because the app
 * authenticates the student, there is no identity page. Nothing replaces it.
 */
const drawPage1Furniture = async (
  doc: jsPDF, assignment: Assignment, layout: TemplateLayout, ink: InkBox[]
) => {
  await drawAuthoredText(
    doc, `${assignment.courseCode}: ${assignment.title}`,
    { x0: COLUMN_X0_MM, y0: PAGE1_FURNITURE_TOP_MM, x1: COLUMN_X0_MM + FURNITURE_MAX_WIDTH_MM, y1: PAGE1_FURNITURE_TOP_MM + PAGE1_TITLE_H_MM },
    { fontPt: 12, bold: true }, ink, 1, 'course and title'
  );

  applyText(doc, 7.5, false, 110);
  // **Names the box.** From 2026-08-17 this line deliberately avoided the words
  // "box" and "area", to leave the word to the questions, which asked students
  // to box their own final answer. There is a box on the sheet now and the
  // questions ask for none, so the instruction says where it is: writing that
  // lands outside a box is never cropped and never graded, and that is the one
  // thing a student cannot recover from.
  //
  // "resting each line of writing on a rule" is worth its width: sitting the
  // baseline on the rule leaves descenders as the only strokes that cross one,
  // which is the easy case for the OCR pass. Writing that floats between rules
  // is what produces baseline drift.
  const instruction = 'Print at 100%, not "fit to page". Check all four corner squares are on the paper before you start, and keep every answer inside its printed box, resting each line of writing on a rule.';
  const lines: string[] = doc.splitTextToSize(instruction, FURNITURE_MAX_WIDTH_MM);
  lines.slice(0, PAGE1_INSTRUCTION_LINES).forEach((line, i) => {
    drawPlain(doc, line, COLUMN_X0_MM, PAGE1_INSTRUCTION_TOP_MM + i * PAGE1_INSTRUCTION_LINE_MM,
      { fontPt: 7.5, grey: 110 }, ink, 1, 'print instruction');
  });

  // The assignment's own instructions. Held to the furniture width so it stays
  // clear of the QR column, which it would otherwise reach at this height.
  if (layout.preambleBoxMm && assignment.preamble) {
    await drawAuthoredBlock(doc, assignment.preamble,
      { ...layout.preambleBoxMm, x1: COLUMN_X0_MM + FURNITURE_MAX_WIDTH_MM },
      { fontPt: DESC_FONT_PT, grey: 40 }, ink, 1, 'preamble');
  }
};

/**
 * The problem heading, wrapped inside the writing column.
 *
 * It was the only authored string on the sheet drawn as a single unwrapped,
 * untruncated line — no width budget at all — while everything else went through
 * `drawAuthoredText` with an `x1` and the one other plain line truncated itself
 * against the QR keep-out. Two ENG17 HW4 titles fitted the column on their own
 * and ran 13–17 mm past it once ` (continued)` was appended, and the ink check
 * refused the export rather than printing them.
 *
 * The wrap uses jsPDF's real metrics rather than the layout's estimate, so what
 * is *drawn* is guaranteed inside the column and not merely inside the guess.
 * The estimate's job is only to reserve the height, and it is deliberately
 * pessimistic, so the real wrap should always need fewer lines than were
 * reserved. Should is not never: if it needs more, the last drawn line is
 * ellipsised. Losing the tail of an absurd title is a visible, understandable
 * degradation; a refused export is not.
 *
 * Plain ASCII "..." rather than a real ellipsis: jsPDF's standard fonts are
 * Latin-1 and re-encode anything outside it as UTF-16BE, which prints as
 * mojibake — the same trap the math renderer had to solve once already.
 */
const drawProblemHeading = (
  doc: jsPDF, heading: string, topMm: number, reservedMm: number,
  ink: InkBox[], pageK: number, partId: string
): void => {
  const widthMm = COLUMN_X1_MM - COLUMN_X0_MM;
  applyText(doc, HEADING_FONT_PT, true, 0);
  const wrapped: string[] = doc.splitTextToSize(heading, widthMm);
  const budget = Math.max(1, Math.round(reservedMm / PROBLEM_HEADING_LINE_MM));

  const lines = wrapped.slice(0, budget);
  if (wrapped.length > budget && lines.length > 0) {
    let tail = lines[lines.length - 1];
    while (tail.length > 1 && doc.getTextWidth(`${tail}...`) > widthMm) tail = tail.slice(0, -1);
    lines[lines.length - 1] = `${tail.replace(/\s+$/, '')}...`;
  }

  lines.forEach((line, i) => {
    drawPlain(doc, line, COLUMN_X0_MM, round4(topMm + i * PROBLEM_HEADING_LINE_MM),
      { fontPt: HEADING_FONT_PT, bold: true }, ink, pageK, `problem heading ${partId}`);
  });
};

/**
 * The prompt row, the question text, and the bordered answer box beneath them.
 *
 * Nothing drawn here is inside the declared rectangle: the prompt sits above and
 * outside the box (`EEC100_Final_Format_Spec` §2), and the box's own border is
 * drawn outside the declared rectangle rather than on it.
 */
/**
 * A problem's heading and its shared setup. Drawn above the problem's first part
 * — and, when that part could not fit beneath the setup and its authored answer
 * space had to be honoured, on a page of its own with the part following under a
 * `(continued)` heading (`layout.standaloneBlocks`).
 *
 * Without this block the sheet is not a self-contained assignment: "1(a)" means
 * nothing on its own when the givens are stated once at the top of the problem.
 */
const drawProblemBlock = async (
  doc: jsPDF, b: ProblemBlock, pageK: number, label: string, ink: InkBox[]
) => {
  drawProblemHeading(doc, b.heading, b.boxMm.y0, b.headingMm, ink, pageK, label);
  if (b.text) {
    // The stem is where figures live, so this is the call that must never put
    // prose and a drawing on one canvas.
    await drawAuthoredBlock(doc, b.text,
      { x0: COLUMN_X0_MM, y0: round4(b.boxMm.y0 + b.headingMm), x1: COLUMN_X1_MM, y1: b.boxMm.y1 },
      { fontPt: DESC_FONT_PT }, ink, pageK, `problem text ${label}`);
  }
};

const drawRegionPrompt = async (doc: jsPDF, r: PlacedRegion, ink: InkBox[]) => {
  // The problem's heading and shared setup, above its first part. Without this
  // the sheet is not a self-contained assignment — "1(a)" means nothing on its
  // own when the givens are stated once at the top of the problem.
  if (r.problemBlock) await drawProblemBlock(doc, r.problemBlock, r.pageK, r.partId, ink);

  // Points first, so the title knows how much room is left.
  const points = `[${r.maxPoints} pts]`;
  applyText(doc, 9, false, 0);
  const pointsW = doc.getTextWidth(points);
  drawPlain(doc, points, COLUMN_X1_MM, r.promptTopMm, { fontPt: 9, align: 'right' }, ink, r.pageK, 'points label');

  const label = `${r.partId}.`;
  const labelW = drawPlain(doc, label, COLUMN_X0_MM, r.promptTopMm, { fontPt: 10, bold: true }, ink, r.pageK, 'part label') + 2.0;

  // The prompt row is the authored sub-part name and nothing else. It used to
  // append "Write your answer below this line." to every part — 117 repetitions
  // across three homeworks of a sentence the instructor could not control,
  // landing ahead of the authored question. The ruled lines directly beneath are
  // the cue, and a continuation is announced by its "(continued)" heading.
  // Goes through the math renderer, so `$…$` in a sub-part name still renders.
  if (r.name.trim()) {
    await drawAuthoredText(
      doc, r.name.trim(),
      {
        x0: COLUMN_X0_MM + labelW, y0: r.promptTopMm,
        x1: COLUMN_X1_MM - pointsW - 3.0, y1: r.promptTopMm + PROMPT_ROW_MM - 0.5,
      },
      { fontPt: DESC_FONT_PT }, ink, r.pageK, `prompt ${r.partId}`
    );
  }

  if (r.descBoxMm) {
    await drawAuthoredBlock(doc, r.description, r.descBoxMm, { fontPt: DESC_FONT_PT, grey: 60 },
      ink, r.pageK, `description ${r.partId}`);
  }

  drawAnswerBox(doc, r, ink);
};

/**
 * The answer box: a bordered rectangle, then `answerLines` faint dashed writing
 * lines at `WRITING_LINE_MM` pitch inside it. A sketch part gets the border and
 * nothing else — reserved blank space to draw in, which is the cleanest case.
 *
 * **The border replaces the old solid top rule; the two are never both drawn**
 * (work order §3: two horizontal lines 2.5 mm apart at the top of every region
 * is noise). From 2026-08-17 to 2026-08-31 a region was a rule and some ruled
 * lines and no frame, on the reasoning that page-format §4.1 forbade a box and
 * that the ENG17 questions asked students to box their own final answer. Both
 * legs are gone: §4.1 carries a dated amendment, and HWK1–HWK3 as rebuilt on 30
 * and 31 August ask students to box nothing.
 *
 * **Solid, continuous, black, 1 pt, square corners, no fill** — the exam
 * detector's contract (`EEC100_Final_Format_Spec` §2). Drawn immediately
 * *outside* the declared rectangle: jsPDF centres a stroke on its path, so the
 * path is inset half a stroke from the column and the ink lands exactly in
 * `COLUMN_X0_MM … COLUMN_X1_MM` with its inner edge on the declared boundary.
 * The crop therefore carries none of the border's own ink.
 *
 * The interior is **not** empty, which is the one place this departs from the
 * exam contract's "empty on the blank exam". The writing lines stay, for
 * measured handwriting reasons rather than detector ones (see below), and the
 * same document's §3 records printed graph paper — far more ink than 9 mm dashed
 * rules at 0.5 pt in 75% grey — tolerated at 262 of 264.
 */
const drawAnswerBox = (doc: jsPDF, r: PlacedRegion, ink: InkBox[]) => {
  doc.setDrawColor(0);
  doc.setLineWidth(BORDER_MM);
  doc.setLineDashPattern([], 0);   // never inherit a dash from the region above
  doc.rect(
    COLUMN_X0_MM + BORDER_MM / 2, r.boxTopMm + BORDER_MM / 2,
    (COLUMN_X1_MM - COLUMN_X0_MM) - BORDER_MM, (r.boxBottomMm - r.boxTopMm) - BORDER_MM,
    'S'
  );

  // Four thin edge boxes, not one big one. The border legitimately encloses the
  // writing lines, so a single ink box spanning the whole frame would read as a
  // collision with them and refuse the export — and the tolerance in that check
  // is what caught the print instruction landing inside the preamble, so it is
  // not the thing to loosen.
  const edge = (what: string, x0: number, y0: number, x1: number, y1: number) =>
    ink.push({ pageK: r.pageK, what: `box ${what} ${r.partId}`, x0, y0, x1, y1 });
  edge('top', COLUMN_X0_MM, r.boxTopMm, COLUMN_X1_MM, round4(r.boxTopMm + BORDER_MM));
  edge('bottom', COLUMN_X0_MM, round4(r.boxBottomMm - BORDER_MM), COLUMN_X1_MM, r.boxBottomMm);
  edge('left', COLUMN_X0_MM, r.boxTopMm, round4(COLUMN_X0_MM + BORDER_MM), r.boxBottomMm);
  edge('right', round4(COLUMN_X1_MM - BORDER_MM), r.boxTopMm, COLUMN_X1_MM, r.boxBottomMm);

  if (r.isDrawing) return;

  // **Dashed, not solid.** This is the one that matters in a circuits course: a
  // solid horizontal rule sitting next to handwritten maths is the exact shape
  // of a fraction bar, a minus sign, an overbar, or the top of an equals — and
  // the grader reads it as one. A dash gives the same alignment and skew
  // reference with no long connected run to mistake for a glyph, and it filters
  // out cleanly downstream.
  //
  // 0.5 pt at 75% grey, not 0.425 pt at 80%: students print these themselves, so
  // the rule has to survive a toner-saving laser without blooming into the
  // handwriting on a low-ink inkjet. Heavier and lighter at the same time —
  // thicker stroke, paler ink — thresholds out more reliably than either alone.
  doc.setDrawColor(191);                    // 0.75 grey
  doc.setLineWidth(0.5 * 25.4 / 72);        // 0.5 pt
  doc.setLineDashPattern([1.2, 1.2], 0);
  for (let i = 1; i <= r.answerLines; i++) {
    const y = round4(r.nominalMm.y0 + i * WRITING_LINE_MM);
    doc.line(r.nominalMm.x0, y, r.nominalMm.x1, y);
  }
  doc.setLineDashPattern([], 0);            // solid again for whatever draws next

  // One ink band spanning the ruled lines rather than one box per line, which
  // would read as dozens of blocks stacked in the same column.
  ink.push({
    pageK: r.pageK, what: `writing lines ${r.partId}`,
    x0: r.nominalMm.x0, y0: round4(r.nominalMm.y0 + WRITING_LINE_MM - 0.2),
    x1: r.nominalMm.x1, y1: round4(r.nominalMm.y1 + 0.2),
  });
};

// ---- Generate ------------------------------------------------------------

/**
 * Build the template. Runs the spec 8.7 self-test and **throws** rather than
 * returning a non-compliant template — "a template failing any check is not
 * emitted". Callers that want the report on a failure can catch and read
 * `error.report`.
 */
export const generateTemplate = async (assignment: Assignment): Promise<GeneratedTemplate> => {
  const assignmentId = await resolvePageFormatId(assignment);
  const layout = buildLayout(assignment);

  if (layout.regions.length === 0) {
    throw new Error('This assignment has no sub-parts, so there is nothing to lay out.');
  }

  // Hash first: the layout_id has to be inside every page's QR. It is computed
  // over the same rounded fractions the CSV carries, never the raw millimetres,
  // so the consumer's recomputation over the parsed file agrees exactly.
  const layoutId = await computeLayoutId(layout.regions.map(r => ({
    regionId: r.regionId, partId: r.partId, pageK: r.pageK,
    ...mmRectToFraction(r.declaredMm),
  })));

  const rows = toLayoutRows(layout.regions, assignmentId, layoutId);
  const csv = toLayoutCsv(rows);
  const payloads = Array.from({ length: layout.pageCount }, (_, i) =>
    buildPayload({ assignmentId, token: MASTER_TOKEN, k: i + 1, n: layout.pageCount, layoutId })
  );

  const selfTest = await runSelfTest({ assignment, layout, rows, payloads, layoutId, csv });
  const fail = (report: SelfTestReport) => {
    const err = new Error(
      `Template self-test failed (spec 8.7), so nothing was emitted:\n` +
      report.failures.map(f => `  • ${f}`).join('\n')
    );
    (err as Error & { report?: SelfTestReport }).report = report;
    throw err;
  };
  if (!selfTest.passed) fail(selfTest);

  const ink: InkBox[] = [];
  const doc = new jsPDF({ unit: 'mm', format: [PAGE_W_MM, PAGE_H_MM], orientation: 'portrait' });
  for (let k = 1; k <= layout.pageCount; k++) {
    if (k > 1) doc.addPage([PAGE_W_MM, PAGE_H_MM], 'portrait');
    drawMarks(doc);
    drawQr(doc, payloads[k - 1]);
    drawHeaderLine(doc, assignmentId, k, layout.pageCount, ink);
    if (k === 1) await drawPage1Furniture(doc, assignment, layout, ink);
    // A setup printed on a page of its own, ahead of the part it belongs to.
    for (const b of layout.standaloneBlocks.filter(b => b.pageK === k)) {
      await drawProblemBlock(doc, b.block, k, b.block.heading, ink);
    }
    for (const r of layout.regions.filter(r => r.pageK === k)) await drawRegionPrompt(doc, r, ink);
  }

  // Checked after drawing, not before: the layout can be legal while a
  // right-aligned label still overruns into the QR's column. Text over the
  // modules can stop the symbol decoding, and the QR is the whole registration
  // mechanism, so this is as fatal as any of checks 1–7.
  const inkReport = runInkChecks(ink, selfTest, layout.regions.map(r => ({
    pageK: r.pageK, regionId: r.regionId, partId: r.partId, rect: r.declaredMm,
  })));
  if (!inkReport.passed) fail(inkReport);

  return {
    assignmentId, layoutId,
    pageCount: layout.pageCount,
    pdf: doc.output('blob'),
    csv,
    pdfFilename: `${assignmentId}_qr_template.pdf`,
    csvFilename: `layout_${assignmentId}.csv`,
    payloads, layout, rows, ink, selfTest: inkReport,
  };
};

export const QR_MODULE_COUNT = QR_MODULES;
