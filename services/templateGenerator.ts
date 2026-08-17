/**
 * templateGenerator.ts — emits a GradeBridge page-format template.
 *
 * Two artifacts, per the work order:
 *   1. `{assignment_id}_qr_template.pdf` — four corner marks, the pinned QR, one
 *      ruled answer region per part, one header line, on every page.
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
  COLUMN_X0_MM, COLUMN_X1_MM, FURNITURE_MAX_WIDTH_MM, LayoutRow, PAGE1_FURNITURE_TOP_MM,
  DESC_FONT_PT, PAGE1_INSTRUCTION_LINE_MM, PAGE1_INSTRUCTION_LINES, PAGE1_INSTRUCTION_TOP_MM,
  PAGE1_TITLE_H_MM, PROBLEM_HEADING_MM, PROMPT_ROW_MM, PlacedRegion, TemplateLayout,
  WRITING_LINE_MM, buildLayout, toLayoutCsv, toLayoutRows,
} from './templateLayout';
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
 * Every question block on the sheet — the problem stem, the sub-part prompt, the
 * sub-part description — is drawn at the same fixed `DESC_FONT_PT`, so a stem can
 * never print smaller than the sub-parts beneath it. The layout reserves against
 * a deliberately generous character-count estimate (`CHAR_ADVANCE_EM`), so the
 * scale-down below is a backstop against a pathological block, not the routine
 * path it used to be when a page-level squeeze drove it.
 */
const drawAuthoredText = async (
  doc: jsPDF, text: string, box: RectMm, opts: { fontPt: number; bold?: boolean; grey?: number },
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
    const scale = naturalHeightMm > maxHeightMm ? maxHeightMm / naturalHeightMm : 1;
    const w = widthMm * scale, h = naturalHeightMm * scale;
    doc.addImage(canvas.toDataURL('image/png'), 'PNG', box.x0, box.y0, w, h, undefined, 'FAST');
    ink.push({ pageK, what, x0: box.x0, y0: box.y0, x1: box.x0 + w, y1: box.y0 + h });
    return;
  }

  // No DOM: fall back to WinAnsi-safe vector text, wrapped into the same box.
  applyText(doc, opts.fontPt, !!opts.bold, grey);
  const lines: string[] = doc.splitTextToSize(toPdfText(text), widthMm);
  const lineMm = opts.fontPt * 1.35 * 25.4 / 72;
  const shown = lines.slice(0, Math.max(1, Math.floor(maxHeightMm / lineMm)));
  shown.forEach((line, i) => doc.text(line, box.x0, box.y0 + i * lineMm, { baseline: 'top' }));
  ink.push({ pageK, what, x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y0 + shown.length * lineMm });
};

const applyText = (doc: jsPDF, fontPt: number, bold: boolean, grey: number) => {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
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
  const instruction = 'Print at 100%, not "fit to page". Check all four corner squares are on the paper before you start, and write only inside the ruled areas.';
  const lines: string[] = doc.splitTextToSize(instruction, FURNITURE_MAX_WIDTH_MM);
  lines.slice(0, PAGE1_INSTRUCTION_LINES).forEach((line, i) => {
    drawPlain(doc, line, COLUMN_X0_MM, PAGE1_INSTRUCTION_TOP_MM + i * PAGE1_INSTRUCTION_LINE_MM,
      { fontPt: 7.5, grey: 110 }, ink, 1, 'print instruction');
  });

  // The assignment's own instructions. Held to the furniture width so it stays
  // clear of the QR column, which it would otherwise reach at this height.
  if (layout.preambleBoxMm && assignment.preamble) {
    await drawAuthoredText(doc, assignment.preamble,
      { ...layout.preambleBoxMm, x1: COLUMN_X0_MM + FURNITURE_MAX_WIDTH_MM },
      { fontPt: DESC_FONT_PT, grey: 40 }, ink, 1, 'preamble');
  }
};

/**
 * The prompt row, the question text, and the rule that tops the answer box.
 *
 * Nothing drawn here is inside the declared rectangle: it all sits above the
 * rule, and the rule is the rectangle's top edge.
 */
const drawRegionPrompt = async (doc: jsPDF, r: PlacedRegion, ink: InkBox[]) => {
  // The problem's heading and shared setup, above its first part. Without this
  // the sheet is not a self-contained assignment — "1(a)" means nothing on its
  // own when the givens are stated once at the top of the problem.
  if (r.problemBlock) {
    const b = r.problemBlock;
    drawPlain(doc, b.heading, COLUMN_X0_MM, b.boxMm.y0,
      { fontPt: 11, bold: true }, ink, r.pageK, `problem heading ${r.partId}`);
    if (b.text) {
      await drawAuthoredText(doc, b.text,
        { x0: COLUMN_X0_MM, y0: round4(b.boxMm.y0 + PROBLEM_HEADING_MM), x1: COLUMN_X1_MM, y1: b.boxMm.y1 },
        { fontPt: DESC_FONT_PT }, ink, r.pageK, `problem text ${r.partId}`);
    }
  }

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
  // landing ahead of the authored question. The ruled box directly beneath is
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
    await drawAuthoredText(doc, r.description, r.descBoxMm, { fontPt: DESC_FONT_PT, grey: 60 },
      ink, r.pageK, `description ${r.partId}`);
  }

  drawAnswerBox(doc, r, ink);
};

/**
 * The answer box: exactly the rectangle the layout map crops, drawn so the
 * student can see it. Its top edge is the region's rule, drawn solid black; the
 * other three sides are faint, and a text part is ruled inside at
 * `WRITING_LINE_MM` pitch. A sketch gets the bounding box only.
 *
 * The page-format spec's 4.1 is written the other way round ("there is no
 * printed answer box"), but its reason is that **nothing detects** a box — a
 * region is found by registering the page and applying the declared rectangle,
 * never by looking for an edge. That still holds: this box is drawn from the
 * declared rectangle, not read back from it. Drawing it is what makes the sheet's
 * own "write only inside the ruled areas" instruction true, and what makes the
 * authored line count the same rectangle that is reserved, drawn and graded.
 */
const drawAnswerBox = (doc: jsPDF, r: PlacedRegion, ink: InkBox[]) => {
  const box = r.declaredMm;

  doc.setDrawColor(170);
  doc.setLineWidth(0.2);
  doc.rect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0, 'S');

  if (!r.isDrawing) {
    doc.setDrawColor(205);
    doc.setLineWidth(0.15);
    for (let i = 1; i <= r.answerLines; i++) {
      const y = round4(r.nominalMm.y0 + i * WRITING_LINE_MM);
      doc.line(r.nominalMm.x0, y, r.nominalMm.x1, y);
    }
  }

  // The rule that tops the region, per spec 4.1 — solid, and the one edge of the
  // box a student's eye should land on.
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.line(COLUMN_X0_MM, r.ruleYMm, COLUMN_X1_MM, r.ruleYMm);

  // One ink box for the whole region. The rules inside it are not recorded
  // separately: they would read as dozens of blocks overlapping their own frame.
  ink.push({ pageK: r.pageK, what: `answer box ${r.partId}`, ...box });
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
    for (const r of layout.regions.filter(r => r.pageK === k)) await drawRegionPrompt(doc, r, ink);
  }

  // Checked after drawing, not before: the layout can be legal while a
  // right-aligned label still overruns into the QR's column. Text over the
  // modules can stop the symbol decoding, and the QR is the whole registration
  // mechanism, so this is as fatal as any of checks 1–7.
  const inkReport = runInkChecks(ink, selfTest);
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
