/**
 * templateLayout.ts — Assignment → page-format region map.
 *
 * Decides how many pages a template needs, where each part's writing area sits,
 * and emits the sidecar rows. Pure geometry and pure data: no jsPDF, no DOM, no
 * text measurement, so the map is identical whether it is computed in a browser
 * or in a test, and the whole thing is testable without rendering anything.
 *
 * Spec: `GradeBridge_Page_Format_v1.md` 4.1–4.4 and 8.5.
 */

import { Assignment, Subsection, AnswerSpace } from '../types';
import {
  PAGE_H_MM, QR_KEEPOUT_MM, REGION_PAD_MM, REGION_Y_MAX_MM,
  RectMm, mmRectToFraction, round4,
} from './pageFormat';

// ---- The writing column --------------------------------------------------
// Chosen so a declared rectangle can never touch a registration-corner keep-out
// at any y: the corners occupy x 7–22 and x 193.9–208.9, so a column strictly
// inside 22 → 193.9 is clear top and bottom, which is what lets the last region
// on a page run all the way down to y = 262.
export const COLUMN_X0_MM = 23.0;   // declared (padded) left edge
export const COLUMN_X1_MM = 192.9;  // declared (padded) right edge

/**
 * Where a page's first prompt row may start.
 *
 * The column reaches past x = 166, so it sits in the QR keep-out's x-range. It
 * is not enough for the *writing rectangle* to clear the keep-out: the prompt
 * row above it carries a right-aligned points label at the column's right edge,
 * which lands squarely in the QR's column. Text over the modules can stop the
 * symbol decoding, and the QR is the whole registration mechanism — so the
 * entire prompt row starts below the keep-out's lower edge, on every page.
 */
export const FIRST_PROMPT_TOP_MM = QR_KEEPOUT_MM.y1 + 1.0; // 38.0

/**
 * Page 1 also carries the course/title line and the print instruction. Both sit
 * between the identity band and the first prompt row, and both are held left of
 * the QR keep-out, so this strip is reserved rather than measured.
 */
export const PAGE1_FURNITURE_TOP_MM = 26.0;
export const PAGE1_FURNITURE_BOTTOM_MM = 44.0;

/** Widest any page-1 furniture line may be — keeps it out of the QR column. */
export const FURNITURE_MAX_WIDTH_MM = QR_KEEPOUT_MM.x0 - COLUMN_X0_MM - 2.0; // 141.0

// ---- Per-region header ---------------------------------------------------
/** `1(a). Title` on the left, `[N pts]` on the right. */
export const PROMPT_ROW_MM = 6.0;
/** The question text, when the part has one. Rendered into a fixed box. */
export const DESC_BLOCK_MM = 13.0;
/** Rule, then a breath, then the writing area starts. */
export const RULE_GAP_MM = 2.5;
/** Blank space under one region before the next part's header. */
export const REGION_GAP_MM = 6.0;

/** Height of everything printed above a writing area, for a given part. */
export const headerHeightMm = (hasDescription: boolean): number =>
  PROMPT_ROW_MM + (hasDescription ? DESC_BLOCK_MM : 0) + RULE_GAP_MM;

// ---- Sizing --------------------------------------------------------------

/**
 * Item 3 of the 2026-08-15 correction: writing space is set **by rule, not by
 * points**. At most two answer regions per page, each getting roughly half the
 * usable height. A sketch, or a part explicitly marked `full`, takes a page to
 * itself. Within a two-region page the split still leans on points, so a 25-pt
 * part gets more room than a 5-pt one, but bounded so neither is squeezed.
 *
 * This replaced a points-derived short/medium/tall scale that produced very
 * uneven pages — a single part could take most of a sheet.
 */
export const MAX_REGIONS_PER_PAGE = 2;

/** Neither half of a shared page may drop below this share of the usable height. */
export const MIN_SHARE = 0.35;
export const MAX_SHARE = 1 - MIN_SHARE;

export const answerSpaceFor = (sub: Subsection): AnswerSpace =>
  sub.isDrawing ? 'full' : (sub.answerSpace ?? 'half');

/** True when this part must have a page to itself. */
export const isFullPage = (sub: Subsection): boolean => answerSpaceFor(sub) === 'full';

// ---- Parts ---------------------------------------------------------------

export interface TemplatePart {
  /** Opaque machine key, `^[a-z][a-z0-9]*$`, unique within the assignment. */
  regionId: string;
  /** Human display string — `1(a)`, `2`. Never parsed downstream. */
  partId: string;
  /** Sub-part title, for the printed prompt only. Not in the map. */
  name: string;
  /** Question text, printed above the writing area. Not in the map. */
  description: string;
  maxPoints: number;
  isDrawing: boolean;
  fullPage: boolean;
  /** Index of the problem this part belongs to, for keeping a problem together. */
  problemIndex: number;
  /** How many parts that problem has. */
  problemPartCount: number;
}

