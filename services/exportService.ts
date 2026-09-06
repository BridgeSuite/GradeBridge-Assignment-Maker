
import { Assignment, SubmissionType } from '../types';
import { decryptJson, encryptJson, normalizeCoursePublicKey, validateCoursePublicKey } from './cryptoService';
import { escapeHtml, hasFigure, hasMath, katexStylesheet, renderTextToCanvas, toHtml, toLatexBody, toPdfText } from './mathRender';
import { stemForGrader } from './figureText';
import { generateTemplate } from './templateGenerator';
import { partIdentifiers } from './templateLayout';
import { buildAuthoringBackup } from './authoringBackup';
import { apportionPoints } from './pointsService';
import { strandedSubsectionLabels, typeAllowedInMode } from './inputModeService';
import jsPDF from 'jspdf';
import JSZip from 'jszip';
import FileSaver from 'file-saver';

// =====================================================
// FORMAT CONVERSION: Assignment Maker → Student Submission
// =====================================================
// The Student Submission app expects a different JSON format.
// This function converts our internal format to their expected format.

interface StudentSubmissionSubsection {
  subsection_statement: string;
  points: number;
  submission_elements: string[];
  max_images_allowed?: number;
}

interface StudentSubmissionProblem {
  problem_statement: string;
  points: number;
  subsections: StudentSubmissionSubsection[];
}

interface StudentSubmissionAssignment {
  assignment_title: string;
  course_code: string;
  preamble?: string;
  total_points: number;
  problems: StudentSubmissionProblem[];
}

const AI_GRADED_TYPES = new Set([
  SubmissionType.AI_GRADED_BINARY,
  SubmissionType.AI_GRADED_SHORT,
  SubmissionType.AI_GRADED_MEDIUM,
  SubmissionType.AI_GRADED_LONG,
]);

const MIN_WORDS_BY_TYPE: Partial<Record<SubmissionType, number>> = {
  [SubmissionType.AI_GRADED_BINARY]: 20,
  [SubmissionType.AI_GRADED_SHORT]:  50,
  [SubmissionType.AI_GRADED_MEDIUM]: 100,
  [SubmissionType.AI_GRADED_LONG]:   150,
};

/**
 * Where an assignment with no target of its own lands. Only a new, empty
 * assignment gets here: an imported one takes its target from the file (see
 * `parseMdToAssignment`), which is the point of that change.
 */
const DEFAULT_TARGET_POINTS = 100;

/**
 * Scale all subsection point values so they sum to assignment.targetPoints
 * (default 100). Largest-remainder apportionment — see services/pointsService.ts
 * for why, and for the negative-points bug the old rounding produced.
 * Returns a new Assignment; does not mutate the input.
 */
const normalizePoints = (assignment: Assignment): Assignment => {
  const target = assignment.targetPoints || DEFAULT_TARGET_POINTS;
  const allSubs = assignment.problems.flatMap(p => p.subsections);
  const scaled = apportionPoints(allSubs.map(s => s.points), target);

  let idx = 0;
  return {
    ...assignment,
    problems: assignment.problems.map(p => ({
      ...p,
      subsections: p.subsections.map(s => ({ ...s, points: scaled[idx++] }))
    }))
  };
};

// =====================================================
// THE EXPORT NEVER SILENTLY RESCALES
// =====================================================
// Every download below runs `normalizePoints`, which is the one moment a point
// value changes. When the authored total and the target disagree, that moment
// writes a different assignment than the one on screen — and NOTHING
// DOWNSTREAM CAN SEE IT. Points sit outside the `layout_id` hash, so every hash
// check, page count and geometry test passes on a halved assignment. There is
// no later check to catch this, which is why the guard has to be here.
//
// A badge was not enough. It was amber on 2026-09-01 for ENG17 HW1–HW3 and the
// export went ahead anyway, three times, twice for operators who knew about the
// trap. So the question is asked out loud, with both numbers in it, and it is
// asked from the service rather than from the four call sites — a fifth caller
// added later cannot forget it, and there is deliberately no way to skip it.
//
// It also closes the stale-target case: the dialog states the values actually
// about to be written, so a target typed into the box but never saved is
// visible before it does any damage.

/** The two numbers a rescale is about to reconcile. */
export interface RescaleNotice { authoredTotal: number; targetPoints: number; }

/** The rescale this export would perform, or null when there is nothing to do. */
export const rescaleNotice = (assignment: Assignment): RescaleNotice | null => {
  const authoredTotal = (assignment.problems || [])
    .flatMap(p => p.subsections || [])
    .reduce((sum, s) => sum + (Number.isFinite(s.points) ? s.points : 0), 0);
  const targetPoints = assignment.targetPoints || DEFAULT_TARGET_POINTS;
  // Nothing authored yet: an empty assignment is not a rescale to warn about,
  // and apportionPoints leaves an all-zero list alone in any case.
  if (authoredTotal <= 0 || authoredTotal === targetPoints) return null;
  return { authoredTotal, targetPoints };
};

/** What the instructor is asked. Both numbers, and what happens next. */
export const rescaleConfirmationMessage = ({ authoredTotal, targetPoints }: RescaleNotice): string =>
  `This assignment totals ${authoredTotal} points. The export target is ${targetPoints}. `
  + `Exporting will rescale every part.\n\n`
  + `OK — export and rescale to ${targetPoints}.\n`
  + `Cancel — stop, and change the Target box to ${authoredTotal}.`;

/** Thrown when the instructor declines the rescale. Nothing is written. */
export class RescaleDeclinedError extends Error {
  readonly rescaleDeclined = true;
  constructor(readonly notice: RescaleNotice) {
    super(`Export cancelled: ${notice.authoredTotal} points authored, target ${notice.targetPoints}.`);
    this.name = 'RescaleDeclinedError';
  }
}

/** True for the error above — call sites use it to stay quiet rather than report a failure. */
export const isRescaleDeclined = (err: unknown): err is RescaleDeclinedError =>
  !!err && typeof err === 'object' && (err as RescaleDeclinedError).rescaleDeclined === true;

/** How the question is put. Replaced only by the test suite. */
let askToRescale: (message: string) => boolean = message =>
  typeof globalThis.confirm === 'function' ? globalThis.confirm(message) : true;

/** Test seam. There is no production caller — see the block comment above. */
export const setRescaleConfirm = (ask: (message: string) => boolean) => { askToRescale = ask; };

/**
 * `normalizePoints`, but it asks first when the numbers disagree.
 *
 * Every download entry point goes through this. `assignmentToMd` still
 * normalises on its own, deliberately: it is a pure serialiser the export ZIP
 * and the test suite both call on an assignment that has already been through
 * here, and apportioning an apportioned list is a no-op.
 *
 * Exported so the suite can assert on the transformation itself rather than on
 * a download, which needs a DOM.
 */
export const normalizePointsConfirmed = (assignment: Assignment): Assignment => {
  const notice = rescaleNotice(assignment);
  if (notice && !askToRescale(rescaleConfirmationMessage(notice))) {
    throw new RescaleDeclinedError(notice);
  }
  return normalizePoints(assignment);
};

// Student-app contract: these element strings are matched verbatim downstream.
export const convertSubmissionType = (type: SubmissionType): string[] => {
  switch (type) {
    case SubmissionType.TEXT:
      return ['Answer as text'];
    case SubmissionType.IMAGE:
      return ['Answer as image'];
    case SubmissionType.HANDWRITTEN:
      return ['Answer as handwritten'];
    case SubmissionType.AI_GRADED_BINARY:
    case SubmissionType.AI_GRADED_SHORT:
    case SubmissionType.AI_GRADED_MEDIUM:
    case SubmissionType.AI_GRADED_LONG:
      return [type]; // pass through the category string
    case SubmissionType.CODE:
      return ['Answer as text'];
    case SubmissionType.FILE_UPLOAD:
      return ['Answer as image'];
    default:
      return ['Answer as text'];
  }
};

const convertToStudentSubmissionFormat = (assignment: Assignment): StudentSubmissionAssignment => {
  const problems: StudentSubmissionProblem[] = assignment.problems.map(prob => {
    const subsections: StudentSubmissionSubsection[] = prob.subsections.map(sub => {
      // Combine name and description for subsection_statement
      let statement = '';
      if (sub.name && sub.description) {
        statement = `${sub.name}\n\n${sub.description}`;
      } else if (sub.name) {
        statement = sub.name;
      } else if (sub.description) {
        statement = sub.description;
      }

      return {
        subsection_statement: statement,
        points: sub.points,
        submission_elements: convertSubmissionType(sub.submissionType),
        max_images_allowed: sub.maxImages || 1
      };
    });

    // Calculate problem points as sum of subsection points
    const problemPoints = subsections.reduce((sum, sub) => sum + sub.points, 0);

    // Combine name and description for problem_statement
    let problemStatement = '';
    if (prob.name && prob.description) {
      problemStatement = `${prob.name}\n\n${prob.description}`;
    } else if (prob.name) {
      problemStatement = prob.name;
    } else if (prob.description) {
      problemStatement = prob.description;
    }

    return {
      problem_statement: problemStatement,
      points: problemPoints,
      subsections
    };
  });

  // Calculate total points
  const totalPoints = problems.reduce((sum, prob) => sum + prob.points, 0);

  return {
    assignment_title: assignment.title,
    course_code: assignment.courseCode,
    preamble: assignment.preamble || undefined,
    total_points: totalPoints,
    problems
  };
};

// =====================================================
// PDF EXPORT
// =====================================================
// jsPDF cannot typeset LaTeX, so any block that contains math is rendered by
// the shared KaTeX renderer (services/mathRender.ts — the same one the HTML
// export and the app preview use), rasterised, and placed as an image. Blocks
// without math stay vector text, so the common case keeps crisp, selectable
// output. If rasterisation is unavailable (no DOM, the browser refused the
// image), the block falls back to toPdfText() — readable plain text, never a
// leaked token.
//
// Every y in this section is the TOP of the block, for text and images alike;
// jsPDF's default is the text baseline, hence the explicit `baseline: 'top'`.

const PX_PER_MM = 96 / 25.4;
const RASTER_SCALE = 3;          // ~288 dpi
const PAGE_BOTTOM_MARGIN = 20;   // mm
const DESC_PREVIEW_LINES = 2;    // problem description repeats on every page — keep it short
const TOP: { baseline: 'top' } = { baseline: 'top' };

// NO NAME, STUDENT ID OR DATE FIELD IS PRINTED, ON ANY PATH.
//
// Ordered by CORRECTION_AM_QR_TEMPLATE_2026-08-15.md section 1, applied then to
// the handwritten template only, and completed here on the PDF and LaTeX exports
// by WORKORDER_AM_NO_IDENTITY_FIELDS_2026-09-03.md. A `NAME_ID_LINE` constant and
// a `nameIdLine()` used to be drawn at the top of every page of the typed-mode
// student PDF, and generateLaTeX carried a "Student Information" block.
//
// Three reasons, all still true, stated here so the next person to want a name
// line finds the decision rather than re-making it:
//
//   1. This app is a de-identified processing step. Identity comes from the
//      authenticated upload, which is the identity of record. Nothing produced
//      here needs to ask who the student is.
//   2. A filled-in name is exactly the PII the pipeline exists to keep out of
//      the artifacts it scans and grades.
//   3. Grading is meant to be blind to identity, and a blank labelled "Student
//      Name" invites the student to defeat that with a pen.
//
// The policy is stated in ASSIGNMENT_MD_SPEC.md section 10, and enforced by
// "no export in either input mode carries a name or student ID field" in
// tests/templateTests.mjs, which asserts on the BUILT ARTIFACT in both modes.
// The 2026-08-15 guard grepped the template source only, which is how the two
// paths above drifted for three weeks with the policy documented in three places.

