// =====================================================
// A skip must never look like a pass
// =====================================================
// WORKORDER_AM_HWK_CHECKS_ARE_DEAD_2026-09-25. The three ENG17 HW1 to HW3
// layout checks in `templateTests.mjs` are the guard against a change moving
// where answers sit on paper students have already printed. They looked for
// the wrong filename, skipped on every run, and the suite reported success.
//
// What is held here, by running `templateTests.mjs` as a child with
// `ENG17_HWK_DIR` pointed at an empty directory:
//
//   - the operator has said the files are there, so the three checks FAIL,
//     by name, rather than skipping;
//   - the suite exits non-zero because of it;
//   - the suite's own summary counts its skips, so a skip is never silent.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { suiteExit } from './suiteExit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

let passed = 0, failed = 0;
const results = [];
const check = (name, fn) => {
  try { fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log('\nA skip must never look like a pass\n');

const empty = mkdtempSync(join(tmpdir(), 'gb-no-eng17-'));
const run = spawnSync(process.execPath, [join(HERE, 'templateTests.mjs')], {
  cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, ENG17_HWK_DIR: empty },
});
const out = (run.stdout || '') + (run.stderr || '');
const LAYOUT_CHECK = (n) => new RegExp(`^ {2}(PASS|FAIL|SKIP) {2}ENG17 HW${n}: \\d+ regions join the rubric one-to-one`, 'm');

check('ENG17_HWK_DIR set to a directory without the files: the run exits non-zero', () => {
  assert(run.status !== 0 && run.status !== null,
    `templateTests.mjs exited ${run.status}${run.signal ? ` (${run.signal})` : ''}; a missing ENG17 file with the override set must fail the run`);
});

for (const n of [1, 2, 3]) {
  check(`ENG17_HWK_DIR set, HW${n} absent: its layout check FAILS, by name, and does not skip`, () => {
    const m = out.match(LAYOUT_CHECK(n));
    assert(m, `the HW${n} layout check did not report at all`);
    assert(m[1] === 'FAIL', `the HW${n} layout check reported ${m[1]}, not FAIL`);
  });
}

// Supplement 1, item 1: the answer-key leak checks on the real homeworks read
// the same directory and obey the same rule.
const LEAK_CHECK = (n) => new RegExp(`^ {2}(PASS|FAIL|SKIP) {2}ENG17 HW${n}: no grading material in any student-facing artifact`, 'm');
for (const n of [1, 2, 3]) {
  check(`ENG17_HWK_DIR set, HW${n} absent: its answer-key leak check FAILS, by name, and does not skip`, () => {
    const m = out.match(LEAK_CHECK(n));
    assert(m, `the HW${n} leak check did not report at all`);
    assert(m[1] === 'FAIL', `the HW${n} leak check reported ${m[1]}, not FAIL`);
  });
}

check('the failure says why: the override is set and the file is not there', () => {
  assert(/ENG17_HWK_DIR is set, so HW1 must be at/.test(out), 'the failure does not name the override and the path');
});

check('the suite summary counts skips, so a skip is never silent', () => {
  assert(/^\d+ passed, \d+ failed, \d+ skipped$/m.test(out), 'the summary line does not count skipped checks');
});

try { rmSync(empty, { recursive: true, force: true }); } catch { /* Windows keeps handles */ }

// =====================================================
// Supplement 2, item 1: the figure suites obey the same rule, from GB_ENG17_DIR
// =====================================================
{
  const none = mkdtempSync(join(tmpdir(), 'gb-no-eng17-fig-'));
  const env = { ...process.env, GB_ENG17_DIR: none };
  delete env.ENG17_HWK_DIR;
  const fx = spawnSync(process.execPath, [join(HERE, 'figure-extract-tests.mjs')], { cwd: REPO, encoding: 'utf8', env });
  const sw = spawnSync(process.execPath, [join(HERE, 'figure-swap-e2e-tests.mjs')], { cwd: REPO, encoding: 'utf8', env });
  check('GB_ENG17_DIR set, sources absent: figure-extract FAILS its three ENG17 checks, by name', () => {
    assert(fx.status === 1, `figure-extract-tests exited ${fx.status}`);
    for (const n of [1, 2, 3]) {
      assert(new RegExp(`^ {2}FAIL {2}CRITERION 2 \\(ENG17 HW${n}\\)`, 'm').test(fx.stdout), `HW${n} did not FAIL`);
    }
    assert(/GB_ENG17_DIR is set, so HW1 must be at/.test(fx.stdout), 'the failure does not name GB_ENG17_DIR');
  });
  check('GB_ENG17_DIR set, sources absent: figure-swap-e2e FAILS CRITERION 6 and does not tell you to set the variable', () => {
    assert(sw.status === 1, `figure-swap-e2e-tests exited ${sw.status}`);
    assert(/^ {2}FAIL {2}CRITERION 6/m.test(sw.stdout), 'CRITERION 6 did not FAIL');
    assert(!/set GB_ENG17_DIR/.test(sw.stdout.split('\n').filter(l => /CRITERION 6/.test(l)).join('\n')),
      'it tells the operator to set a variable that is set');
  });
  const both = spawnSync(process.execPath, [join(HERE, 'figure-extract-tests.mjs')], {
    cwd: REPO, encoding: 'utf8', env: { ...process.env, GB_ENG17_DIR: none, ENG17_HWK_DIR: REPO },
  });
  check('ENG17_HWK_DIR and GB_ENG17_DIR set to different folders: refused, not guessed', () => {
    assert(both.status !== 0, `figure-extract-tests exited ${both.status} with the two variables disagreeing`);
    assert(/both set and name different folders/.test(both.stdout + both.stderr), 'the refusal does not say why');
  });
  try { rmSync(none, { recursive: true, force: true }); } catch { /* Windows keeps handles */ }
}

// =====================================================
// Supplement 2, item 2: a suite that ran nothing has not passed
// =====================================================
const { suiteExitCode, outputRanNothing, RAN_NOTHING } = await import('./suiteExit.mjs');

check('suiteExitCode: nothing run is a failure; a pass is a pass; a failure is a failure', () => {
  assert(suiteExitCode(0, 0) === 1, 'a suite that ran nothing exits 0');
  assert(suiteExitCode(3, 0) === 0, 'a passing suite does not exit 0');
  assert(suiteExitCode(3, 1) === 1 && suiteExitCode(0, 1) === 1, 'a failing suite exits 0');
});

check('outputRanNothing reads the last summary line', () => {
  assert(outputRanNothing('x\n0 passed, 0 failed\n'), '"0 passed, 0 failed" was not seen as running nothing');
  assert(outputRanNothing('0 passed, 0 failed, 4 skipped'), 'skips were counted as runs');
  assert(!outputRanNothing('2 passed, 0 failed'), 'a suite that ran checks was seen as running nothing');
  assert(!outputRanNothing('no summary here'), 'no summary is for the runner to judge, not this');
});

// Every suite the runner runs ends through suiteExit, apart from the two
// disclosure guards the runner exempts by name. Read from the runner itself,
// so a suite added there without the rule fails here.
check('every suite in run-all.mjs ends through suiteExit, or is one of the two named exemptions', () => {
  const runAll = readFileSync(join(HERE, 'run-all.mjs'), 'utf8');
  const list = runAll.slice(runAll.indexOf('const SUITES = ['), runAll.indexOf('];', runAll.indexOf('const SUITES = [')));
  const suites = [...list.matchAll(/'([\w-]+\.mjs)'/g)].map(m => m[1]);
  assert(suites.length >= 16, `read only ${suites.length} suites from run-all.mjs`);
  const exempt = ['no-personal-names.mjs', 'no-process-records.mjs'];
  const missing = suites.filter(f => !exempt.includes(f))
    .filter(f => { const src = readFileSync(join(HERE, f), 'utf8');
      return !/suiteExit\(passed, failed\)/.test(src) || /process\.exit\(failed/.test(src); });
  assert(missing.length === 0, `these suites can still exit 0 having run nothing: ${missing.join(', ')}`);
});

// The runner's backstop, on real child processes: a suite that says it ran
// nothing, and one that says nothing at all, both exit 0 and both must FAIL.
{
  const dir = mkdtempSync(join(tmpdir(), 'gb-ran-nothing-'));
  const zero = join(dir, 'zero-suite.mjs'), silent = join(dir, 'silent-suite.mjs'), real = join(dir, 'real-suite.mjs');
  const lines = (...l) => l.map(x => `console.log(${JSON.stringify(x)});`).join('\n') + '\n';
  writeFileSync(zero, lines('  SKIP  a check (no data)', '', '0 passed, 0 failed'));
  writeFileSync(silent, lines('hello'));
  writeFileSync(real, lines('  PASS  a check', '', '1 passed, 0 failed'));
  const runner = (list) => spawnSync(process.execPath, [join(HERE, 'run-all.mjs')], {
    cwd: REPO, encoding: 'utf8', env: { ...process.env, GB_RUN_ALL_SUITES: list.join(',') },
  });
  const r1 = runner([zero]), r2 = runner([silent]), r3 = runner([real]);
  check('the runner FAILS a suite that exits 0 having run no checks', () => {
    assert(r1.status === 1, `run-all exited ${r1.status} for a suite that ran nothing`);
    assert(/ran no checks/.test(r1.stdout), 'run-all did not say the suite ran no checks');
  });
  check('the runner FAILS a suite that exits 0 and never says what it ran', () => {
    assert(r2.status === 1, `run-all exited ${r2.status} for a suite with no summary line`);
    assert(/printed no "N passed, M failed" line/.test(r2.stdout), 'run-all did not say why');
  });
  check('the runner still passes a suite that ran a check', () => {
    assert(r3.status === 0, `run-all exited ${r3.status} for a passing suite: ${r3.stdout.slice(-300)}`);
  });
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows keeps handles */ }
}

// And the suite-side rule, in a real child: suiteExit(0, 0) exits 1 and says so.
{
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { suiteExit } from ${JSON.stringify(pathToFileURL(join(HERE, 'suiteExit.mjs')).href)}; suiteExit(0, 0);`],
    { encoding: 'utf8' });
  check('suiteExit(0, 0) exits 1 and prints why', () => {
    assert(r.status === 1, `suiteExit(0, 0) exited ${r.status}`);
    assert(r.stdout.includes(RAN_NOTHING), 'suiteExit(0, 0) did not say it ran nothing');
  });
}



console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
// A suite that ran no checks has not passed (tests/suiteExit.mjs).
suiteExit(passed, failed);
