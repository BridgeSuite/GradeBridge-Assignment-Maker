// =====================================================
// BRINGING A .md AND ITS figures/ IN TOGETHER
// =====================================================
// A `.md` with figure blocks is not complete on its own: it refers to files.
// This matches the two up, and refuses the cases where guessing would be worse
// than stopping.
//
// The three refusals are all the same principle — **never pick one** — and each
// has a different reason:
//
//   * a block with no file: the drawing is simply absent, and a placeholder
//     would put a question in front of students with a hole where the circuit
//     should be. There is nothing to fall back to.
//   * two files for one id, `p1-divider.svg` and `p1-divider.png`: the author
//     has two drawings and the app has no way to know which is current. Picking
//     by extension order would be a coin toss printed onto paper.
//   * a file that fails a guard: colour, too small, too large. Covered by
//     `figureGuards.ts`; reported here with the rest so an instructor sees
//     everything wrong with their folder at once rather than one item per
//     attempt.
//
// A file no block refers to is REPORTED AND NOT STORED. It is not an error —
// authors leave spare drawings around — but silently carrying it would put
// bytes in the authoring backup that nothing uses.

import { Assignment, FigureFile, FigureMap } from '../types';
import { FIGURE_FORMATS, FigureFormat, figureDataUri, referencedFigureIds } from './figureRefs';
import { figureFileProblems } from './figureGuards';
import { splitFigures } from './figureBlocks';

/** One candidate file, as it arrived. */
export interface IncomingFile {
  /** The name as given, which may include a `figures/` prefix. */
  path: string;
  bytes: Uint8Array;
}

export interface FigureImportResult {
  figures: FigureMap;
  /** Everything that must be fixed before this can be imported. */
  problems: string[];
  /** Files nobody referred to. Not stored, not an error. */
  unreferenced: string[];
}

