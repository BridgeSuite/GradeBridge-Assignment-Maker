// =====================================================
// WHAT AN IMPORT TELLS THE INSTRUCTOR
// =====================================================
// One home for the sentences an import route says about a file that is not
// quite the shape the app now expects, so the `.md` route and the JSON route
// cannot drift into saying different things about the same file.
//
// The standing rule these all serve: **an import may adopt a default or drop a
// field, but it may never do either silently.** This repo has been caught by
// silent loss more than once — `answerLines` reverting to the six-line default
// repaginates the sheet and moves `layout_id`, and `targetPoints` going missing
// halves every point one export cycle later, where nothing connects the damage
// to the import that caused it. Neither refused anything; both looked like a
// clean load.

/**
 * Shown when an imported file still carries a course public key.
 *
 * REPORTS IT, NEVER REFUSES THE FILE. Submission encryption was removed from
 * the pipeline on 2026-09-21: student work now travels in plaintext over TLS
 * with integrity by hash, and the campus host receives only the answer-region
 * crops. There is nothing left for a course key to do, and the field no longer
 * exists on `Assignment`. The file imports perfectly well without it, so
 * refusing would cost the instructor their work for no safety gain.
 *
 * Saying nothing would be worse than either. An instructor who once pasted a
 * key, and who can still see it sitting at the top of their own file, has every
 * reason to believe their students' submissions are still being sealed with it.
 * They are not. The belief is what this message exists to correct — not the
 * key, which is now inert, but the assumption about what it is doing.
 */
export const courseKeyRemovedNotice = (): string =>
  'This file carries a course public key. Submission encryption has been '
  + 'removed from the pipeline, so the key no longer does anything and has been '
  + 'discarded. Student work is now sent over an encrypted connection and '
  + 'checked for tampering by hash instead. Nothing is required of you — you '
  + 'can delete the key from the file.';

/**
 * Shown when an imported file still carries a submission address.
 *
 * Removed 2026-09-22. Students are told to use the Submission app when they
 * receive the assignment, so the printed sheet does not need to repeat it, and
 * the field confused the first instructor who met it.
 *
 * Reported for the same reason a leftover course key is: an instructor who set
 * an address and can still see it in their own file would otherwise expect it
 * on the sheet, and find out it was not there by printing a hundred copies.
 */
export const submissionAddressRemovedNotice = (): string =>
  'This file carries a submission address. That setting has been removed — the '
  + 'printed sheet no longer has a "When you have finished writing" section — so '
  + 'the address has been discarded. Students are told how to hand work in when '
  + 'they open the assignment in the Submission app. Nothing is required of you.';

/**
 * Shown when an imported file has an image part set to automatic marking.
 *
 * Removed 2026-09-22. `imageGradingMode: 'auto'` exported as
 * `grading_type: "ai_image_completion"` — full marks for any upload at all,
 * with nobody looking at it. **A person decides every grade**, and no grading
 * type may award marks on its own.
 *
 * Reported rather than silently switched, because the instructor who chose it
 * chose something specific, and the part now behaves differently: somebody has
 * to look at those uploads who previously did not.
 */
export const autoImageGradingRemovedNotice = (count: number): string =>
  `${count} image question${count === 1 ? ' was' : 's were'} set to be marked `
  + 'automatically, which gave full marks for any upload without anyone looking. '
  + `That option has been removed, so ${count === 1 ? 'it is' : 'they are'} now `
  + 'reviewed by a person like every other image question. Nothing else about '
  + 'the assignment has changed.';

/**
 * Shown when a loaded assignment predates `assignmentKind` and is taken to be
 * conventional.
 *
 * Every assignment authored before 2026-09-21 is conventional, so the default
 * is right in every case it will ever be applied to. It is announced anyway,
 * because "right in every case so far" is exactly the reasoning that makes a
 * silent default dangerous later: the first reader assignment that arrives
 * through an old file would be adopted as conventional without a word.
 */
export const assignmentKindDefaultedNotice = (): string =>
  'This assignment does not say whether it is conventional or reader, so it has '
  + 'been opened as conventional. Every assignment authored before this field '
  + 'existed is conventional, so this is almost certainly right — but you can '
  + 'change it in the editor if it is not.';

