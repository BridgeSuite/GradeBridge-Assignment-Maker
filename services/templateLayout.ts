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

import { Assignment, Subsection } from '../types';
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
/** Breath between the question text and the rule that tops the writing area. */
export const RULE_GAP_MM = 2.5;
/** Blank space under one region before the next part's header. */
export const REGION_GAP_MM = 6.0;

/**
 * Question text is set at this size — always, everywhere on the sheet: the
 * problem stem, the sub-part prompt and the sub-part description. There is no
 * scale-to-fit and no page-level squeeze, so a stem can no longer print smaller
 * than the sub-parts under it. What flexes instead is the page count.
 */
export const DESC_FONT_PT = 9.0;
export const DESC_LINE_MM = DESC_FONT_PT * 1.35 * 25.4 / 72;
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
 * jsPDF or the DOM to measure anything. `$\delta_s$` counts as eleven characters
 * and renders as about two, so math over-reserves, which is the safe direction.
 *
 * **This must never come out short.** Authored text is drawn at 9 pt and is
 * never scaled (`drawAuthoredText`), so a reservation smaller than the real
 * render does not shrink the text — it overruns into whatever is beneath, and
 * the generator refuses to emit. Over-reserving costs a little paper. That is
 * the direction to err in, and both numbers below err in it deliberately:
 *
 * - `CHAR_ADVANCE_EM` is 0.62 against a render font that measures **0.40 em**
 *   for prose at this size (Times New Roman, what `renderTextToCanvas` sets;
 *   Helvetica, for comparison, is 0.44). Roughly half again as much width as the
 *   text actually needs, which absorbs the part-line lost at every word wrap.
 * - `DESC_SLACK_LINES` adds a whole line to every non-empty block. Width is not
 *   the only way a block grows: an inline KaTeX span with a subscript is taller
 *   than a plain line of prose, and the estimate assumes every line is exactly
 *   `DESC_LINE_MM`. The slack line absorbs that.
 *
 * Neither number affects where text wraps — a block is always rendered at the
 * full writing column. They buy vertical headroom only.
 */
export const CHAR_ADVANCE_EM = 0.62;
export const DESC_SLACK_LINES = 1;

export const estimateDescLines = (text: string, widthMm: number): number => {
  if (!text.trim()) return 0;
  const charMm = DESC_FONT_PT * CHAR_ADVANCE_EM * 25.4 / 72;
  const perLine = Math.max(20, Math.floor(widthMm / charMm));

  // A figure is reserved for as a block, not by character count — an SVG
  // document is thousands of characters, and counting it as prose would reserve
  // most of a page of blank space for a drawing that needs 51 mm.
  const segs = splitFigures(text);
  const figures = segs.filter(s => s.kind === 'figure').length;
  const proseLines = segs.reduce((n, seg) => {
    if (seg.kind !== 'text' || !seg.value.trim()) return n;
    return n + seg.value.split('\n').reduce(
      (m, para) => m + Math.max(1, Math.ceil(para.trim().length / perLine)), 0
    );
  }, 0);

  // No ceiling. A long stem reserves its full estimated height and prints at
  // full size; if that pushes the part onto a page of its own, it takes one.
  // The slack line is per block, not per paragraph — one taller-than-nominal
  // line is what it is there to absorb.
  return (proseLines > 0 ? proseLines + DESC_SLACK_LINES : 0) + figures * FIGURE_LINES;
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
 * Writing space is **authored, not derived**: `> template: lines=N` on the
 * sub-part says how many writing lines its answer needs, and the generator
 * reserves exactly that. What used to happen instead — half/full pages split by
 * points, with the prose squeezed down whenever a page got tight — meant the
 * space bore no relation to the answer (a three-point list got a blank page, a
 * table got a third of one) and the question text was the compressible
 * remainder. Now the text is fixed and the page count is what flexes.
 *
 * Both numbers below are tunables. `WRITING_LINE_MM` is the one to turn if
 * printed sheets come out cramped or loose.
 *
 * 9.0 mm, not the 8.0 it started at: at 8 mm, engineering handwriting with
 * sub- and superscripts collides across lines — `V_{32} = V_3 - V_2` pushes its
 * subscript into the next line's zone, and the OCR pass then has to separate
 * two rows of glyphs that overlap. 9 mm clears it for a little more paper. One
 * global pitch rather than a per-part one: a single value is the clean first
 * rollout, and there is no evidence yet that some parts want 8 and others 10.
 */
export const WRITING_LINE_MM = 9.0;
export const DEFAULT_ANSWER_LINES = 6;

/**
 * What the retired `space=full` / `space=xtall` values import as: about a page
 * of writing once the heading, the question and the padding are paid for. Not a
 * promise of exactly one page — a part that overruns simply continues, which is
 * the same thing that happens to any other over-long part.
 */
export const FULL_PAGE_LINES = 24;

/** Line counts the pre-2026-08-17 `space=` spellings import as (import only). */
export const LEGACY_SPACE_LINES: Readonly<Record<string, number>> = {
  short: 4, medium: 6, tall: 10,
  half: DEFAULT_ANSWER_LINES, full: FULL_PAGE_LINES, xtall: FULL_PAGE_LINES,
};

/** Writing lines this part asked for, or the default when it never said. */
export const answerLinesFor = (sub: Subsection): number => {
  const n = sub.answerLines;
  return typeof n === 'number' && isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_ANSWER_LINES;
};

/** Height of a writing area holding `lines` lines. */
export const answerBoxMm = (lines: number): number => round4(lines * WRITING_LINE_MM);

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
  /**
   * Writing lines this region reserves and draws. On a whole part it is what
   * the author asked for; on a slice of a part that ran past a page it is what
   * that page could hold, and the rest lands on a continuation region.
   */
  answerLines: number;
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
        answerLines: answerLinesFor(sub),
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
  /**
   * The rule the student writes below, mm. It sits exactly on `declaredMm.y0`,
   * so the region's visual start and its cropped rectangle begin together.
   */
  ruleYMm: number;
  /** The writing area the student sees, mm — exactly `answerLines` lines tall. */
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
  /**
   * Question text that would not fit a page even on its own, and so was
   * reserved smaller than authored — the one place the renderer still scales
   * text down. Not reachable from ordinary prose; worth telling the author.
   */
  clamped: { partId: string; requestedMm: number; usedMm: number }[];
}

