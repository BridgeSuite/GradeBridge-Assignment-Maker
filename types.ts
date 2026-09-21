
export enum SubmissionType {
  TEXT = 'Text',
  IMAGE = 'Image',
  TEXT_AND_IMAGE = 'Text and Image',
  AI_GRADED_BINARY = 'AI Graded: Binary',
  AI_GRADED_SHORT = 'AI Graded: Short',
  AI_GRADED_MEDIUM = 'AI Graded: Medium',
  AI_GRADED_LONG = 'AI Graded: Long',
  HANDWRITTEN = 'Handwritten',
  MATLAB_GRADER = 'MatlabGrader',
  CODE = 'Code',
  FILE_UPLOAD = 'File Upload'
}

/**
 * How much writing space a handwritten part gets on the printed template,
 * **authored** rather than derived: the number of writing lines to reserve.
 * The generator reserves exactly this, draws exactly this, and the layout map
 * crops exactly this — one rectangle, no drift between what the student writes
 * in and what the grader sees. Absent means `DEFAULT_ANSWER_LINES`.
 */
export type AnswerLines = number;

export interface Subsection {
  id: string;
  name: string;
  description: string;
  points: number;
  submissionType: SubmissionType;
  answerLines?: AnswerLines; // Handwritten only: writing lines reserved on the template. Unset = DEFAULT_ANSWER_LINES.
  isDrawing?: boolean;       // Handwritten only: sketch part. Sets is_drawing in the layout map.
  maxImages?: number; // Specific for Image submission types
  imageGradingMode?: 'human' | 'auto'; // Image only: 'human' = TA reviews; 'auto' = autograder checks images_submitted > 0
  handwrittenGradingMode?: 'ai' | 'human'; // Handwritten only: 'ai' = OCR+grade; 'human' = TA grades from crops
  config?: string; // For extra data like prompts or IDs
  aiGradingPrompt?: string;
  graderNote?: string; // Human grader reference: expected answer or what to look for (not shown to students)
  minWords?: number; // Minimum word count — derived from ai-graded category on import
}

export interface Problem {
  id: string;
  name: string;
  description: string;
  subsections: Subsection[];
}

export type InputMode = 'electronic' | 'handwritten';

/**
 * The two kinds of assignment. Two values, no third, and no blank once set.
 */
export type AssignmentKind = 'conventional' | 'reader';

export interface Assignment {
  id: string;
  courseCode: string;
  title: string;
  inputMode?: InputMode; // How students answer. Absent (older assignments) means 'electronic'.
  /**
   * Which of the two kinds of assignment this is.
   *
   * **Required, and there is exactly one per assignment.** No per-problem kind,
   * no assignment that is partly one and partly the other, and no runtime
   * condition that changes it. It is named `assignmentKind` rather than `type`
   * or `mode` because `submissionType` and `inputMode` already exist in this
   * file and mean other things.
   *
   * **Absent on load means `'conventional'`, and the load says so.** Every
   * assignment authored before 2026-09-21 predates the field and all of them are
   * conventional, so the default is right in every case it will ever be applied
   * to. It is announced anyway: "right in every case so far" is exactly the
   * reasoning that makes a silent default dangerous later, and this repo has
   * twice paid for a field that went missing quietly — `answerLines`, which
   * repaginates the sheet and moves `layout_id`, and `targetPoints`, which
   * halves every point one export cycle after the import that lost it. See
   * `assignmentKindDefaultedNotice` in `services/importNotices.ts`.
   *
   * **It never reaches the student.** It is not in `STUDENT_SPEC_FIELDS` and a
   * test asserts it stays out. The student's browser has no use for it, and
   * anything in that file is a claim rather than a fact because the gb1 key
   * ships inside the bundle — so the pipeline is built with nothing
   * student-facing carrying the kind at all, which leaves no claim for anything
   * downstream to validate.
   */
  assignmentKind: AssignmentKind;
  pageFormatId?: string; // QR field 2, [A-Z0-9]{1,12}. Unset = derived from courseCode + title.
  /**
   * Whether students may request the gradeless, pointer-only AI feedback on any
   * problem in this assignment. Whole-assignment; there are no per-problem allow
   * flags. Absent means off, so every spec written before this existed stays
   * valid and feedback-off.
   *
   * **Gates student-facing feedback only — never grading.** Whether the AI
   * analyses work and advises a grade to a human is driven by the submission
   * types and is unaffected by this. The feedback itself, the per-problem
   * one-time election and the cross-submission tally all live in
   * Gradescope/Docker; this app only records the instructor's choice and carries
   * it into the exported spec.
   */
  aiFeedback?: boolean;
  // No dueDate / dueTime, deliberately (removed 2026-08-31). Due dates are set
  // in Canvas and do not travel through this pipeline: `parseMdToAssignment`
  // never set them, the Editor stripped them on load, and
  // `ASSIGNMENT_MD_SPEC.md` §2 already documented `**Due:**` as ignored on
  // import. A field that is never present is a type that lies to the next
  // person who trusts it.
  preamble: string;
  problems: Problem[];
  /**
   * There is deliberately no grading-resource field here — no model, no
   * temperature, no token budget. **The Assignment Maker describes the work; the
   * grading system decides how to grade it** (ASSIGNMENT_MD_SPEC.md §12). The
   * `aiGradingConfig` that used to live here was read by nothing and was
   * removed on 2026-08-31; a spec exported before then still carries it and is
   * silently ignored on import.
   */
  targetPoints?: number; // Target total for point scaling (default 100)
  /**
   * Where a student goes to hand this assignment in — printed on page 1 of the
   * handwritten sheet, under "When you have finished writing".
   *
   * **A value, never a constant.** `templateLayout.ts` is explicit that the
   * standing text names no institution, because the tool is meant for use beyond
   * the campus that commissioned it and the text has to be true wherever it
   * prints. A hardcoded deployment URL is the same violation one step along:
   * this suite has already been renamed and moved hosts once, in August 2026,
   * and a URL baked into the generator would have printed a dead address onto
   * every sheet of that term. So the address is the instructor's to set, and the
   * tool only says what to do with it.
   *
   * **Absent means the whole submission section is not printed** — no
   * placeholder, no example, no sentence with a gap in it. A sheet reading "go
   * to ______" is worse than one that says nothing, because a hundred copies of
   * it are printed before anyone notices. See `submissionSection`.
   *
   * Handwritten only, in practice: an electronic student is already inside the
   * app by the time they read anything, so there is nothing to tell them. It is
   * carried on any assignment, like `pageFormatId`, rather than being made
   * conditional on a mode that can change.
   */
  submissionAddress?: string;
  createdAt: number;
  updatedAt: number;
}

export type AssignmentDraft = Omit<Assignment, 'id' | 'createdAt' | 'updatedAt'>;
