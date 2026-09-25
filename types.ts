
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
  /**
   * Image parts only. **The only value is `'human'`: a person reviews the
   * upload.**
   *
   * `'auto'` was removed on 2026-09-22. It exported as
   * `grading_type: "ai_image_completion"`, documented as "auto-award if
   * `images_submitted > 0`" — full marks for any upload at all, with nobody
   * looking at it. **A person decides every grade** (Andre, 2026-09-22), and no
   * grading type may award marks on its own.
   *
   * The field is kept rather than deleted because it still carries a real
   * choice for the day a second review mode exists, and because removing it
   * outright would make an older file's value vanish with nothing said. A file
   * carrying `'auto'` is reported on import and treated as human review.
   */
  imageGradingMode?: 'human';
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
 * One figure file, as the app stores it.
 *
 * Bytes are held base64-encoded because that is the one form that survives
 * every route this app has: JSON storage, the authoring backup, and a `data:`
 * URI in a rendered page. `filename` is kept only so the instructor can be told
 * what they uploaded; nothing reads it to decide anything.
 */
export interface FigureFile {
  format: 'svg' | 'png' | 'jpg';
  /** The file's bytes, base64. For SVG this decodes to the document text. */
  base64: string;
  /** What the file was called when it arrived. Display only. */
  filename: string;
}

/** Figure id to file. Ids are `[a-z0-9-]{1,40}` and name the file on disk. */
export type FigureMap = Record<string, FigureFile>;

/**
 * What finalizing records: the layout the printed sheet carries, a fingerprint
 * of what students see, and the date.
 *
 * `layoutId` is empty for an electronic assignment, which has no printed
 * layout. Such an assignment is still fingerprinted, so the lock works for it
 * on content alone.
 */
export interface FinalizeStamp {
  /** `YYYY-MM-DD`. */
  date: string;
  /** The `layout_id` computed fresh at the moment of finalizing. */
  layoutId: string;
  /** 16 hex characters over the student-facing content. See `services/finalize.ts`. */
  fingerprint: string;
}

/**
 * The two kinds of assignment. Two values, no third, and no blank once set.
 */
export type AssignmentKind = 'conventional' | 'reader';

/** The only non-default answer sheet. See `Assignment.sheet`. */
export type SheetKind = 'generic';

export interface Assignment {
  id: string;
  courseCode: string;
  title: string;
  inputMode?: InputMode; // How students answer. Absent (older assignments) means 'electronic'.
  /**
   * What a handwritten student writes on. **Absent means today's app-printed
   * sheet** — the questions and one box per part, with a layout of its own.
   * `'generic'` means the instructor posts their own question PDF and every
   * student writes on the one generic answer page (`services/genericAnswerPage.ts`),
   * telling the Submission app which part each page holds.
   *
   * **Handwritten only.** An electronic assignment never carries it: an import
   * reports and discards it, and the export refuses one that still does
   * (`sheetProblem` in `services/inputModeService.ts`). One value and no second,
   * so that every file written before it existed means what it always meant.
   */
  sheet?: SheetKind;
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
   * **It reaches the student, since 2026-09-25**, and a test asserts it stays
   * on `STUDENT_SPEC_FIELDS`. It was withheld until then on the reasoning that
   * the student's browser had no use for it. That stopped being true: the
   * Submission app writes sentences that depend on whether a grader exists and
   * chooses what to show per part by whether points exist, and without the
   * field it had to infer the kind from whether `parts` carries `max_points`.
   * This project does not accept inference where a declaration can be written
   * (it is why `part_source` exists), so the kind travels.
   *
   * **The student's copy is for the Submission app's own presentation, not for
   * grading.** Anything in that file is a claim rather than a fact, because the
   * gb1 key ships inside the bundle. The grading side learns the kind from
   * `assignment_kind` in `{stem}_grading_rubric.json`, which stays with the
   * instructor, and must go on doing so.
   */
  assignmentKind: AssignmentKind;
  /**
   * The figure files this assignment's ```figure blocks refer to, by id.
   *
   * **Per assignment and copied, never shared.** A course-wide figure library
   * was considered and rejected: a change made for one assignment would
   * silently change another assignment's printed sheet, and no assignment would
   * be self-contained.
   *
   * Absent on an assignment with no figure blocks, which is every assignment
   * authored before 2026-09-21 and every one whose figures stay inline.
   *
   * **Never reaches a student.** `buildAssignmentSpec` resolves the blocks into
   * inline figures and drops this map, so the student spec carries drawings and
   * no references — exactly as it did before figure blocks existed.
   */
  figures?: FigureMap;
  /**
   * Present once the instructor has issued this assignment. An export that
   * would change the student-facing content or the printed layout is then
   * refused until the assignment is explicitly reopened.
   *
   * **Never reaches a student.** It is not in `STUDENT_SPEC_FIELDS` and a test
   * asserts it stays out: it is a fact about the instructor's workflow, and the
   * student's copy has no use for it.
   */
  finalized?: FinalizeStamp;
  /**
   * Every stamp this assignment has had, appended to on each reopen and never
   * overwritten.
   *
   * The lock does not prevent an assignment being changed after issue — it
   * makes the change visible. This is where it stays visible.
   */
  finalizeHistory?: FinalizeStamp[];
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
  // No submissionAddress, deliberately (removed 2026-09-22). Students are told
  // to use the Student Submission app when they receive the assignment, so the
  // printed sheet does not need to repeat it, and the field confused the first
  // instructor who met it. It was never set on any real assignment — HW1 to HW3
  // print identically without it, which is why removing it moves no layout —
  // and the page-1 section it conditioned went with it.
  createdAt: number;
  updatedAt: number;
}

export type AssignmentDraft = Omit<Assignment, 'id' | 'createdAt' | 'updatedAt'>;
