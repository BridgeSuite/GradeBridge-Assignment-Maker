// =====================================================
// FIGURE BLOCKS — a figure referred to by id, not contained
// =====================================================
// An instructor working from their own textbook will want to swap a drawing,
// often for a scan in a different format. Until now a figure was either a whole
// SVG document inline in the `.md` or a Markdown image whose URL had to be a
// base64 `data:` URI to keep the file self-contained. Neither can be edited by
// hand, so replacing a figure meant regenerating the assignment.
//
// A figure block names the drawing instead of carrying it:
//
//   ```figure
//   id: p1-divider
//   title: Voltage divider for Problem 1
//   desc: Two resistors R1 and R2 in series across a 12 V source.
//   ```
//
// and the drawing lives in `figures/<id>.svg|.png|.jpg` beside the `.md`.
// Replacing it, format included, means replacing that file. The `.md` does not
// change.
//
// WHY `title` AND `desc` LIVE IN THE BLOCK AND NOT IN THE IMAGE
//
// **`desc` is the only thing the grader ever sees of a figure.** The rubric
// reduces every figure to its words and never carries the drawing — ENG17
// measured the alternative at ~143k tokens of `<path d="…">` per student per
// grading pass. Today those words come from the SVG's own `<title>` and
// `<desc>`, and **a PNG has neither**. Keeping them in the `.md` is what lets a
// format swap leave the grader's view of the question completely untouched.
//
// WHY THIS FILE EXISTS AT ALL, RATHER THAN A NEW FENCE IN `figureBlocks.ts`
//
// `services/figureBlocks.ts` is mirrored byte-for-byte into the Student
// Submission app and a test in each repo fails if the copies drift. Teaching it
// this fence would mean shipping the Assignment Maker's authoring concern into
// the student's bundle, where there is nothing to resolve a reference against.
//
// So resolution happens HERE, and it happens BEFORE `splitFigures()` ever runs.
// A resolved SVG block is a ```svg fence holding the file's bytes; a resolved
// raster is an image line with a `data:` URI. After resolution the text is
// exactly what an instructor would have authored inline, so every consumer
// downstream — `figureBlocks.ts` included — needs no changes and sees no
// difference. `assignment_spec.json` therefore never contains a figure block,
// and every export stays self-contained.

import { Assignment, FigureFile, FigureMap, Problem } from '../types';

/** ```` ```figure ```` on its own line opens a block; a bare ```` ``` ```` closes it. */
export const FIGURE_REF_OPEN_RE = /^[ \t]*```[ \t]*figure[ \t]*$/i;
export const FIGURE_REF_CLOSE_RE = /^[ \t]*```[ \t]*$/;

/**
 * Ids name a file on disk, so they are deliberately narrow: lowercase letters,
 * digits and hyphens. No dots, no slashes, no spaces, nothing that changes
 * meaning in a path or a zip entry.
 */
export const FIGURE_ID_RE = /^[a-z0-9-]{1,40}$/;

/** The formats a figure file may be in. Anything else is refused by the guards. */
export const FIGURE_FORMATS = ['svg', 'png', 'jpg'] as const;
export type FigureFormat = (typeof FIGURE_FORMATS)[number];

export const FIGURE_MEDIA_TYPE: Record<FigureFormat, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
};

/** What one ```figure block says. */
export interface FigureRef {
  id: string;
  title: string;
  desc: string;
}

/** A parsed block, with the authored source so a replacement can be exact. */
export interface FigureRefSeg {
  ref: FigureRef;
  /** The block verbatim, without its trailing newline. */
  source: string;
}

/** What is wrong with a block, in the author's terms. Empty when it is fine. */
export const figureRefProblems = (ref: Partial<FigureRef>): string[] => {
  const problems: string[] = [];
  if (!ref.id) problems.push('it has no `id:` line');
  else if (!FIGURE_ID_RE.test(ref.id)) {
    problems.push(`its id ${JSON.stringify(ref.id)} is not usable as a filename `
      + '(lowercase letters, digits and hyphens, 1 to 40 characters)');
  }
  // Both are required, and `desc` is required for a reason worth repeating at
  // the point of refusal: without it the grader has no view of the figure at
  // all, and the question silently becomes one nobody can mark.
  if (!ref.title) problems.push('it has no `title:` line');
  if (!ref.desc) problems.push('it has no `desc:` line, which is the only thing the grader sees of the figure');
  return problems;
};

