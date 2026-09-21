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
import { FIGURE_FORMATS, FigureFormat, referencedFigureIds } from './figureRefs';
import { figureFileProblems } from './figureGuards';

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
    const [{ file }] = list;
    const bad = await figureFileProblems(file);
    if (bad.length) { problems.push(...bad.map(p => p.message)); continue; }
    figures[id] = file;
  }

  return { figures, problems, unreferenced };
};

/** What the instructor is told about files nobody referred to. */
export const unreferencedNotice = (unreferenced: string[]): string =>
  `${unreferenced.length} file${unreferenced.length === 1 ? '' : 's'} in the folder `
  + `${unreferenced.length === 1 ? 'is' : 'are'} not referred to by any figure block and `
  + `${unreferenced.length === 1 ? 'was' : 'were'} not imported: ${unreferenced.join(', ')}. `
  + 'Nothing is wrong — they are simply unused, and carrying them would put bytes in your '
  + 'backup that nothing reads.';