/** Heading line above a problem's first part. */
export const PROBLEM_HEADING_MM = 5.5;
/** Gap under a problem block before the first part's prompt row. */
export const PROBLEM_BLOCK_GAP_MM = 1.5;

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
 * A further writing area for the same part, on the page after it. Same
 * `part_id`, so the two crops belong to the same answer; a new `region_id`,
 * because that is the map's unique key. `seq` is 2 for the first continuation.
 *
 * Continuations carry no name and no description: the question was asked on the
 * page before, and this is the rest of the room to answer it in.
 */
export const continuationOf = (p: TemplatePart, seq: number, lines: number): TemplatePart => ({
  ...p,
  regionId: `${p.regionId}x${seq}`,
  name: '',
  description: '',
  answerLines: lines,
  isContinuation: true,
});

/**
 * The sheet is the assignment, so it has to carry the whole question: the
 * assignment's instructions on page 1, each problem's shared setup above its
 * first part, and each part's own text above its writing area. A student should
 * never need a second document to know what 1(a) is asking.
 *
 * Pack, then break. A problem opens a new page carrying its heading and shared
 * setup; its parts then pack down the page at their authored sizes, and the
 * moment the next part's question plus its writing area does not fit the rest of
 * the page, that part starts a new one. A part whose own answer is bigger than a
 * page continues onto the next with the same `part_id`. Nothing is ever squeezed
 * to avoid a break — a break is the correct outcome, paper is cheap and
 * unreadable text is not.
 */
