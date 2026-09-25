// =====================================================
// EXTRACT FIGURES — inline SVG into files, changing nothing
// =====================================================
// All thirty ENG17 figures are inline SVG, and they must keep importing exactly
// as they do now. **There is no forced migration.** Extraction is an action the
// instructor chooses to run, and it is how a colleague gets files they can swap
// without editing a `.md`.
//
// THE PROPERTY THAT MAKES IT SAFE
//
// Extracting a figure and resolving it again must put back the same bytes. The
// figure file holds the SVG document verbatim, and `inlineFormFor` rebuilds the
// fence around it, so the resolved text is what it was — which is why the
// student spec can be asserted byte-identical before and after. That assertion
// is the whole point: it is what proves extraction changes nothing a student or
// a scanner can see.
//
// **A figure that cannot make that promise is left inline.** Two cases: an SVG
// with no `<title>` or no `<desc>`, because a block without a desc takes away
// the grader's only view of the figure; and, as a belt-and-braces check, any
// fence this module cannot rebuild character for character.

import { Assignment, FigureFile, FigureMap } from '../types';
import { splitFigures } from './figureBlocks';
import { svgDesc } from './figureText';
import { figureLabel } from './figureBlocks';
import { FIGURE_ID_RE, inlineFormFor } from './figureRefs';

/** One figure that was turned into a file. */
export interface ExtractedFigure {
  id: string;
  problemNumber: number;
  title: string;
}

/** One figure that was deliberately not touched, and why. */
export interface LeftInline {
  problemNumber: number;
  /** What the figure is called, when it is called anything. */
  label: string;
  reason: string;
}

export interface ExtractionResult {
  assignment: Assignment;
  extracted: ExtractedFigure[];
  leftInline: LeftInline[];
}

/**
 * Which figure to extract, when not all of them: the problem, and the
 * figure's position among that problem's inline figures (`splitFigures`
 * order, counting from 0). Used by Replace on an inline figure's card, so an
 * instructor can swap a drawing without first knowing to run Extract figures
 * (Supplement 2, item 6).
 */
export interface ExtractOnly { problemIndex: number; figureIndex: number }

/**
 * Why an inline figure could not become a file, or `null` when it can. The
 * same reasons `extractFigures` reports, so a card can say it before the
 * instructor tries.
 */
export const inlineFigureBlocker = (seg: { kind: 'figure'; figure: import('./figureBlocks').Figure }): string | null => {
  if (seg.figure.form !== 'svg') {
    return 'it is already an image rather than a drawing, so there is nothing to lift out';
  }
  const title = figureLabel(seg.figure).trim();
  const desc = svgDesc(seg.figure.svg).trim();
  if (!title && !desc) return 'it has neither a <title> nor a <desc>';
  if (!title) return 'it has no <title>';
  if (!desc) return 'it has no <desc>, which is the only thing the grader sees of a figure';
  return null;
};

const utf8ToBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  if (typeof btoa === 'function') {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
};

/**
 * Turn every eligible inline SVG into a figure block plus a figure file.
 *
 * Ids are `p<problem>-fig<n>`, numbered from 1 within each problem, so they are
 * predictable from the assignment rather than from the order of extraction.
 * A raster `data:` image is left alone: it is already a file in all but name,
 * and re-encoding it would be a change with nothing to gain.
 */
