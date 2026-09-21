// =====================================================
// No process record is tracked
// =====================================================
// Reports, handoffs, directives, session notes, milestone reports, memos and
// start-here files are how one working session hands off to the next. They are
// not developer documentation, they name people and describe individual pieces
// of coursework, and this repository is public.
//
// **An ignore file is not a guard.** The `.gitignore` block for these existed,
// with a comment explaining the reasoning, while nineteen of them were tracked
// anyway: nine under `tests/captures/`, which the patterns did not reach, and
// the rest added before the block was written or added with `-f`. `.gitignore`
// says nothing about a file that is already in the index. This does.
//
// **There is no exemption list, deliberately.** A document that genuinely
// belongs to developers gets a name that is not a process-record name —
// `README.md`, `AUTOGRADER_ZIP_SPEC.md`, `tests/captures/BASELINE_*.md`. An
// exemption list is where the next process record comes to live.
// ADOPTED VERBATIM FROM THE STUDENT SUBMISSION REPOSITORY, which is canonical
// for this file. **Everything below this comment is byte-for-byte that copy**,
// so re-adopting when it moves again is a plain overwrite plus this block —
// not a merge. Do not edit the body here; edit it there.
//
// Three statements above describe THAT repository's tree rather than this one,
// and are kept rather than localised so the two files stay comparable:
//
//   * "nine under `tests/captures/`" — this repository has no capture folder.
//     Its nineteen arrived at the root and under `docs/session/`.
//   * the examples of legitimate names — here they are `ASSIGNMENT_MD_SPEC.md`,
//     `tests/README.md` and `docs/session/README.md`.
//   * CLEAN's "real filenames from this repository" — `AUTOGRADER_ZIP_SPEC.md`,
//     `BASELINE_2026-09-01.md` and `LABELS.csv` are that repository's. They are
//     strings fed to the matcher, so they test it equally well from here, and
//     the case that actually matters — `README.md` — is common to both.
//
// The rule enforced is the one in `docs/session/README.md`: work orders,
// handoffs, completion records, corrections and reports live in `docs/session/`
// and are not tracked. The pattern list is WIDER than those five prefixes and is
// kept wide deliberately — it is a superset, it flags nothing here, and two
// copies of one rule differing only in strictness is how a rule stops being one
// rule. `docs/session/README.md` needs no exemption: a README is not a
// process-record name.
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The same set the `.gitignore` block carries, as regexes over the BASENAME.
 *
 * Matched at any depth: these arrive in subdirectories as often as at the root,
 * and that is exactly how nine of them arrived.
 */
const PROCESS_RECORD = [
  /^HANDOFF_.*\.md$/i,
  /^COMPLETION_.*\.md$/i,
  /^WORKORDER_.*\.md$/i,
  /^WORK_ORDERS_.*\.md$/i,
  /^CORRECTION_.*\.md$/i,
  /^REPORT_.*\.md$/i,
  /^DIRECTIVE_.*\.md$/i,
  /^DECISION_.*\.md$/i,
  /^SESSION_.*\.md$/i,
  /^MILESTONE_.*\.md$/i,
  /^NOTE_.*\.md$/i,
  /^PLAN_.*\.md$/i,
  /^SCHEDULE_.*\.md$/i,
  /^RESUME_.*\.md$/i,
  /^HANDOVER_.*\.md$/i,
  /^BRIEF_.*\.md$/i,
  /^START_HERE.*\.md$/i,
  /_Memo_.*\.md$/i,
  /_Test_Battery_.*\.md$/i,
];

/**
 * Process records identified by WHERE they are rather than what they are
 * called, as regexes over the repo-relative POSIX path.
 *
 * `PROCESS_RECORD` above matches basenames, which is right for a naming
 * convention and wrong for this: a session artifact that is not a `.md` has no
 * agreed prefix to match on. On 2026-09-21 a `.patch` holding a discarded
 * feature was written to `docs/session/` and committed, because every pattern
 * above ends in `\.md$` and a `.patch` is not one. It was caught by review, not
 * by this file, and the fix is not another prefix — the next one would be a
 * `.txt`, a `.diff` or a `.json`.
 *
 * **`docs/session/` is for working notes and is not tracked**, per
 * `docs/session/README.md` and the `.gitignore` block. The exception is that
 * folder's own `README.md`, which explains the rule and is developer
 * documentation rather than a record of a session.
 */
const PROCESS_RECORD_PATHS = [
  /^docs\/session\/(?!README\.md$).+$/i,
];