interface RichStyle {
  fontPt: number;
  bold?: boolean;
  italic?: boolean;
  grey?: number; // jsPDF greyscale 0–255; undefined means black
}

const applyStyle = (doc: jsPDF, style: RichStyle) => {
  doc.setFont('times', style.bold ? 'bold' : style.italic ? 'italic' : 'normal');
  doc.setFontSize(style.fontPt);
  doc.setTextColor(style.grey ?? 0);
};

/** Copy a horizontal band out of a canvas so a tall block can span pages. */
const sliceCanvas = (src: HTMLCanvasElement, topPx: number, heightPx: number): string => {
  const slice = document.createElement('canvas');
  slice.width = src.width;
  slice.height = Math.max(1, Math.round(heightPx));
  const ctx = slice.getContext('2d');
  if (!ctx) return src.toDataURL('image/png');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, slice.width, slice.height);
  ctx.drawImage(src, 0, topPx, src.width, slice.height, 0, 0, src.width, slice.height);
  return slice.toDataURL('image/png');
};

/** Starts a new page carrying the name/ID line, and returns the y to resume at. */
type PageBreak = () => number;

// Vector text with automatic page wrapping.
const addWrappedText = (
  doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight: number, newPage: PageBreak
): number => {
  const lines: string[] = doc.splitTextToSize(text, maxWidth);
  const pageHeight = doc.internal.pageSize.height;
  let currentY = y;
  for (const line of lines) {
    if (currentY > pageHeight - PAGE_BOTTOM_MARGIN) currentY = newPage();
    doc.text(line, x, currentY, TOP);
    currentY += lineHeight;
  }
  return currentY;
};

/**
 * Place one authored text block. Math-bearing blocks go through KaTeX; plain
 * blocks stay vector text. Either way the caller gets back the new y.
 */
const addRichText = async (
  doc: jsPDF, text: string, x: number, y: number,
  maxWidthMm: number, lineHeightMm: number, style: RichStyle, newPage: PageBreak
): Promise<number> => {
  if (!text) return y;
  const pageHeight = doc.internal.pageSize.height;

  // A figure takes the same route as math: the browser draws the block — prose,
  // KaTeX and the inlined SVG together — and the raster is placed as an image.
  // Without a DOM it degrades to toPdfText(), which prints `[figure: ...]`.
  if (hasMath(text) || hasFigure(text)) {
    const grey = style.grey ?? 0;
    const canvas = await renderTextToCanvas(text, {
      widthPx: maxWidthMm * PX_PER_MM,
      fontSizePx: style.fontPt * 96 / 72,
      lineHeightPx: lineHeightMm * PX_PER_MM,
      bold: style.bold,
      italic: style.italic,
      color: `rgb(${grey},${grey},${grey})`,
      scale: RASTER_SCALE,
    });
    if (canvas) {
      const pxPerMm = RASTER_SCALE * PX_PER_MM;
      let takenPx = 0;
      while (takenPx < canvas.height) {
        let availableMm = pageHeight - PAGE_BOTTOM_MARGIN - y;
        if (availableMm < lineHeightMm * 2) {
          y = newPage();
          availableMm = pageHeight - PAGE_BOTTOM_MARGIN - y;
        }
        const slicePx = Math.min(availableMm * pxPerMm, canvas.height - takenPx);
        const sliceMm = slicePx / pxPerMm;
        doc.addImage(sliceCanvas(canvas, takenPx, slicePx), 'PNG', x, y, maxWidthMm, sliceMm, undefined, 'FAST');
        y += sliceMm;
        takenPx += slicePx;
        if (takenPx < canvas.height) y = newPage();
      }
      applyStyle(doc, style);
      return y;
    }
  }

  applyStyle(doc, style);
  return addWrappedText(doc, toPdfText(text), x, y, maxWidthMm, lineHeightMm, newPage);
};

const generatePDFContent = async (doc: jsPDF, assignment: Assignment, isTemplate: boolean) => {
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);

  // No identity line is drawn here or on any later page. See the note beside
  // TOP, above: the removed line sat at y = 15 and content has always started at
  // y = 30, so nothing moved when it went.
  const newPage: PageBreak = () => {
    doc.addPage();
    return 30;
  };

  // --- COVER PAGE ---

  let y = 30;

  doc.setFont('times', 'bold');
  doc.setFontSize(18);
  doc.text(`${assignment.courseCode}: ${assignment.title}`, margin, y, TOP);
  y += 20;

  if (assignment.preamble) {
    y = await addRichText(doc, assignment.preamble, margin, y, contentWidth, 6,
      { fontPt: 11, italic: true }, newPage);
    y += 10;
  }

  // --- PROBLEM PAGES ---
  // Each problem and subsection starts on a new page.
  // For Image types, we might generate multiple pages.

  for (const [pIndex, prob] of assignment.problems.entries()) {
    for (const [sIndex, sub] of prob.subsections.entries()) {

      // Determine how many pages this subsection gets.
      // TEXT_AND_IMAGE: 1 text page + N image pages.
      const isTextAndImageSub = sub.submissionType === SubmissionType.TEXT_AND_IMAGE;
      const pageCount = sub.submissionType === SubmissionType.IMAGE
        ? (sub.maxImages || 1)
        : isTextAndImageSub
          ? 1 + (sub.maxImages || 1)
          : 1;

      for (let i = 0; i < pageCount; i++) {
        doc.addPage(); // STRICT PAGE BREAK FOR EVERY ITEM
        y = 30;

        // Header: Problem info (Repeated on every page for clarity)
        y = await addRichText(doc, `Problem ${pIndex + 1}: ${prob.name}`, margin, y, contentWidth, 7,
          { fontPt: 14, bold: true }, newPage);

        // Problem description, kept compact — it repeats on every page of the problem.
        if (prob.description && y < 50) {
          const style: RichStyle = { fontPt: 10, grey: 100 };
          applyStyle(doc, style);
          const wrapped: string[] = doc.splitTextToSize(toPdfText(prob.description), contentWidth);
          // A stem carrying a figure is never shortened: the drawing is the
          // context the part is answered against, and a truncated preview would
          // reduce it to the words "[figure: ...]".
          if (wrapped.length > DESC_PREVIEW_LINES && !hasFigure(prob.description)) {
            // Truncating rendered math would cut mid-expression, so a shortened
            // description is always the plain-text form.
            wrapped.slice(0, DESC_PREVIEW_LINES).forEach((line, n) => {
              doc.text(n === DESC_PREVIEW_LINES - 1 ? `${line} ...` : line, margin, y + n * 5, TOP);
            });
            y += DESC_PREVIEW_LINES * 5 + 3;
          } else {
            y = await addRichText(doc, prob.description, margin, y, contentWidth, 5, style, newPage);
            y += 3;
          }
          doc.setTextColor(0);
        }

        // Subsection Info
        const subLabel = String.fromCharCode(97 + sIndex); // a, b, c...
        let title = `(${subLabel}) [${sub.points} pts] ${sub.name}`;
        if (pageCount > 1) {
          title += ` (Page ${i + 1} of ${pageCount})`;
        }
        y = await addRichText(doc, title, margin + 5, y, contentWidth - 5, 6,
          { fontPt: 12, bold: true }, newPage);

        if (sub.description) {
          y = await addRichText(doc, sub.description, margin + 5, y, contentWidth - 5, 5,
            { fontPt: 11 }, newPage);
          y += 5;
        }

        // Submission Type Indicator
        doc.setFont('courier', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(`[Submission: ${sub.submissionType}]`, margin + 5, y, TOP);
        doc.setTextColor(0);
        y += 5;

        // Answer Region
        if (isTemplate) {
          // Draw box taking up rest of page minus bottom margin
          const boxHeight = pageHeight - y - PAGE_BOTTOM_MARGIN;

          if (boxHeight > 20) {
            doc.setDrawColor(200);
            doc.rect(margin + 5, y, contentWidth - 5, boxHeight);

            doc.setFontSize(8);
            doc.setTextColor(150);
            const regionText = sub.submissionType === SubmissionType.IMAGE
              ? `Attach Image ${i + 1} Here`
              : isTextAndImageSub && i > 0
                ? `Attach Image ${i} Here`
                : 'Gradescope Answer Region';
            doc.text(regionText, margin + 7, y + 4, TOP);
            doc.setTextColor(0);
            doc.setDrawColor(0);
          }
        }
      }
    }
  }
};

export const createPDF = async (assignment: Assignment, type: 'student' | 'template'): Promise<Blob> => {
  const doc = new jsPDF();
  await generatePDFContent(doc, assignment, type === 'template');
  return doc.output('blob');
};

