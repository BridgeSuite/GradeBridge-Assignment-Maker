// =====================================================
// A suite that ran nothing did not pass
// =====================================================
// WORKORDER_AM_HWK_CHECKS_ARE_DEAD_2026-09-25, Supplement 2, item 2.
//
// `figure-swap-e2e-tests.mjs` held one check, gated on course material. When
// the material was absent it skipped that check, printed `0 passed, 0 failed`
// and exited 0: a whole suite that tested nothing, reported as success, and it
// would have swallowed any check added to it later just the same.
//
// So every suite ends through `suiteExit`:
//
//   - any failure            -> exit 1
//   - no check ran at all    -> exit 1, and it says so
//   - otherwise              -> exit 0
//
// "Ran" means passed or failed. A skip is not a run. The runner (`run-all.mjs`)
// holds the same rule from the outside, as a backstop for a suite that forgets.

/** The exit code for a suite's counts. Pure, so it can be tested. */
export const suiteExitCode = (passed, failed) => (failed > 0 || passed + failed === 0 ? 1 : 0);

/** The line a suite that ran nothing prints, and the runner looks for. */
export const RAN_NOTHING = 'RAN NOTHING: this suite ran no checks, and a suite that tested nothing has not passed';

/**
 * The runner's backstop: true when a suite's output shows a standard
 * `N passed, M failed` summary with both zero. Suites that report in their own
 * format are not judged by this; see run-all.mjs.
 */
export const outputRanNothing = (stdout) => {
  const all = [...String(stdout).matchAll(/^(\d+) passed, (\d+) failed/gm)];
  if (!all.length) return false;
  const [, p, f] = all[all.length - 1];
  return Number(p) + Number(f) === 0;
};

/** End a suite. Never returns. */
export const suiteExit = (passed, failed) => {
  if (passed + failed === 0) console.log(`\n${RAN_NOTHING}\n`);
  process.exit(suiteExitCode(passed, failed));
};
