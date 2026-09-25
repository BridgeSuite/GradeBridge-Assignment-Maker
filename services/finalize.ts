// =====================================================
// THE FINALIZE LOCK
// =====================================================
// The workflow already says an assignment is finalized before students see it.
// This makes the app enforce that rather than trust it.
//
// Finalizing stamps two things and a date. After that, an export that would
// change either is refused until the assignment is explicitly reopened. Grader
// material — prompts, notes, rubrics — stays editable throughout, because none
// of it is student-facing.
//
// WHY TWO STAMPS AND NOT ONE
//
// `layout_id` catches changes that move answer regions: those mean the printed
// sheet and the scanner disagree about where a student's answers are.
//
// The fingerprint catches changes that move nothing and still change what a
// student sees. **The clearest case is a figure replaced after students have
// printed their sheets.** Every rectangle is where it was, so `layout_id` is
// unmoved and a layout-only check would wave it through — while the printed
// sheet shows the old drawing and the online copy shows the new one.
//
// WHAT THIS IS NOT
//
// **A guard against accident, not a security control.** An instructor who
// deletes the `**Finalized:**` line from the `.md` has turned the lock off on
// purpose, and that is acceptable. Nothing here resists a determined edit, and
// nothing should be built on the assumption that it does.

import { Assignment, FinalizeStamp } from '../types';
import { resolveAssignmentFigures } from './figureRefs';
import { buildLayout } from './templateLayout';
import { computeLayoutId } from './qrPayload';
import { mmRectToFraction } from './pageFormat';
import { GENERIC_LAYOUT_ID } from './genericAnswerPage';

/**
 * The student-facing fields, by name.
 *
 * Deliberately a copy of what `STUDENT_SPEC_FIELDS` selects rather than an
 * import of it: **the lock must not change meaning because the whitelist did.**
 * A field added to the student spec later should be a decision about the lock
 * too, taken here, rather than something that silently widens what a finalized
 * assignment refuses.
 */
const FINGERPRINTED_ASSIGNMENT = [
  'courseCode', 'title', 'preamble',
  // Both are included EXPLICITLY, even though both are on the student
  // whitelist. `assignmentKind` joined it on 2026-09-25: it travels because the
  // Submission app's wording and its parts menu depend on the kind, and
  // deriving it from the presence of `max_points` is inference this project
  // does not accept. (This comment said it never would; that was reversed, not
  // worked around.) It was already fingerprinted here, so joining the whitelist
  // moved no fingerprint. Changing it after issue reroutes every submission,
  // conventional to reader or back, which is exactly the after-issue change
  // this lock exists to stop. Naming both here means the lock does not depend
  // on what the whitelist happens to contain.
  'inputMode', 'assignmentKind',
  // The answer sheet: switching between the printed sheet and the generic page
  // after issue changes what every student prints and holds, so it is locked
  // with the rest. Absent on every assignment that predates it, and `pick`
  // skips an absent key, so no existing fingerprint moves.
  'sheet',
  'aiFeedback',
] as const;

const FINGERPRINTED_PROBLEM = ['name', 'description'] as const;
const FINGERPRINTED_SUBSECTION = [
  'name', 'description', 'points', 'submissionType',
  'minWords', 'maxImages', 'answerLines', 'isDrawing',
] as const;

/**
 * NOT fingerprinted, and this is the part that has to be right.
 *
 * `createdAt` and `updatedAt` move on every save. If they were included,
 * editing a grader note would move the fingerprint, and the lock would refuse
 * an edit it was never meant to cover — which is how a guard gets switched off
 * by the people it is protecting. `id` is excluded for the same reason a copy
 * is a new assignment: identity is not content.
 *
 * Grading material is excluded because it is not student-facing: prompts,
 * grader notes and the grading mode may all change after issue.
 */
export const NOT_FINGERPRINTED = [
  'id', 'createdAt', 'updatedAt',
  'aiGradingPrompt', 'graderNote', 'handwrittenGradingMode', 'imageGradingMode',
  'targetPoints', 'pageFormatId', 'submissionAddress', 'config',
  'figures', 'finalized', 'finalizeHistory',
] as const;

const pick = (src: Record<string, unknown>, keys: readonly string[]) => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in src && src[k] !== undefined) out[k] = src[k];
  return out;
};

/**
 * The student-facing content, in a form whose text is identical whenever the
 * content is.
 *
 * Figures are RESOLVED first, so the fingerprint is over the drawings a student
 * would receive rather than over the ids that refer to them. That is what makes
 * swapping a figure file — the case a layout check cannot see — move the
 * fingerprint. It is also what makes extracting an inline SVG into a file leave
 * it alone, since resolution puts the same bytes back.
 */
