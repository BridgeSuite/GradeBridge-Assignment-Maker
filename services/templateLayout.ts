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
  PAGE_H_MM, QR_KEEPOUT_MM, REGION_PAD_MM,
  RectMm, mmRectToFraction, round4,
} from './pageFormat';

// ---- The writing column --------------------------------------------------
/**
 * The full width of everything printed below the identity band, and the outer
 * edge of every answer box.
 *
 * It used to be x 23.0 → 192.9, narrowed on purpose so a declared rectangle
 * could never touch a registration-corner keep-out *at any y* — the corners
 * occupy x 7–22 and x 193.9–208.9 — which is what let the last region on a page
 * run down to y = 262.
 *
 * That trade is now made the other way round (`WORKORDER_ANSWER_BOX_2026-08-31`
 * §2, option C). The corner keep-outs only bite in two horizontal bands, y 7–22
 * and y 257.4–272.4; regions never start above y = 38, so only the bottom band
 * constrains anything. Taking the page-wide safe area (12.0 → 203.9) and capping
 * every region at `REGION_BOTTOM_MM` buys **22.0 mm of writing width on every
 * line of every region**, 13% more, against 5.0 mm of height once per page. It
 * is also the only option that is uniform — a box that changes width down the
 * sheet reads as a defect — and it is what makes the ingest spec's §4.4.4 check
 * Z5 (the sole region on a page spans the full permitted width) pass rather than
 * warn on every page this app emits.
 */
export const COLUMN_X0_MM = 12.0;   // outer left edge of the printed answer box
export const COLUMN_X1_MM = 203.9;  // outer right edge of the printed answer box

// ---- The printed answer box ----------------------------------------------
/**
 * **Every answer region is a bordered box.** This reverses the 2026-08-17
 * decision to draw a top rule and no frame, on the instructor's call of
 * 2026-08-31; page-format §4.1 and §8.5 carry the amendment.
 *
 * A printed box does four jobs and only the first is obvious
 * (`GradeBridge-Exam-Maker/docs/EEC100_Final_Format_Spec_2026-08-28.md` §0):
 * it tells the student where to write; **it is a fiducial**, so a detector
 * perspective-corrects from the box's own corners and nothing depends on the
 * answer landing where the map predicted; it bounds the crop, and on the EEC100
 * midterm what got clipped was the end of the working, which biased scores one
 * way; and it creates the whitespace returned markup needs.
 *
 * The fiducial argument is worth **more** to homework than to the exam.
 * Homework arrives as a phone photograph of a possibly curled page, not a
 * flatbed scan, and page-format §6 measures corner-mark detection falling from
 * 4 of 4 to 2 of 4 on a page rotated by 6 degrees — at 2 of 4 the page goes to
 * manual. A per-region border survives that.
 *
 * 1.0 pt: the exam spec's floor ("solid, continuous and dark, at least 1 pt; a
 * dashed or hairline border is not reliably found"). Deliberately its own value
 * and not the 0.3 mm ≈ 0.85 pt the retired top rule used.
 */
export const BORDER_PT = 1.0;
export const BORDER_MM = round4(BORDER_PT * 25.4 / 72);   // 0.3528

/**
 * The lowest any printed ink may reach — the outer edge of the last box on a
 * page. 5.0 mm above the format's own `REGION_Y_MAX_MM` (262.0), which is what
 * option C spends to buy the extra width: the bottom registration corners
 * occupy y 257.4–272.4, and at the full column width a box would otherwise run
 * straight through them. 22.4 mm of paper below it, comfortably past the exam
 * spec's "at least 6 mm to any paper edge".
 */
export const REGION_BOTTOM_MM = 257.0;

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
export const FURNITURE_MAX_WIDTH_MM = QR_KEEPOUT_MM.x0 - COLUMN_X0_MM - 2.0; // 152.0

// ---- Per-region header ---------------------------------------------------
/** `1(a). Title` on the left, `[N pts]` on the right. */
export const PROMPT_ROW_MM = 6.0;
/** Breath between the question text and the top edge of the answer box. */
export const RULE_GAP_MM = 2.5;
/** Blank space under one box before the next part's header. */
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

/**
 * The smallest box that may be printed, outer edge to outer edge.
 *
 * 28 mm, the `\abmin` the exam track already uses
 * (`EEC100_Final_Format_Spec` §1.1), below which a box moves to the next page
 * rather than being emitted small. There was no equivalent here: a part
 * authored `> template: lines=2` produced an 18 mm region, which is a box a
 * detector has to find, a crop a grader has to read, and not enough of either.
 *
 * It is a floor on the box, not a cap on the author: a part asking for fewer
 * lines than this gets the floor, and a part that cannot meet the floor in
 * what is left of a page breaks to a new one, which is what `buildLayout`
 * already does for a part that does not fit.
 */
