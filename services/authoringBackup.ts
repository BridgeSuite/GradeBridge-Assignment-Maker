// =====================================================
// AUTHORING BACKUP — {stem}_authoring_backup.json
// =====================================================
// The one file in the export ZIP whose job is COMPLETENESS. It carries the
// entire `Assignment` object, unencrypted, and restores it exactly.
//
// WHY THIS FILE EXISTS AT ALL
//   The app's privacy notice tells instructors to export the ZIP as their
//   backup, and until 2026-08-31 nothing in that ZIP restored an assignment
//   completely:
//
//   - `assignment_spec.json` is now a whitelist of what the student's browser
//     reads, so it correctly drops `aiGradingPrompt`, `graderNote`,
//     `answerLines` and `handwrittenGradingMode`. Losing `answerLines` alone
//     reverts every part to the six-line default, which repaginates the sheet
//     and moves `layout_id` — you do not get your assignment back, you get a
//     different one that looks like yours.
//   - `Export .md` carries far more (prompts byte-for-byte, `answerLines`,
//     `inputMode`, `pageFormatId`, `aiFeedback`) but not `targetPoints`,
//     `coursePublicKey` or `config` — and the ZIP did not even contain it.
//     `targetPoints` is the nastiest of the three because the damage is delayed
//     one cycle: the .md carries already-scaled values, so the reimport looks
//     right and the NEXT export normalises to 100 and halves every point.
//     Two of those three have since been fixed at the source: `targetPoints` on
//     2026-09-01 (the import reads the file's own total) and `coursePublicKey`
//     on 2026-09-05 (the .md carries a fenced ```pem block). `config` remains,
//     and so does the reason this file exists — a route that has to be
//     re-verified every time a field is added to `Assignment` is a guarantee
//     that decays quietly.
//
//   In every case the loss was silent.
//
// THE POINT OF THE SPLIT
//   Each file gets one job, so the guarantees stop fighting each other:
//
//     assignment_spec.json        minimal — never grading material
//     {stem}.md                   human-editable, hand-writable, round-trip stable
//     {stem}_authoring_backup.json  COMPLETE, and tested as such
//
//   Completeness is now **one property of one file with one test**, rather than
//   something that has to be re-verified on both other routes every time a field
//   is added to `Assignment`. The round-trip test is deliberately written to
//   fail when a new field is not carried, so the guarantee cannot rot.
//
// UNENCRYPTED, DELIBERATELY
//   Consistent with the rest of the instructor half of the ZIP: the grader
//   document and the grading rubric are already in the clear and are already
//   full of answers. Encrypting a backup only makes it harder to recover from.
//   It does mean the ZIP is **instructor-only and must never be given to
//   students** — see the privacy notice and README.
//
// SELF-DESCRIBING
//   The envelope names the artifact, so Import JSON knows what it was handed
//   instead of guessing from shape. A student spec and a backup are not reliably
//   distinguishable structurally (a text-only assignment carries no prompts
//   either), and guessing at read time is the failure this suite keeps
//   re-learning. No timestamp is written: re-exporting an unchanged assignment
//   produces a byte-identical file, which makes a diff meaningful.

import { Assignment } from '../types';

export const AUTHORING_BACKUP_ARTIFACT = 'authoring_backup';
export const AUTHORING_BACKUP_VERSION = 1;

export interface AuthoringBackup {
  gradebridge_artifact: typeof AUTHORING_BACKUP_ARTIFACT;
  format_version: number;
  app: string;
  /** The entire Assignment object, verbatim. */
  assignment: Assignment;
}

/** The file's text. Pretty-printed: a backup is something a human may have to read. */
export const buildAuthoringBackup = (assignment: Assignment): string =>
  JSON.stringify({
    gradebridge_artifact: AUTHORING_BACKUP_ARTIFACT,
    format_version: AUTHORING_BACKUP_VERSION,
    app: 'GradeBridge Assignment Maker',
    assignment,
  } satisfies AuthoringBackup, null, 2);

/** True when this parsed JSON is an authoring backup rather than some other export. */
export const isAuthoringBackup = (parsed: unknown): parsed is AuthoringBackup =>
  !!parsed && typeof parsed === 'object' &&
  (parsed as AuthoringBackup).gradebridge_artifact === AUTHORING_BACKUP_ARTIFACT &&
  !!(parsed as AuthoringBackup).assignment;

/**
 * The Assignment out of a backup, verbatim — no defaulting, no repair. Anything
 * added here would be a field the round-trip test could no longer catch as
 * missing, which is the one thing this file is for.
 */
export const readAuthoringBackup = (parsed: unknown): Assignment => {
  if (!isAuthoringBackup(parsed)) {
    throw new Error('Not a GradeBridge authoring backup.');
  }
  if (parsed.format_version > AUTHORING_BACKUP_VERSION) {
    throw new Error(
      `This authoring backup was written by a newer version of the Assignment Maker ` +
      `(format ${parsed.format_version}, this app reads ${AUTHORING_BACKUP_VERSION}). Update the app before importing it.`
    );
  }
  return parsed.assignment;
};

// ---- What a non-backup import is about to lose -------------------------------

/** One instructor-facing field that a student spec does not carry. */
interface Gap { label: string; present: (a: any) => boolean; }

const GAPS: Gap[] = [
  { label: 'grading prompts (the AI rubric for each part)',
    present: a => subs(a).some(s => s.aiGradingPrompt) },
  { label: 'grader notes (the human grader\'s reference answer)',
    present: a => subs(a).some(s => s.graderNote) },
  { label: 'answer-space settings (`lines=N` / `sketch`) — without them every handwritten part reverts to the 6-line default and the printed sheet repaginates',
    present: a => subs(a).some(s => s.answerLines !== undefined || s.isDrawing !== undefined) },
  { label: 'handwritten grading mode (AI or human per part)',
    present: a => subs(a).some(s => s.handwrittenGradingMode) },
  { label: 'the point target — without it the next export normalises to 100 and rescales every point',
    present: a => a.targetPoints !== undefined },
  { label: 'the course public key — without it exports fall back from gb2 to gb1',
    present: a => !!a.coursePublicKey },
  { label: 'the submission address — without it page 1 of the printed sheet does not tell students how to hand the work in',
    present: a => !!(a.submissionAddress || '').trim() },
];

const subs = (a: any): any[] =>
  Array.isArray(a?.problems) ? a.problems.flatMap((p: any) => p?.subsections || []) : [];

/**
 * What this file does NOT carry, in instructor language. Empty when the file is
 * complete enough that nothing is worth saying.
 *
 * Absence is reported, not inferred from the file's kind: an assignment that
 * genuinely has no grading prompts is not warned about prompts it never had.
 * That keeps the message true, which is what makes it worth reading — the
 * failure being fixed here is silent loss, and a warning nobody believes is the
 * same failure with extra steps.
 */
export const describeImportGaps = (parsed: any): string[] =>
  GAPS.filter(g => !g.present(parsed)).map(g => g.label);