/**
 * `1(a)` when a problem has several sub-parts, plain `2` when it has one — the
 * shape the spec's worked example uses. `region_id` mirrors it as `p1a` / `p2`.
 */
export const enumerateParts = (assignment: Assignment): TemplatePart[] =>
  assignment.problems.flatMap((prob, pIdx) =>
    prob.subsections.map((sub, sIdx) => {
      const single = prob.subsections.length === 1;
      const letter = String.fromCharCode(97 + sIdx);
      return {
        regionId: single ? `p${pIdx + 1}` : `p${pIdx + 1}${letter}`,
        partId: single ? `${pIdx + 1}` : `${pIdx + 1}(${letter})`,
        name: sub.name || '',
        description: sub.description || '',
        maxPoints: sub.points,
        isDrawing: !!sub.isDrawing,
        fullPage: isFullPage(sub),
        problemIndex: pIdx,
        problemPartCount: prob.subsections.length,
      };
    })
  );

// ---- Placement -----------------------------------------------------------

export interface PlacedRegion extends TemplatePart {
  pageK: number;
  /** Top of the `1(a). Title …[N pts]` row, mm. Printed content. */
  promptTopMm: number;
  /** Box the question text is rendered into, mm. Absent when there is none. */
  descBoxMm?: RectMm;
  /** The rule the student writes below, mm. */
  ruleYMm: number;
  /** The writing area the student sees, mm. */
  nominalMm: RectMm;
  /** nominal grown by REGION_PAD_MM on all four sides — this is what is stored. */
  declaredMm: RectMm;
}

export interface TemplateLayout {
  parts: TemplatePart[];
  regions: PlacedRegion[];
  pageCount: number;
  /** Parts whose writing area came out unusually small, worth telling the author. */
  clamped: { partId: string; requestedMm: number; usedMm: number }[];
}

/** Top of the first prompt row on a page. */
export const pageTopMm = (pageK: number): number =>
  pageK === 1 ? Math.max(FIRST_PROMPT_TOP_MM, PAGE1_FURNITURE_BOTTOM_MM) : FIRST_PROMPT_TOP_MM;

/** Usable vertical run for headers + writing areas on a page. */
export const pageRunMm = (pageK: number): number => REGION_Y_MAX_MM - pageTopMm(pageK);

const pad = (r: RectMm): RectMm => ({
  x0: round4(r.x0 - REGION_PAD_MM), y0: round4(r.y0 - REGION_PAD_MM),
  x1: round4(r.x1 + REGION_PAD_MM), y1: round4(r.y1 + REGION_PAD_MM),
});

/**
 * Group the parts into pages: full-page parts alone, everything else in twos.
 * A problem with exactly two parts is kept together when that only costs
 * starting a new page — which is what "naturally" means here; nothing is
 * reordered and no page is left empty to achieve it.
 */
export const paginate = (parts: TemplatePart[]): TemplatePart[][] => {
  const pages: TemplatePart[][] = [];
  let current: TemplatePart[] = [];
  const flush = () => { if (current.length) { pages.push(current); current = []; } };

  parts.forEach((part, i) => {
    if (part.fullPage) { flush(); pages.push([part]); return; }

    // Would this part start a two-part problem as the *second* region on a page,
    // splitting it across the break? Start a fresh page instead.
    const startsPairedProblem =
      part.problemPartCount === 2 &&
      parts[i - 1]?.problemIndex !== part.problemIndex &&
      !parts[i + 1]?.fullPage &&
      parts[i + 1]?.problemIndex === part.problemIndex;
    if (current.length === 1 && startsPairedProblem) flush();

    current.push(part);
    if (current.length === MAX_REGIONS_PER_PAGE) flush();
  });
  flush();
  return pages;
};