export const MIN_BOX_MM = 28.0;

/** `MIN_BOX_MM` expressed in writing lines — 3 at a 9 mm pitch. */
export const MIN_ANSWER_LINES = Math.max(1, Math.ceil(
  (MIN_BOX_MM - 2 * BORDER_MM - 2 * REGION_PAD_MM) / WRITING_LINE_MM
));

// ---- The instructions page (page 1) --------------------------------------

/**
 * **Page 1 of a handwritten assignment is an instructions page, by design.** It
 * carries the standing instructions and the author's preamble and nothing else:
 * no problem, no answer region, no row in `layout_*.csv`, and therefore nothing
 * that is ever cropped. Problems begin on page 2. Always — not when the preamble
 * happens to be long enough.
 *
 * It used to be emergent. The ENG17 preamble was written long enough to push
 * Problem 1 onto page 2, which worked and was a side effect rather than a
 * feature: twenty words shorter and the instructions were squeezed beside a
 * circuit diagram with nothing announcing it, and a tuning of `CHAR_ADVANCE_EM`
 * would have done the same. After the column widened and the region-height fix
 * landed the break stopped happening, and nothing noticed.
 *
 * Three properties are now guarantees rather than consequences, and the
 * self-test holds them: page 1 carries no rows in the map, `k=1` is always the
 * instructions page, and `N` counts it.
 *
 * THE SPLIT (2026-09-01): **the tool owns instructions about the sheet and the
 * submission; the author's preamble owns instructions about the work.** The
 * evidence for needing a boundary at all is that ENG17's first preamble draft
 * opened by repeating the print instruction almost word for word, because it was
 * written without looking at the exported page — two authors writing standing
 * instructions into one page with no rule about who owned what.
 *
 * THE GOVERNING RULE for what may be added here: **if a piece of advice would
 * only ever help the automatic reader, it does not belong in front of students,
 * and no mark anywhere in any rubric may depend on following it.** Adopted from
 * `EEC100_Final_Student_Note_2026-08-28.md`. Centralising these sentences means
 * a bad one appears on every sheet in the system rather than one course's, so
 * the bar goes up rather than down: every line below earns its place with a
 * human grader too.
 */
export const STANDING_INSTRUCTIONS: ReadonlyArray<{ heading: string; items: readonly string[] }> = [
  {
    // First on the page, above the printing instructions, so it is read rather
    // than buried among them.
    //
    // **No institution is named, and none may be.** This tool is meant for use
    // beyond the course and the campus that commissioned it, so the standing
    // text has to be true everywhere it is printed. "Academic misconduct" is the
    // common term; a named code, an office, a penalty schedule and a reporting
    // route all differ by institution and would be wrong somewhere. That is the
    // split extended one step: **the tool states the obligation, the author
    // states the policy.**
    //
    // OPEN, AND IT BELONGS TO THE AUTHOR: this says nothing about what
    // assistance is permitted — a calculator, a textbook, a classmate, a study
    // group, an AI assistant. That varies by course and by institution, so it
    // belongs in the preamble. Every course that adopts this tool will otherwise
    // inherit the previous course's unstated assumption.
    heading: 'Your own work',
    items: [
      'The work you submit must be your own. Submitting work that is not your own is academic misconduct.',
    ],
  },
  {
    heading: 'Before you start',
    items: [
      'Print at 100%, not "fit to page". Check that all four black corner squares appear on every sheet.',
      'Do not write your name or student ID anywhere on these pages. You are identified when you upload.',
    ],
  },
  {
    heading: 'As you work',
    items: [
      // States the constraint and then says what the box is FOR, rather than the
      // bare prohibition that was held back in August: "do not continue in the
      // margin or on the back" told a student who had run out of room to write
      // less, with no alternative. If a continuation mechanism is ever built,
      // this is the sentence that announces it.
      //
      // Amended 2026-09-01. It previously ended "the boxes are sized for a full
      // answer; if you are running out of room, there is usually a shorter
      // route" — which treats running out of room as a SIZING problem and
      // answers it by telling a student who needed the room that they took the
      // long way. Running out of room is a COMPOSITION problem. Saying so
      // teaches something, drops the implicit accusation, and makes the space
      // question largely disappear. It also makes the sheet honest about the
      // artifact: a box that collects only what is inside it should say plainly
      // that it wants a solution, not a workspace.
      'Write each answer inside its printed box. Only what is inside the box is collected. Work the problem out on scratch paper first, then write into the box the solution you want read. The box is not scratch paper. It is sized for a composed answer, not for everything you tried.',
      'One line through anything you have abandoned.',
      // Amended 2026-09-02. It previously read "Darker beats bigger. A faint
      // pencil scans badly." — which is a diagnosis, not an instruction: it
      // tells a student what goes wrong and not what to do about it. Every
      // hard-to-read capture in the calibration set is a pencil one, and
      // cap01's crop is partly illegible to a person at full resolution.
      //
      // The defect is hardness, not pencil. "Use a pen" would take away the
      // eraser, which is the wrong trade on a sheet where only the box is
      // collected and abandoned work is cancelled by hand. A 2B photographs
      // nearly as dark as ink and still erases, so naming the grade fixes the
      // problem that banning the pencil would only move.
      'Write with a soft pencil (2B or B) or a pen. Hard pencils come out faint and scan badly. Darker beats bigger.',
    ],
  },
];

