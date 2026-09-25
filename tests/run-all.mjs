// =====================================================
// Run every suite. Always all of them. Report each.
// =====================================================
// `npm test` used to be the five suites joined with `&&`, which meant the FIRST
// failing suite stopped the rest from running at all.
//
// That is not a theoretical cost. Between the ENG17 Fall course key being
// reissued at RSA-4096 and 2026-09-05, two assertions in `run-tests.mjs`
// hardcoded a 2048-bit modulus and failed — and behind those two red lines sat
// `templateTests` (127 checks), `bundle-tests` (10), `no-personal-names` and
// `no-process-records`, all green, none of which anyone had seen run since. The
// repository was one command away from a name or a local path being committed
// into a repository that is going public, and the command reported nothing
// because an unrelated key size was wrong.
//
// **A red line that prevents anyone reading the green ones behind it is the same
// defect as the bad assertion itself**, so the chaining is gone: every suite
// runs, every suite reports, and the exit code is non-zero if any of them
// failed. A failure is still a failure; it just no longer conceals the others.

import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outputRanNothing } from './suiteExit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  'run-tests.mjs',
  'templateTests.mjs',
  'bundle-tests.mjs',
  'no-personal-names.mjs',
  'no-process-records.mjs',
  'deploy-gate-tests.mjs',
  'figure-ref-tests.mjs',
  'figure-guard-tests.mjs',
  'finalize-tests.mjs',
  'figure-extract-tests.mjs',
  'figure-swap-e2e-tests.mjs',
  'figure-render-tests.mjs',
  'generic-sheet-tests.mjs',
  'instructor-ui-tests.mjs',
  'no-dialog-tests.mjs',
  'skip-visibility-tests.mjs',
];

// For the test of this runner only (`skip-visibility-tests.mjs`): a
// comma-separated list of suite files to run INSTEAD of the list above, so the
// "ran nothing" backstop can be shown failing a real child process. Never set
// in CI or by `npm test`.
const ONLY = process.env.GB_RUN_ALL_SUITES;
if (ONLY) SUITES.splice(0, SUITES.length, ...ONLY.split(',').filter(Boolean));

const results = [];
// Every skipped check in every suite, gathered for the summary below. A skip
// tested nothing, and the ENG17 layout checks skipped on every run for weeks
// behind a green summary (WORKORDER_AM_HWK_CHECKS_ARE_DEAD_2026-09-25). So
// the last thing this prints names each one, with a count. Suites mark a skip
// as a line `  SKIP  <name> (<why>)`, and that is what is collected.
const skips = [];

// THE BACKSTOP for "a suite that ran nothing has not passed" (Supplement 2,
// item 2). Every counter-based suite ends through `suiteExit` and fails itself;
// this catches one that forgets, from the outside. A suite exiting 0 is judged
// a FAILURE here if its `N passed, M failed` line shows no check run, or if it
// prints no such line at all, because then nothing says it ran anything.
//
// Two suites report in their own format and are exempt from the second test,
// by name and for a stated reason: each is a disclosure guard whose scans fail
// on an empty set by design and whose self-checks run on in-memory fixtures on
// every run, so neither can run nothing and exit 0.
const OWN_FORMAT = new Set(['no-personal-names.mjs', 'no-process-records.mjs']);

for (const suite of SUITES) {
  // stdout is captured, then echoed, so its SKIP lines can be collected;
  // stderr still goes straight through.
  const run = spawnSync(process.execPath, [isAbsolute(suite) ? suite : join(HERE, suite)], {
    stdio: ['inherit', 'pipe', 'inherit'],
    cwd: join(HERE, '..'),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const out = run.stdout || '';
  process.stdout.write(out);
  for (const m of out.matchAll(/^ {2}SKIP {2}(.+)$/gm)) skips.push({ suite, line: m[1] });
  // A suite killed by a signal has no exit code; treat that as a failure rather
  // than as a pass, which `status === 0` alone would not.
  let failed = run.status !== 0 || run.signal !== null;
  let why = null;
  if (!failed && outputRanNothing(out)) { failed = true; why = 'ran no checks'; }
  if (!failed && !OWN_FORMAT.has(suite) && !/^\d+ passed, \d+ failed/m.test(out)) {
    failed = true; why = 'printed no "N passed, M failed" line, so nothing says it ran anything';
  }
  results.push({ suite, failed, status: run.status, signal: run.signal, why });
}

const width = Math.max(...SUITES.map(s => s.length));
console.log('\n' + '='.repeat(width + 20));
console.log('SUITE SUMMARY');
console.log('='.repeat(width + 20));
for (const r of results) {
  const how = r.signal ? `killed by ${r.signal}` : r.why ? r.why : r.failed ? `exit ${r.status}` : 'ok';
  console.log(`  ${r.failed ? 'FAIL' : 'pass'}  ${r.suite.padEnd(width)}  ${how}`);
}

const failedSuites = results.filter(r => r.failed);
console.log(
  `\n${results.length - failedSuites.length} of ${results.length} suites passed` +
  (failedSuites.length ? `; failed: ${failedSuites.map(r => r.suite).join(', ')}` : '') + '\n'
);

console.log(`${skips.length} check${skips.length === 1 ? '' : 's'} skipped, and so tested nothing` +
  (skips.length ? ':' : '.'));
for (const k of skips) console.log(`  SKIP  ${k.suite}: ${k.line}`);
console.log('');

// In GitHub Actions, the same list as an ANNOTATION on the run. The run's log
// needs authentication to read and annotations do not, so this is how anyone,
// including a later session, confirms from CI which checks CI skipped
// (Supplement 2, item 5). Written with a count EVEN WHEN IT IS ZERO: an absent
// annotation would otherwise be read as "nothing skipped" when it could as
// easily mean "this step never ran" -- the same absence-read-as-a-fact that
// this order exists to remove.
if (process.env.GITHUB_ACTIONS === 'true') {
  const esc = (t) => String(t).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const body = skips.length ? skips.map(k => `${k.suite}: ${k.line}`).join('\n') : 'none';
  console.log(`::notice title=${skips.length} check${skips.length === 1 ? '' : 's'} skipped in CI::${esc(body)}`);
}

process.exit(failedSuites.length > 0 ? 1 : 0);