const isProcessRecord = (path) =>
  PROCESS_RECORD.some((re) => re.test(basename(path)))
  || PROCESS_RECORD_PATHS.some((re) => re.test(path.replace(/\\/g, '/')));

// `git ls-files`, not the working directory. An untracked note beside the code
// is a working file and must not trip this; a committed one must always trip
// it, whether it is ignored or not — `git add -f` beats `.gitignore` and this
// is the thing that catches that.
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 64 << 20 })
  .toString('utf8').split('\0').filter(Boolean);

const offenders = tracked.filter(isProcessRecord);

let failed = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failed++; };

console.log(`\nno process records — ${tracked.length} tracked files\n`);

// =====================================================
// X-1: a check that scanned nothing must say so
// =====================================================
// Three findings in one week had this shape: one NUL byte hid 143 KB of source
// from a scan; a capture probe compared twelve names against an empty set;
// check 2 of the name guard scanned nothing in a repository with no images. All
// three were GREEN.
//
// **Green and correct look identical from outside, and that is the defect.**
//
// So both sets this file depends on are counted out loud on every run, and an
// empty one fails rather than passing vacuously. This check is allowed to find
// nothing. It is not allowed to be silent about having looked at nothing.
if (tracked.length === 0) {
  fail('git ls-files returned nothing — this check would pass by scanning an ' +
    'empty tree');
}
if (PROCESS_RECORD.length === 0) {
  fail('the pattern list is empty — every filename would be compared against ' +
    'nothing and reported clean');
}
if (PROCESS_RECORD_PATHS.length === 0) {
  fail('the path pattern list is empty — a session artifact with no process ' +
    'prefix would be reported clean');
}
console.log(`  ${plural(PROCESS_RECORD.length, 'filename pattern', 'filename patterns')} ` +
  `and ${plural(PROCESS_RECORD_PATHS.length, 'path pattern', 'path patterns')} ` +
  `over ${plural(tracked.length, 'tracked file', 'tracked files')}`);