/**
 * How to hand the work in. **The tool owns this ground under the split above —
 * and until 2026-09-06 it claimed the ground and left it empty.** The sheet
 * carried `Your own work`, `Before you start`, `As you work` and the author's
 * preamble, and said nothing at all about submitting: no mention that an app
 * exists, no address, nothing about photographing pages. A student printed
 * sixteen sheets, did the work properly, and was left holding paper with no
 * stated next step. The preamble could not fill the gap without breaking the
 * split, and an author who tried would trip the duplicate-instruction guard.
 *
 * **Printed only when the author has set an address, and omitted entirely
 * otherwise** — see `Assignment.submissionAddress` for why the address cannot be
 * a constant and why a gapped sentence is worse than silence. That makes this
 * the one conditional section on the page.
 *
 * Each line is held to the governing rule above — advice that only helps the
 * automatic reader does not belong in front of students:
 *
 *  - *Check each photograph* earns its place with a human grader too. A page
 *    photographed too dark to read is unreadable to a TA and to a model alike,
 *    and the student is the only person who can retake it.
 *  - *Keep your printed pages* is the student's own protection in a dispute
 *    about what they wrote, and the only copy of the original that exists.
 *  - Nothing here says how to hold a phone, how to crop, or anything else whose
 *    only beneficiary would be the detector.
 *
 * No mark anywhere depends on any of it.
 */
export const SUBMISSION_HEADING = 'When you have finished writing';

/**
 * The four steps are **numbered and the last line is not**, which is the one
 * formatting difference from every other section on the page and is carrying
 * meaning: these happen in order, and a student who photographs before loading
 * the assignment file has to start again. The sections above are independent
 * statements and are deliberately left unnumbered.
 */
export const submissionItems = (address: string): string[] => [
  `1. Go to ${address} on your phone or laptop.`,
  '2. Load the assignment file: the .zip you downloaded with this assignment.',
  '3. Photograph each page when the app asks.',
  '4. Check each photograph in the app before you submit. If a page is dark or blurred, take it again.',
  'Keep your printed pages until your grade is posted.',
];

/**
 * The address as it will print, or `''` when there is none. Trimmed and reduced
 * to one line: the field is a single address and a newline inside it would be
 * reserved as one line and drawn as another, which is how a block silently
 * overruns the space measured for it.
 */
export const printableSubmissionAddress = (assignment: Assignment): string =>
  (assignment.submissionAddress || '').replace(/\s+/g, ' ').trim();

/**
 * The standing sections in printed order, including the conditional submission
 * section. **Every consumer must read this rather than `STANDING_INSTRUCTIONS`**
 * — the layout, the duplicate-instruction guard and the tests alike — or a
 * sentence the tool prints stops being one the guards know about.
 */
export const standingSections = (
  assignment: Assignment
): ReadonlyArray<{ heading: string; items: readonly string[] }> => {
  const address = printableSubmissionAddress(assignment);
  return address
    ? [...STANDING_INSTRUCTIONS, { heading: SUBMISSION_HEADING, items: submissionItems(address) }]
    : STANDING_INSTRUCTIONS;
};

/**
 * Not decoration. Students read "your work is scanned" as "my handwriting is
 * being judged", and the anxious response is to write larger and slower, which
 * costs them time and helps nobody.
 */
export const STANDING_CLOSING = 'Neat handwriting is not marked. Clear working is.';

/** The author's preamble prints below the standing instructions, under this. */
export const PREAMBLE_HEADING = 'About this assignment';

const INSTR_HEADING_H_MM = 5.0;
const INSTR_ITEM_GAP_MM = 1.4;
const INSTR_SECTION_GAP_MM = 4.0;
const INSTR_INDENT_MM = 4.0;

