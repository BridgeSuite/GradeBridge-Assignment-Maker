
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

export interface Assignment {
  id: string;
  courseCode: string;
  title: string;
  inputMode?: InputMode; // How students answer. Absent (older assignments) means 'electronic'.
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
  coursePublicKey?: string; // SPKI PEM (public only). Present → students produce hardened gb2 submissions; absent → gb1.
  createdAt: number;
  updatedAt: number;
}

export type AssignmentDraft = Omit<Assignment, 'id' | 'createdAt' | 'updatedAt'>;