export const extractFigures = (assignment: Assignment, only?: ExtractOnly): ExtractionResult => {
  const figures: FigureMap = { ...(assignment.figures || {}) };
  const extracted: ExtractedFigure[] = [];
  const leftInline: LeftInline[] = [];

  const problems = (assignment.problems || []).map((problem, pIdx) => {
    const problemNumber = pIdx + 1;
    const segs = splitFigures(problem.description || '');
    if (!segs.some(s => s.kind === 'figure')) return problem;
    if (only && only.problemIndex !== pIdx) return problem;

    let figureIndex = -1;
    const rebuilt = segs.map(seg => {
      if (seg.kind !== 'figure') return seg.value;
      figureIndex += 1;
      // Extracting one figure leaves every other figure exactly as it was.
      if (only && only.figureIndex !== figureIndex) return seg.source;
      if (seg.figure.form !== 'svg') {
        leftInline.push({
          problemNumber,
          label: figureLabel(seg.figure) || '(an image)',
          reason: 'it is already an image rather than a drawing, so there is nothing to lift out',
        });
        return seg.source;
      }

      const title = figureLabel(seg.figure).trim();
      const desc = svgDesc(seg.figure.svg).trim();
      if (!title || !desc) {
        // NOT extracted with blank fields. A block with no desc removes the
        // grader's only view of the figure, which is a worse outcome than a
        // figure that stayed inline.
        leftInline.push({
          problemNumber,
          label: title || '(untitled)',
          reason: !title && !desc ? 'it has neither a <title> nor a <desc>'
            : !title ? 'it has no <title>'
              : 'it has no <desc>, which is the only thing the grader sees of a figure',
        });
        return seg.source;
      }

      // THE FIRST FREE NUMBER in this problem, not a running count. A count
      // restarted at 1 on every run, so a problem that gained a drawing after
      // an earlier extraction would have been given `p1-fig1` again and
      // overwritten the file already stored under it. On a problem with no
      // files yet the two agree, so every id extracted before this is
      // unchanged.
      let n = 1;
      while (figures[`p${problemNumber}-fig${n}`]) n += 1;
      const id = `p${problemNumber}-fig${n}`;
      if (!FIGURE_ID_RE.test(id)) {
        leftInline.push({ problemNumber, label: title, reason: `the id ${id} is not usable as a filename` });
        return seg.source;
      }

      const file: FigureFile = {
        format: 'svg',
        base64: utf8ToBase64(seg.figure.svg),
        filename: `${id}.svg`,
      };

      // THE BELT-AND-BRACES CHECK. Resolution must put back exactly what was
      // there — not nearly. A fence written with trailing whitespace, say,
      // would come back normalised, and the student spec would differ by those
      // bytes. Rather than accept a difference nobody would notice until a
      // hash moved, the figure stays inline and is reported.
      if (inlineFormFor({ id, title, desc }, file) !== seg.source) {
        leftInline.push({
          problemNumber,
          label: title,
          reason: 'extracting it would not reproduce the original text exactly',
        });
        return seg.source;
      }

      figures[id] = file;
      extracted.push({ id, problemNumber, title });
      return ['```figure', `id: ${id}`, `title: ${title}`, `desc: ${desc}`, '```'].join('\n');
    }).join('');

    return { ...problem, description: rebuilt };
  });

  const next: Assignment = { ...assignment, problems };
  if (Object.keys(figures).length) next.figures = figures;
  return { assignment: next, extracted, leftInline };
};

/** What the instructor is shown after extraction. */
export const describeExtraction = (result: ExtractionResult): string => {
  const lines: string[] = [];
  lines.push(result.extracted.length
    ? `${result.extracted.length} figure${result.extracted.length === 1 ? '' : 's'} extracted into files:`
    : 'No figures were extracted.');
  for (const f of result.extracted) lines.push(`  figures/${f.id}.svg — ${f.title}`);

  if (result.leftInline.length) {
    lines.push('');
    lines.push(`${result.leftInline.length} left inline, unchanged:`);
    for (const f of result.leftInline) {
      lines.push(`  Problem ${f.problemNumber}, ${f.label} — ${f.reason}`);
    }
    lines.push('');
    lines.push('A figure needs both a <title> and a <desc> to become a file: the desc is the '
      + 'only thing the grader ever sees of it. Add them to the drawing and run this again.');
  }

  if (result.extracted.length) {
    lines.push('');
    lines.push('Nothing students see has changed. Export .md now writes a zip holding the .md '
      + 'and its figures/ folder.');
  }
  return lines.join('\n');
};