const toBase64 = (bytes: Uint8Array): string => {
  if (typeof btoa === 'function') {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
};

/** `figures/p1-divider.svg` -> `{ id: 'p1-divider', format: 'svg' }`, or null. */
export const parseFigureFilename = (path: string): { id: string; format: FigureFormat } | null => {
  const base = path.replace(/\\/g, '/').split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = base.slice(0, dot);
  let ext = base.slice(dot + 1).toLowerCase();
  // `.jpeg` is the same format under a longer name; the app stores one spelling
  // so an id cannot be ambiguous purely because of how a camera names things.
  if (ext === 'jpeg') ext = 'jpg';
  if (!FIGURE_FORMATS.includes(ext as FigureFormat)) return null;
  return { id, format: ext as FigureFormat };
};

/**
 * Match an assignment's figure blocks to the files that arrived with it.
 *
 * Every problem is collected before anything is returned, so an instructor with
 * three bad files is told about three, not about the first.
 */
export const collectFigures = async (
  assignment: Pick<Assignment, 'problems'>,
  incoming: IncomingFile[],
): Promise<FigureImportResult> => {
  const wanted = referencedFigureIds(assignment);
  const problems: string[] = [];
  const unreferenced: string[] = [];

  // id -> every file offering itself for that id
  const offers = new Map<string, Array<{ file: FigureFile; path: string }>>();
  for (const item of incoming) {
    const parsed = parseFigureFilename(item.path);
    if (!parsed) continue; // not a figure file at all; the caller decides about those
    const file: FigureFile = {
      format: parsed.format,
      base64: toBase64(item.bytes),
      filename: item.path.replace(/\\/g, '/').split('/').pop() || item.path,
    };
    const list = offers.get(parsed.id) || [];
    list.push({ file, path: item.path });
    offers.set(parsed.id, list);
  }

  for (const [id, list] of offers) {
    if (!wanted.includes(id)) {
      unreferenced.push(list.map(o => o.path).join(', '));
    }
  }

  const figures: FigureMap = {};
  for (const id of wanted) {
    const list = offers.get(id) || [];
    if (list.length === 0) {
      problems.push(`The figure "${id}" has no file. Expected figures/${id}.svg, .png or .jpg `
        + 'beside the .md.');
      continue;
    }
    if (list.length > 1) {
      problems.push(`The figure "${id}" has ${list.length} files `
        + `(${list.map(o => o.file.filename).join(', ')}). Keep exactly one: the app will not `
        + 'choose between them, because the wrong choice would be printed onto paper.');
      continue;
    }
    const [{ file, path }] = list;
    const bad = await figureFileProblems(file);
    // Named, so an instructor with three bad files knows which three.
    if (bad.length) { problems.push(...bad.map(p => `${path}: ${p.message}`)); continue; }
    figures[id] = file;
  }

  return { figures, problems, unreferenced };
};

// =====================================================
// `![alt](path)`: THE FORM AUTHORS WRITE UNPROMPTED
// =====================================================
// WORKORDER_AM_FIGURES_AND_FOLDER_IMPORT_2026-09-27 §5 and §6.
//
// An author writes `![Transmission line circuit](figs/Fig-4.png)` because that
// is what markdown means everywhere else. The app used to store it and draw
// `[figure: ...]`, since `safeImageUrl` rightly refuses a relative path: at
// render time it would resolve against the app's own site, not the author's
// folder. So the path is resolved HERE, once, at import, and the line is
// rewritten to a `data:` URI. Every surface downstream sees exactly what an
// author who typed the data URI by hand would have produced, and needs no change.
//
// Matching is the same principle as `collectFigures` above: **never pick one.**
//   1. the path as written, relative to the folder the `.md` is in;
//   2. the path as written, wherever it sits under what was chosen, when
//      exactly one file ends with it;
//   3. the file name alone, when exactly one file has it.
// Two or more at any step is a refusal naming them all. None at all is a
// refusal naming the path. There is no placeholder: a drawing that is missing
// must stop the import, not reach a student as a hole in the question.

/** A url that already stands on its own, and is left exactly as written. */
const SELF_CONTAINED_URL_RE = /^(data:|https?:\/\/)/i;

/** `a\b/./c/../d.png` -> `a/b/d.png`. Segments only, no leading slash. */
export const normalizeImportPath = (path: string): string => {
  const out: string[] = [];
  for (const seg of path.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return out.join('/');
};

const baseName = (path: string): string => normalizeImportPath(path).split('/').pop() || '';

const decodeUrlPath = (url: string): string => {
  try { return decodeURIComponent(url); } catch { return url; }
};

/** Every `![alt](url)` in the assignment's text that points at a file, with where it is. */
export const imagePathRefs = (assignment: Pick<Assignment, 'problems'>):
  Array<{ where: string; alt: string; url: string }> => {
  const refs: Array<{ where: string; alt: string; url: string }> = [];
  const scan = (text: string | undefined, where: string) => {
    for (const seg of splitFigures(text || '')) {
      if (seg.kind === 'figure' && seg.figure.form === 'image'
        && !SELF_CONTAINED_URL_RE.test(seg.figure.url)) {
        refs.push({ where, alt: seg.figure.alt, url: seg.figure.url });
      }
    }
  };
  assignment.problems.forEach((p, i) => {
    scan(p.description, `Problem ${i + 1}`);
    p.subsections.forEach((s, j) => scan(s.description, `Problem ${i + 1}(${String.fromCharCode(97 + j)})`));
  });
  return refs;
};

export type ImageMatch =
  | { kind: 'found'; path: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous'; paths: string[] };

/** Find the one file a reference means, or say why there is not exactly one. */
export const matchImagePath = (url: string, mdPath: string, candidates: string[]): ImageMatch => {
  const ref = normalizeImportPath(decodeUrlPath(url));
  const mdDir = normalizeImportPath(mdPath).split('/').slice(0, -1).join('/');
  const norm = candidates.map(c => ({ path: c, n: normalizeImportPath(c) }));
  const decide = (hits: typeof norm): ImageMatch | null =>
    hits.length === 1 ? { kind: 'found', path: hits[0].path }
      : hits.length > 1 ? { kind: 'ambiguous', paths: hits.map(h => h.path) }
      : null;

  const target = normalizeImportPath(mdDir ? `${mdDir}/${ref}` : ref);
  return decide(norm.filter(c => c.n === target))
    ?? decide(norm.filter(c => c.n === ref || c.n.endsWith(`/${ref}`)))
    ?? decide(norm.filter(c => baseName(c.n).toLowerCase() === baseName(ref).toLowerCase()))
    ?? { kind: 'missing' };
};

const formatFromName = (path: string): string => {
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  return ext === 'jpeg' ? 'jpg' : ext;
};

export interface ImagePathResult {
  /** The assignment with every file reference rewritten to a data: URI. Use only when `problems` is empty. */
  assignment: Assignment;
  problems: string[];
  /** How many references pointed at a file. */
  resolved: number;
  /** The files that were used, as they arrived. */
  usedPaths: string[];
}

/**
 * Resolve every `![alt](path)` against the files that arrived with the `.md`.
 * Every problem is collected before anything is returned, as `collectFigures` does.
 */
export const resolveImagePaths = async (
  assignment: Assignment,
  incoming: IncomingFile[],
  mdPath: string,
): Promise<ImagePathResult> => {
  const refs = imagePathRefs(assignment);
  const problems: string[] = [];
  const uris = new Map<string, string>();
  const reported = new Set<string>();
  const usedPaths = new Set<string>();
  const byPath = new Map(incoming.map(f => [f.path, f]));
  const paths = incoming.map(f => f.path);

  for (const ref of refs) {
    if (uris.has(ref.url) || reported.has(ref.url)) continue;
    reported.add(ref.url);
    const m = matchImagePath(ref.url, mdPath, paths);
    if (m.kind === 'missing') {
      problems.push(`${ref.where}: the image ${ref.url} is not among the files chosen.`);
      continue;
    }
    if (m.kind === 'ambiguous') {
      problems.push(`${ref.where}: the image ${ref.url} could be any of ${m.paths.join(', ')}. `
        + 'Keep one, or write its path in full. The app will not choose between them.');
      continue;
    }
    const item = byPath.get(m.path)!;
    const file: FigureFile = {
      format: formatFromName(m.path) as FigureFile['format'],
      base64: toBase64(item.bytes),
      filename: baseName(m.path),
    };
    const bad = await figureFileProblems(file);
    if (bad.length) { problems.push(...bad.map(p => `${m.path}: ${p.message}`)); continue; }
    uris.set(ref.url, figureDataUri(file));
    usedPaths.add(m.path);
  }

  const rewrite = (text: string): string => {
    if (!text) return text;
    return splitFigures(text).map(seg => {
      if (seg.kind === 'text') return seg.value;
      if (seg.figure.form !== 'image') return seg.source;
      const uri = uris.get(seg.figure.url);
      return uri ? seg.source.replace(`(${seg.figure.url})`, `(${uri})`) : seg.source;
    }).join('');
  };

  return {
    assignment: {
      ...assignment,
      problems: assignment.problems.map(p => ({
        ...p,
        description: rewrite(p.description),
        subsections: p.subsections.map(s => ({ ...s, description: rewrite(s.description) })),
      })),
    },
    problems,
    resolved: refs.length,
    usedPaths: [...usedPaths],
  };
};

/**
 * Whether a file that arrived with the `.md` is worth reading: anything that
 * could be a figure, and anything the text names. A chosen folder may hold a
 * PDF, a LaTeX source and a zip beside the assignment, and there is no reason
 * to read those.
 */
export const mightBeNeeded = (path: string, mdText: string): boolean =>
  /\.(svg|png|jpe?g)$/i.test(path) || mdText.includes(baseName(path));

/** What the instructor is told once images were matched: the alt text is the grader's only view of them. */
export const altTextNotice = (count: number): string =>
  `${count} image${count === 1 ? ' was' : 's were'} matched to the files you chose and stored in the `
  + 'assignment. A grader never sees a PNG or JPG, only its alt text (the words in the square '
  + 'brackets), so write that as a description of what the drawing shows, not as a label.';

/** What the instructor is told about files nobody referred to. */
export const unreferencedNotice = (unreferenced: string[]): string =>
  `${unreferenced.length} file${unreferenced.length === 1 ? '' : 's'} in the folder `
  + `${unreferenced.length === 1 ? 'is' : 'are'} not referred to by any figure block and `
  + `${unreferenced.length === 1 ? 'was' : 'were'} not imported: ${unreferenced.join(', ')}. `
  + 'Nothing is wrong — they are simply unused, and carrying them would put bytes in your '
  + 'backup that nothing reads.';
