// =====================================================
// No process record is tracked
// =====================================================
// Work orders, handoffs, completion records, corrections and reports are the
// working notes of a session. They are not contracts, they date fast, and they
// name what was going wrong at the time. `docs/session/README.md` has said they
// belong in `docs/session/` and are not tracked since 2026-08-17.
//
// **`.gitignore` is not a guard.** It is a default, and `git add -f` walks past
// it without comment. That is how nineteen process documents came to be tracked
// in this repository before 2026-09-03 — every one of them ignored on paper.
// A rule with no check behind it is a preference.
//
// So this is the check. It fails the suite if a process record is tracked,
// wherever it sits in the tree.
//
// SCOPE, AND WHY IT IS THE PATH AND NOT THE CONTENT
//
//   Matching is by filename prefix, the same five the rule and `.gitignore`
//   name. Not by reading the file: a document's content is not what makes it a
//   process record, its role is, and a content heuristic would fire on the
//   contracts — `ASSIGNMENT_MD_SPEC.md` and `tests/README.md` both quote work
//   orders and describe completions at length, correctly.
//
// THE ONE TRACKED FILE IN THAT FOLDER
//
//   `docs/session/README.md` is tracked and must stay so. It is the thing that
//   tells the next session the rule exists, and in a fresh clone it is the only
//   file in the folder. It is a README, not a process record, so it does not
//   match the prefixes — but it is named explicitly below so that nobody
//   loosens the pattern later to let it through.
//
// This guard is NOT a port. The Student Submission repository has its own
// `tests/no-process-records.mjs` enforcing the same rule, but the work order of
// 2026-09-03 permitted reading exactly two files from that repository and this
// was not one of them. Written from the rule in `docs/session/README.md`
// instead. **The two are therefore not known to agree** — if they are ever to
// be held in step, someone who may read both should diff them.
import { execFileSync } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The five prefixes named by the rule and by `.gitignore`. */
const PREFIXES = ['WORKORDER', 'HANDOFF', 'COMPLETION', 'CORRECTION', 'REPORT'];

/** Tracked files that look like a process record but are not one. */
const ALLOWED = new Set([
  'docs/session/README.md',
]);

const isProcessRecord = (path) => {
  const name = basename(path);
  return PREFIXES.some(p => name.toUpperCase().startsWith(p + '_'));
};

let failed = 0;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failed++; };

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, maxBuffer: 64 << 20 })
  .toString('utf8').split('\0').filter(Boolean);

console.log(`\nno process records — ${tracked.length} tracked files\n`);

const offenders = tracked.filter(p => isProcessRecord(p) && !ALLOWED.has(p));
for (const path of offenders) {
  fail(`${path} is a process record and is tracked — move it to docs/session/ ` +
    `and remove it from the index (git rm --cached). Do NOT add it to ALLOWED; ` +
    `that list is for files which are not process records, not for exceptions.`);
}

// An allowance for a file that has gone protects nothing and hides the next
// real finding behind a stale entry.
for (const path of ALLOWED) {
  if (!tracked.includes(path)) {
    fail(`the allowed path ${path} is no longer tracked — delete its entry ` +
      `rather than leaving an allowance that protects nothing`);
  }
}

// A guard that silently stops matching is worse than none, and this one matches
// on a string pattern that a refactor could quietly break. Prove it still
// recognises each of the five shapes, and that it does not swallow the README.
{
  const shouldMatch = [
    'WORKORDER_AM_SOMETHING_2026-09-03.md',
    'docs/session/HANDOFF_2026-09-03.md',
    'COMPLETION_AM_SOMETHING_2026-09-03.md',
    'deep/nested/CORRECTION_SOMETHING.md',
    'REPORT_SOMETHING_2026-09-03.md',
  ];
  const shouldNot = [
    'docs/session/README.md',
    'README.md',
    'tests/README.md',
    'ASSIGNMENT_MD_SPEC.md',
    'services/reportBuilder.ts',      // starts with the letters, is not the prefix
    'REPORTING.md',                   // ditto: no underscore, so not the shape
  ];
  for (const p of shouldMatch) {
    if (!isProcessRecord(p)) fail(`the guard no longer recognises ${p} as a process record`);
  }
  for (const p of shouldNot) {
    if (isProcessRecord(p)) fail(`the guard wrongly treats ${p} as a process record`);
  }
}

if (failed > 0) {
  console.error(`\n  ${failed} finding(s).\n`);
  process.exit(1);
}
console.log(`  ${PREFIXES.join(', ')} — none tracked (${ALLOWED.size} allowed file present)`);
console.log('  no process record is tracked\n');
