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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
