
import { Assignment, SubmissionType } from '../types';
import { encryptJson, normalizeCoursePublicKey, validateCoursePublicKey } from './cryptoService';
import { escapeHtml, hasMath, katexStylesheet, renderTextToCanvas, toHtml, toLatexBody, toPdfText } from './mathRender';
import { generateTemplate } from './templateGenerator';
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
  SubmissionType.AI_FORMATIVE,
]);

const MIN_WORDS_BY_TYPE: Partial<Record<SubmissionType, number>> = {
  [SubmissionType.AI_GRADED_BINARY]: 20,
  [SubmissionType.AI_GRADED_SHORT]:  50,
  [SubmissionType.AI_GRADED_MEDIUM]: 100,
  [SubmissionType.AI_GRADED_LONG]:   150,
};

/**
 * Scale all subsection point values so they sum to assignment.targetPoints (default 100).
 * Rounding error is absorbed by the highest-point subsection.
 * Returns a new Assignment — does not mutate the input.
 */
const normalizePoints = (assignment: Assignment): Assignment => {
  const target = assignment.targetPoints || 100;
  const allSubs = assignment.problems.flatMap(p => p.subsections);
  const total = allSubs.reduce((sum, s) => sum + s.points, 0);
  if (total === 0 || total === target) return assignment;

  const scaled = allSubs.map(s => Math.round(s.points * target / total));

  const diff = target - scaled.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    const maxIdx = scaled.reduce((maxI, v, i, arr) => v > arr[maxI] ? i : maxI, 0);
    scaled[maxIdx] += diff;
  }

  let idx = 0;
  return {
    ...assignment,
    problems: assignment.problems.map(p => ({
      ...p,
      subsections: p.subsections.map(s => ({ ...s, points: scaled[idx++] }))
    }))
  };
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
    case SubmissionType.AI_FORMATIVE:
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
const NAME_ID_LINE = 'Student Name: ______________________________   Student ID: __________________';
const TOP: { baseline: 'top' } = { baseline: 'top' };

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

  if (hasMath(text)) {
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

  const nameIdLine = () => {
    doc.setFont('times', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(0);
    doc.text(NAME_ID_LINE, margin, 15, TOP);
  };
  const newPage: PageBreak = () => {
    doc.addPage();
    nameIdLine();
    return 30;
  };

  // --- COVER PAGE ---

  nameIdLine();
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
        nameIdLine();
        y = 30;

        // Header: Problem info (Repeated on every page for clarity)
        y = await addRichText(doc, `Problem ${pIndex + 1}: ${prob.name}`, margin, y, contentWidth, 7,
          { fontPt: 14, bold: true }, newPage);

        // Problem description, kept compact — it repeats on every page of the problem.
        if (prob.description && y < 50) {
          const style: RichStyle = { fontPt: 10, grey: 100 };
          applyStyle(doc, style);
          const wrapped: string[] = doc.splitTextToSize(toPdfText(prob.description), contentWidth);
          if (wrapped.length > DESC_PREVIEW_LINES) {
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
      <p class="authored">${toHtml(p.description || '')}</p>
      ${p.subsections.map((s, j) => `
        <div class="subsection">
          <h4>(${String.fromCharCode(97 + j)}) ${toHtml(s.name)} <span class="points">[${s.points} pts]</span></h4>
          <p class="authored">${toHtml(s.description || '')}</p>
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

% ---- Student Information ----
\\noindent\\textbf{Student Name:} \\underline{\\hspace{6cm}} \\hfill \\textbf{Student ID:} \\underline{\\hspace{4cm}}

\\vspace{1.5em}

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
      const isAi = AI_GRADED_TYPES.has(sub.submissionType);
      const isFormative = sub.submissionType === SubmissionType.AI_FORMATIVE;
      const isImage = sub.submissionType === SubmissionType.IMAGE;
      const isTextAndImage = sub.submissionType === SubmissionType.TEXT_AND_IMAGE;
      const isHandwritten = sub.submissionType === SubmissionType.HANDWRITTEN;
      const isAiHandwritten = isHandwritten && (sub.handwrittenGradingMode ?? 'ai') !== 'human';
      const subsectionLetter = String.fromCharCode(97 + sIndex);
      const minWords = MIN_WORDS_BY_TYPE[sub.submissionType];

      rubrics[subsectionId] = {
        subsection_id: subsectionId,
        problem_number: pIndex + 1,
        problem_name: prob.name,
        subsection_letter: subsectionLetter,
        subsection_name: sub.name,
        display_name: `Problem ${pIndex + 1}(${subsectionLetter}): ${sub.name}`,
        max_points: sub.points,
        // Handwritten is checked first: pages are cropped per region, so it never
        // falls through to the image or plain-human branches.
        grading_type: isHandwritten
            ? (sub.handwrittenGradingMode === 'human' ? 'human_handwritten' : 'ai_handwritten')
          : isFormative ? 'ai_formative'
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
    ai_grading_config: {
      model: assignment.aiGradingConfig?.model || 'claude-haiku-4-5-20251001',
      temperature: assignment.aiGradingConfig?.temperature ?? 0.1,
      max_tokens: assignment.aiGradingConfig?.maxTokens || 1024
    },
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
  [SubmissionType.AI_FORMATIVE]:     'ai-graded:formative',
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
      if (isHandwritten && (sub.answerSpace || sub.isDrawing)) {
        const opts = [
          ...(sub.answerSpace ? [`space=${sub.answerSpace}`] : []),
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
          ${sub.description ? `<p class="sub-desc">${toHtml(sub.description)}</p>` : ''}
          ${referenceBlock}
        </div>`;
    }).join('');

    return `
      <div class="problem">
        <div class="prob-header">
          <span class="prob-num">Problem ${pIdx + 1}: ${toHtml(prob.name)}</span>
          <span class="prob-pts">${problemPoints} pts</span>
        </div>
        ${prob.description ? `<p class="prob-desc">${toHtml(prob.description)}</p>` : ''}
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
// The spec is the Assignment object itself. `coursePublicKey` is the one
// field with conditional presence: when set it is carried verbatim so the
// Student Submission app switches to gb2; when unset the field is omitted
// entirely, leaving the spec identical to pre-gb2 exports (→ gb1).
export const buildAssignmentSpec = async (assignment: Assignment): Promise<Assignment> => {
  const { coursePublicKey, ...withoutKey } = assignment;
  const pem = normalizeCoursePublicKey(coursePublicKey || '');
  if (!pem) return withoutKey as Assignment;

  // A malformed key would silently produce unreadable submissions — stop instead.
  const check = await validateCoursePublicKey(pem);
  if (!check.ok) {
    throw new Error(`Export stopped: the course public key on this assignment is not valid. ${check.error}`);
  }

  return { ...(withoutKey as Assignment), coursePublicKey: pem };
};

export const exportService = {
  downloadZIP: async (assignment: Assignment) => {
    const zip = new JSZip();
    assignment = normalizePoints(assignment);

    // 1. Spec JSON — encoded with AES-256-GCM so students cannot read or edit it.
    //    The Student Submission app decodes it transparently on load.
    //    Assignment Maker's "Import JSON" also handles encoded files.
    zip.file('assignment_spec.json', await encryptJson(await buildAssignmentSpec(assignment)));

    // 2. Student PDF
    const studentPdf = await createPDF(assignment, 'student');
    zip.file('assignment.pdf', studentPdf);

    // 3. Template PDF
    const templatePdf = await createPDF(assignment, 'template');
    zip.file('template.pdf', templatePdf);

    // 4. HTML
    const html = await generateHTML(assignment);
    zip.file('assignment.html', html);

    // 5. LaTeX (editable source file for instructors)
    const latex = generateLaTeX(assignment);
    zip.file('assignment.tex', latex);

    // 6. Grading Rubric JSON (private — for autograder only)
    const rubric = generateGradingRubric(assignment);
    const rubricFilename = `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}_grading_rubric.json`;
    zip.file(rubricFilename, JSON.stringify(rubric, null, 2));

    // 7. Grader Document HTML (private — instructor/TA reference with rubrics and answer keys)
    const graderDoc = await generateGraderHTML(assignment);
    const graderDocFilename = `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}_grader_document.html`;
    zip.file(graderDocFilename, graderDoc);

    // 8. Page-format QR template + its sidecar map — handwritten assignments only.
    //    This is the sheet the student prints, writes on and photographs; the
    //    sidecar is what the Submission app crops by. generateTemplate() runs the
    //    spec 8.7 self-test and throws rather than emitting a bad template, so a
    //    failure here stops the whole export, which is the intent.
    if (assignment.inputMode === 'handwritten') {
      const template = await generateTemplate(assignment);
      zip.file(template.pdfFilename, template.pdf);
      zip.file(template.csvFilename, template.csv);
    }

    const content = await zip.generateAsync({ type: 'blob' });

    // Handle file-saver import differences (default export vs named export property)
    const save = (FileSaver as any).saveAs || FileSaver;
    save(content, `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}_Export.zip`);
  },

  downloadMd: (assignment: Assignment) => {
    const md = assignmentToMd(assignment);
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  },

  downloadGraderDoc: async (assignment: Assignment) => {
    const html = await generateGraderHTML(normalizePoints(assignment));
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}_grader_document.html`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /**
   * The printable QR template and its sidecar, on their own. Both files must
   * travel together: the PDF is useless to the Submission app without the map
   * its QR hashes to. Returns the self-test report so the caller can surface any
   * warnings (a shortened writing area, say) that did not block emission.
   */
  downloadQrTemplate: async (assignment: Assignment) => {
    const template = await generateTemplate(normalizePoints(assignment));
    const drop = (data: Blob | string, filename: string, type: string) => {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    };
    drop(template.pdf, template.pdfFilename, 'application/pdf');
    drop(template.csv, template.csvFilename, 'text/csv');
    return template;
  }
};
