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
import { splitFigures } from './figureBlocks';
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
// Page 1's furniture is a stack with explicit tops and heights, so a block can
// never be positioned relative to a guess about the one above it. Getting this
// wrong put the print instruction's second line inside the preamble.
export const PAGE1_TITLE_TOP_MM = 26.0;
export const PAGE1_TITLE_H_MM = 6.5;
export const PAGE1_INSTRUCTION_TOP_MM = PAGE1_TITLE_TOP_MM + PAGE1_TITLE_H_MM;   // 32.5
export const PAGE1_INSTRUCTION_LINE_MM = 3.4;
export const PAGE1_INSTRUCTION_LINES = 2;
export const PAGE1_INSTRUCTION_H_MM = PAGE1_INSTRUCTION_LINES * PAGE1_INSTRUCTION_LINE_MM + 1.2; // 8.0
export const PAGE1_PREAMBLE_TOP_MM = PAGE1_INSTRUCTION_TOP_MM + PAGE1_INSTRUCTION_H_MM;          // 40.5

/** Kept for the generator's title box; the stack above is the source of truth. */
export const PAGE1_FURNITURE_TOP_MM = PAGE1_TITLE_TOP_MM;

/** Widest any page-1 furniture line may be — keeps it out of the QR column. */
export const FURNITURE_MAX_WIDTH_MM = QR_KEEPOUT_MM.x0 - COLUMN_X0_MM - 2.0; // 141.0

// ---- Per-region header ---------------------------------------------------
/** `1(a). Title` on the left, `[N pts]` on the right. */
export const PROMPT_ROW_MM = 6.0;
/** Rule, then a breath, then the writing area starts. */
export const RULE_GAP_MM = 2.5;
/** Blank space under one region before the next part's header. */
export const REGION_GAP_MM = 6.0;

/** Question text is set at this size, and wraps at this line height. */
export const DESC_FONT_PT = 9.0;
export const DESC_LINE_MM = DESC_FONT_PT * 1.35 * 25.4 / 72;
/** A single part cannot eat the page with prose; past this it is scaled down. */
export const DESC_MAX_LINES = 8;
/**
 * Height reserved for one figure, in `DESC_LINE_MM` units — about 51 mm, which
 * is a readable circuit diagram without taking the writing area with it. A
 * drawing taller than its box is scaled to fit, as authored text is.
 */
export const FIGURE_LINES = 12;

/**
 * How many lines the question text will take, estimated from character count
 * rather than measured.
 *
 * The layout has to be identical in a browser and in a Node test — the map is
 * hashed into every page's QR, so a millimetre of drift between the two would
 * change `layout_id` and make a template refuse to crop. That rules out asking
 * jsPDF or the DOM to measure anything. Half the font size is a good average
 * advance width for Helvetica prose; `$\delta_s$` counts as eleven characters
 * and renders as about two, so math over-reserves, which is the safe direction.
 */
export const estimateDescLines = (text: string, widthMm: number): number => {
  if (!text.trim()) return 0;
  const charMm = DESC_FONT_PT * 0.5 * 25.4 / 72;
  const perLine = Math.max(20, Math.floor(widthMm / charMm));

  // A figure is reserved for as a block, not by character count — an SVG
  // document is thousands of characters, so counting it as prose would pin every
  // stem it appears in to the DESC_MAX_LINES ceiling and then scale the drawing
  // down into it as a smudge. Text with no figure counts exactly as it always
  // did, so no existing template's layout_id moves.
  const segs = splitFigures(text);
  const figures = segs.filter(s => s.kind === 'figure').length;
  const proseLines = segs.reduce((n, seg) => {
    if (seg.kind !== 'text' || !seg.value.trim()) return n;
    return n + seg.value.split('\n').reduce(
      (m, para) => m + Math.max(1, Math.ceil(para.trim().length / perLine)), 0
    );
  }, 0);

  return Math.min(proseLines, DESC_MAX_LINES) + figures * FIGURE_LINES;
};

/**
 * Vertical space reserved for a block of prose. Zero when there is none.
 * `widthMm` must be the width it will actually be *rendered* at — reserving
 * against a wider column than the renderer uses under-reserves, and the text
 * then gets scaled down to fit a box that was always too small.
 */
export const descBlockMm = (text: string, widthMm: number = COLUMN_X1_MM - COLUMN_X0_MM): number =>
  round4(estimateDescLines(text, widthMm) * DESC_LINE_MM);

/** Height of everything printed above a writing area, for a given part. */
export const headerHeightMm = (description: string): number =>
  PROMPT_ROW_MM + descBlockMm(description) + RULE_GAP_MM;

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
  /** `Problem 2: Rectangular waveguide` — printed above the problem's first part. */
  problemHeading: string;
  /** The problem's shared setup text, printed once under its heading. */
  problemDescription: string;
  /** A second writing area for the same part, on the page after it. */
  isContinuation?: boolean;
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
        problemHeading: `Problem ${pIdx + 1}${prob.name ? `: ${prob.name}` : ''}`,
        problemDescription: prob.description || '',
      };
    })
  );

// ---- Placement -----------------------------------------------------------

