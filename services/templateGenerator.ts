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
import { toPdfText } from './mathRender';
import {
  MARK_ORIGINS_MM, MARK_SIZE_MM, PAGE_H_MM, PAGE_W_MM, QR_KEEPOUT_MM, QR_MODULES,
  QR_QUIET_MM, QR_RECT_MM, QR_SIZE_MM, IDENTITY_BAND_MM, HEADER_TEXT_ANCHOR_MM,
  mmRectToFraction,
} from './pageFormat';
import { encodeQr } from './qrEncoder';
import {
  MASTER_TOKEN, buildPayload, computeLayoutId, derivePageFormatId, isValidPageFormatId,
} from './qrPayload';
import {
  COLUMN_X0_MM, COLUMN_X1_MM, LayoutRow, PlacedRegion, TemplateLayout,
  buildLayout, promptRule, toLayoutCsv, toLayoutRows,
} from './templateLayout';
import { SelfTestReport, runSelfTest } from './templateSelfTest';

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
 * The one text line allowed in the identity band (spec 8.4). Identity-free by
 * construction — assignment id and pagination only. Truncated so it can never
 * reach the QR keep-out at x = 166.
 */
const drawHeaderLine = (doc: jsPDF, assignmentId: string, k: number, n: number) => {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(0);
  const maxWidth = QR_KEEPOUT_MM.x0 - HEADER_TEXT_ANCHOR_MM.x - 4.0;
  let text = `GradeBridge  ${assignmentId}  page ${k} of ${n}`;
  while (text.length > 8 && doc.getTextWidth(text) > maxWidth) text = text.slice(0, -1);
  doc.text(text, HEADER_TEXT_ANCHOR_MM.x, HEADER_TEXT_ANCHOR_MM.y, { baseline: 'top' });
};

/**
 * Course, title, name/ID/date and the print instruction. All of it below the
 * 25 mm band and left of the QR keep-out — put any of it in the band and the
 * consumer's PII gate withholds every crop on every page (spec 4.5).
 */
const drawPage1Furniture = (doc: jsPDF, assignment: Assignment) => {
  let y = IDENTITY_BAND_MM + 1.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0);
  doc.text(toPdfText(`${assignment.courseCode}: ${assignment.title}`), COLUMN_X0_MM, y, { baseline: 'top' });
  y += 6.0;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Name: ____________________________    Student ID: ______________    Date: ____________',
    COLUMN_X0_MM, y, { baseline: 'top' });
  y += 5.0;

  doc.setFontSize(7.5);
  doc.setTextColor(110);
  doc.text('Print at 100% (not "fit to page"), then check all four corner squares are on the paper. Write only inside the ruled areas.',
    COLUMN_X0_MM, y, { baseline: 'top' });
  doc.setTextColor(0);
};

/**
 * A ruled prompt, never a printed box (spec 4.1). The rule sits above the
 * writing area; the declared rectangle covers the writing area only, so the
 * prompt text is deliberately outside it.
 */
const drawRegionPrompt = (doc: jsPDF, r: PlacedRegion) => {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0);

  const label = `${r.partId}.`;
  doc.text(label, COLUMN_X0_MM, r.promptTopMm, { baseline: 'top' });
  const labelW = doc.getTextWidth(label) + 2.0;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const tail = `${r.isDrawing ? 'Sketch' : 'Write'} your answer below this line.`;
  const points = `[${r.maxPoints} pts]`;
  const pointsW = doc.getTextWidth(points);
  const room = COLUMN_X1_MM - COLUMN_X0_MM - labelW - pointsW - 4.0;

  // The template is a writing surface, not a restatement of the question — the
  // student reads the assignment itself. The part title is a locator, so it is
  // truncated to one line to keep the prompt block a fixed height, which is what
  // lets the layout be computed with no text measurement at all.
  let title = toPdfText(r.name).replace(/\s+/g, ' ').trim();
  const sep = title ? ' — ' : '';
  while (title && doc.getTextWidth(`${title}${sep}${tail}`) > room) title = title.slice(0, -1);
  doc.text(`${title}${title ? ' — ' : ''}${tail}`, COLUMN_X0_MM + labelW, r.promptTopMm, { baseline: 'top' });
  doc.text(points, COLUMN_X1_MM - pointsW, r.promptTopMm, { baseline: 'top' });

  const rule = promptRule(r);
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.line(rule.xFromMm, rule.yMm, rule.xToMm, rule.yMm);
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
  if (!selfTest.passed) {
    const err = new Error(
      `Template self-test failed (spec 8.7), so nothing was emitted:\n` +
      selfTest.failures.map(f => `  • ${f}`).join('\n')
    );
    (err as Error & { report?: SelfTestReport }).report = selfTest;
    throw err;
  }

  const doc = new jsPDF({ unit: 'mm', format: [PAGE_W_MM, PAGE_H_MM], orientation: 'portrait' });
  for (let k = 1; k <= layout.pageCount; k++) {
    if (k > 1) doc.addPage([PAGE_W_MM, PAGE_H_MM], 'portrait');
    drawMarks(doc);
    drawQr(doc, payloads[k - 1]);
    drawHeaderLine(doc, assignmentId, k, layout.pageCount);
    if (k === 1) drawPage1Furniture(doc, assignment);
    for (const r of layout.regions.filter(r => r.pageK === k)) drawRegionPrompt(doc, r);
  }

  return {
    assignmentId, layoutId,
    pageCount: layout.pageCount,
    pdf: doc.output('blob'),
    csv,
    pdfFilename: `${assignmentId}_qr_template.pdf`,
    csvFilename: `layout_${assignmentId}.csv`,
    payloads, layout, rows, selfTest,
  };
};

export const QR_MODULE_COUNT = QR_MODULES;
