// =====================================================
// WHAT AN INSTRUCTOR READS AFTER AN IMPORT
// =====================================================
// WORKORDER_AM_NOTHING_FAILS_SILENTLY_2026-09-27, items 2 to 4.
//
// Two rules, both learned from the first real folder import:
//
//   * THE REMEDY COMES SECOND, directly under "not imported", never after the
//     list. A browser dialog does not scroll to the end: with three figures the
//     last line was already below the fold, and with twelve the instructor
//     reads the complaints, presses OK, and never sees what to do.
//   * A LIST IS A LIST: one file per line, not a run-on sentence of paths.
//
// Nothing here decides anything; it only words what the import already found.

import { parseFigureFilename } from './figureImport';

const bullets = (items: string[]) => items.map(i => `  • ${i}`);

/** The refusal when a figure cannot be matched or fails a guard. Nothing was stored. */
export const figureRefusalMessage = (figureCount: number, problems: string[]): string => [
  'This was not imported.',
  'Choose the folder that holds the .md and its images, or drag that folder onto this page, and import again.',
  '',
  `It refers to ${figureCount} figure${figureCount === 1 ? '' : 's'}, and:`,
  ...bullets(problems),
].join('\n');

/**
 * Image files that came with the .md and that nothing in it refers to. Not a
 * refusal: spare drawings in a folder are normal. But an author who forgot a
 * `![...](...)` line must be able to see that a drawing went unused.
 */
export const unusedImages = (
  candidatePaths: string[],
  usedPaths: string[],
  figureBlockIds: string[],
): string[] => candidatePaths
  .filter(p => /\.(svg|png|jpe?g)$/i.test(p))
  .filter(p => !usedPaths.includes(p))
  .filter(p => { const f = parseFigureFilename(p); return !(f && figureBlockIds.includes(f.id)); });

export const unusedImagesNotice = (paths: string[]): string => [
  `${paths.length} image${paths.length === 1 ? '' : 's'} in what you chose ${paths.length === 1 ? 'is' : 'are'} `
    + `not referred to by the .md and ${paths.length === 1 ? 'was' : 'were'} not imported:`,
  ...bullets(paths),
  'Nothing is wrong if these are spare drawings. If one belongs in the assignment, add a line '
    + '![what it shows](its path) where it goes, and import again.',
].join('\n');

/** Other .md files that were chosen and are not the assignment. */
export const setAsideNotice = (mdPath: string, setAside: string[]): string => [
  `Imported ${mdPath}. ${setAside.length === 1 ? 'This .md was' : `These ${setAside.length} .md files were`} `
    + `set aside, because ${setAside.length === 1 ? 'it is not an assignment' : 'they are not assignments'}:`,
  ...bullets(setAside),
].join('\n');