/** The problem's heading and shared setup, printed above its first part. */
export interface ProblemBlock {
  heading: string;
  /** Empty when the problem has no shared setup, or when it is a continuation. */
  text: string;
  /** True when the problem started on an earlier page — heading only, no repeat of the setup. */
  continued: boolean;
  boxMm: RectMm;
}

export interface PlacedRegion extends TemplatePart {
  pageK: number;
  /** Printed above this region when it is the first of its problem on the page. */
  problemBlock?: ProblemBlock;
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
  /** The assignment's instructions, printed under the title on page 1. */
  preambleBoxMm?: RectMm;
  /** Where page 1's first prompt row starts, once the furniture is measured. */
  page1TopMm: number;
  /** Parts whose writing area came out unusually small, worth telling the author. */
  clamped: { partId: string; requestedMm: number; usedMm: number }[];
}

/** Heading line above a problem's first part. */
export const PROBLEM_HEADING_MM = 5.5;
/** Gap under a problem block before the first part's prompt row. */
export const PROBLEM_BLOCK_GAP_MM = 1.5;
/** No writing area may be squeezed below this, whatever the prose costs. */
export const MIN_REGION_MM = 22.0;

/** Vertical space a problem block needs, given whether it repeats the setup. */
export const problemBlockMm = (text: string, continued: boolean): number =>
  PROBLEM_HEADING_MM + (continued ? 0 : descBlockMm(text)) + PROBLEM_BLOCK_GAP_MM;

/** Usable vertical run for headers + writing areas on a page. */
export const pageRunMm = (topMm: number): number => REGION_Y_MAX_MM - topMm;

const pad = (r: RectMm): RectMm => ({
  x0: round4(r.x0 - REGION_PAD_MM), y0: round4(r.y0 - REGION_PAD_MM),
  x1: round4(r.x1 + REGION_PAD_MM), y1: round4(r.y1 + REGION_PAD_MM),
});

/**
 * A part's second writing area, on the page that follows it. Same `part_id`, so
 * the two crops belong to the same answer; a new `region_id`, because that is
 * the map's unique key.
 */
export const continuationOf = (p: TemplatePart): TemplatePart => ({
  ...p,
  regionId: `${p.regionId}x2`,
  name: '',
  description: '',
  isContinuation: true,
});

/**
 * Group the parts into pages.
 *
 * 1. **Every problem starts a new page**, and that page carries **one sub-part
 *    only** — it is also carrying the problem heading and the shared setup, so
 *    a second answer area on it would be cramped.
 * 2. The problem's remaining sub-parts follow, at most two to a page.
 * 3. A sketch, or a part marked `full`, is alone on its page.
 * 4. **A problem with a single sub-part gets a second page** — the question and
 *    some writing space, then a full page of writing space for the same part.
 *    A lone question is usually the long one.
 */
export const paginate = (parts: TemplatePart[]): TemplatePart[][] => {
  const pages: TemplatePart[][] = [];

  const byProblem = new Map<number, TemplatePart[]>();
  for (const p of parts) byProblem.set(p.problemIndex, [...(byProblem.get(p.problemIndex) || []), p]);

  for (const [, group] of [...byProblem].sort((a, b) => a[0] - b[0])) {
    pages.push([group[0]]);                                   // rule 1

    if (group.length === 1) {
      pages.push([continuationOf(group[0])]);                 // rule 4
      continue;
    }

    let current: TemplatePart[] = [];
    const flush = () => { if (current.length) { pages.push(current); current = []; } };
    for (const p of group.slice(1)) {
      if (p.fullPage) { flush(); pages.push([p]); continue; } // rule 3
      current.push(p);
      if (current.length === MAX_REGIONS_PER_PAGE) flush();   // rule 2
    }
    flush();
  }

  return pages;
};

/**
 * The sheet is the assignment, so it has to carry the whole question: the
 * assignment's instructions on page 1, each problem's shared setup above its
 * first part, and each part's own text above its writing area. A student should
 * never need a second document to know what 1(a) is asking.
 *
 * Prose competes with writing space, and prose can be arbitrarily long. When a
 * page cannot hold both, the prose is squeezed first — down to a single line per
 * block if it comes to that — so the writing area never falls below
 * MIN_REGION_MM and never runs past the page. The generator scales the rendered
 * text into whatever box survives, so nothing is silently cut off.
 */
