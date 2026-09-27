// =====================================================
// ONE RUBRIC. THE HUMAN MARKER AND THE MODEL READ THE SAME CRITERIA
// =====================================================
// WORKORDER_AM_ONE_RUBRIC_BOTH_GRADERS_2026-09-27.
//
// Every assignment this quarter is marked twice: a human marks the work and
// sets the grade, and a model marks the same work independently so the two can
// be compared. That comparison means something only if both work off the SAME
// criteria.
//
// They did not, by construction. The grader document chose between the two
// authored fields on grading type (an AI part showed the grading prompt and hid
// the grader note; a human part the reverse), and the rubric carried the prompt
// only on AI parts. On EEC130A Homework 1, where every part is human-graded,
// the person read the instructor's worked solution and the model was told
// nothing but the part's title.
//
// So nothing here branches on grading type. Both fields an author can write are
// carried, to both graders, whenever they exist; a part with neither has no
// criteria, and that absence means exactly that the author wrote none.
//
// THE DIRECTION, NOT TAKEN HERE: two authored fields, one named for a model and
// one for a person, invite two texts. The end state is one field of criteria,
// read by whoever marks. That merge needs a migration, a `.md` format change
// and every import route, and is to be decided on purpose.

import { Subsection } from '../types';
import { stemForGrader } from './figureText';

/** Which authored field a piece of criteria came from. The grader document labels by it; the text is the same. */
export type CriteriaField = 'aiGradingPrompt' | 'graderNote';

export interface CriteriaPiece {
  field: CriteriaField;
  /** Exactly as authored. The grader document renders this. */
  text: string;
}

/** The authored criteria for one part, in a fixed order, prompt first. Empty when the author wrote none. */
export const criteriaPieces = (sub: Pick<Subsection, 'aiGradingPrompt' | 'graderNote'>): CriteriaPiece[] =>
  ([['aiGradingPrompt', sub.aiGradingPrompt], ['graderNote', sub.graderNote]] as Array<[CriteriaField, string | undefined]>)
    .filter(([, text]) => !!text && !!text.trim())
    .map(([field, text]) => ({ field, text: text as string }));

/** One piece as the grader-facing text: prose verbatim, each figure reduced to its words. */
export const criteriaText = (piece: CriteriaPiece): string => stemForGrader(piece.text);

/** Blank line between pieces, so a prompt and a note never run together. */
export const CRITERIA_SEPARATOR = '\n\n';

/**
 * `grading_criteria` for the rubric: every piece, figures reduced to words,
 * joined. `undefined` when the author wrote no criteria, so the key is absent.
 */
export const gradingCriteriaFor = (sub: Pick<Subsection, 'aiGradingPrompt' | 'graderNote'>): string | undefined => {
  const pieces = criteriaPieces(sub);
  return pieces.length ? pieces.map(criteriaText).join(CRITERIA_SEPARATOR) : undefined;
};

// =====================================================
// THE CHECK: the two files agree, part by part
// =====================================================
// Every criteria block in the grader document carries the part it belongs to
// and the grader-facing text it shows, in two attributes. This reads them back
// out of the finished HTML, joins them per part exactly as the rubric joins
// them, and compares with `grading_criteria`. It reads the two files as
// produced, not the function that produced them, so it is what proves "one
// rubric" rather than restating it.

const unescapeHtml = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

const BLOCK_RE = /<div class="ref-block[^"]*" data-criteria-for="([^"]+)" data-criteria="([^"]*)">/g;

/** Per part, the criteria text the grader document shows. */
export const criteriaInGraderDocument = (html: string): Map<string, string> => {
  const found = new Map<string, string[]>();
  for (const m of html.matchAll(BLOCK_RE)) {
    const list = found.get(m[1]) || [];
    list.push(unescapeHtml(m[2]));
    found.set(m[1], list);
  }
  return new Map([...found].map(([id, list]) => [id, list.join(CRITERIA_SEPARATOR)]));
};

/**
 * Every part where the grader document and the rubric do not carry the same
 * criteria text, named. Empty when they agree on every part.
 */
export const criteriaAgreementProblems = (
  graderHtml: string,
  rubric: { rubrics: Record<string, { display_name?: string; grading_criteria?: string }> },
): string[] => {
  const shown = criteriaInGraderDocument(graderHtml);
  const problems: string[] = [];
  for (const [id, entry] of Object.entries(rubric.rubrics)) {
    const name = entry.display_name ? `${entry.display_name} (${id})` : id;
    const inDoc = shown.get(id);
    const inRubric = entry.grading_criteria;
    if (inDoc === undefined && inRubric === undefined) continue;
    if (inDoc === undefined) problems.push(`${name}: the rubric has grading criteria and the grader document shows none.`);
    else if (inRubric === undefined) problems.push(`${name}: the grader document shows criteria and the rubric has no grading_criteria.`);
    else if (inDoc !== inRubric) problems.push(`${name}: the grader document and the rubric carry different criteria text.`);
  }
  for (const id of shown.keys()) {
    if (!(id in rubric.rubrics)) problems.push(`${id}: the grader document shows criteria for a part the rubric does not have.`);
  }
  return problems;
};
