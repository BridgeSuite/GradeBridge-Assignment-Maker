/**
 * templateLayout.ts — Assignment → page-format region map.
 *
 * Decides how many pages a template needs, where each part's writing area sits,
 * and emits the sidecar rows. Pure geometry and pure data: no jsPDF, no DOM, so
 * the whole thing is testable without rendering anything.
 *
 * Spec: `GradeBridge_Page_Format_v1.md` 4.1–4.4 and 8.5.
 */

import { Assignment, Subsection, AnswerSpace } from '../types';
import {
  IDENTITY_BAND_MM, PAGE_H_MM, QR_KEEPOUT_MM, REGION_PAD_MM, REGION_Y_MAX_MM,
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
 * The column reaches past x = 166, so it sits in the QR keep-out's x-range and
 * every page's first rectangle has to clear the keep-out's lower edge rather
 * than merely the identity band. Same reasoning as the spec's worked example
 * (Appendix B), which starts its first region at 40.3 mm for exactly this reason.
 */
export const FIRST_REGION_TOP_MM = QR_KEEPOUT_MM.y1 + 1.0; // 38.0

/**
 * Page 1 carries the furniture the identity band is not allowed to hold — course,
 * title, the name/ID/date line, and the print instruction — so its first region
 * starts lower. Everything in that strip is below y = 25 and left of x = 166, so
 * it trips neither the band's ink scan nor the QR keep-out.
 */
export const PAGE1_FURNITURE_MM = 12.0;

/** Prompt line + rule + gap, above every writing area. Printed, never declared. */
export const PROMPT_BLOCK_MM = 9.0;
/** Blank space under one region before the next part's prompt. */
export const REGION_GAP_MM = 5.0;

/** Nominal writing-area heights, mm. The declared rectangle adds REGION_PAD_MM on each side. */
export const ANSWER_SPACE_MM: Record<AnswerSpace, number> = {
  short: 32.0,
  medium: 58.0,
  tall: 92.0,
  xtall: 140.0,
};

/** Default sizing when the author has not chosen: bigger parts get more room. */
export const defaultAnswerSpace = (sub: Subsection): AnswerSpace => {
  if (sub.isDrawing) return 'tall';
  const pts = sub.points || 0;
  if (pts <= 5) return 'short';
  if (pts <= 12) return 'medium';
  if (pts <= 25) return 'tall';
  return 'xtall';
};

export const answerSpaceFor = (sub: Subsection): AnswerSpace =>
  sub.answerSpace ?? defaultAnswerSpace(sub);

// ---- Parts ---------------------------------------------------------------

export interface TemplatePart {
  /** Opaque machine key, `^[a-z][a-z0-9]*$`, unique within the assignment. */
  regionId: string;
  /** Human display string — `1(a)`, `2`. Never parsed downstream. */
  partId: string;
  /** Sub-part title, for the printed prompt only. Not in the map. */
  name: string;
  maxPoints: number;
  isDrawing: boolean;
  heightMm: number;
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
        maxPoints: sub.points,
        isDrawing: !!sub.isDrawing,
        heightMm: ANSWER_SPACE_MM[answerSpaceFor(sub)],
      };
    })
  );

// ---- Placement -----------------------------------------------------------

/** One placed region: the printed prompt, and the declared (padded) rectangle. */
export interface PlacedRegion extends TemplatePart {
  pageK: number;
  /** Top of the prompt text, mm. Printed content. */
  promptTopMm: number;
  /** The writing area the student sees, mm. */
  nominalMm: RectMm;
  /** nominal grown by REGION_PAD_MM on all four sides — this is what is stored. */
  declaredMm: RectMm;
}

export interface TemplateLayout {
  parts: TemplatePart[];
  regions: PlacedRegion[];
  pageCount: number;
  /** Parts whose requested height did not fit a page and were shortened. */
  clamped: { partId: string; requestedMm: number; usedMm: number }[];
}

/** Top of the first prompt block on a page — page 1 sits lower, under the furniture. */
export const pageTopMm = (pageK: number): number =>
  FIRST_REGION_TOP_MM + (pageK === 1 ? PAGE1_FURNITURE_MM : 0) + REGION_PAD_MM - PROMPT_BLOCK_MM;

/** Tallest writing area that can start at the top of a fresh page (page 2 onward). */
export const MAX_REGION_HEIGHT_MM = REGION_Y_MAX_MM - (FIRST_REGION_TOP_MM + REGION_PAD_MM);

const pad = (r: RectMm): RectMm => ({
  x0: round4(r.x0 - REGION_PAD_MM), y0: round4(r.y0 - REGION_PAD_MM),
  x1: round4(r.x1 + REGION_PAD_MM), y1: round4(r.y1 + REGION_PAD_MM),
});

/**
 * Flow the parts down the pages. Each page starts a fresh column below the QR
 * keep-out; a part that does not fit in what is left moves to the next page
 * whole, because a writing area split across a page break has no meaning.
 */
export const buildLayout = (assignment: Assignment): TemplateLayout => {
  const parts = enumerateParts(assignment);
  const regions: PlacedRegion[] = [];
  const clamped: TemplateLayout['clamped'] = [];

  let pageK = 1;
  // Cursor is the top of the next prompt block.
  let cursor = pageTopMm(pageK);

  let regionsOnPage = 0;

  for (const part of parts) {
    /** Writing-area height that still leaves the declared rectangle inside y ≤ 262. */
    const roomAt = (top: number) => REGION_Y_MAX_MM - (top + PROMPT_BLOCK_MM + REGION_PAD_MM);

    let height = Math.min(part.heightMm, MAX_REGION_HEIGHT_MM);
    if (height > roomAt(cursor)) {
      if (regionsOnPage > 0) {
        pageK += 1;
        regionsOnPage = 0;
        cursor = pageTopMm(pageK);
      }
      // Page 1 starts lower than the rest, so the tallest part can still be a
      // little too tall for it even on a fresh page. Shorten rather than leave
      // page 1 empty and push everything down one page.
      height = Math.min(height, roomAt(cursor));
    }
    if (height < part.heightMm) {
      clamped.push({ partId: part.partId, requestedMm: part.heightMm, usedMm: round4(height) });
    }

    const nominalTop = cursor + PROMPT_BLOCK_MM;
    const nominal: RectMm = {
      x0: COLUMN_X0_MM + REGION_PAD_MM,
      y0: round4(nominalTop),
      x1: COLUMN_X1_MM - REGION_PAD_MM,
      y1: round4(nominalTop + height),
    };

    regions.push({
      ...part,
      pageK,
      promptTopMm: round4(cursor),
      nominalMm: nominal,
      declaredMm: pad(nominal),
    });

    regionsOnPage += 1;
    cursor = nominal.y1 + REGION_PAD_MM + REGION_GAP_MM;
  }

  return { parts, regions, pageCount: Math.max(1, pageK), clamped };
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

/** Where the prompt rule is drawn, and how wide. Printed content, not declared. */
export const promptRule = (r: PlacedRegion) => ({
  xFromMm: COLUMN_X0_MM,
  xToMm: COLUMN_X1_MM,
  yMm: round4(r.nominalMm.y0 - 1.5),
});

export const IDENTITY_BAND_LIMIT_MM = IDENTITY_BAND_MM;
export const PAGE_BOTTOM_MM = PAGE_H_MM;