export type InstructionsRowStyle = 'title' | 'section' | 'item' | 'closing' | 'preambleHeading';

export interface InstructionsPage {
  /** Plain rows the generator draws top to bottom. The preamble is separate: it
   *  is authored text and goes through the math/figure renderer. */
  rows: { style: InstructionsRowStyle; text: string; boxMm: RectMm }[];
  preambleBoxMm?: RectMm;
  /** Millimetres past `REGION_BOTTOM_MM`. Non-zero refuses the export. */
  overflowMm: number;
}

/**
 * Page 1's geometry. The title sits beside the QR so it keeps the narrower
 * furniture width; everything below `FIRST_PROMPT_TOP_MM` is clear of the symbol
 * and uses the full writing column.
 */
export const buildInstructionsPage = (assignment: Assignment): InstructionsPage => {
  const rows: InstructionsPage['rows'] = [];
  const colW = COLUMN_X1_MM - COLUMN_X0_MM;
  const itemX0 = round4(COLUMN_X0_MM + INSTR_INDENT_MM);
  const itemW = round4(COLUMN_X1_MM - itemX0);

  rows.push({
    style: 'title',
    text: `${assignment.courseCode}: ${assignment.title}`,
    boxMm: {
      x0: COLUMN_X0_MM, y0: PAGE1_TITLE_TOP_MM,
      x1: round4(COLUMN_X0_MM + FURNITURE_MAX_WIDTH_MM), y1: round4(PAGE1_TITLE_TOP_MM + PAGE1_TITLE_H_MM),
    },
  });

  let y = FIRST_PROMPT_TOP_MM;
  standingSections(assignment).forEach((section, i) => {
    if (i > 0) y = round4(y + INSTR_SECTION_GAP_MM);
    rows.push({
      style: 'section', text: section.heading,
      boxMm: { x0: COLUMN_X0_MM, y0: round4(y), x1: COLUMN_X1_MM, y1: round4(y + INSTR_HEADING_H_MM) },
    });
    y = round4(y + INSTR_HEADING_H_MM);
    for (const item of section.items) {
      const h = descBlockMm(item, itemW);
      rows.push({
        style: 'item', text: item,
        boxMm: { x0: itemX0, y0: round4(y), x1: COLUMN_X1_MM, y1: round4(y + h) },
      });
      y = round4(y + h + INSTR_ITEM_GAP_MM);
    }
  });

  y = round4(y + INSTR_SECTION_GAP_MM);
  const closingH = descBlockMm(STANDING_CLOSING, colW);
  rows.push({
    style: 'closing', text: STANDING_CLOSING,
    boxMm: { x0: COLUMN_X0_MM, y0: round4(y), x1: COLUMN_X1_MM, y1: round4(y + closingH) },
  });
  y = round4(y + closingH);

  let preambleBoxMm: RectMm | undefined;
  if ((assignment.preamble || '').trim()) {
    y = round4(y + INSTR_SECTION_GAP_MM * 2);
    rows.push({
      style: 'preambleHeading', text: PREAMBLE_HEADING,
      boxMm: { x0: COLUMN_X0_MM, y0: round4(y), x1: COLUMN_X1_MM, y1: round4(y + INSTR_HEADING_H_MM) },
    });
    y = round4(y + INSTR_HEADING_H_MM);
    const h = descBlockMm(assignment.preamble, colW);
    preambleBoxMm = { x0: COLUMN_X0_MM, y0: round4(y), x1: COLUMN_X1_MM, y1: round4(y + h) };
    y = round4(y + h);
  }

  return { rows, preambleBoxMm, overflowMm: round4(Math.max(0, y - REGION_BOTTOM_MM)) };
};

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
   * Writing lines this region reserves and draws — what the author asked for,
   * clamped to what a page can hold, and then grown to the bottom margin if it
   * is the last region on its page.
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
}

/**
 * The two identifiers the layout map and the printed sheet use for one sub-part.
 *
 * `partId` is `1(a)` when a problem has several sub-parts and plain `2` when it
 * has one — the shape the spec's worked example uses. `regionId` mirrors it as
 * `p1a` / `p2`.
 *
 * **Exported so `generateGradingRubric` can name the region each rubric entry
 * grades using this exact derivation rather than a second copy of it.** The
 * rubric and the map are keyed by different schemes on purpose (`p0s0` is
 * load-bearing in three places at once — see ASSIGNMENT_MD_SPEC.md §12), so the
 * link between them has to be written, and it has to come from one place. Two
 * independent derivations of the same string is how they drifted in the first
 * place: the single-part case drops the letter here while the rubric still
 * records `subsection_letter: "a"`, so a consumer parsing `part_id` literally
 * failed to join seven of ENG17 HW1's seventeen regions, silently.
 */