export const studentFacingContent = (assignment: Assignment): unknown => {
  const resolved = resolveAssignmentFigures(assignment);
  return {
    ...pick(resolved as unknown as Record<string, unknown>, FINGERPRINTED_ASSIGNMENT),
    problems: (resolved.problems || []).map(p => ({
      ...pick(p as unknown as Record<string, unknown>, FINGERPRINTED_PROBLEM),
      subsections: (p.subsections || []).map(s =>
        pick(s as unknown as Record<string, unknown>, FINGERPRINTED_SUBSECTION)),
    })),
  };
};

/** Stable JSON: keys in sorted order at every level, so text follows content. */
export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
};

const sha256Hex = async (text: string): Promise<string> => {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** The fingerprint of an assignment's student-facing content. 16 hex chars. */
export const contentFingerprint = async (assignment: Assignment): Promise<string> =>
  (await sha256Hex(canonicalJson(studentFacingContent(assignment)))).slice(0, 16).toUpperCase();

/**
 * The `layout_id` this assignment would produce right now.
 *
 * Computed fresh, never read from an earlier export: a stamp taken from a stale
 * value would lock the assignment to a sheet nobody has.
 *
 * Electronic assignments have no layout and stamp an empty string. They are
 * still fingerprinted, so the lock works for them on content alone.
 */
export const currentLayoutId = async (assignment: Assignment): Promise<string> => {
  if (assignment.inputMode !== 'handwritten') return '';
  // The generic page's layout is the same for every assignment that uses it.
  if (assignment.sheet === 'generic') return GENERIC_LAYOUT_ID;
  const resolved = resolveAssignmentFigures(assignment);
  const layout = buildLayout(resolved);
  if (!layout.regions.length) return '';
  return computeLayoutId(layout.regions.map(r => ({
    regionId: r.regionId, partId: r.partId, pageK: r.pageK,
    ...mmRectToFraction(r.declaredMm),
  })));
};

/** Today, as `YYYY-MM-DD`. */
const today = (): string => new Date().toISOString().slice(0, 10);

/** The stamp an assignment would get if it were finalized now. */
export const buildStamp = async (assignment: Assignment): Promise<FinalizeStamp> => ({
  date: today(),
  layoutId: await currentLayoutId(assignment),
  fingerprint: await contentFingerprint(assignment),
});

/** Finalize: stamp the assignment as it stands. */
export const finalizeAssignment = async (assignment: Assignment): Promise<Assignment> => ({
  ...assignment,
  finalized: await buildStamp(assignment),
});

/**
 * Reopen: drop the stamp, and APPEND what it said to the history.
 *
 * The history is never overwritten and never cleared, so the record shows that
 * an assignment was changed after it was issued even though doing so was
 * allowed. That is the whole value of it: the lock does not prevent the change,
 * it makes the change visible.
 */
export const reopenAssignment = (assignment: Assignment): Assignment => {
  if (!assignment.finalized) return assignment;
  const { finalized, ...rest } = assignment;
  return {
    ...(rest as Assignment),
    finalizeHistory: [...(assignment.finalizeHistory || []), finalized],
  };
};

/** What the instructor is told before reopening. */
export const REOPEN_WARNING =
  'Reopening lets you change what students receive.\n\n'
  + 'Students may already hold printed copies of this assignment. Anything you change '
  + 'after reopening will not match the paper in their hands, and if the answer regions '
  + 'move they will have to reprint.\n\n'
  + 'This is recorded: the date, the layout id and the content fingerprint of the version '
  + 'being replaced are kept in the assignment\'s finalize history.';

/**
 * Why a finalized assignment may not be exported, or `null` when it may.
 *
 * Both halves are checked and both are named, because they fail for different
 * reasons and cost the instructor different things: a moved fingerprint is a
 * re-issue, a moved `layout_id` is a reprint.
 */
export const finalizeLockProblem = async (assignment: Assignment): Promise<string | null> => {
  const stamp = assignment.finalized;
  if (!stamp) return null;

  const problems: string[] = [];

  const fingerprint = await contentFingerprint(assignment);
  if (fingerprint !== stamp.fingerprint) {
    problems.push(
      'What students see has changed since this assignment was finalized on '
      + `${stamp.date}. That covers the questions, the figures, the preamble, the points, `
      + 'the answer space, and whether this is a conventional or a reader assignment. '
      + 'Grading prompts and grader notes are not covered and can be edited freely.');
  }

  const layoutId = await currentLayoutId(assignment);
  if (layoutId !== stamp.layoutId) {
    problems.push(
      `The printed layout has changed: it was ${stamp.layoutId || '(none)'} when this was `
      + `finalized and would now be ${layoutId || '(none)'}. **Students would have to reprint.** `
      + 'The layout id is in the QR code on every page, and the app refuses to crop a sheet '
      + 'whose code does not match the map.');
  }

  if (!problems.length) return null;

  return [
    ...problems,
    '',
    'Reopen the assignment if you mean to change it. Reopening is recorded.',
  ].join('\n\n');
};