export const buildLayout = (assignment: Assignment): TemplateLayout => {
  const parts = enumerateParts(assignment);
  const regions: PlacedRegion[] = [];
  const clamped: TemplateLayout['clamped'] = [];

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
  let pageK = 0;
  let cursor = 0;
  let pageIsEmpty = true;
  const newPage = () => {
    pageK += 1;
    cursor = pageK === 1 ? page1Top : FIRST_PROMPT_TOP_MM;
    pageIsEmpty = true;
  };

  let previousProblem = -1;
  for (const part of parts) {
    // A problem always opens a page, so a page never mixes two problems and the
    // heading a student reads at the top is always the one they are answering.
    if (part.problemIndex !== previousProblem) newPage();
    previousProblem = part.problemIndex;

    let remaining = part.answerLines;
    let seq = 1;

    while (remaining > 0) {
      // The first region on a page carries the problem block: the heading
      // always, the shared setup only the first time the problem is seen.
      const opens = pageIsEmpty;
      const continued = opens && seenProblem.has(part.problemIndex);
      const slice = seq === 1 ? part : continuationOf(part, seq, remaining);

      const blockHeadingMm = opens ? PROBLEM_HEADING_MM : 0;
      const blockGapMm = opens ? PROBLEM_BLOCK_GAP_MM : 0;
      let blockTextMm = opens && !continued ? descBlockMm(part.problemDescription) : 0;
      let descMm = descBlockMm(slice.description);

      // Everything that is not prose and not the writing area.
      const fixedMm = blockHeadingMm + blockGapMm + PROMPT_ROW_MM + RULE_GAP_MM + REGION_PAD_MM * 2;
      const linesThatFit = () =>
        Math.floor((REGION_Y_MAX_MM - cursor - fixedMm - blockTextMm - descMm + 1e-6) / WRITING_LINE_MM);
      let fits = linesThatFit();

      // Not everything fits and this page already has something on it: break
      // rather than shrink, and try again at the top of a clean page. Nothing is
      // clamped on this path — a page break is the cheap, correct answer, and
      // reaching for the clamp first is how ordinary prose used to get trimmed
      // for no reason but its position on the page.
      if (fits < remaining && !opens) { newPage(); continue; }

      // A page of its own and *still* no room for a single writing line: the
      // question text is longer than a page. Last resort — trim the reservation,
      // which the self-test then refuses to emit on, naming the part. It is the
      // only case where a reservation is smaller than its text.
      if (fits < 1) {
        const requested = round4(blockTextMm + descMm);
        const budget = REGION_Y_MAX_MM - cursor - fixedMm - WRITING_LINE_MM;
        descMm = Math.max(descMm > 0 ? DESC_LINE_MM : 0, Math.min(descMm, budget - blockTextMm));
        if (blockTextMm + descMm > budget) {
          blockTextMm = Math.max(blockTextMm > 0 ? DESC_LINE_MM : 0, budget - descMm);
        }
        clamped.push({ partId: part.partId, requestedMm: requested, usedMm: round4(blockTextMm + descMm) });
        fits = linesThatFit();
      }

      const lines = Math.max(1, Math.min(remaining, fits));

      let problemBlock: ProblemBlock | undefined;
      if (opens) {
        const height = PROBLEM_HEADING_MM + blockTextMm;
        problemBlock = {
          heading: continued ? `${part.problemHeading} (continued)` : part.problemHeading,
          text: continued ? '' : part.problemDescription,
          continued,
          boxMm: { x0: COLUMN_X0_MM, y0: round4(cursor), x1: COLUMN_X1_MM, y1: round4(cursor + height) },
        };
        cursor = round4(cursor + height + PROBLEM_BLOCK_GAP_MM);
      }
      seenProblem.add(part.problemIndex);

      const promptTop = cursor;
      const descBox: RectMm | undefined = descMm > 0 ? {
        x0: COLUMN_X0_MM, y0: round4(promptTop + PROMPT_ROW_MM),
        x1: COLUMN_X1_MM, y1: round4(promptTop + PROMPT_ROW_MM + descMm),
      } : undefined;

      // The rule sits on the declared rectangle rather than a millimetre above
      // it, so the region's visual start and its cropped rectangle begin at the
      // same y: what is reserved, ruled and cropped is one rectangle.
      const header = PROMPT_ROW_MM + descMm + RULE_GAP_MM;
      const declaredTop = round4(promptTop + header);
      const nominalTop = round4(declaredTop + REGION_PAD_MM);
      const nominal: RectMm = {
        x0: COLUMN_X0_MM + REGION_PAD_MM,
        y0: nominalTop,
        x1: COLUMN_X1_MM - REGION_PAD_MM,
        y1: round4(nominalTop + answerBoxMm(lines)),
      };

      regions.push({
        ...slice,
        answerLines: lines,
        pageK,
        problemBlock,
        promptTopMm: round4(promptTop),
        descBoxMm: descBox,
        ruleYMm: declaredTop,
        nominalMm: nominal,
        declaredMm: pad(nominal),
      });

      cursor = round4(nominal.y1 + REGION_PAD_MM + REGION_GAP_MM);
      pageIsEmpty = false;
      remaining -= lines;
      if (remaining > 0) { seq += 1; newPage(); }
    }
  }

  return {
    parts, regions,
    pageCount: Math.max(1, pageK),
    preambleBoxMm,
    page1TopMm: round4(page1Top),
    clamped,
  };
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