export const partIdentifiers = (
  pIdx: number, sIdx: number, partCount: number
): { regionId: string; partId: string } => {
  const single = partCount === 1;
  const letter = String.fromCharCode(97 + sIdx);
  return {
    regionId: single ? `p${pIdx + 1}` : `p${pIdx + 1}${letter}`,
    partId: single ? `${pIdx + 1}` : `${pIdx + 1}(${letter})`,
  };
};

export const enumerateParts = (assignment: Assignment): TemplatePart[] =>
  assignment.problems.flatMap((prob, pIdx) =>
    prob.subsections.map((sub, sIdx) => {
      return {
        ...partIdentifiers(pIdx, sIdx, prob.subsections.length),
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
  /**
   * Height reserved for the heading itself, inside `boxMm` — `headingLines`
   * lines at `PROBLEM_HEADING_LINE_MM`. The stem is drawn directly under it, so
   * the generator reads this rather than re-deriving it from the string.
   */
  headingMm: number;
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
   * Outer edge of the printed border, top and bottom. The border spans the full
   * column horizontally, so `COLUMN_X0_MM`/`COLUMN_X1_MM` are its other two
   * edges and are not repeated per region.
   */
  boxTopMm: number;
  boxBottomMm: number;
  /** The writing area the student sees, mm — exactly `answerLines` lines tall. */
  nominalMm: RectMm;
  /**
   * nominal grown by REGION_PAD_MM on all four sides — **this is what is stored
   * in `layout_*.csv`, and it is the box INTERIOR**, inside the border stroke.
   *
   * `EEC100_Final_Format_Spec` §6 requires a build to state which of the two it
   * records, and `answerbox.sty` records the inner area. Matching it does two
   * things: the crop never contains the border's own ink, which would otherwise
   * land in the numerator of the ink-to-character audit
   * (`GradeBridge_OCR_Transcription_v1.6_addendum` §C), and the two tracks agree,
   * which is the point of converging on one page format.
   */
  declaredMm: RectMm;
}

export interface TemplateLayout {
  parts: TemplatePart[];
  regions: PlacedRegion[];
  pageCount: number;
  /**
   * Page 1: the standing instructions and the author's preamble, and nothing
   * else. It carries no region and no row in the map, so nothing on it is ever
   * cropped. See `buildInstructionsPage`.
   */
  instructionsPage: InstructionsPage;
  /**
   * Question text that would not fit a page even on its own, and so was
   * reserved smaller than authored — the one place the renderer still scales
   * text down. Not reachable from ordinary prose; worth telling the author.
   */
  clamped: { partId: string; requestedMm: number; usedMm: number }[];
  /**
   * Problem setup printed on a page with no region on it. Happens only when a
   * problem's first part is authored more answer space than fits beneath its own
   * shared setup: the setup is printed here and the part takes the next page
   * under a `(continued)` heading, because a region is never shrunk below its
   * authored line count. Consumers that draw the sheet must draw these; nothing
   * else refers to them, and they are not regions — nothing is cropped from them.
   */
  standaloneBlocks: { pageK: number; block: ProblemBlock }[];
}

/** One line of the problem heading above a problem's first part. */
export const PROBLEM_HEADING_LINE_MM = 5.5;
/** Gap under a problem block before the first part's prompt row. */
export const PROBLEM_BLOCK_GAP_MM = 1.5;

/**
 * The heading is authored text in the writing column, so it has to be given a
 * width budget like every other block. It used to have none: it was the one
 * printed row drawn as a single unwrapped, untruncated line, and a long title
 * ran out of the column. ` (continued)` was what pushed the two longest ENG17
 * HW4 titles past the limit and refused the export outright.
 *
 * Estimated, never measured, for the same reason `estimateDescLines` is: the map
 * is hashed into every QR, so the reservation must be identical in a browser and
 * in a Node test. And like that estimate it must never come out short — the
 * advance is set at the all-caps worst case rather than the title-case average,
 * so a title-case heading that renders on one line may reserve two. The 5.5 mm
 * that costs is given straight back by the page-fill pass.
 */
export const HEADING_FONT_PT = 11;
export const HEADING_ADVANCE_EM = 0.68;   // ~0.50 measured for title case, ~0.68 all-caps worst case
export const MAX_HEADING_LINES = 3;

export const headingLines = (
  heading: string, widthMm: number = COLUMN_X1_MM - COLUMN_X0_MM
): number => {
  if (!heading.trim()) return 1;
  const charMm = HEADING_FONT_PT * HEADING_ADVANCE_EM * 25.4 / 72;
  const perLine = Math.max(20, Math.floor(widthMm / charMm));
  return Math.min(MAX_HEADING_LINES, Math.max(1, Math.ceil(heading.trim().length / perLine)));
};

/** Vertical space the heading itself reserves — one to `MAX_HEADING_LINES` lines. */
export const problemHeadingMm = (heading: string): number =>
  round4(headingLines(heading) * PROBLEM_HEADING_LINE_MM);

/** Vertical space a problem block needs, given whether it repeats the setup. */
export const problemBlockMm = (heading: string, text: string, continued: boolean): number =>
  problemHeadingMm(heading) + (continued ? 0 : descBlockMm(text)) + PROBLEM_BLOCK_GAP_MM;

/** Usable vertical run for headers + answer boxes on a page. */
export const pageRunMm = (topMm: number): number => REGION_BOTTOM_MM - topMm;

const pad = (r: RectMm): RectMm => ({
  x0: round4(r.x0 - REGION_PAD_MM), y0: round4(r.y0 - REGION_PAD_MM),
  x1: round4(r.x1 + REGION_PAD_MM), y1: round4(r.y1 + REGION_PAD_MM),
});

/**
 * The last box on each page runs to the bottom margin.
 *
 * Before this, the bottom gaps down HW1's 21 pages were 44, 49, 66, 88, 100,
 * 119, 133, 140, 154 and 163 mm. Page 9 carried four ruled lines and 150 mm of
 * nothing, so a student needing a fifth line had blank paper right there and no
 * sanctioned place to use it — anything written outside a declared rectangle is
 * never cropped and never graded. Extending the rectangle is what makes that
 * paper part of the answer rather than decoration.
 *
 * Only the *last* region on a page grows: earlier parts keep exactly the lines
 * their author asked for, and the final one absorbs all the slack. And it only
 * ever grows — a region is never shrunk to fit this rule.
 *
 * `y1 = y0 + n x WRITING_LINE_MM` is preserved deliberately: `drawWritingArea`
 * draws line *i* at `y0 + i x pitch`, so that identity is what puts the last
 * rule exactly on the rectangle's own edge.
 */
const fillPagesToBottom = (regions: PlacedRegion[]): void => {
  const last = new Map<number, PlacedRegion>();
  for (const r of regions) {
    const held = last.get(r.pageK);
    if (!held || r.nominalMm.y0 > held.nominalMm.y0) last.set(r.pageK, r);
  }
  for (const r of last.values()) {
    // The most lines whose box still *closes* at or above the bottom limit: the
    // border's own stroke and the interior pad both sit below the last rule, and
    // an unclosed box is not a box.
    const lines = Math.floor(
      (REGION_BOTTOM_MM - BORDER_MM - REGION_PAD_MM - r.nominalMm.y0) / WRITING_LINE_MM
    );
    if (lines <= r.answerLines) continue;
    r.answerLines = lines;
    r.nominalMm = { ...r.nominalMm, y1: round4(r.nominalMm.y0 + answerBoxMm(lines)) };
    r.declaredMm = pad(r.nominalMm);
    r.boxBottomMm = round4(r.declaredMm.y1 + BORDER_MM);
  }
};

/**
 * The sheet is the assignment, so it has to carry the whole question: the
 * assignment's instructions on page 1, each problem's shared setup above its
 * first part, and each part's own text above its writing area. A student should
 * never need a second document to know what 1(a) is asking.
 *
 * Pack, then break, then fill. A problem opens a new page carrying its heading
 * and shared setup; its parts then pack down the page at their authored sizes,
 * and the moment the next part's question plus its answer box does not fit the
 * rest of the page, that part starts a new one. A part is placed exactly once —
 * an answer is never split across pages, so one that outgrows an empty page
 * takes the whole page instead. Finally the last box on every page runs to the
 * bottom margin. Nothing is ever squeezed to avoid a break — a break is the
 * correct outcome, paper is cheap and unreadable text is not. No box is ever
 * emitted under `MIN_BOX_MM`; a part that cannot reach it on this page breaks
 * to the next, which is the same path as any other part that does not fit.
 */
export const buildLayout = (assignment: Assignment): TemplateLayout => {
  const parts = enumerateParts(assignment);
  const regions: PlacedRegion[] = [];
  const clamped: TemplateLayout['clamped'] = [];
  // A problem's shared setup printed on a page that carries no region of its
  // own, because its first part could not fit beneath it and its authored answer
  // space is not negotiable. Rare and deliberate — see case 2 below.
  const standaloneBlocks: TemplateLayout['standaloneBlocks'] = [];

  // Page 1 is the instructions page and carries no region, so the first
  // `newPage()` opens page 2. That is what makes `k=1` an invariant rather than
  // a usual case, and it is why every page a part can be placed on now starts at
  // the same `FIRST_PROMPT_TOP_MM` — page 1's furniture is no longer something a
  // part has to fit beneath.
  const instructionsPage = buildInstructionsPage(assignment);

  const seenProblem = new Set<number>();
  let pageK = 1;
  let cursor = FIRST_PROMPT_TOP_MM;
  let pageIsEmpty = true;
  const newPage = () => {
    pageK += 1;
    cursor = FIRST_PROMPT_TOP_MM;
    pageIsEmpty = true;
  };

  let previousProblem = -1;
  for (const part of parts) {
    // A problem always opens a page, so a page never mixes two problems and the
    // heading a student reads at the top is always the one they are answering.
    if (part.problemIndex !== previousProblem) newPage();
    previousProblem = part.problemIndex;

    // A part is placed exactly once. The loop is only a retry after a page
    // break, never a second slice of the same answer: an answer is never split
    // across pages. What a page-and-a-bit of authored lines used to produce was
    // a 15 mm orphan on the next page — one writing line under a repeated
    // heading, which is not somewhere anyone finishes an answer.
    for (;;) {
      // The first region on a page carries the problem block: the heading
      // always, the shared setup only the first time the problem is seen.
      const opens = pageIsEmpty;
      const continued = opens && seenProblem.has(part.problemIndex);
      // Built before the reservation, not after: the heading is wrapped text
      // now, and ` (continued)` is what makes the longest ones wrap.
      const heading = continued ? `${part.problemHeading} (continued)` : part.problemHeading;
      const headingMm = problemHeadingMm(heading);

      const blockHeadingMm = opens ? headingMm : 0;
      const blockGapMm = opens ? PROBLEM_BLOCK_GAP_MM : 0;
      let blockTextMm = opens && !continued ? descBlockMm(part.problemDescription) : 0;
      let descMm = descBlockMm(part.description);

      // Everything that is not prose and not the writing area. The border's two
      // strokes are paid for here alongside the interior padding: a box has to
      // close inside the page, and `REGION_BOTTOM_MM` is where its outer edge
      // may reach.
      const fixedMm = blockHeadingMm + blockGapMm + PROMPT_ROW_MM + RULE_GAP_MM
        + BORDER_MM * 2 + REGION_PAD_MM * 2;
      const linesThatFit = () =>
        Math.floor((REGION_BOTTOM_MM - cursor - fixedMm - blockTextMm - descMm + 1e-6) / WRITING_LINE_MM);
      let fits = linesThatFit();

      // Never smaller than the minimum box, whatever the author asked for.
      const wanted = Math.max(part.answerLines, MIN_ANSWER_LINES);

      // ---- What a better page could offer this part -----------------------
      //
      // A region is never shrunk below its authored line count. When this page
      // cannot hold `wanted`, the question is not "how much can I give" but
      // "is there a page that can", and there are exactly two things taking room
      // away that a different page would not:
      //
      //   1. Page 1's furniture — the title, the print instruction and the
      //      preamble sit above the first part, so page 1's run is shorter than
      //      every other page's.
      //   2. The problem's shared setup. It is printed once, above the problem's
      //      first part, so a part that follows it on a `(continued)` page does
      //      not pay for it again.
      //
      // Since 2026-09-01 there is only ONE thief left. Page 1 used to be the
      // other — its title, print instruction and preamble sat above the first
      // part — but page 1 is now the instructions page and carries no region, so
      // every page a part can stand on begins at the same `FIRST_PROMPT_TOP_MM`.
      // The remaining escape is therefore escapable once, which is why this
      // terminates: a part breaks at most once before it is on the roomiest page
      // that exists.
      //
      // Leaving the shared setup behind and carrying on under a `(continued)`
      // heading — the roomiest page this part can ever stand on.
      const fitsWithoutStem = Math.floor(
        (REGION_BOTTOM_MM - FIRST_PROMPT_TOP_MM
          - (problemHeadingMm(`${part.problemHeading} (continued)`) + PROBLEM_BLOCK_GAP_MM
             + PROMPT_ROW_MM + RULE_GAP_MM + BORDER_MM * 2 + REGION_PAD_MM * 2)
          - descMm + 1e-6) / WRITING_LINE_MM
      );

      if (fits < wanted) {
        // This page already has something on it: break rather than shrink, and
        // try again at the top of a clean page. Nothing is clamped on this path
        // — a page break is the cheap, correct answer, and reaching for the
        // clamp first is how ordinary prose used to get trimmed for no reason
        // but its position on the page.
        if (!opens) { newPage(); continue; }

        // The shared setup itself is what does not leave room. Print it
        // here, on its own, and take the part to the next page under a
        // `(continued)` heading. This is the only way a part authored more lines
        // than fit beneath its own stem can still be given them, and giving them
        // is not optional — see the rule at the top of this function.
        //
        // The test is `>= wanted`, not "more than this page offers". A break
        // that improves the fit without achieving the authored count trades a
        // blank page for a line or two and still ends in rule 3 — so it is not
        // worth a sheet of paper.
        if (blockTextMm > 0 && fitsWithoutStem >= wanted) {
          standaloneBlocks.push({
            pageK,
            block: {
              heading, text: part.problemDescription, continued: false, headingMm,
              boxMm: {
                x0: COLUMN_X0_MM, y0: round4(cursor),
                x1: COLUMN_X1_MM, y1: round4(cursor + headingMm + blockTextMm),
              },
            },
          });
          seenProblem.add(part.problemIndex);
          newPage();
          continue;
        }

        // Neither escape helps: the part's own prompt and question text plus its
        // authored answer exceed the roomiest page there is. It takes the whole
        // page — rule 3, unchanged. `fillPagesToBottom` then gives it every
        // millimetre the page has, which is the most any page can offer.
      }

      // A page of its own and *still* no room for the smallest legal box: the
      // question text is longer than a page. Last resort — trim the reservation,
      // which the self-test then refuses to emit on, naming the part. It is the
      // only case where a reservation is smaller than its text.
      if (fits < MIN_ANSWER_LINES) {
        const requested = round4(blockTextMm + descMm);
        const budget = REGION_BOTTOM_MM - cursor - fixedMm - MIN_ANSWER_LINES * WRITING_LINE_MM;
        descMm = Math.max(descMm > 0 ? DESC_LINE_MM : 0, Math.min(descMm, budget - blockTextMm));
        if (blockTextMm + descMm > budget) {
          blockTextMm = Math.max(blockTextMm > 0 ? DESC_LINE_MM : 0, budget - descMm);
        }
        clamped.push({ partId: part.partId, requestedMm: requested, usedMm: round4(blockTextMm + descMm) });
        fits = linesThatFit();
      }

      // A part that does not fit even an empty page simply takes the whole page.
      // No warning and no report entry: with the page-fill pass below, a full
      // page is the most room a page has to give, so this is not a degradation
      // anyone can act on. (The `clamped` path above, for *question text* that
      // will not fit a page, is a different thing and is still reported.)
      const lines = Math.max(MIN_ANSWER_LINES, Math.min(wanted, fits));

      let problemBlock: ProblemBlock | undefined;
      if (opens) {
        const height = round4(headingMm + blockTextMm);
        problemBlock = {
          heading,
          text: continued ? '' : part.problemDescription,
          continued,
          headingMm,
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

      // Four nested rectangles, outside in: the border's outer edge (the full
      // column, `boxTop` → `boxBottom`), the border's inner edge — which is the
      // **declared** rectangle, so the crop carries no border ink — the 3 mm
      // region pad, and the writing area the rules are drawn in.
      const header = PROMPT_ROW_MM + descMm + RULE_GAP_MM;
      const boxTop = round4(promptTop + header);
      const nominalTop = round4(boxTop + BORDER_MM + REGION_PAD_MM);
      const nominal: RectMm = {
        x0: round4(COLUMN_X0_MM + BORDER_MM + REGION_PAD_MM),
        y0: nominalTop,
        x1: round4(COLUMN_X1_MM - BORDER_MM - REGION_PAD_MM),
        y1: round4(nominalTop + answerBoxMm(lines)),
      };
      const declared = pad(nominal);

      regions.push({
        ...part,
        answerLines: lines,
        pageK,
        problemBlock,
        promptTopMm: round4(promptTop),
        descBoxMm: descBox,
        boxTopMm: boxTop,
        boxBottomMm: round4(declared.y1 + BORDER_MM),
        nominalMm: nominal,
        declaredMm: declared,
      });

      cursor = round4(declared.y1 + BORDER_MM + REGION_GAP_MM);
      pageIsEmpty = false;
      break;
    }
  }

  fillPagesToBottom(regions);

  return {
    parts, regions, standaloneBlocks, instructionsPage,
    pageCount: Math.max(1, pageK),
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