// ---------------------------------------------------------------------------
// THE ONE PLACE A RETIRED FIELD IS STILL NAMED
// ---------------------------------------------------------------------------
// `WORKORDER_AM_PIPELINE_RECALIBRATION_2026-09-21` §3 defines "gb2 is gone"
// as a grep for these names returning nothing. It returns exactly this block,
// and that is not the removal failing — it is §3.3, which requires an import
// to REPORT a file that still carries a key rather than drop it silently. A
// detector cannot recognise a field it is not allowed to name.
//
// So the name lives here once, in the file that explains it, rather than being
// spelled out at each import route. Deleting this block would not finish the
// removal; it would only make an old file lose its key without a word, which
// is the behaviour §3.3 exists to prevent.
//
// **This is removable, and here is the condition.** Once no instructor is
// plausibly still importing a file authored before 2026-09-21, the notice has
// no audience and both this block and its callers can go. Nothing breaks if it
// is removed early except that those files go quiet.

/** Fields dropped from `Assignment` that a file written earlier may still carry. */
const RETIRED_ASSIGNMENT_FIELDS: ReadonlyArray<[string, () => string]> = [
  ['coursePublicKey', courseKeyRemovedNotice],
  ['submissionAddress', submissionAddressRemovedNotice],
];

/**
 * The same names, for the cross-repo whitelist check.
 *
 * Exported so the test suite reads this list rather than keeping a second copy
 * of it. The Student Submission app is a separate repository and still declares
 * `coursePublicKey` on its own `Assignment`; until that repo catches up, its
 * declaration is a field this app deliberately does not send, not a gap in the
 * whitelist. Sourcing the exemption from here means it disappears the moment
 * the entry above does, instead of outliving it as a hardcoded allowance.
 */
export const RETIRED_ASSIGNMENT_FIELD_NAMES: readonly string[] =
  RETIRED_ASSIGNMENT_FIELDS.map(([field]) => field);

/**
 * Remove any retired field from a freshly parsed assignment, returning one
 * notice per field actually found. Empty for every file authored since.
 *
 * Presence, not truthiness: a file carrying an empty key still carried one, and
 * an instructor who put it there is owed the same sentence as one whose key is
 * intact.
 */
/**
 * Give a loaded assignment a kind if it has none, returning a notice when the
 * default was applied and nothing when the file already answered.
 *
 * Mutates, like `stripRetiredFields` above, because both are called on a freshly
 * parsed object on its way into storage and the caller wants the notices, not a
 * copy.
 *
 * **Anything that is not one of the two values counts as absent**, including a
 * third value invented by a hand-edited file. There is no partial credit here:
 * the field has exactly two legal values, and a file claiming otherwise has not
 * answered the question.
 */
export const adoptAssignmentKind = (imported: Record<string, unknown>): string[] => {
  const kind = imported.assignmentKind;
  if (kind === 'conventional' || kind === 'reader') return [];
  imported.assignmentKind = 'conventional';
  return [assignmentKindDefaultedNotice()];
};

export const stripRetiredFields = (imported: Record<string, unknown>): string[] => {
  const notices: string[] = [];
  for (const [field, notice] of RETIRED_ASSIGNMENT_FIELDS) {
    if (field in imported) {
      delete imported[field];
      notices.push(notice());
    }
  }
  notices.push(...downgradeAutoImageGrading(imported));
  return notices;
};

/**
 * Turn every image part set to automatic marking into a reviewed one.
 *
 * A sub-part field rather than an assignment one, so it is walked here instead
 * of sitting in `RETIRED_ASSIGNMENT_FIELDS`. Counted and reported once rather
 * than once per part: an instructor with eleven image questions needs one
 * sentence, not eleven.
 */
export const downgradeAutoImageGrading = (imported: Record<string, unknown>): string[] => {
  const problems = Array.isArray(imported.problems) ? imported.problems : [];
  let count = 0;
  for (const p of problems as Array<Record<string, unknown>>) {
    const subs = Array.isArray(p?.subsections) ? p.subsections : [];
    for (const s of subs as Array<Record<string, unknown>>) {
      if (s?.imageGradingMode === 'auto') { s.imageGradingMode = 'human'; count += 1; }
    }
  }
  return count ? [autoImageGradingRemovedNotice(count)] : [];
};
