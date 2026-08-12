/**
 * inputModeService.ts
 * Assignment input mode (electronic / handwritten) and the rules that follow from it:
 * which mediums a mode offers, what a new sub-part defaults to, and how a sub-part
 * the target mode cannot express is converted when the author switches modes.
 *
 * Kept out of Editor.tsx so the rules are testable without a DOM.
 */

import { InputMode, Subsection, SubmissionType } from '../types';

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
