/**
 * retiredTypes.ts
 * Submission types this app no longer authors, and what an assignment that
 * still carries one loads as.
 *
 * `AI Formative` was retired on 2026-08-18: the suite now has one AI-feedback
 * concept, the per-assignment `aiFeedback` flag. Nothing new can be authored
 * with a retired type — the pill, the export mapping and the enum member are
 * all gone — but an `.md` or a saved project written before the removal still
 * has to open. `submissionType` is a bare enum here (no `| string` union), so
 * a retired value left in place is an untyped value the editor would render
 * blank and the export would silently write as `human`.
 *
 * The rule: degrade to plain Text, and say so, naming the sub-part. Losing the
 * type is correct; losing the assignment is not.
 */

import { Assignment, SubmissionType, Subsection } from '../types';

/** `.md` type tag → the type it now imports as. */
export const RETIRED_TYPE_TAGS: Record<string, SubmissionType> = {
  'ai-graded:formative': SubmissionType.TEXT,
};

/** Stored/imported `submissionType` value → the type it now loads as. */
export const RETIRED_TYPE_VALUES: Record<string, SubmissionType> = {
  'AI Formative': SubmissionType.TEXT,
};

/** One line per degraded part, surfaced to the instructor at import. */
export const retiredTypeWarning = (label: string, retired: string, loadedAs: SubmissionType): string =>
  `"${label}" was authored as ${retired}, which has been retired. It is now a plain ${loadedAs} part — review its points and rubric before exporting.`;

/**
 * A degraded part is not AI graded any more, so the editor stops showing its
 * `aiGradingPrompt` and the next `.md` export stops writing it — the authored
 * rubric would go quietly. Move the words to the grader note, which every type
 * shows and exports, unless the part already has one.
 */
export function keepPromptAsGraderNote(sub: Subsection): void {
  if (!sub.aiGradingPrompt) return;
  if (!sub.graderNote) sub.graderNote = sub.aiGradingPrompt;
  sub.aiGradingPrompt = '';
}

/**
 * Rewrite every retired `submissionType` in an assignment, in place, and
 * return one warning per rewritten sub-part. Used on the JSON-import path and
 * on every read out of local storage, so a project saved before the removal
 * opens as a valid assignment rather than one with an unknown type in it.
 */
export function degradeRetiredTypes(assignment: Assignment): string[] {
  const warnings: string[] = [];
  for (const problem of assignment.problems ?? []) {
    for (const sub of problem.subsections ?? []) {
      const retired = sub.submissionType as unknown as string;
      const loadedAs = RETIRED_TYPE_VALUES[retired];
      if (!loadedAs) continue;
      sub.submissionType = loadedAs;
      delete sub.minWords;
      keepPromptAsGraderNote(sub);
      warnings.push(retiredTypeWarning(`${problem.name} — ${sub.name}`, retired, loadedAs));
    }
  }
  return warnings;
}
