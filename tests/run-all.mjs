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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  'run-tests.mjs',
  'templateTests.mjs',
  'bundle-tests.mjs',
  'no-personal-names.mjs',
  'no-process-records.mjs',
];

const results = [];

for (const suite of SUITES) {
  const run = spawnSync(process.execPath, [join(HERE, suite)], {
    stdio: 'inherit',
    cwd: join(HERE, '..'),
  });
  // A suite killed by a signal has no exit code; treat that as a failure rather
  // than as a pass, which `status === 0` alone would not.
  const failed = run.status !== 0 || run.signal !== null;
  results.push({ suite, failed, status: run.status, signal: run.signal });
}

const width = Math.max(...SUITES.map(s => s.length));
console.log('\n' + '='.repeat(width + 20));
console.log('SUITE SUMMARY');
console.log('='.repeat(width + 20));
for (const r of results) {
  const how = r.signal ? `killed by ${r.signal}` : r.failed ? `exit ${r.status}` : 'ok';
  console.log(`  ${r.failed ? 'FAIL' : 'pass'}  ${r.suite.padEnd(width)}  ${how}`);
}

const failedSuites = results.filter(r => r.failed);
console.log(
  `\n${results.length - failedSuites.length} of ${results.length} suites passed` +
  (failedSuites.length ? `; failed: ${failedSuites.map(r => r.suite).join(', ')}` : '') + '\n'
);

process.exit(failedSuites.length > 0 ? 1 : 0);