/**
 * Every figure block in a piece of text, in order.
 *
 * Unknown keys inside a block are ignored rather than refused: the block is a
 * small key-value list and a future key must not make an older app reject a
 * file it could otherwise read.
 */
export const parseFigureRefs = (text: string): FigureRefSeg[] => {
  if (!text) return [];
  const lines = text.split('\n');
  const out: FigureRefSeg[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!FIGURE_REF_OPEN_RE.test(lines[i])) continue;
    let end = i + 1;
    while (end < lines.length && !FIGURE_REF_CLOSE_RE.test(lines[end])) end++;
    const closed = end < lines.length;
    const body = lines.slice(i + 1, end);

    const ref: Partial<FigureRef> = {};
    for (const line of body) {
      const m = line.match(/^[ \t]*([a-z]+)[ \t]*:[ \t]*(.*)$/i);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (key === 'id') ref.id = value;
      else if (key === 'title') ref.title = value;
      else if (key === 'desc') ref.desc = value;
    }

    out.push({
      ref: { id: ref.id ?? '', title: ref.title ?? '', desc: ref.desc ?? '' },
      source: lines.slice(i, closed ? end + 1 : end).join('\n'),
    });
    i = closed ? end : lines.length - 1;
  }
  return out;
};

/** True when the text carries at least one figure block. */
export const hasFigureRef = (text: string): boolean =>
  !!text && FIGURE_REF_OPEN_RE.test(text) ? parseFigureRefs(text).length > 0
    : !!text && text.split('\n').some(l => FIGURE_REF_OPEN_RE.test(l));

/** Every id referred to anywhere in an assignment, in first-seen order. */
export const referencedFigureIds = (assignment: Pick<Assignment, 'problems'>): string[] => {
  const seen: string[] = [];
  for (const problem of assignment.problems || []) {
    for (const { ref } of parseFigureRefs(problem.description || '')) {
      if (ref.id && !seen.includes(ref.id)) seen.push(ref.id);
    }
  }
  return seen;
};

/**
 * Split text into figure blocks and everything else, exactly parallel to
 * `splitFigures` in `figureBlocks.ts`.
 *
 * Concatenating the pieces reproduces the input, which is what the `.md` round
 * trip depends on. The parser needs this because a figure block is not a figure
 * as far as `figureBlocks.ts` is concerned, so without it the block's lines
 * would be handed to the description's line filter as ordinary prose and come
 * back reflowed.
 */
export const splitFigureRefs = (text: string): Array<
  { kind: 'text'; value: string } | { kind: 'ref'; ref: FigureRef; source: string }
> => {
  if (!text) return [];
  const lines = text.split('\n');
  const out: Array<{ kind: 'text'; value: string } | { kind: 'ref'; ref: FigureRef; source: string }> = [];
  let buf: string[] = [];

  const flush = () => {
    if (buf.length) { out.push({ kind: 'text', value: buf.join('\n') }); buf = []; }
  };

  for (let i = 0; i < lines.length; i++) {
    if (!FIGURE_REF_OPEN_RE.test(lines[i])) { buf.push(lines[i]); continue; }
    let end = i + 1;
    while (end < lines.length && !FIGURE_REF_CLOSE_RE.test(lines[end])) end++;
    const closed = end < lines.length;
    const source = lines.slice(i, closed ? end + 1 : end).join('\n');
    flush();
    out.push({ kind: 'ref', ref: parseFigureRefs(source)[0]?.ref ?? { id: '', title: '', desc: '' }, source });
    i = closed ? end : lines.length - 1;
  }
  flush();
  return out;
};

