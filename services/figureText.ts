/**
 * figureText.ts — a figure as words, for the AI grader's copy of the stem.
 *
 * **Grader-facing only.** Everything a student sees still inlines the real
 * drawing: the Maker preview, `assignment.html`, `assignment.pdf`, the
 * handwritten template and the Student app are untouched, and the authored `.md`
 * still carries the full `<svg>`. Only `problem_statement` in the grading rubric
 * JSON loses the path data.
 *
 * Why. §11 sends the stem verbatim into every rubric entry, figure included.
 * ENG17 measured what that costs: ~143k tokens of `<path d="…">` geometry per
 * student per full grading pass (HW1 32k, HW2 55k, HW3 55k) — about a million
 * tokens across a class of 30 — carried so that a grader **forbidden by policy
 * to reason from the drawing** may decline to use it.
 *
 * A `<desc>` written under the "describe only what a sighted student can see"
 * rule is a few hundred bytes, more useful to a model than coordinates, and
 * leaks strictly less than the full geometry. No clause's verdict depends on
 * reading the drawing and prompts stay figure-agnostic, so this removes nothing
 * the grader was allowed to use.
 *
 * It degrades rather than blocks while the `<desc>` set is being authored:
 * `<desc>` → title and desc; `<title>` only → the title; neither → `[figure]`.
 * Correct today, more useful as each description lands.
 */

import { Figure, figureLabel, splitFigures } from './figureBlocks';

/**
 * The document's `<desc>`, flattened to one line.
 *
 * The first one only: SVG allows a `<desc>` on any container, and by convention
 * the first belongs to the document while later ones annotate parts of it.
 */
export const svgDesc = (svg: string): string => {
  const m = svg.match(/<desc[^>]*>([\s\S]*?)<\/desc\s*>/i);
  return m ? m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : '';
};

/**
 * One figure, as the words that describe it. Never markup — the point is that
 * no `<svg>` or `<path>` reaches the grader's context.
 */
export const figureToDescText = (figure: Figure): string => {
  if (figure.form === 'image') {
    // A Markdown image has no title/desc to read; its alt text is the same
    // promise, written in the same place a screen reader would look.
    const alt = figure.alt.trim();
    return alt ? `[Figure: ${alt}]` : '[figure]';
  }

  const title = figureLabel(figure);
  const desc = svgDesc(figure.svg);
  if (title && desc) return `[Figure — ${title}: ${desc}]`;
  if (title) return `[Figure: ${title}]`;
  if (desc) return `[Figure: ${desc}]`;
  return '[figure]';
};

/**
 * The stem with every drawing replaced by its own description.
 *
 * Prose segments are kept verbatim and in place, so the result reads as the
 * problem it is. A stem with no figure comes back byte-for-byte unchanged —
 * `splitFigures` reassembles exactly — so rubrics for figure-free assignments
 * do not move.
 */
export const stemForGrader = (stem: string): string =>
  splitFigures(stem)
    .map(seg => (seg.kind === 'text' ? seg.value : figureToDescText(seg.figure)))
    .join('');
