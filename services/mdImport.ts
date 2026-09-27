// =====================================================
// WHAT ARRIVES WHEN AN INSTRUCTOR IMPORTS A .md
// =====================================================
// WORKORDER_AM_FIGURES_AND_FOLDER_IMPORT_2026-09-27 §4.
//
// An author has a FOLDER: the `.md`, and beside it a `figs` subfolder. The
// Windows Open dialog cannot select across two folders, so "choose the .md and
// its images together" could not be done in one action for the layout every
// course uses. Four routes now arrive here and are treated identically:
//
//   * a chosen folder (the primary route)       every file, with its path
//   * a folder dragged onto the page             the same
//   * several files chosen by hand               bare names, no folders
//   * a zip, as a colleague sends an assignment  unpacked here
//
// A zip is unpacked only when it was chosen itself. A zip that happens to sit
// inside a chosen folder is somebody's download, not part of the assignment.
//
// ONE .md PER IMPORT. A real assignment folder also holds a README and notes,
// so the rule is one ASSIGNMENT: a `.md` whose first line is `# CODE: Title`,
// the line the parser takes the course and title from, and which has at least
// one `## Problem N:` heading. Exactly one of those is imported and any other
// `.md` is named as set aside. Two of them is a refusal naming both: the app
// will not choose which assignment was meant.

import JSZip from 'jszip';
import { IncomingFile, mightBeNeeded } from './figureImport';

/** One file as it arrived, read only if it turns out to be needed. */
export interface ChosenFile {
  /** Its path under what was chosen (`master/figs/Fig-4.png`), or its bare name. */
  path: string;
  /** True for a file inside a chosen or dragged folder. */
  inFolder: boolean;
  read: () => Promise<Uint8Array>;
}

export interface GatheredImport {
  content: string;
  /** The `.md`'s own path, which image paths are resolved against. */
  mdPath: string;
  candidates: IncomingFile[];
  /** Other `.md` files that were chosen and are not the assignment. */
  setAside: string[];
}

/** The refusal, in the instructor's terms. The caller shows it as it is. */
export class ImportRefusal extends Error {}

const TITLE_LINE_RE = /^#\s+([^:]+):\s+(.+)$/;
const PROBLEM_LINE_RE = /^##\s+Problem\s+\d+:/im;

/** Whether a `.md`'s text is a GradeBridge assignment rather than a README or a note. */
export const looksLikeAssignment = (text: string): boolean => {
  const first = text.replace(/^﻿/, '').split('\n').find(l => l.trim()) || '';
  return TITLE_LINE_RE.test(first.trim()) && PROBLEM_LINE_RE.test(text);
};

const isMd = (path: string) => /\.md$/i.test(path);

/** Expand a chosen zip into its entries. Anything else passes through. */
const expand = async (chosen: ChosenFile[]): Promise<ChosenFile[]> => {
  const out: ChosenFile[] = [];
  for (const f of chosen) {
    if (!f.inFolder && /\.zip$/i.test(f.path)) {
      const zip = await JSZip.loadAsync(await f.read());
      for (const entry of Object.values(zip.files)) {
        if (entry.dir || /(^|\/)__MACOSX\//.test(entry.name)) continue;
        out.push({ path: entry.name, inFolder: true, read: () => entry.async('uint8array') });
      }
    } else {
      out.push(f);
    }
  }
  return out;
};

export const gatherImport = async (chosen: ChosenFile[]): Promise<GatheredImport> => {
  const files = await expand(chosen);
  const mds: Array<{ path: string; text: string }> = [];
  for (const f of files.filter(f => isMd(f.path))) {
    mds.push({ path: f.path, text: new TextDecoder().decode(await f.read()) });
  }

  if (!mds.length) throw new ImportRefusal('No .md file was chosen. Choose the folder that holds your assignment\'s .md.');

  let md = mds[0];
  if (mds.length > 1) {
    const assignments = mds.filter(m => looksLikeAssignment(m.text));
    if (assignments.length > 1) {
      throw new ImportRefusal(['This was not imported. It holds more than one assignment:', '',
        ...assignments.map(m => `  • ${m.path}`), '',
        'Import one at a time. Move the other into its own folder, or choose the files by hand.',
      ].join('\n'));
    }
    if (!assignments.length) {
      throw new ImportRefusal(['This was not imported. None of these .md files is an assignment:', '',
        ...mds.map(m => `  • ${m.path}`), '',
        'An assignment starts with a line like "# EEC130A: Homework 1" and has at least one '
          + '"## Problem 1:" heading.',
      ].join('\n'));
    }
    md = assignments[0];
  }

  const candidates: IncomingFile[] = [];
  for (const f of files) {
    if (isMd(f.path) || !mightBeNeeded(f.path, md.text)) continue;
    candidates.push({ path: f.path, bytes: await f.read() });
  }

  return {
    content: md.text,
    mdPath: md.path,
    candidates,
    setAside: mds.filter(m => m !== md).map(m => m.path),
  };
};

/** A chosen `File`, from an input or a drop of loose files. */
export const chosenFromFile = (f: File, path?: string): ChosenFile => {
  const rel = path ?? ((f as File & { webkitRelativePath?: string }).webkitRelativePath || '');
  return {
    path: rel || f.name,
    inFolder: !!rel && rel.includes('/'),
    read: async () => new Uint8Array(await f.arrayBuffer()),
  };
};

/**
 * Everything dropped on the page, folders walked. A dropped folder's files keep
 * their paths under it, so they resolve exactly as a chosen folder's do.
 */
export const chosenFromDrop = async (items: DataTransferItemList): Promise<ChosenFile[]> => {
  type Entry = {
    isFile: boolean; isDirectory: boolean; fullPath: string; name: string;
    file?: (ok: (f: File) => void, fail: (e: unknown) => void) => void;
    createReader?: () => { readEntries: (ok: (e: Entry[]) => void, fail: (e: unknown) => void) => void };
  };
  const roots: Entry[] = [];
  const loose: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.();
    if (entry) roots.push(entry);
    else { const f = item.getAsFile(); if (f) loose.push(f); }
  }

  const out: ChosenFile[] = loose.map(f => chosenFromFile(f, f.name));
  const walk = async (entry: Entry, inFolder: boolean): Promise<void> => {
    if (entry.isFile && entry.file) {
      const file = await new Promise<File>((ok, fail) => entry.file!(ok, fail));
      out.push(chosenFromFile(file, entry.fullPath.replace(/^\//, '')));
      out[out.length - 1].inFolder = inFolder;
      return;
    }
    if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader();
      // readEntries hands back a batch at a time and an empty batch at the end.
      for (;;) {
        const batch = await new Promise<Entry[]>((ok, fail) => reader.readEntries(ok, fail));
        if (!batch.length) break;
        for (const child of batch) await walk(child, true);
      }
    }
  };
  for (const root of roots) await walk(root, false);
  return out;
};