/** `data:image/png;base64,…` for a raster figure file. */
export const figureDataUri = (file: FigureFile): string =>
  `data:${FIGURE_MEDIA_TYPE[file.format]};base64,${file.base64}`;

const decodeBase64 = (b64: string): string => {
  if (typeof atob === 'function') {
    const bytes = atob(b64);
    // The SVG is UTF-8; `atob` gives one char per byte, so widen it properly
    // rather than assuming the drawing is ASCII. A degree sign or an ohm in a
    // label would otherwise come back mangled.
    const arr = Uint8Array.from(bytes, c => c.charCodeAt(0));
    return new TextDecoder().decode(arr);
  }
  // Node, in the test suite and the converter's parity checks.
  return Buffer.from(b64, 'base64').toString('utf8');
};

/** The SVG document a figure file holds, verbatim. */
export const figureSvgSource = (file: FigureFile): string => decodeBase64(file.base64);

/**
 * One figure block replaced by the inline figure it refers to.
 *
 * An SVG becomes the ```svg fence it would have been authored as, holding the
 * file's bytes unchanged — which is what makes extraction (§6.2) provably
 * invisible: extract a figure and resolve it again and the text is what it was.
 * A raster becomes an image line whose alt text is the block's title, because
 * alt text is where a screen reader looks and the title is what it should say.
 */
export const inlineFormFor = (ref: FigureRef, file: FigureFile): string =>
  file.format === 'svg'
    ? ['```svg', figureSvgSource(file), '```'].join('\n')
    : `![${ref.title}](${figureDataUri(file)})`;

/**
 * Replace every figure block in a piece of text with its inline figure.
 *
 * A block whose file is missing is left exactly as it is. Resolution is not the
 * place to refuse: import already refuses a block with no file (§4.1), so by the
 * time anything renders there is nothing missing. Leaving it alone keeps a
 * render path from throwing in the middle of drawing a page, and keeps the text
 * reversible if it ever does happen.
 */
export const resolveFigureRefsInText = (text: string, figures?: FigureMap): string => {
  if (!text) return text;
  const refs = parseFigureRefs(text);
  if (refs.length === 0) return text;

  let out = text;
  for (const { ref, source } of refs) {
    const file = figures?.[ref.id];
    if (!file) continue;
    out = out.replace(source, inlineFormFor(ref, file));
  }
  return out;
};

/**
 * The whole assignment with every figure block resolved, and the map dropped.
 *
 * **Every surface that renders or exports a stem calls this first**, so each of
 * them handles one text format instead of two. The map is removed from the
 * returned object because a resolved assignment no longer refers to anything:
 * carrying it would let a consumer believe it still had files to fetch.
 */
export const resolveAssignmentFigures = (assignment: Assignment): Assignment => {
  const { figures, ...rest } = assignment as Assignment & { figures?: FigureMap };
  if (!figures || !assignment.problems?.length) return rest as Assignment;
  return {
    ...(rest as Assignment),
    problems: assignment.problems.map((p: Problem) => ({
      ...p,
      description: resolveFigureRefsInText(p.description || '', figures),
    })),
  };
};

/**
 * A figure block as the words the grader sees, in the same shape
 * `figureToDescText` writes for an inline figure.
 *
 * This is why the words live in the block. An SVG's own `<title>`/`<desc>` and a
 * block's `title:`/`desc:` produce the identical line, so swapping an SVG for a
 * PNG changes nothing in the rubric at all.
 */
export const figureRefToDescText = (ref: FigureRef): string => {
  const title = (ref.title || '').trim();
  const desc = (ref.desc || '').trim();
  if (title && desc) return `[Figure — ${title}: ${desc}]`;
  if (title) return `[Figure: ${title}]`;
  if (desc) return `[Figure: ${desc}]`;
  return '[figure]';
};

/** The stem with every figure block replaced by its description text. */
export const resolveFigureRefsForGrader = (text: string): string => {
  if (!text) return text;
  let out = text;
  for (const { ref, source } of parseFigureRefs(text)) {
    out = out.replace(source, figureRefToDescText(ref));
  }
  return out;
};