export const buildLayout = (assignment: Assignment): TemplateLayout => {
  const parts = enumerateParts(assignment);
  const pages = paginate(parts);
  const regions: PlacedRegion[] = [];
  const clamped: TemplateLayout['clamped'] = [];
  const columnWidth = COLUMN_X1_MM - COLUMN_X0_MM;

  // Page 1's furniture stack: title, print instruction, then the preamble. The
  // preamble is *rendered* at the narrower furniture width (it must stay clear
  // of the QR column at this height), so it is *reserved* at that width too —
  // estimating against the full column would under-reserve and shrink the text.
  const preambleMm = descBlockMm(assignment.preamble || '', FURNITURE_MAX_WIDTH_MM);
  const preambleBoxMm: RectMm | undefined = preambleMm > 0 ? {
    x0: COLUMN_X0_MM, y0: PAGE1_PREAMBLE_TOP_MM,
    x1: COLUMN_X0_MM + FURNITURE_MAX_WIDTH_MM, y1: round4(PAGE1_PREAMBLE_TOP_MM + preambleMm),
  } : undefined;
  const furnitureBottom = (preambleBoxMm ? preambleBoxMm.y1 : PAGE1_PREAMBLE_TOP_MM) + 2.0;
  const page1Top = round4(Math.max(FIRST_PROMPT_TOP_MM, furnitureBottom));

  const seenProblem = new Set<number>();

  pages.forEach((pageParts, pageIdx) => {
    const pageK = pageIdx + 1;
    const top = pageK === 1 ? page1Top : FIRST_PROMPT_TOP_MM;
    const run = pageRunMm(top);

    // Which parts open a problem block on this page, and whether it is a repeat.
    const openers = pageParts.map((p, i) => {
      const firstOfProblemHere = i === 0 || pageParts[i - 1].problemIndex !== p.problemIndex;
      return firstOfProblemHere
        ? { continued: seenProblem.has(p.problemIndex) }
        : null;
    });
    pageParts.forEach(p => seenProblem.add(p.problemIndex));

    // Shrink prose until the writing areas fit. `squeeze` scales every reserved
    // prose block on the page; 1 is "as authored", 0 is "one line each".
    const proseMm = (squeeze: number) =>
      pageParts.reduce((n, p, i) => {
        const opener = openers[i];
        const problem = opener
          ? PROBLEM_HEADING_MM + PROBLEM_BLOCK_GAP_MM +
            (opener.continued ? 0 : shrink(descBlockMm(p.problemDescription), squeeze))
          : 0;
        return n + problem + shrink(descBlockMm(p.description), squeeze);
      }, 0);
    const fixedMm = pageParts.reduce((n) => n + PROMPT_ROW_MM + RULE_GAP_MM + REGION_PAD_MM * 2, 0)
      + REGION_GAP_MM * (pageParts.length - 1);
    const needed = MIN_REGION_MM * pageParts.length;

    let squeeze = 1;
    while (squeeze > 0 && run - fixedMm - proseMm(squeeze) < needed) squeeze = round4(squeeze - 0.05);
    squeeze = Math.max(0, squeeze);

    const writable = Math.max(run - fixedMm - proseMm(squeeze), needed);
    const shares = pageParts.length === 2
      ? splitByPoints(pageParts[0].maxPoints, pageParts[1].maxPoints)
      : [1];

    let cursor = top;
    pageParts.forEach((part, i) => {
      const opener = openers[i];
      let problemBlock: ProblemBlock | undefined;
      if (opener) {
        const textMm = opener.continued ? 0 : shrink(descBlockMm(part.problemDescription), squeeze);
        const height = PROBLEM_HEADING_MM + textMm;
        problemBlock = {
          heading: opener.continued ? `${part.problemHeading} (continued)` : part.problemHeading,
          text: opener.continued ? '' : part.problemDescription,
          continued: opener.continued,
          boxMm: { x0: COLUMN_X0_MM, y0: round4(cursor), x1: COLUMN_X1_MM, y1: round4(cursor + height) },
        };
        cursor = round4(cursor + height + PROBLEM_BLOCK_GAP_MM);
      }

      const promptTop = cursor;
      const descHeight = shrink(descBlockMm(part.description), squeeze);
      const descBox: RectMm | undefined = descHeight > 0 ? {
        x0: COLUMN_X0_MM, y0: round4(promptTop + PROMPT_ROW_MM),
        x1: COLUMN_X1_MM, y1: round4(promptTop + PROMPT_ROW_MM + descHeight),
      } : undefined;

      const header = PROMPT_ROW_MM + descHeight + RULE_GAP_MM;
      const height = Math.max(writable * shares[i], MIN_REGION_MM);
      if (height < 30.0) clamped.push({ partId: part.partId, requestedMm: 30.0, usedMm: round4(height) });

      const ruleY = round4(promptTop + header - 1.0);
      const nominalTop = promptTop + header + REGION_PAD_MM;
      const nominal: RectMm = {
        x0: COLUMN_X0_MM + REGION_PAD_MM,
        y0: round4(nominalTop),
        x1: COLUMN_X1_MM - REGION_PAD_MM,
        y1: round4(nominalTop + height),
      };

      regions.push({
        ...part,
        pageK,
        problemBlock,
        promptTopMm: round4(promptTop),
        descBoxMm: descBox,
        ruleYMm: ruleY,
        nominalMm: nominal,
        declaredMm: pad(nominal),
      });

      cursor = nominal.y1 + REGION_PAD_MM + REGION_GAP_MM;
    });
  });

  return {
    parts, regions,
    pageCount: Math.max(1, pages.length),
    preambleBoxMm,
    page1TopMm: round4(page1Top),
    clamped,
  };
};

/** Scale a reserved prose block, never below one line (or zero when there is none). */
const shrink = (mm: number, squeeze: number): number =>
  mm <= 0 ? 0 : round4(Math.max(DESC_LINE_MM, mm * squeeze));

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