// Math is rendered here, at export time, by the same KaTeX call the app preview
// makes — so the file shows the same thing the instructor saw. KaTeX's
// stylesheet and glyph fonts are embedded: the file needs no network at all.
export const generateHTML = async (assignment: Assignment): Promise<string> => {
  const katexCss = await katexStylesheet();
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(`${assignment.courseCode} - ${assignment.title}`)}</title>
<style>
${katexCss}
body { font-family: 'Georgia', serif; max-width: 800px; margin: 40px auto; line-height: 1.6; padding: 0 20px; color: #333; }
h1 { border-bottom: 1px solid #eee; padding-bottom: 10px; }
.metadata { color: #666; font-style: italic; margin-bottom: 30px; }
.problem { margin-top: 40px; border: 1px solid #eee; padding: 20px; border-radius: 4px; }
.subsection { margin-left: 20px; margin-top: 20px; }
.submission-type { font-family: monospace; background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
.points { font-weight: bold; color: #0056b3; }
.authored { white-space: pre-wrap; }
</style>
</head>
<body>
  <h1>${toHtml(`${assignment.courseCode}: ${assignment.title}`)}</h1>
  <div class="metadata">${escapeHtml(assignment.courseCode)}</div>
  <p class="authored">${toHtml(assignment.preamble || '')}</p>

  ${assignment.problems.map((p, i) => `
    <div class="problem">
      <h3>Problem ${i + 1}: ${toHtml(p.name)}</h3>
      <p class="authored">${toHtml(p.description || '', `p${i}f`)}</p>
      ${p.subsections.map((s, j) => `
        <div class="subsection">
          <h4>(${String.fromCharCode(97 + j)}) ${toHtml(s.name)} <span class="points">[${s.points} pts]</span></h4>
          <p class="authored">${toHtml(s.description || '', `p${i}s${j}f`)}</p>
          <div class="submission-type">
            Submission: ${escapeHtml(s.submissionType)}
            ${s.submissionType === 'Image' && s.maxImages ? `(Max ${s.maxImages} pages)` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('')}
</body>
</html>
  `;
};

// =====================================================
// LaTeX EXPORT
// =====================================================
// Generates a compilable .tex file that instructors can edit

// Prose is escaped and math is passed through verbatim by toLatexBody(), so
// pdflatex typesets `$...$` natively. There is no placeholder token to corrupt:
// the `<<MATH_BLOCK_N>>` scheme this replaced was rewritten by its own
// underscore escape and leaked into every export.

export const generateLaTeX = (assignment: Assignment): string => {
  // Calculate total points
  const totalPoints = assignment.problems.reduce((sum, prob) =>
    sum + prob.subsections.reduce((s, sub) => s + sub.points, 0), 0
  );

  // Build the LaTeX document
  let latex = `% ============================================================
% ${assignment.courseCode}: ${assignment.title}
% Generated by GradeBridge Assignment Maker
% https://bridgesuite.github.io/GradeBridge-Assignment-Maker/
% ============================================================
% This is an editable LaTeX file. Compile with pdflatex.
% ============================================================

\\documentclass[11pt,letterpaper]{article}

% ---- Packages ----
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{geometry}
\\usepackage{fancyhdr}
\\usepackage{enumitem}
\\usepackage{graphicx}
\\usepackage{xcolor}
\\usepackage{hyperref}

% ---- Page Setup ----
\\geometry{margin=1in}
\\pagestyle{fancy}
\\fancyhf{}
\\lhead{${toLatexBody(assignment.courseCode)}}
\\rhead{${toLatexBody(assignment.title)}}
\\cfoot{\\thepage}

% ---- Custom Commands ----
\\newcommand{\\pts}[1]{\\textbf{[#1 pts]}}
\\newcommand{\\submissiontype}[1]{\\textcolor{gray}{\\texttt{[#1]}}}

% ============================================================
\\begin{document}

% ---- Title Section ----
\\begin{center}
{\\LARGE\\bfseries ${toLatexBody(assignment.courseCode)}: ${toLatexBody(assignment.title)}}\\\\[0.5em]
{\\large Total Points: ${totalPoints}}
\\end{center}

\\vspace{1em}

`;

  // Preamble
  if (assignment.preamble) {
    latex += `% ---- Preamble / Instructions ----
\\noindent\\textit{${toLatexBody(assignment.preamble)}}

\\vspace{1.5em}
\\hrule
\\vspace{1.5em}

`;
  }

  // Problems
  assignment.problems.forEach((prob, pIndex) => {
    const problemPoints = prob.subsections.reduce((s, sub) => s + sub.points, 0);

    latex += `% ============================================================
% Problem ${pIndex + 1}
% ============================================================
\\section*{Problem ${pIndex + 1}: ${toLatexBody(prob.name)} \\hfill \\normalsize{(${problemPoints} points)}}

`;

    if (prob.description) {
      latex += `${toLatexBody(prob.description)}

`;
    }

    // Subsections
    prob.subsections.forEach((sub, sIndex) => {
      const subLabel = String.fromCharCode(97 + sIndex); // a, b, c...

      latex += `\\subsection*{(${subLabel}) ${toLatexBody(sub.name)} \\pts{${sub.points}}}

`;

      if (sub.description) {
        latex += `${toLatexBody(sub.description)}

`;
      }

      // Submission type indicator
      let submissionNote: string = sub.submissionType;
      if (sub.submissionType === SubmissionType.IMAGE && sub.maxImages) {
        submissionNote = `${sub.submissionType} (max ${sub.maxImages} image${sub.maxImages > 1 ? 's' : ''})`;
      }
      latex += `\\submissiontype{Submission: ${submissionNote}}

`;

      // Add answer space
      latex += `\\vspace{2em}
% Answer space for part (${subLabel})
\\noindent\\dotfill

\\vspace{3cm}

`;
    });

    latex += `\\newpage

`;
  });

  // End document
  latex += `\\end{document}
`;

  return latex;
};

export const generateGradingRubric = (assignment: Assignment): object => {
  const rubrics: Record<string, object> = {};

  assignment.problems.forEach((prob, pIndex) => {
    prob.subsections.forEach((sub, sIndex) => {
      const subsectionId = `p${pIndex}s${sIndex}`;
      // The SAME derivation the layout map uses, imported rather than copied —
      // see `partIdentifiers`. This is the link between the two schemes.
      const { regionId, partId } = partIdentifiers(pIndex, sIndex, prob.subsections.length);
      const isAi = AI_GRADED_TYPES.has(sub.submissionType);
      const isImage = sub.submissionType === SubmissionType.IMAGE;
      const isTextAndImage = sub.submissionType === SubmissionType.TEXT_AND_IMAGE;
      const isHandwritten = sub.submissionType === SubmissionType.HANDWRITTEN;
      const isAiHandwritten = isHandwritten && (sub.handwrittenGradingMode ?? 'ai') !== 'human';
      const subsectionLetter = String.fromCharCode(97 + sIndex);
      const minWords = MIN_WORDS_BY_TYPE[sub.submissionType];
      // Declared only where the app actually knows: a handwritten part declares
      // it via `sketch`, and a written answer is a written answer. The image
      // types and the unwired stubs declare nothing. See ASSIGNMENT_MD_SPEC.md §12.
      const answerModality = isHandwritten
          ? (sub.isDrawing ? 'figure' : 'text')
        : (isAi || sub.submissionType === SubmissionType.TEXT) ? 'text'
        : undefined;

      rubrics[subsectionId] = {
        subsection_id: subsectionId,
        // THE REGION THIS ENTRY GRADES.
        //
        // Two identifier schemes exist for one entity and both are load-bearing:
        // the layout map and the printed crop use `p1a` / `1(a)`, while the
        // rubric key, the student payload keys (`p{i}_s{j}`) and the electronic
        // image names (`p{i}s{j}_image_{k}.jpg`) use `p0s0`. Renaming either
        // would break three consumers at once, so the schemes stay and the
        // *link* is written down instead.
        //
        // Without it a consumer holding `crops/p1a.jpg` looks up `rubrics["p1a"]`,
        // finds nothing, and gets no error — only an absent entry. The join is
        // also asymmetric: a single-part problem's `part_id` is `4`, not `4(a)`,
        // while `subsection_letter` here still says `"a"`, so parsing `part_id`
        // literally silently missed seven of ENG17 HW1's seventeen regions.
        //
        // Written for every assignment, not only handwritten ones: a field that
        // appears and disappears on a condition the consumer cannot see is worse
        // than one that is always there. `tests/run-tests.mjs` asserts the map
        // and the rubric join one-to-one with agreeing `max_points`.
        region_id: regionId,
        part_id: partId,
        problem_number: pIndex + 1,
        problem_name: prob.name,
        subsection_letter: subsectionLetter,
        subsection_name: sub.name,
        display_name: `Problem ${pIndex + 1}(${subsectionLetter}): ${sub.name}`,
        // The problem stem, with each figure reduced to its own `<title>`/
        // `<desc>` text rather than its SVG source (`stemForGrader`). The prose
        // is verbatim and in place; a stem with no figure is byte-for-byte what
        // it always was, so figure-free rubrics do not move. Written only when
        // the problem has a stem.
        //
        // Grader-facing only. Students still get the real drawing everywhere,
        // and the authored `.md` still carries the full `<svg>`.
        ...(prob.description ? { problem_statement: stemForGrader(prob.description) } : {}),
        max_points: sub.points,
        // The declared modality of the *answer*, so a consumer holding the
        // rubric alone can route without guessing at read time (OCR addendum
        // v1.5 §3, T19) and without joining to the layout map. For a handwritten
        // part it comes from the same `isDrawing` that writes `is_drawing` in
        // `layout_*.csv`: the two are deliberately duplicated and must agree.
        //
        // **Optional, and absent wherever the app does not know.** An `[image]`
        // or `[text+image]` part is answered with a picture but carries no
        // modality declaration — `isDrawing` is handwritten-only — so nothing is
        // written for it. An absent field is an absence; `"text"` on a part
        // answered with a picture would be a false statement in a field whose
        // only purpose is routing, and a wrong value is worse than a missing one
        // precisely because it does not prompt anyone to ask. `"hybrid"` is
        // reserved in the documented set and never emitted.
        ...(answerModality ? { answer_modality: answerModality } : {}),
        // Handwritten is checked first: pages are cropped per region, so it never
        // falls through to the image or plain-human branches.
        grading_type: isHandwritten
            ? (sub.handwrittenGradingMode === 'human' ? 'human_handwritten' : 'ai_handwritten')
          : isAi ? 'ai'
          : isImage ? (sub.imageGradingMode === 'auto' ? 'ai_image_completion' : 'human_image')
          : 'human',
        grading_prompt: (isAi || isAiHandwritten) ? (sub.aiGradingPrompt || '') : '',
        ...(isAi && minWords !== undefined && { min_words: minWords }),
        // No max_images for handwritten — pages are an assignment-level pool.
        ...((isImage || isTextAndImage) && { max_images: sub.maxImages ?? 1 })
      };
    });
  });

  const assignmentId = `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}`;

  return {
    assignment_id: assignmentId,
    course_code: assignment.courseCode,
    assignment_title: assignment.title,
    // No model, temperature or token budget travels with the rubric. The
    // Assignment Maker describes the work; the grading system decides how to
    // grade it and allocates its own resources — see ASSIGNMENT_MD_SPEC.md §12.
    rubrics
  };
};

// =====================================================
// MARKDOWN EXPORT — Assignment → .md (round-trip)
// =====================================================

const TYPE_TAG: Partial<Record<SubmissionType, string>> = {
  [SubmissionType.TEXT]:             'text',
  [SubmissionType.IMAGE]:            'image',
  [SubmissionType.TEXT_AND_IMAGE]:   'text+image',
  [SubmissionType.AI_GRADED_BINARY]: 'ai-graded:binary',
  [SubmissionType.AI_GRADED_SHORT]:  'ai-graded:short',
  [SubmissionType.AI_GRADED_MEDIUM]: 'ai-graded:medium',
  [SubmissionType.AI_GRADED_LONG]:   'ai-graded:long',
  [SubmissionType.HANDWRITTEN]:      'handwritten',
};

export const assignmentToMd = (assignment: Assignment): string => {
  // Always export with normalized points
  const normalized = normalizePoints(assignment);
  const lines: string[] = [];

  lines.push(`# ${normalized.courseCode}: ${normalized.title}`);
  lines.push('');
  // Only handwritten assignments carry the line — electronic files stay byte-identical
  // to everything exported before handwritten support existed.
  if (normalized.inputMode === 'handwritten') {
    lines.push(`**Input:** handwritten`);
    lines.push('');
  }
  // Only when the author overrode it — a derived id is recomputed on import, so
  // writing it would pin a value that is meant to follow the course code and title.
  if (normalized.pageFormatId) {
    lines.push(`**Template ID:** ${normalized.pageFormatId}`);
    lines.push('');
  }
  // Emitted only when on: absent means off, so a file written before AI feedback
  // existed round-trips byte-for-byte.
  if (normalized.aiFeedback) {
    lines.push(`**AI Feedback:** on`);
    lines.push('');
  }
  // Where students hand the work in, printed on page 1 of the handwritten sheet.
  // Emitted only when set, so a file written before it existed round-trips
  // byte-for-byte — and carried at all because `Export .md` → `Import Markdown`
  // is a documented restore route, and a field that vanishes on that round trip
  // is the silent-loss defect this suite has already paid for twice.
  if ((normalized.submissionAddress || '').trim()) {
    lines.push(`**Submit at:** ${normalized.submissionAddress!.trim()}`);
    lines.push('');
  }
  // The course public key — the field that turns gb2 on. A 4096-bit SPKI PEM is
  // fourteen lines, and the metadata rows above are single-line by construction,
  // so this is a fenced block rather than a row. Nothing else in the pipeline
  // touches it: `FIGURE_FENCE_OPEN_RE` matches only ```svg, and the metadata
  // region's body is discarded by both parsers, so the PEM never reaches a
  // description, an escaper or the `$...$` splitter.
  //
  // Emitted only when set, so a keyless file stays byte-identical. Carried at
  // all because the .md is meant to be the source: until 2026-09-05 `Export .md`
  // -> `Import Markdown` dropped the key silently, and the next export fell back
  // to gb1 with nothing reporting it.
  //
  // NOT A SECRET. This is the public half; it ships to every student inside
  // assignment_spec.json already.
  const coursePem = normalizeCoursePublicKey(normalized.coursePublicKey || '');
  if (coursePem) {
    lines.push('```pem');
    coursePem.split('\n').forEach(l => lines.push(l));
    lines.push('```');
    lines.push('');
  }
  if (normalized.preamble) {
    lines.push(`**Preamble:** ${normalized.preamble}`);
  }

  normalized.problems.forEach((prob, pIdx) => {
    lines.push('');
    lines.push(`## Problem ${pIdx + 1}: ${prob.name}`);
    if (prob.description) {
      lines.push('');
      lines.push(prob.description);
    }

    prob.subsections.forEach((sub, sIdx) => {
      const letter = String.fromCharCode(97 + sIdx);
      const isImage = sub.submissionType === SubmissionType.IMAGE;
      const isTextAndImage = sub.submissionType === SubmissionType.TEXT_AND_IMAGE;
      const isHandwritten = sub.submissionType === SubmissionType.HANDWRITTEN;
      const isAiHandwritten = isHandwritten && sub.handwrittenGradingMode !== 'human';
      const typeTag = isImage && sub.maxImages && sub.maxImages > 1
        ? `image:${sub.maxImages}`
        : isTextAndImage && sub.maxImages && sub.maxImages > 1
          ? `text+image:${sub.maxImages}`
          : isHandwritten && sub.handwrittenGradingMode === 'human'
            ? 'handwritten:human'
            : (TYPE_TAG[sub.submissionType as SubmissionType] ?? 'text');

      lines.push('');
      lines.push(`### (${letter}) ${sub.name} [${sub.points} pts] [${typeTag}]`);

      if (sub.description) {
        lines.push(sub.description);
      }

      // Printed-template settings, only when the author set them. A separate key
      // rather than more colons in the type tag, so the tag grammar is untouched
      // and a file written before templates existed round-trips byte-for-byte.
      // Always the `lines=N` form. The retired `space=…` spellings still import
      // (mapped to a line count) but are never written back — a one-way
      // migration, so a file only ever gains the newer, clearer spelling.
      if (isHandwritten && (sub.answerLines || sub.isDrawing)) {
        const opts = [
          ...(sub.answerLines ? [`lines=${sub.answerLines}`] : []),
          ...(sub.isDrawing ? ['sketch'] : []),
        ];
        lines.push('');
        lines.push(`> template: ${opts.join(', ')}`);
      }

      if ((AI_GRADED_TYPES.has(sub.submissionType) || isAiHandwritten) && sub.aiGradingPrompt) {
        lines.push('');
        const sentences = sub.aiGradingPrompt.split(/(?<=\.)\s+/);
        sentences.forEach((sentence, i) => {
          if (i === 0) {
            lines.push(`> grading_prompt: ${sentence.trim()}`);
          } else {
            lines.push(`> ${sentence.trim()}`);
          }
        });
      }

      if (sub.graderNote) {
        lines.push('');
        const sentences = sub.graderNote.split(/(?<=\.)\s+/);
        sentences.forEach((sentence, i) => {
          if (i === 0) {
            lines.push(`> grader_note: ${sentence.trim()}`);
          } else {
            lines.push(`> ${sentence.trim()}`);
          }
        });
      }
    });
  });

  lines.push('');
  return lines.join('\n');
};

// =====================================================
// GRADER DOCUMENT — Instructor/TA reference sheet
// Shows rubrics (ai-graded) and answer keys (text/image)
// CONFIDENTIAL — not distributed to students
// =====================================================

export const generateGraderHTML = async (assignment: Assignment): Promise<string> => {
  const katexCss = await katexStylesheet();
  const totalPoints = assignment.problems.reduce((sum, prob) =>
    sum + prob.subsections.reduce((s, sub) => s + sub.points, 0), 0
  );

  const subsectionRows = assignment.problems.map((prob, pIdx) => {
    const problemPoints = prob.subsections.reduce((s, sub) => s + sub.points, 0);
    const subsRows = prob.subsections.map((sub, sIdx) => {
      const letter = String.fromCharCode(97 + sIdx);
      const isAi = AI_GRADED_TYPES.has(sub.submissionType);
      const isImage = sub.submissionType === SubmissionType.IMAGE;
      const isHandwritten = sub.submissionType === SubmissionType.HANDWRITTEN;
      const isAiHandwritten = isHandwritten && (sub.handwrittenGradingMode ?? 'ai') !== 'human';

      const isTextAndImageRubric = sub.submissionType === SubmissionType.TEXT_AND_IMAGE;
      let referenceBlock = '';
      if ((isAi || isAiHandwritten) && sub.aiGradingPrompt) {
        referenceBlock = `<div class="ref-block ai-ref"><span class="ref-label">AI Rubric</span><p>${toHtml(sub.aiGradingPrompt)}</p></div>`;
      } else if (sub.graderNote) {
        const label = isImage ? 'What to look for'
          : isTextAndImageRubric ? 'Expected answer + what to look for in image'
          : isHandwritten ? 'Expected answer — grade from the marked region'
          : 'Expected answer';
        referenceBlock = `<div class="ref-block human-ref"><span class="ref-label">${label}</span><p>${toHtml(sub.graderNote)}</p></div>`;
      } else {
        referenceBlock = `<div class="ref-block empty-ref"><span class="ref-label">No grader note</span><p>Human review required — no reference answer provided.</p></div>`;
      }

      const typeLabel = isHandwritten
        ? (isAiHandwritten ? 'Handwritten (AI graded)' : 'Handwritten (human review)')
        : isAi ? sub.submissionType : isImage
        ? `Image${sub.maxImages && sub.maxImages > 1 ? ` (${sub.maxImages} pages)` : ''} — human review`
        : isTextAndImageRubric
          ? `Text + Image${sub.maxImages && sub.maxImages > 1 ? ` (${sub.maxImages} image pages)` : ''} — human grading`
          : 'Electronic text — human grading';

      return `
        <div class="subsection">
          <div class="sub-header">
            <span class="sub-id">(${letter})</span>
            <span class="sub-name">${toHtml(sub.name)}</span>
            <span class="sub-pts">${sub.points} pts</span>
            <span class="sub-type">${escapeHtml(typeLabel)}</span>
          </div>
          ${sub.description ? `<p class="sub-desc">${toHtml(sub.description, `gp${pIdx}s${sIdx}f`)}</p>` : ''}
          ${referenceBlock}
        </div>`;
    }).join('');

    return `
      <div class="problem">
        <div class="prob-header">
          <span class="prob-num">Problem ${pIdx + 1}: ${toHtml(prob.name)}</span>
          <span class="prob-pts">${problemPoints} pts</span>
        </div>
        ${prob.description ? `<p class="prob-desc">${toHtml(prob.description, `gp${pIdx}f`)}</p>` : ''}
        ${subsRows}
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>GRADER DOCUMENT — ${escapeHtml(`${assignment.courseCode}: ${assignment.title}`)}</title>
<style>
${katexCss}
  body { font-family: Georgia, serif; max-width: 900px; margin: 40px auto; line-height: 1.6; padding: 0 24px; color: #222; }
  .confidential-banner { background: #b91c1c; color: #fff; text-align: center; padding: 10px 0; font-weight: bold; font-size: 1.1em; letter-spacing: 0.05em; margin-bottom: 28px; border-radius: 4px; }
  h1 { font-size: 1.6em; border-bottom: 2px solid #333; padding-bottom: 8px; margin-bottom: 4px; }
  .meta { color: #555; font-style: italic; margin-bottom: 28px; font-size: 0.95em; }
  .problem { margin-top: 36px; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; }
  .prob-header { background: #1e3a5f; color: #fff; padding: 10px 16px; display: flex; justify-content: space-between; align-items: baseline; }
  .prob-num { font-weight: bold; font-size: 1.05em; }
  .prob-pts { font-size: 0.9em; opacity: 0.85; }
  .prob-desc { margin: 10px 16px 0; color: #444; font-size: 0.95em; }
  .subsection { border-top: 1px solid #e5e5e5; padding: 12px 16px; }
  .sub-header { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 4px; }
  .sub-id { font-weight: bold; color: #1e3a5f; min-width: 28px; }
  .sub-name { font-weight: bold; flex: 1; }
  .sub-pts { font-size: 0.9em; color: #555; white-space: nowrap; }
  .sub-type { font-size: 0.82em; font-family: monospace; background: #f0f0f0; padding: 1px 6px; border-radius: 3px; color: #444; }
  .sub-desc { color: #555; font-size: 0.93em; margin: 2px 0 8px 28px; white-space: pre-wrap; }
  .prob-desc, .sub-name { white-space: pre-wrap; }
  .ref-block { margin: 8px 0 0 28px; padding: 10px 14px; border-radius: 4px; font-size: 0.93em; }
  .ref-label { display: inline-block; font-weight: bold; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
  .ai-ref { background: #eff6ff; border-left: 4px solid #2563eb; }
  .ai-ref .ref-label { color: #1d4ed8; }
  .human-ref { background: #f0fdf4; border-left: 4px solid #16a34a; }
  .human-ref .ref-label { color: #15803d; }
  .empty-ref { background: #fafafa; border-left: 4px solid #d1d5db; }
  .empty-ref .ref-label { color: #9ca3af; }
  .ref-block p { margin: 0; white-space: pre-wrap; }
  @media print {
    .confidential-banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .prob-header { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .problem { page-break-inside: avoid; }
  }
</style>
</head>
<body>
  <div class="confidential-banner">CONFIDENTIAL — INSTRUCTOR / TA USE ONLY — NOT FOR DISTRIBUTION</div>
  <h1>${toHtml(`${assignment.courseCode}: ${assignment.title}`)} — Grader Reference</h1>
  <div class="meta">Total: ${totalPoints} pts &nbsp;|&nbsp; Generated by GradeBridge Assignment Maker &nbsp;|&nbsp; Blue = AI rubric &nbsp;|&nbsp; Green = Answer key / What to look for</div>
  ${assignment.preamble ? `<p class="prob-desc"><em>${toHtml(assignment.preamble)}</em></p>` : ''}
  ${subsectionRows}
</body>
</html>`;
};

// =====================================================
// ASSIGNMENT SPEC — payload of assignment_spec.json
// =====================================================
// The spec is built from an EXPLICIT LIST of the fields the Student Submission
// app reads. It is not the Assignment object with fields subtracted, and the
// direction is the whole point.
//
// **A blacklist is how the answer key got in.** `aiGradingPrompt` was added for
// the grader; the spec shipped the whole object; nothing objected. On
// 2026-08-31 a decrypt of a real ENG17 HW1 export showed 17 of 17 grading
// prompts in the student's copy, `REFERENCE:` lines and all — one of them
// stating the answer is 1.2 V and deriving it. `graderNote` travels the same
// way on any assignment that has a `handwritten:human` part.
//
// With a whitelist, **the next field anyone adds to `Assignment` is excluded by
// default** and reaches students only when someone decides it should. That is
// the property worth having: the failure mode of a blacklist is silent and the
// failure mode of a whitelist is a missing feature someone notices.
//
// Nothing is lost. Grading material reaches the grader by its proper route,
// `{stem}_grading_rubric.json`, which stays with the instructor. The authoring
// round trip is `Export .md` → `Import Markdown`, which carries the prompts and
// the grader notes in full. See ASSIGNMENT_MD_SPEC.md §12.
//
// Keep this list in step with `GradeBridge-Student-Submission/types.ts`, which
// is where "what the student app reads" is actually defined. `tests/run-tests.mjs`
// asserts the built spec's field set is exactly this, so adding a field to
// `Assignment` fails the suite until someone decides deliberately.

/** Fields always written, in the order the spec serialises them. */
const SPEC_ASSIGNMENT_REQUIRED = ['id', 'courseCode', 'title', 'preamble', 'problems', 'createdAt', 'updatedAt'] as const;
/** Written only when the assignment actually carries them, so a spec from
 *  before a field existed stays byte-for-byte what it was.
 *
 *  `layoutCsvName` / `layoutCsv` are the exception to "fields of `Assignment`":
 *  they are not authored, they are the map the generator just produced, handed
 *  to `buildAssignmentSpec` as its second argument. They ride in the spec so a
 *  handwritten student has ONE file to load and no second file to choose
 *  wrongly — and so the map, which decides where their answers are cut from,
 *  is neither readable nor editable on the way. Both present or both absent,
 *  never one. See THE EMBEDDED LAYOUT below. */
const SPEC_ASSIGNMENT_OPTIONAL = ['inputMode', 'aiFeedback', 'coursePublicKey', 'layoutCsvName', 'layoutCsv'] as const;
const SPEC_PROBLEM_REQUIRED = ['id', 'name', 'description', 'subsections'] as const;
const SPEC_SUBSECTION_REQUIRED = ['id', 'name', 'description', 'points', 'submissionType'] as const;
const SPEC_SUBSECTION_OPTIONAL = ['minWords', 'maxImages', 'config'] as const;

/** The whole contract in one shape, exported so the test can assert against it. */
export const STUDENT_SPEC_FIELDS = {
  assignment: [...SPEC_ASSIGNMENT_REQUIRED, ...SPEC_ASSIGNMENT_OPTIONAL],
  problem: [...SPEC_PROBLEM_REQUIRED],
  subsection: [...SPEC_SUBSECTION_REQUIRED, ...SPEC_SUBSECTION_OPTIONAL],
} as const;

/**
 * Copy `required` unconditionally and `optional` only where the source has the
 * key. Presence, not truthiness: `aiFeedback: false` is a real answer and must
 * survive, while an assignment that predates the flag must stay without it.
 */
const pickFields = (src: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) => {
  const out: Record<string, unknown> = {};
  for (const k of required) out[k] = src[k];
  for (const k of optional) if (k in src && src[k] !== undefined) out[k] = src[k];
  return out;
};

// =====================================================
// THE EMBEDDED LAYOUT
// =====================================================
// A handwritten student used to receive three files and had to open a zip to
// get the sheet out to print. That single act put the layout map in front of
// them — the file that decides where their answers are cut from, in plain text,
// editable — and left them choosing which of two files to upload.
//
// The map now travels INSIDE the spec, which is `gb1:`-encoded, so it is
// neither readable nor editable and there is nothing to choose between.
//
// **The CSV text is embedded VERBATIM: not reformatted, not converted to JSON,
// not normalised.** That is the whole reason this cannot move `layout_id`.
// `computeLayoutId` hashes `canonicalMapSerialization(rows)` — the PARSED rows,
// not the file bytes — so a consumer that embeds the same text and parses it
// with the same parser gets identical rows by construction. Reformat it here
// and the guarantee becomes an argument instead of a fact. `95438EDF` is
// printed into the QR on every ENG17 sheet that already exists: every other
// mistake in this file is a redeploy, this one is a reprint.
export interface EmbeddedLayout {
  /** The sidecar's own filename, so a consumer's errors can still name a file. */
  name: string;
  /** `toLayoutCsv()`'s output, byte for byte, as written to `instructor/`. */
  csv: string;
}

export const buildAssignmentSpec = async (
  assignment: Assignment,
  layout?: EmbeddedLayout,
): Promise<Assignment> => {
  // Validate the key before building, so a malformed one stops the export
  // rather than silently producing submissions nobody can read.
  const pem = normalizeCoursePublicKey(assignment.coursePublicKey || '');
  if (pem) {
    const check = await validateCoursePublicKey(pem);
    if (!check.ok) {
      throw new Error(`Export stopped: the course public key on this assignment is not valid. ${check.error}`);
    }
  }

  const source = { ...(assignment as unknown as Record<string, unknown>) };
  // An empty or whitespace-only key is not a key: omit the field entirely so
  // the spec stays identical to a pre-gb2 export and the student app falls back
  // to gb1.
  if (pem) source.coursePublicKey = pem; else delete source.coursePublicKey;

  // Both fields or neither, refused here rather than downstream: a spec naming a
  // map it does not carry, or carrying one it cannot name, is a shape no
  // consumer has been written for, and the export is the last place anyone
  // looks at it.
  delete source.layoutCsvName;
  delete source.layoutCsv;
  if (layout) {
    if (typeof layout.name !== 'string' || !layout.name ||
        typeof layout.csv !== 'string' || !layout.csv) {
      throw new Error(
        'Export stopped: the layout to embed in the assignment spec is incomplete. ' +
        'A spec carries the map\'s name and the map\'s text, or neither — never one.');
    }
    source.layoutCsvName = layout.name;
    source.layoutCsv = layout.csv;
  }

  const spec = pickFields(source, SPEC_ASSIGNMENT_REQUIRED, SPEC_ASSIGNMENT_OPTIONAL);
  spec.problems = (assignment.problems || []).map(prob => {
    const p = pickFields(prob as unknown as Record<string, unknown>, SPEC_PROBLEM_REQUIRED);
    p.subsections = (prob.subsections || []).map(sub =>
      pickFields(sub as unknown as Record<string, unknown>, SPEC_SUBSECTION_REQUIRED, SPEC_SUBSECTION_OPTIONAL));
    return p;
  });

  return spec as unknown as Assignment;
};

// =====================================================
// THE EXPORT ZIP
// =====================================================
// Two folders and a notice at the root:
//
//   00_INSTRUCTOR_ONLY_DO_NOT_DISTRIBUTE.txt
//   student/      the only files a student may receive
//   instructor/   everything else — three of which contain the answer key
//
// The structure exists so that "give students the student folder" is
// unambiguous. Having just removed the answer key from `assignment_spec.json`,
// the largest remaining disclosure path is an instructor handing out the whole
// ZIP, and prose in a README does not help the person who has just dragged a
// folder into Canvas. The folders say what the prose says.
//
// Nothing in the suite unzips this archive programmatically — it is an
// instructor's download that they unpack and distribute pieces from — so the
// folders break no consumer. Filenames are unchanged, which is what the briefs
// and the Gradescope setup instructions actually name.

export const STUDENT_DIR = 'student/';
export const INSTRUCTOR_DIR = 'instructor/';
export const DISTRIBUTION_NOTICE_NAME = '00_INSTRUCTOR_ONLY_DO_NOT_DISTRIBUTE.txt';

/**
 * The notice is GENERATED from the entry list, never hand-maintained: a notice
 * that drifts out of step with the folder is worse than none, because it will
 * be believed. Anything added to `instructor/` that holds answers must be added
 * to `ANSWER_BEARING` in the same edit, and a test asserts every name here is
 * really in the ZIP.
 */
const ANSWER_BEARING: Array<[suffix: string, what: string]> = [
  ['_grader_document.html',   'the answer key and rubrics, for you and your TAs'],
  ['_grading_rubric.json',    'the same rubrics, for the autograder'],
  ['_authoring_backup.json',  'the complete assignment, rubrics included'],
  ['.md',                     'the authored source, rubrics included'],
];

const buildDistributionNotice = (
  names: string[],
  student: { studentZip: string; studentPdf: string; studentUpload: string },
): string => {
  const base = (n: string) => n.slice(n.lastIndexOf('/') + 1);
  const instructor = names.filter(n => n.startsWith(INSTRUCTOR_DIR));

  // The student list is ordered by what the instructor does with it, not by
  // insertion order: print the sheet, then hand over the file they upload.
  // Anything unrecognised is still listed — a student file silently missing
  // from this list is the failure the notice exists to prevent.
  const STUDENT_ORDER = [student.studentPdf, student.studentUpload];
  const studentWhat = (b: string) =>
      b === student.studentPdf ? 'the sheet they print and write on'
    : b === student.studentUpload ? 'they load this into the Submission app; the map is inside it'
    : '';
  const rank = (b: string) => {
    const i = STUDENT_ORDER.indexOf(b);
    return i === -1 ? STUDENT_ORDER.length : i;
  };
  const studentRows = names
    .filter(n => n.startsWith(STUDENT_DIR)).map(base)
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map(b => [b, studentWhat(b)] as const);

  // The map used to be a student file. An instructor who remembers that it
  // "must travel with the PDF" would post the copy now sitting in instructor/,
  // and nothing downstream would object — the student app would simply take the
  // separate map in preference to the embedded one. Say where it went.
  const mapName = instructor.map(base).find(b => /^layout_.*\.csv$/i.test(b));

  const answerRows = ANSWER_BEARING
    .map(([suffix, what]) => {
      const hit = instructor.find(n => base(n).endsWith(suffix));
      return hit ? ([base(hit), what] as const) : null;
    })
    .filter(Boolean) as ReadonlyArray<readonly [string, string]>;

  // One column width for the whole notice, taken from the longest name actually
  // in it, so a long course stem does not run the names into the descriptions.
  const width = Math.max(...[...answerRows, ...studentRows].map(([n]) => n.length)) + 2;
  const row = ([n, what]: readonly [string, string]) => ('  ' + n.padEnd(width) + what).trimEnd();

  const count = studentRows.length === 1 ? '1 file' : studentRows.length + ' files';

  // THE FIRST LINE IS THE WHOLE INSTRUCTION (item 3, 2026-09-06). It names ONE
  // file, because an instructor building a Canvas assignment attaches one file.
  // It briefly named two, and two means selecting and attaching both, which is
  // assembly — the thing this whole line of work exists to remove. An instructor
  // in a hurry reads the top of a file and stops, so what they must do goes
  // there and the explanation goes below it.
  return [
    'Attach ' + student.studentZip + ' to your Canvas assignment. That',
    'one file is everything your students need: the sheet they print, and the',
    'file they load into the submission app. Post nothing else from this',
    'archive. Everything under ' + INSTRUCTOR_DIR + ' contains answers.',
    '',
    'INSTRUCTOR ONLY. DO NOT GIVE THIS FOLDER TO STUDENTS.',
    '',
    'This export contains the answer key.',
    '',
    'Files here that contain answers (in ' + INSTRUCTOR_DIR + '):',
    ...answerRows.map(row),
    '',
    student.studentZip + ' holds these ' + count + ', and nothing else:',
    ...studentRows.map(row),
    '',
    ...(mapName ? [
      'The layout map ' + mapName + ' is now INSIDE ' + student.studentUpload + '.',
      'The copy in ' + INSTRUCTOR_DIR + ' is yours, for the Gradescope outline. Do not',
      'post it: students no longer need it, and it is the map their answers are',
      'cut from.',
      '',
    ] : []),
    'Keep everything else. It is your backup and your grading material.',
    '',
  ].join('\n');
};

/**
 * Everything that goes in the export ZIP, as path → content. Split out from the
 * download so the contents can be asserted without a browser.
 *
 * **There is one student PDF.** For a handwritten assignment it *is* the
 * page-format sheet — the QR, the marks, the question text and the ruled writing
 * areas. There is deliberately no second PDF to choose between: the instructor
 * prints it and that is the whole story.
 *
 * **The two student entries carry the names they will ship under**, not internal
 * ones renamed later. `STUDENT_DIR` is only a marker for who may receive an
 * entry; the filename is decided in one place, `exportFilenames`.
 */
export const buildExportEntries = async (
  assignment: Assignment
): Promise<Record<string, Blob | string>> => {
  const stem = `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}`;
  const handwritten = assignment.inputMode === 'handwritten';
  const { studentZip, studentPdf, studentUpload } = exportFilenames(assignment);

  // THE TEMPLATE COMES FIRST on the handwritten path, because its CSV text goes
  // into the spec: the spec cannot be built until the map exists.
  // generateTemplate() runs the spec 8.7 self-test and throws rather than
  // emitting a non-compliant template, so a failure stops the whole export —
  // which is the intent.
  const template = handwritten ? await generateTemplate(assignment) : null;

  const entries: Record<string, Blob | string> = {
    // ---- student/ : the only files a student may receive --------------------
    // Spec JSON — encoded with AES-256-GCM so students cannot casually read or
    // edit it, and built from a whitelist so it carries no grading material at
    // all. On a handwritten assignment it also carries the layout map verbatim,
    // so this is the only file a student uploads. The Student Submission app
    // decodes it on load; Import JSON here handles encoded files too.
    [`${STUDENT_DIR}${studentUpload}`]: await encryptJson(await buildAssignmentSpec(
      assignment,
      template ? { name: template.csvFilename, csv: template.csv } : undefined)),

    // ---- instructor/ : backup, grading material, readable documents ---------
    // THE BACKUP. The one file whose job is completeness — see
    // services/authoringBackup.ts for why it exists and why it is unencrypted.
    [`${INSTRUCTOR_DIR}${stem}_authoring_backup.json`]: buildAuthoringBackup(assignment),
    // The authored source. It was only ever a separate download before, which
    // meant the backup the app recommends did not contain the more complete of
    // the two restore routes.
    [`${INSTRUCTOR_DIR}${stem}.md`]: assignmentToMd(assignment),
    [`${INSTRUCTOR_DIR}assignment.html`]: await generateHTML(assignment),
    // Editable LaTeX source, for an instructor who wants to hand-tune the paper.
    [`${INSTRUCTOR_DIR}assignment.tex`]: generateLaTeX(assignment),
    // Private — for the autograder only.
    [`${INSTRUCTOR_DIR}${stem}_grading_rubric.json`]: JSON.stringify(generateGradingRubric(assignment), null, 2),
    // Private — instructor/TA reference with rubrics and answer keys.
    [`${INSTRUCTOR_DIR}${stem}_grader_document.html`]: await generateGraderHTML(assignment),
  };

  if (template) {
    // The page-format sheet is the assignment.
    entries[`${STUDENT_DIR}${studentPdf}`] = template.pdf;
    // The sidecar map, INSTRUCTOR-SIDE since 2026-09-06. Its filename carries
    // the template id because that is what the printed QR points at; do not
    // rename it — the same text is embedded in the spec above, and the two
    // copies are asserted byte-identical before anything is written. The
    // instructor's use for it is the Gradescope outline; the student's copy
    // rides inside the file they upload.
    entries[`${INSTRUCTOR_DIR}${template.csvFilename}`] = template.csv;
  } else {
    entries[`${STUDENT_DIR}${studentPdf}`] = await createPDF(assignment, 'student');
    // The boxed answer-region sheet, for setting up the Gradescope outline —
    // which is an instructor task, so it is not in student/. Handwritten has no
    // use for it: the page-format sheet already is the answer surface, and a
    // second boxed one only invites printing the wrong PDF.
    entries[`${INSTRUCTOR_DIR}template.pdf`] = await createPDF(assignment, 'template');
  }

  // The notice names the student package, so it is generated from the same
  // function that names it on disk — never from a second copy of the pattern.
  entries[DISTRIBUTION_NOTICE_NAME] =
    buildDistributionNotice(Object.keys(entries), { studentZip, studentPdf, studentUpload });
  return entries;
};

// =====================================================
// THE TWO STUDENT FILES — what the instructor posts, ready to post
// =====================================================
//
// THE FAILURE THIS REMOVES. The export ZIP holds `student/` and `instructor/`,
// and posting it requires the instructor to unzip it and re-zip the `student/`
// contents by hand. Skipping that step is **silent and complete**: the Student
// Submission app's `baseName()` ignores directory prefixes, so
// `student/assignment_spec.json` matches, `instructor/` holds no spec and no
// layout file, and the whole export loads *perfectly*. The student gets their
// assignment and the grading rubric in one download, and nothing anywhere
// reports a problem. The folders and the generated notice tell a human what to
// do; they cannot make the machine refuse the wrong thing.
//
// **CHANGED 2026-09-06: there is no student ZIP any more.** The student package
// was itself an archive, which meant a student had to open something to reach
// the sheet they print — and that single act put the layout map and a second
// candidate upload file in front of them. Two loose files replace it: a PDF to
// print and one file to upload, with the map inside the second. The archive an
// instructor unzips is the same one they always unzipped; what changed is that
// the two files they post are already loose at its root.
//
// **Built by filtering the same `entries` map the export ZIP is built from**,
// never from a second list of filenames. Two lists is how the two would come to
// disagree about what is student-facing, and the disagreement would be silent in
// exactly the same way — a file added to `student/` and forgotten here would be
// withheld from students, or worse, one added to `instructor/` and named here
// would be published.
//
// **`loaderContractProblems` was removed in the same change.** It enforced the
// Student Submission loader's rules for a student *archive* — exactly one
// `assignment_spec.json`, at most one `layout_*.csv`, counted by base name — and
// there is no longer a student archive for it to run over. Keeping it would have
// left exactly what its own comment warned against: code that looks like a guard
// and guards nothing.

/**
 * What the student files must be, exactly. Both modes ship the same two.
 *
 * Each entry carries the human name as well as the matcher, because these
 * strings reach an instructor in a failure message and a raw regular expression
 * is not something anyone should be shown at the moment their export stopped.
 *
 * **The map is no longer in this list, and the guarantee it stood for did not
 * go with it.** "The sheet never ships without its map" used to be held here, by
 * requiring a third file; it is now held by `embeddedLayoutProblems`, which
 * asserts the handwritten spec actually carries the map's text and that the text
 * is byte-identical to the instructor's copy. The check moved to where the map
 * now travels.
 *
 * ITEM 1, determined 2026-09-06: a student needs the upload file more than the
 * PDF on an electronic assignment — the spec carries every problem and sub-part
 * description and the Submission app renders them — but both modes ship both,
 * because on a handwritten assignment the PDF *is* the answer surface.
 */
export const studentFileContract = (assignment: Assignment) => {
  const { studentPdf, studentUpload } = exportFilenames(assignment);
  return [
    { label: `the sheet to print (${studentPdf})`, match: (n: string) => n === studentPdf },
    { label: `the file to upload (${studentUpload})`, match: (n: string) => n === studentUpload },
  ];
};

/**
 * The student-facing entries, at the archive root, asserted rather than assumed.
 *
 * Throws rather than emitting a bad archive. Everything here is a *publishing*
 * mistake — the archive goes to a whole class at once and cannot be recalled —
 * so the same reasoning applies as to the template self-test: refuse, and name
 * what is wrong, rather than warn beside a download that has already happened.
 */
export const buildStudentEntries = (
  entries: Record<string, Blob | string>,
  assignment: Assignment
): Record<string, Blob | string> => {
  // This took the mode as a BOOLEAN until 2026-09-05, and the change is not
  // cosmetic: naming the offending sub-parts needs the assignment. It does mean
  // a stale caller passing `true` would be read as an object with no
  // `inputMode`, silently become electronic, and then refuse for a puzzling
  // reason — a layout map "not a file students may receive". Say what actually
  // happened instead. TypeScript stops this in the app; the test suites and the
  // scratch harnesses are plain JavaScript, where it is a live trap.
  if (!assignment || typeof assignment !== 'object' || !Array.isArray(assignment.problems)) {
    throw new Error(
      'buildStudentEntries() takes the assignment as its second argument, not a mode flag. ' +
      `Got ${assignment === null ? 'null' : typeof assignment}.`
    );
  }

  const mode = assignment.inputMode === 'handwritten' ? 'handwritten' : 'electronic';
  const handwritten = mode === 'handwritten';

  // ---- MIXED-MEDIUM: refuse, and say which sub-parts ----------------------
  //
  // One assignment is either handwritten throughout or electronic throughout.
  // A mixed one is representable — `submissionType` is per sub-part — and until
  // now it EXPORTED CLEANLY in both directions, producing an answer that cannot
  // be collected, silently:
  //
  //   handwritten + a text part   the student is given a printed box to
  //                               photograph for an answer they typed, and no
  //                               PDF is generated at all, so a human grader has
  //                               no document to read.
  //   electronic + a handwritten  the rubric names a `region_id` against a
  //   part                        layout map that was never written, and the
  //                               student is directed to a page-upload section
  //                               that is not rendered for their assignment.
  //
  // Neither is recoverable once a student has submitted, and no downstream check
  // can catch either: `layout_id` hashes GEOMETRY, and mixed-medium geometry is
  // perfectly valid geometry.
  //
  // **The check is here, at export, and not at authoring.** The editor already
  // filters the medium pills by mode, so the UI cannot create one — but
  // `parseMdToAssignment` sets `inputMode` and the per-part types with no
  // cross-check between them, so a hand-written `.md` reaches Export without
  // ever passing through the editor. An authoring-side guard is therefore not a
  // guard. This is the one place every route converges.
  //
  // It NAMES THE OFFENDING SUB-PARTS. A refusal that says only "mixed medium"
  // sends the author hunting through a long assignment for something the tool
  // already knows the location of. The labels come from
  // `strandedSubsectionLabels`, the same function the editor's mode-switch
  // dialog uses, so the two can never describe the same defect differently.
  const stranded = strandedSubsectionLabels(assignment.problems || [], mode);
  if (stranded.length > 0) {
    const one = stranded.length === 1;
    throw new Error([
      'Export stopped: this assignment mixes handwritten and electronic sub-parts.',
      '',
      handwritten
        ? `It is a handwritten assignment, so every sub-part must be Handwritten. ${one ? 'This one is' : 'These are'} not:`
        : `It is an electronic assignment, so no sub-part may be Handwritten. ${one ? 'This one is' : 'These are'}:`,
      ...stranded.map(label => `  • ${label}`),
      '',
      `Change ${one ? 'it' : 'them'}, or switch the whole assignment to ` +
      `${handwritten ? 'Electronic' : 'Handwritten'}. An assignment cannot be half of each: the ` +
      `answers to the sub-parts above could not be collected from a student, and nothing later ` +
      `in the pipeline would report a problem.`,
    ].join('\n'));
  }

  const out: Record<string, Blob | string> = {};
  const problems: string[] = [];

  for (const [name, content] of Object.entries(entries)) {
    if (!name.startsWith(STUDENT_DIR)) continue;
    const base = name.slice(STUDENT_DIR.length);
    // A nested path under `student/` would arrive at the root still carrying a
    // separator, and a consumer that splits on it would see a directory that is
    // not there. Nothing produces one today; this is what stops the first one
    // being noticed by a student.
    if (base.includes('/') || base.includes('\\')) {
      problems.push(`"${name}" is nested inside ${STUDENT_DIR} — the student files are flat`);
      continue;
    }
    out[base] = content;
  }

  // Belt and braces over the filter above: assert the *result*, not the loop, so
  // a future change to how entries are selected is still held to the outcome.
  for (const name of Object.keys(out)) {
    if (name.startsWith(INSTRUCTOR_DIR)) problems.push(`"${name}" is an instructor file`);
    if (name === DISTRIBUTION_NOTICE_NAME) {
      problems.push(`the instructor-only notice "${name}" reached the student files`);
    }
  }
  const fromStudentDir = Object.keys(entries).filter(n => n.startsWith(STUDENT_DIR)).length;
  if (Object.keys(out).length !== fromStudentDir) {
    problems.push(`${fromStudentDir} files are in ${STUDENT_DIR} but ${Object.keys(out).length} reached the archive root`);
  }

  // The contents must be exactly the two files — no more, and no fewer. "No
  // more" is the disclosure guard; "no fewer" catches an assignment shipped
  // without the sheet, or without the file that loads it, which fails when a
  // student sits down to work rather than at download time.
  const remaining = new Set(Object.keys(out));
  for (const want of studentFileContract(assignment)) {
    const hit = [...remaining].find(n => want.match(n));
    if (hit) remaining.delete(hit);
    else problems.push(`the student files are missing ${want.label}`);
  }
  for (const extra of remaining) problems.push(`"${extra}" is not a file students may receive`);

  if (problems.length) {
    throw new Error(
      'Export stopped: the student files would not have been safe to post.\n' +
      problems.map(p => `  • ${p}`).join('\n')
    );
  }
  return out;
};

// ---- Download names ------------------------------------------------------
//
// **The name is the only thing standing between a tired instructor and
// publishing the answer key.**
//
//     {stem}_INSTRUCTOR_ONLY.zip        the one download; contains the grading rubric
//       ├── {stem}_FOR_STUDENTS.zip       attach THIS to Canvas. Stored, not deflated.
//       │     ├── {stem}.pdf                they print it
//       │     └── {stem}_OPEN_IN_APP.json   they load it into the app
//       └── instructor/                   everything else
//
// **THE STUDENT PACKAGE IS ONE FILE, and that is what an instructor attaches.**
// It briefly was not: earlier on 2026-09-06 the two student files were moved
// loose to the outer root, which meant an instructor building a Canvas
// assignment had to select two files out of an archive and attach both. **That
// is assembly, and removing assembly is the point of this whole line of work.**
//
// The reason they were moved out has since gone. The student zip then held
// three files, one of them an editable CSV, so a student opening it faced a
// confusing choice. The layout now travels inside the spec, so the package holds
// exactly two files and both names say what to do with them — which is a package
// worth handing over whole.
//
// **`Export` was the word that failed** on the archive: it named the operation
// and said nothing about who the file was for, so the reader had to already
// know. `INSTRUCTOR_ONLY` and `FOR_STUDENTS` say it.
//
// **The two files INSIDE the student zip deliberately do not say
// `FOR_STUDENTS`.** That suffix tells an *instructor* which file to attach, and
// it belongs on the package, not on its contents. The two names inside are read
// by a student, to whom "for students" says nothing they do not already know;
// what a student needs from a filename is which of the two to act on and how. So
// exactly one of them carries an instruction, and it is the one whose misuse is
// the failure: a `.pdf` has one obvious use and a `.json` has none.
//
// This RENAMES the existing export download: what used to arrive as
// `{stem}_Export.zip` is now `{stem}_INSTRUCTOR_ONLY.zip`. Folders unzipped from
// older downloads keep their old name. Recorded in ASSIGNMENT_MD_SPEC.md §13.
//
// **WHY `_OPEN_IN_APP` AND NOT `_UPLOAD`** (Andre, 2026-09-06, deciding the
// work order's open question). The student workflow contains TWO uploads: this
// file into the Submission app, and the finished submission archive into
// Gradescope. "Upload" is therefore the one word that appears at both
// destinations, which makes it the one word that cannot tell them apart — and
// the failure it invites is a student uploading their assignment file to
// Gradescope, where it is accepted and the autograder fails. `_OPEN_IN_APP`
// names the destination that is not the grading site.
//
// Naming the app instead was considered and rejected: **"GradeBridge" and
// "Gradescope" are four characters apart and both begin "Grade"**, so a filename
// that names the product discriminates worse than one that does not.
//
// Both names are decided here and nowhere else, so a change is a change to this
// function.
const STUDENT_SPEC_SUFFIX = 'OPEN_IN_APP';
const STUDENT_SUFFIX = 'FOR_STUDENTS';
const INSTRUCTOR_SUFFIX = 'INSTRUCTOR_ONLY';

const stemOf = (assignment: Assignment) =>
  `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}`;

export const exportFilenames = (assignment: Assignment) => {
  const stem = stemOf(assignment);
  return {
    instructorZip: `${stem}_${INSTRUCTOR_SUFFIX}.zip`,
    // Not a download of its own — this is the one entry inside the instructor
    // archive that the instructor attaches to Canvas, untouched.
    studentZip: `${stem}_${STUDENT_SUFFIX}.zip`,
    // The two files inside that package.
    studentPdf: `${stem}.pdf`,
    studentUpload: `${stem}_${STUDENT_SPEC_SUFFIX}.json`,
  };
};

// **One download per user gesture. Never two.**
//
// Measured in Chrome 152.0.7977.77 on 2026-09-06, over file-saver's own
// mechanism on an http origin: three `saveAs` calls from one click delivered
// ONE file; the other two never arrived, with no exception and nothing in the
// console. Spacing them 300 ms apart delivered none. And once Chrome had
// blocked automatic downloads for the site, a *single* download from it failed
// silently too, across ports — an app that has quietly stopped downloading
// anything, which is unrecoverable from inside the page.
//
// Yesterday's answer was one button per artifact, so that no gesture ever
// triggered two downloads. **Today's answer is stronger: one download per
// export, full stop.** A rule that says "never call this twice in a gesture" is
// a rule someone has to keep; an export that produces a single archive cannot
// break it. The student package rides inside that archive, which is also why
// `downloadQrTemplate` ships one ZIP rather than two files — same reasoning,
// applied to the whole export.
const saveOne = (content: Blob, filename: string) => {
  // Handle file-saver import differences (default export vs named export property)
  const save = (FileSaver as any).saveAs || FileSaver;
  save(content, filename);
};

/**
 * Add one entry, as bytes rather than as a `Blob`.
 *
 * JSZip only accepts a `Blob` where `support.blob` is true, which is a browser.
 * Outside one the entry is stored as an unrecognised type and fails on *read*
 * with "Can't read the data of '...'" — so an archive built in a test looks
 * fine until something opens it. Converting here costs nothing (the bytes are
 * already in memory) and is what lets the suite open the archive this app
 * exists to produce, rather than assert that it meant to produce one.
 */
const addZipEntry = async (zip: JSZip, name: string, content: Blob | string): Promise<void> => {
  zip.file(name, content instanceof Blob ? new Uint8Array(await content.arrayBuffer()) : content);
};

/**
 * THE TWO COPIES OF THE MAP MUST AGREE, and it is asserted over what will be
 * written rather than over what was intended.
 *
 * The spec is decoded here exactly as a student's browser decodes it, and the
 * embedded text compared with `instructor/layout_*.csv` **character for
 * character**. That is the check the whole design rests on: the hash is computed
 * over parsed rows, so identical text gives an identical `layout_id` by
 * construction — and a difference of one character is the one way that stops
 * being true. `95438EDF` is printed into the QR on paper that already exists.
 *
 * Also enforced here: both fields or neither (a spec naming a map it does not
 * carry is a shape nothing has been written for), a handwritten spec carries
 * one, and an electronic spec does not — the electronic path generates no map,
 * so a field claiming otherwise would be a lie about geometry that does not
 * exist. Returns every problem, so an export that has two is not fixed twice.
 */
export const embeddedLayoutProblems = async (
  entries: Record<string, Blob | string>,
  assignment: Assignment
): Promise<string[]> => {
  const problems: string[] = [];
  const { studentUpload } = exportFilenames(assignment);
  const specEntry = entries[`${STUDENT_DIR}${studentUpload}`];
  if (typeof specEntry !== 'string') {
    return [`there is no ${studentUpload} to check the embedded layout map in`];
  }

  const spec = await decryptJson(specEntry) as Record<string, unknown>;
  const hasName = 'layoutCsvName' in spec, hasCsv = 'layoutCsv' in spec;
  if (hasName !== hasCsv) {
    problems.push(
      `${studentUpload} carries ${hasName ? 'layoutCsvName without layoutCsv' : 'layoutCsv without layoutCsvName'}` +
      ' — a spec carries the map\'s name and its text, or neither');
  }

  const csvPath = Object.keys(entries).find(n => /^instructor\/layout_.*\.csv$/.test(n));
  const csvName = csvPath ? csvPath.slice(INSTRUCTOR_DIR.length) : null;

  if (assignment.inputMode === 'handwritten') {
    if (!csvPath) {
      problems.push(`the export has no ${INSTRUCTOR_DIR}layout_*.csv to compare the embedded map against`);
    }
    if (!hasCsv) {
      problems.push(
        `${studentUpload} carries no layout map, so a handwritten student would have nothing to crop by`);
    }
    if (csvPath && hasCsv) {
      if (spec.layoutCsv !== entries[csvPath]) {
        problems.push(
          `the map embedded in ${studentUpload} is not byte-identical to ${csvPath} — ` +
          'the two copies disagree, so the embedded one may not hash to the layout_id printed on the sheet');
      }
      if (spec.layoutCsvName !== csvName) {
        problems.push(
          `${studentUpload} names its map "${String(spec.layoutCsvName)}" but the export writes "${csvName}"`);
      }
    }
  } else if (hasCsv || hasName) {
    problems.push(
      `${studentUpload} carries a layout map, but an electronic assignment generates none`);
  }
  return problems;
};

/**
 * THE PACKAGE, RE-OPENED AND CHECKED AS A CONSUMER WOULD OPEN IT.
 *
 * Everything `buildStudentEntries` and `embeddedLayoutProblems` enforce is
 * checked before packaging, over the entry map. This runs *after*, over the
 * bytes of the zip that will actually ship — because packaging is itself a step
 * that can go wrong, and a check that stops at the entry map cannot see a
 * mistake made while writing the archive.
 *
 * It is not a restatement of the earlier checks. A prefix added during
 * packaging, an entry written twice, an instructor file appended after the
 * filter ran, or a spec re-encoded on the way in are all invisible upstream and
 * all visible here.
 *
 * **Exported because it cannot be reached through `buildOuterEntries`**: the
 * upstream checks refuse a bad entry map first, so every doctored-entries test
 * is caught before packaging ever runs. Reaching this one means handing it zip
 * bytes directly. Extracted so it is a guard the suite can actually exercise
 * rather than dead code that merely looks like one — the same lesson
 * `loaderContractProblems` taught by failing it.
 *
 * **It returns the names it read, and its caller reports those**, so what the
 * instructor is told the package holds is read back out of the zip rather than
 * taken from the entry map that fed it.
 *
 * **Its RULES are covered; its WIRING is not, and that is measured rather than
 * assumed.** Stubbing the call out of `buildOuterEntries` fails no check —
 * because packaging is a faithful copy today, so the packaged names and the
 * entry-map names are always the same and the stub is an equivalent mutant.
 * There is no input that distinguishes them. That is precisely the condition
 * under which this check earns its keep in future and not today: it is here for
 * the first change that makes packaging do something, and on that day it starts
 * being reachable. Do not read its five direct checks as covering the call.
 */
export const packagedStudentZipProblems = async (
  innerBytes: Uint8Array,
  entries: Record<string, Blob | string>,
  assignment: Assignment
): Promise<{ problems: string[]; names: string[] }> => {
  const problems: string[] = [];
  const { studentPdf, studentUpload } = exportFilenames(assignment);

  const opened = await JSZip.loadAsync(innerBytes);
  const names = Object.keys(opened.files).filter(n => !opened.files[n].dir).sort();

  const expected = [studentPdf, studentUpload].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    problems.push(
      `the packaged student ZIP holds ${JSON.stringify(names)}, not ${JSON.stringify(expected)}`);
  }
  for (const n of names) {
    if (n.includes('/') || n.includes('\\')) {
      problems.push(`"${n}" is not at the student ZIP's root — the package is flat`);
    }
    if (n.startsWith(INSTRUCTOR_DIR)) problems.push(`"${n}" is instructor material`);
    if (n === DISTRIBUTION_NOTICE_NAME) problems.push(`the instructor-only notice is in the student ZIP`);
    if (/_grading_rubric\.json$|_grader_document\.html$|_authoring_backup\.json$|\.md$/.test(n)) {
      problems.push(`"${n}" is answer-bearing and is inside the file the instructor attaches`);
    }
  }

  // The map, read back out of the packaged spec rather than out of the entry
  // map. This is the one number that is printed on paper.
  if (assignment.inputMode === 'handwritten' && names.includes(studentUpload)) {
    const csvPath = Object.keys(entries).find(n => /^instructor\/layout_.*\.csv$/.test(n));
    const spec = await decryptJson(await opened.file(studentUpload)!.async('string')) as Record<string, unknown>;
    if (!csvPath) {
      problems.push(`the export has no ${INSTRUCTOR_DIR}layout_*.csv to compare the packaged map against`);
    } else if (spec.layoutCsv !== entries[csvPath]) {
      problems.push(
        `the map inside the packaged ${studentUpload} is not byte-identical to ${csvPath} — ` +
        'it did not survive packaging intact');
    }
  }
  return { problems, names };
};

/**
 * THE OUTER ARCHIVE, as path → content, with the student package inside it.
 *
 * Split out from the download for the same reason `buildExportEntries` is: the
 * archive an instructor receives can then be asserted without a browser, over
 * the bytes rather than over the intention.
 *
 * **The two student files live in exactly one place**, inside
 * `{stem}_FOR_STUDENTS.zip`, so the outer archive cannot come to hold a second,
 * drifting copy of the spec and there is nothing loose for an instructor to post
 * by mistake — or, worse, to attach only half of. The package is built by
 * filtering the SAME `entries` map, through `buildStudentEntries`, which refuses
 * rather than emitting anything unsafe, and it is re-opened and checked again
 * once written.
 */
export const buildOuterEntries = async (
  entries: Record<string, Blob | string>,
  assignment: Assignment
): Promise<{
  outer: Record<string, Blob | string | Uint8Array>;
  studentZipName: string;
  studentNames: string[];
}> => {
  // Asserted before a byte is written; throws if the package would be unsafe.
  const student = buildStudentEntries(entries, assignment);

  const mapProblems = await embeddedLayoutProblems(entries, assignment);
  if (mapProblems.length) {
    throw new Error(
      'Export stopped: the layout map inside the student file does not match the one this export writes.\n' +
      mapProblems.map(p => `  • ${p}`).join('\n'));
  }

  const innerZip = new JSZip();
  for (const [name, content] of Object.entries(student)) {
    await addZipEntry(innerZip, name, content);
  }
  const innerBytes = await innerZip.generateAsync({ type: 'uint8array' });

  // ...and again, over what packaging actually produced. `packagedNames` is what
  // the instructor is told the package holds — read back out of the zip, not
  // taken from the entry map that fed it.
  const { problems: packagedProblems, names: packagedNames } =
    await packagedStudentZipProblems(innerBytes, entries, assignment);
  if (packagedProblems.length) {
    throw new Error(
      'Export stopped: the packaged student ZIP would not have been safe to post.\n' +
      packagedProblems.map(p => `  • ${p}`).join('\n'));
  }

  const studentZipName = exportFilenames(assignment).studentZip;
  const outer: Record<string, Blob | string | Uint8Array> = {
    [DISTRIBUTION_NOTICE_NAME]: entries[DISTRIBUTION_NOTICE_NAME],
    [studentZipName]: innerBytes,
  };
  for (const [name, content] of Object.entries(entries)) {
    if (name.startsWith(INSTRUCTOR_DIR)) outer[name] = content;
  }

  // Assert the RESULT, not the loop above: no loose student file, and nothing
  // outside the notice, the student package and instructor/.
  const stray = Object.keys(outer).filter(
    n => n !== DISTRIBUTION_NOTICE_NAME && n !== studentZipName && !n.startsWith(INSTRUCTOR_DIR));
  if (stray.length) {
    throw new Error(
      'Export stopped: the instructor archive holds files that belong nowhere in it.\n' +
      stray.map(n => `  • "${n}"`).join('\n'));
  }
  return { outer, studentZipName, studentNames: packagedNames };
};

export const exportService = {
  downloadZIP: async (assignment: Assignment) => {
    // Asks before rescaling, and throws RescaleDeclinedError if told not to —
    // before the ZIP is built, so declining writes nothing.
    assignment = normalizePointsConfirmed(assignment);
    const entries = await buildExportEntries(assignment);
    // Asserted before a byte is written: if the student package would be unsafe
    // to post, or the embedded map and the instructor's copy disagree, that is a
    // fact about this assignment and the whole export stops.
    const { outer, studentZipName, studentNames } = await buildOuterEntries(entries, assignment);

    const zip = new JSZip();
    for (const [name, content] of Object.entries(outer)) {
      if (name === studentZipName) {
        // STORED, not deflated. It is already a compressed archive: deflating it
        // again costs time on every export and saves nothing. A deliberate
        // exception to the archive default set below.
        zip.file(name, content as Uint8Array, { compression: 'STORE' });
      } else {
        await addZipEntry(zip, name, content as Blob | string);
      }
    }
    const filename = exportFilenames(assignment).instructorZip;
    // DEFLATE for the archive as a whole. JSZip's default is STORE, so until
    // 2026-09-06 this export was written uncompressed — and the bulk of it is
    // the grader document, the rubric, the backup and the `.md`, which are all
    // text and compress by roughly four to one. It also makes the STORE above
    // load-bearing rather than a restatement of the default: with the archive
    // deflating, removing it really would recompress the student package.
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    saveOne(blob, filename);
    // The bytes are returned, not just the intent, so a test can open the
    // artifact this function exists to produce rather than assert that it meant
    // to produce one.
    return { filename, studentZipName, studentNames, blob };
  },

  // REMOVED 2026-09-06: `downloadStudentZip` and `downloadStudentPdf`.
  //
  // They were separate downloads behind separate buttons, which is how the
  // export came to cost three deliberate gestures. Both artifacts still exist
  // and are still built from the same entry map — the student package is an
  // entry inside the instructor archive, and the PDF is inside that. Nothing is
  // lost; what is gone is the opportunity to download the wrong one.

  downloadMd: (assignment: Assignment) => {
    // `assignmentToMd` normalises internally, and the .md carries the scaled
    // values forward — this is the route whose damage shows up one cycle later,
    // so it asks like the rest.
    const md = assignmentToMd(normalizePointsConfirmed(assignment));
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  },

  downloadGraderDoc: async (assignment: Assignment) => {
    const html = await generateGraderHTML(normalizePointsConfirmed(assignment));
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}_grader_document.html`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * The printable QR template and its sidecar, on their own.
   *
   * **One ZIP, not two downloads.** The PDF is useless to the Submission app
   * without the map its QR hashes to, and two `a.click()` calls in a row trip
   * Chrome's "Download multiple files?" prompt — decline it, or miss it, and you
   * are left holding a template whose map silently never arrived. That failure
   * would surface at grading time, not at download time. A single archive cannot
   * come apart.
   *
   * Returns the self-test report so the caller can surface warnings (a shortened
   * writing area, say) that did not block emission.
   */
  downloadQrTemplate: async (assignment: Assignment) => {
    const template = await generateTemplate(normalizePointsConfirmed(assignment));

    const zip = new JSZip();
    zip.file(template.pdfFilename, template.pdf);
    zip.file(template.csvFilename, template.csv);
    const zipFilename = `${template.assignmentId}_qr_template.zip`;
    const content = await zip.generateAsync({ type: 'blob' });

    const save = (FileSaver as any).saveAs || FileSaver;
    save(content, zipFilename);

    return { ...template, zipFilename };
  }
};