export const buildLayout = (assignment: Assignment): TemplateLayout => {
  const parts = enumerateParts(assignment);
  const pages = paginate(parts);
  const regions: PlacedRegion[] = [];
  const clamped: TemplateLayout['clamped'] = [];

  pages.forEach((pageParts, pageIdx) => {
    const pageK = pageIdx + 1;
    const top = pageTopMm(pageK);
    const run = pageRunMm(pageK);

    // Everything printed above the writing areas, plus the padding they carry.
    const overhead = pageParts.reduce((n, p) => n + headerHeightMm(!!p.description) + REGION_PAD_MM * 2, 0)
      + REGION_GAP_MM * (pageParts.length - 1);
    const writable = run - overhead;

    // Two regions split the writable run by points, bounded so neither is squeezed.
    const shares = pageParts.length === 2
      ? splitByPoints(pageParts[0].maxPoints, pageParts[1].maxPoints)
      : [1];

    let cursor = top;
    pageParts.forEach((part, i) => {
      const height = Math.max(writable * shares[i], 0);
      if (height < 25.0) {
        clamped.push({ partId: part.partId, requestedMm: 25.0, usedMm: round4(height) });
      }

      const promptTop = cursor;
      const hasDesc = !!part.description;
      const descBox: RectMm | undefined = hasDesc ? {
        x0: COLUMN_X0_MM, y0: round4(promptTop + PROMPT_ROW_MM),
        x1: COLUMN_X1_MM, y1: round4(promptTop + PROMPT_ROW_MM + DESC_BLOCK_MM),
      } : undefined;

      const ruleY = round4(promptTop + headerHeightMm(hasDesc) - 1.0);
      const nominalTop = promptTop + headerHeightMm(hasDesc) + REGION_PAD_MM;
      const nominal: RectMm = {
        x0: COLUMN_X0_MM + REGION_PAD_MM,
        y0: round4(nominalTop),
        x1: COLUMN_X1_MM - REGION_PAD_MM,
        y1: round4(nominalTop + height),
      };

      regions.push({
        ...part,
        pageK,
        promptTopMm: round4(promptTop),
        descBoxMm: descBox,
        ruleYMm: ruleY,
        nominalMm: nominal,
        declaredMm: pad(nominal),
      });

      cursor = nominal.y1 + REGION_PAD_MM + REGION_GAP_MM;
    });
  });

  return { parts, regions, pageCount: Math.max(1, pages.length), clamped };
};

/** Points-weighted split of a shared page, bounded to [MIN_SHARE, MAX_SHARE]. */
export const splitByPoints = (a: number, b: number): [number, number] => {
  const total = (a || 0) + (b || 0);
  if (total <= 0) return [0.5, 0.5];
  const first = Math.min(MAX_SHARE, Math.max(MIN_SHARE, a / total));
  return [first, 1 - first];
};

// ---- The stored map ------------------------------------------------------

/** One row of `layout_{assignment_id}.csv`, spec 4.3. */
export interface LayoutRow {
  assignmentId: string;
  layoutId: string;
  regionId: string;
  partId: string;
  pageK: number;
  x0: number; y0: number; x1: number; y1: number;
  isDrawing: 0 | 1;
  maxPoints: number;
}

export const LAYOUT_CSV_HEADER =
  'assignment_id,layout_id,region_id,part_id,page_k,x0,y0,x1,y1,is_drawing,max_points';

/** Regions → map rows, in fractions. `layoutId` is filled in once it is hashed. */
export const toLayoutRows = (
  regions: PlacedRegion[], assignmentId: string, layoutId: string
): LayoutRow[] =>
  regions.map(r => {
    const fr = mmRectToFraction(r.declaredMm);
    return {
      assignmentId, layoutId,
      regionId: r.regionId, partId: r.partId, pageK: r.pageK,
      x0: fr.x0, y0: fr.y0, x1: fr.x1, y1: fr.y1,
      isDrawing: r.isDrawing ? 1 : 0,
      maxPoints: r.maxPoints,
    };
  });

/**
 * Fields land in the CSV unquoted, matching the spec's worked example, so a value
 * carrying a comma, quote or newline would corrupt the map. Every emitted value
 * is machine-generated and cannot, but assert rather than assume.
 */
export const csvUnsafeFields = (rows: LayoutRow[]): string[] =>
  rows.flatMap(r =>
    ([['assignment_id', r.assignmentId], ['layout_id', r.layoutId],
      ['region_id', r.regionId], ['part_id', r.partId]] as const)
      .filter(([, v]) => /[",\r\n]/.test(v))
      .map(([col, v]) => `${r.regionId}: ${col} contains a CSV metacharacter: ${JSON.stringify(v)}`)
  );

export const toLayoutCsv = (rows: LayoutRow[]): string => {
  const body = rows.map(r => [
    r.assignmentId, r.layoutId, r.regionId, r.partId, String(r.pageK),
    r.x0.toFixed(4), r.y0.toFixed(4), r.x1.toFixed(4), r.y1.toFixed(4),
    String(r.isDrawing), String(r.maxPoints),
  ].join(','));
  return [LAYOUT_CSV_HEADER, ...body].join('\n') + '\n';
};

export const PAGE_BOTTOM_MM = PAGE_H_MM;
