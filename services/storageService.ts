
import { Assignment } from '../types';
import { degradeRetiredTypes } from './retiredTypes';
import { UnansweredNotice } from './questions';

const STORAGE_KEY = 'gradebridge_assignments_v1';

// =====================================================
// A WRITE THAT FAILS SAYS SO (WORKORDER_AM_NOTHING_FAILS_SILENTLY_2026-09-27 §1)
// =====================================================
// `localStorage.setItem` THROWS when the site's storage is full (about 5 MB for
// the whole app). It used to be called bare: the exception escaped the handler,
// the navigation after it never ran, and nothing appeared on screen, so an
// author was left on the editor believing the work was saved. It was not.
//
// That is reachable now, not theoretical: an imported image is carried inside
// the assignment as encoded text, and EEC130A Homework 1's three come to about
// 280 KB, so a quarter of such assignments fills the store.
//
// So a write never throws out of here. It returns what happened, and a failure
// carries the notice an author reads, in the page, not a browser dialog, which
// a browser may suppress without a word (CLAUDE.md, the standing rule on
// guards). Every caller shows it and stays where it is.

/** What a write did. A failure carries the notice to show, already worded. */
export type WriteResult = { ok: true } | { ok: false; notice: UnansweredNotice };

/** The browser's "storage full" error, under each of the names engines have used for it. */
export const isQuotaError = (err: unknown): boolean => {
  const e = err as { name?: string; code?: number } | null;
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || e.code === 22 || e.code === 1014);
};

/**
 * The notice for a write that failed. `what` says what did not happen, in the
 * words of the action the author took: "was not saved", "was not imported".
 */
export const writeFailureNotice = (err: unknown, subject: string, what: string): UnansweredNotice =>
  isQuotaError(err)
    ? {
      title: `${subject} ${what}`,
      body: [
        'The browser storage this app keeps assignments in is full, so nothing was written. '
          + 'What is on this page is not lost yet, as long as you do not close or leave it.',
        'To make room: press Export .md to keep a copy of anything you need, then delete assignments '
          + 'you no longer need from the dashboard, and try again.',
        'Imported images take the most room: each is stored inside its assignment.',
      ],
    }
    : {
      title: `${subject} ${what}`,
      body: [
        `The browser refused to store it${err instanceof Error && err.name ? ` (${err.name})` : ''}, `
          + 'so nothing was written. What is on this page is not lost yet, as long as you do not close or leave it.',
        'Press Export .md to keep a copy, then try again.',
      ],
    };

const write = (all: Assignment[], subject: string, what: string): WriteResult => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    return { ok: true };
  } catch (err) {
    return { ok: false, notice: writeFailureNotice(err, subject, what) };
  }
};

export const storageService = {
  getAll: (): Assignment[] => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return [];

      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];

      // normalize IDs to strings and trim whitespace to prevent mismatch issues
      // also ensure createdAt and updatedAt exist as numbers
      const now = Date.now();
      return parsed.map((a: any) => {
        const assignment: Assignment = {
          ...a,
          id: String(a.id).trim(),
          createdAt: typeof a.createdAt === 'number' ? a.createdAt : now,
          updatedAt: typeof a.updatedAt === 'number' ? a.updatedAt : now
        };
        // An assignment saved before a submission type was retired loads with
        // that part as plain Text — an unknown type would render blank in the
        // editor and export as `human` without anyone being told.
        for (const w of degradeRetiredTypes(assignment)) console.warn(`[GradeBridge] ${w}`);
        return assignment;
      });
    } catch (error) {
      console.error("Failed to load assignments", error);
      return [];
    }
  },

  get: (id: string): Assignment | undefined => {
    const all = storageService.getAll();
    const targetId = String(id).trim();
    return all.find(a => a.id === targetId);
  },

  /**
   * Store one assignment. Never throws: a failed write comes back as
   * `{ ok: false, notice }`, and the caller must show the notice and not move on.
   * `what` names the failure in the author's terms; it defaults to a save.
   */
  save: (assignment: Assignment, what = 'was NOT saved'): WriteResult => {
    const all = storageService.getAll();
    // Ensure ID is string and trimmed to prevent duplicates/mismatches
    const safeAssignment = { ...assignment, id: String(assignment.id).trim() };
    
    const index = all.findIndex(a => a.id === safeAssignment.id);
    
    if (index >= 0) {
      all[index] = { ...safeAssignment, updatedAt: Date.now() };
    } else {
      all.push({ ...safeAssignment, createdAt: Date.now(), updatedAt: Date.now() });
    }

    return write(all, `"${safeAssignment.title || 'This assignment'}"`, what);
  },

  /** Remove one assignment. Never throws; a failure means it is still there, and says so. */
  delete: (id: string): WriteResult => {
    const all = storageService.getAll();
    const targetId = String(id).trim();
    // Filter out the assignment, ensuring comparison is done on trimmed strings
    const filtered = all.filter(a => String(a.id).trim() !== targetId);
    return write(filtered, 'The assignment', 'was NOT deleted');
  }
};