// ---- the patterns are exercised, on names built here and tracked nowhere ----
// SS-3. **The Assignment Maker dropped this to stay in step with this copy and
// said it thought that a loss. It was.**
//
// Without it the only evidence the matcher works is the tree happening to
// contain a process record — and the whole point of the guard is that the tree
// does not. So it passed by matching nothing, which from outside is
// indistinguishable from matching correctly. That is the same failure this week
// produced three times.
//
// The names are strings in memory. Nothing is tracked, so nothing here can
// itself become a finding.
{
  const matches = (name) => PROCESS_RECORD.some((re) => re.test(name));

  /**
   * Real process-record filenames. **Written out, not derived from the
   * patterns.**
   *
   * The first version of this built each name from the pattern it was meant to
   * exercise, on the reasoning that a hand-maintained list stops being
   * maintained. It was self-fulfilling and a mutation proved it: corrupting
   * `^COMPLETION_` to `^COMPLETIONXX_` also corrupted the filename derived from
   * it, the two still matched, and the self-check passed. **A fixture generated
   * from the thing under test cannot test it** — it can only detect the thing
   * being deleted, never changed.
   *
   * So these are literal, and the coverage assertion below is what keeps the
   * hand-maintenance honest: a pattern that no name here matches fails, so
   * adding a pattern without a case is caught even though the case is manual.
   *
   * **They are filenames, and a filename is where a personal name hides.** The
   * first version of this list carried a real colleague's name in a plausible
   * brief filename, and `no-personal-names.mjs` — which scans this file like
   * every other — refused it. Keep them descriptive: a course code, a subject,
   * a date.
   */
  const DIRTY = [
    'HANDOFF_HANDWRITTEN_STAGE2B_2026-08-11.md',
    'COMPLETION_STUDENT_CONSUME_2026-09-01.md',
    'WORKORDER_NO_LOCAL_TRACES_2026-09-03.md',
    'WORK_ORDERS_2026-09.md',
    'CORRECTION_AM_TARGET_POINTS_2026-09-01.md',
    'REPORT_FULL_ASSIGNMENT_2026-09-03.md',
    'DIRECTIVE_FREEZE_2026-08-31.md',
    'DECISION_PACKAGE_CONTENTS_2026-09-01.md',
    'SESSION_REPORT_2026-03-24.md',
    'MILESTONE_ZERO_2026-09-01.md',
    'NOTE_AI_FEEDBACK_2026-08-18.md',
    'PLAN_ENG17_FALL_CONVERGENCE_2026-08-31.md',
    'SCHEDULE_FALL_2026.md',
    'RESUME_2026-09-02.md',
    'HANDOVER_2026-09-03.md',
    'BRIEF_AUTOGRADER_2026-06-20.md',
    'START_HERE_2026-09-03.md',
    'EEC100_Memo_2026-08-28.md',
    'EEC100_Test_Battery_2026-08-28.md',
  ];

  /**
   * Real filenames from this repository that must NOT match.
   *
   * Developer documentation is what a pattern reaching too far catches first,
   * and a false positive here is what would get the guard deleted rather than
   * fixed. `README.md` is the one that matters: a pattern anchored loosely
   * enough to match it takes the repository's front door with it.
   */
  const CLEAN = [
    'README.md', 'AUTOGRADER_ZIP_SPEC.md', 'CONTRIBUTING.md',
    'BASELINE_2026-09-01.md', 'LABELS.csv', 'types.ts', 'index.html',
    'PULL_REQUEST_TEMPLATE.md', 'LICENSE',
  ];

  /**
   * Paths that are process records because of where they sit, whatever they are
   * called. The first is the real file this rule was added for.
   */
  const DIRTY_PATHS = [
    'docs/session/SUPERSEDED_no_key_dialog_2026-09-06.patch',
    'docs/session/COMPLETION_AM_PIPELINE_RECALIBRATION_2026-09-21.md',
    'docs/session/scratch.txt',
    'docs/session/reviewer-notes.diff',
    'docs/session/nested/anything.json',
  ];

  /**
   * Paths that must stay clean. `docs/session/README.md` is the exception the
   * rule is written around — it explains the convention and is documentation.
   * The rest guard against a path pattern anchored loosely enough to escape the
   * folder: a `.patch` anywhere else in the tree is a legitimate file.
   */
  const CLEAN_PATHS = [
    'docs/session/README.md',
    'docs/architecture.md',
    'patches/vendor-fix.patch',
    'tests/fixtures/sample.patch',
    'converter/convert.py',
    'README.md',
  ];

  let ran = 0;
  for (const name of DIRTY) {
    ran++;
    if (!matches(name)) {
      fail(`the pattern list no longer matches ${name}, which is a process ` +
        `record and must never be tracked`);
    }
  }
  for (const path of DIRTY_PATHS) {
    ran++;
    if (!isProcessRecord(path)) {
      fail(`${path} is no longer recognised as a process record — anything ` +
        `under docs/session/ except its README must never be tracked`);
    }
  }
  for (const path of CLEAN_PATHS) {
    ran++;
    if (isProcessRecord(path)) {
      fail(`${path} is treated as a process record and must not be`);
    }
  }
  for (const name of CLEAN) {
    ran++;
    if (matches(name)) {
      fail(`the pattern list matches ${name}, which is developer documentation ` +
        `and must never be treated as a process record`);
    }
  }

  // What keeps a manual list from rotting: a pattern nothing above exercises is
  // a pattern nothing tests, and it fails here rather than sitting unproven.
  for (const re of PROCESS_RECORD) {
    if (!DIRTY.some((name) => re.test(name))) {
      fail(`no fixture exercises ${re} — add a filename to DIRTY rather than ` +
        `leaving the pattern unproven`);
    }
  }
  for (const re of PROCESS_RECORD_PATHS) {
    if (!DIRTY_PATHS.some((path) => re.test(path))) {
      fail(`no fixture exercises ${re} — add a path to DIRTY_PATHS rather than ` +
        `leaving the pattern unproven`);
    }
  }

  if (ran === 0) fail('the self-check exercised no filenames at all');
  console.log(`  self-check — ${ran} cases: ` +
    `${DIRTY.length} names and ${DIRTY_PATHS.length} paths that must match, ` +
    `${CLEAN.length} names and ${CLEAN_PATHS.length} paths that must not; ` +
    `every pattern covered`);
}

if (offenders.length > 0) {
  for (const path of offenders) fail(`tracked process record: ${path}`);
  console.error(
    `\n  ${offenders.length} process record(s) tracked. Move them out of the ` +
    `repository — they belong in the engineering record, not in a public code ` +
    `repository — then \`git rm --cached\` each one. Do not add an exemption.\n`);
  process.exit(1);
}
if (failed > 0) {
  console.error(`\n  ${failed} finding(s) — the guard itself is not working as ` +
    `described above.\n`);
  process.exit(1);
}
console.log('\n  no process records tracked\n');
