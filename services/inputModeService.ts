/**
 * inputModeService.ts
 * Assignment input mode (electronic / handwritten) and the rules that follow from it:
 * which mediums a mode offers, what a new sub-part defaults to, and how a sub-part
 * the target mode cannot express is converted when the author switches modes.
 *
 * Kept out of Editor.tsx so the rules are testable without a DOM.
 */

import { Assignment, AssignmentKind, InputMode, Subsection, SubmissionType } from '../types';

// =====================================================
// A READER ASSIGNMENT MUST BE HANDWRITTEN
// =====================================================
// The reader's first stage transcribes photographed handwriting. An electronic
// submission has nothing to transcribe, and no electronic reader path exists
// anywhere in the pipeline. Three combinations are valid and one is refused:
//
//   handwritten + conventional   valid
//   handwritten + reader         valid
//   electronic  + conventional   valid
//   electronic  + reader         REFUSED
//
// **THE TEST IS `=== 'handwritten'`, NEVER `!== 'electronic'`.** `inputMode` is
// optional on `Assignment` and ABSENT MEANS ELECTRONIC — an `**Input:**` line
// that is missing, or that carries any value other than `handwritten`, is an
// electronic assignment. So a reader assignment with no `inputMode` at all is an
// electronic reader assignment and must be refused. Written the other way round
// the check passes exactly the case it exists to catch, which is why the rule is
// stated here rather than left to whoever writes the next call site.
//
// ONE FUNCTION, CALLED FROM EVERY ENTRY POINT — the editor's save, both
// imports, `buildAssignmentSpec` as the backstop, and `converter/convert.py` as
// the format's second implementation. Not one check per entry point: separate
// checks drift apart.

/** Is this pairing the refused one? Absent `inputMode` is electronic. */
export const isElectronicReader = (
  inputMode: InputMode | undefined,
  assignmentKind: AssignmentKind | undefined,
): boolean => assignmentKind === 'reader' && inputMode !== 'handwritten';

/**
 * Why this assignment's kind and input mode cannot go together, or `null` when
 * they can.
 *
 * Returns the sentence an instructor is shown, in their terms rather than the
 * field names': the rule is a consequence of how the reader works, so saying so
 * is what makes it a rule rather than an arbitrary refusal.
 */
export const assignmentKindProblem = (
  assignment: Pick<Assignment, 'inputMode' | 'assignmentKind'>,
): string | null =>
  isElectronicReader(assignment.inputMode, assignment.assignmentKind)
    ? 'A reader assignment must be handwritten. The reader works by reading '
      + 'photographed pages, and an electronic assignment has nothing to '
      + 'photograph. Either set the input mode to Handwritten, or make this a '
      + 'conventional assignment.'
    : null;

export const MODE_LABEL: Record<InputMode, string> = {
  electronic: 'Electronic text and images',
  handwritten: 'Handwritten',
};

/** Handwritten mode is strictly handwritten-only; electronic mode offers everything else. */
export const typeAllowedInMode = (type: SubmissionType, inputMode: InputMode): boolean =>
  inputMode === 'handwritten'
    ? type === SubmissionType.HANDWRITTEN
    : type !== SubmissionType.HANDWRITTEN;

/** The medium a new sub-part takes in each mode. */
export const defaultTypeForMode = (inputMode: InputMode): SubmissionType =>
  inputMode === 'handwritten' ? SubmissionType.HANDWRITTEN : SubmissionType.TEXT;

/** Handwritten parts are AI graded (OCR + grade) unless explicitly set to human. */
export const isAiHandwritten = (sub: Subsection): boolean =>
  sub.submissionType === SubmissionType.HANDWRITTEN && (sub.handwrittenGradingMode ?? 'ai') !== 'human';

/**
 * Rewrite a sub-part the target mode cannot express. Name, description, points,
 * rubric and grader note survive; the fields that no longer apply (image page
 * count, the other mode's grading mode) are dropped. Nothing is ever discarded
 * silently — callers warn first.
 */
export const convertSubsectionToMode = (sub: Subsection, mode: InputMode): Subsection => {
  const { maxImages: _mi, imageGradingMode: _ig, handwrittenGradingMode: _hg, ...rest } = sub;
  return mode === 'handwritten'
    ? { ...rest, submissionType: SubmissionType.HANDWRITTEN, handwrittenGradingMode: 'ai' }
    : { ...rest, submissionType: SubmissionType.TEXT, maxImages: 1 };
};

/** Human-readable "2b. Field sketch — Handwritten" labels for the parts a mode switch would convert. */
export const strandedSubsectionLabels = (
  problems: { subsections: Subsection[] }[],
  mode: InputMode
): string[] =>
  problems.flatMap((p, pIdx) =>
    p.subsections
      .map((s, sIdx) => ({
        s,
        label: `${pIdx + 1}${String.fromCharCode(97 + sIdx)}. ${s.name || '(untitled)'} — ${s.submissionType}`,
      }))
      .filter(({ s }) => !typeAllowedInMode(s.submissionType, mode))
      .map(({ label }) => label)
  );
