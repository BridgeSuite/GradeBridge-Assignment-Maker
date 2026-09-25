// =====================================================
// Where the real ENG17 homeworks are, for every suite that reads them
// =====================================================
// WORKORDER_AM_HWK_CHECKS_ARE_DEAD_2026-09-25, Supplement 2, item 1.
//
// Three suites read the same three files and each used to decide on its own
// where they were: `templateTests.mjs` from `ENG17_HWK_DIR` with a default,
// `figure-extract-tests.mjs` and `figure-swap-e2e-tests.mjs` from
// `GB_ENG17_DIR` with none. All three looked for `ENG17_HW{n}_assignment.md`,
// and the files are `ENG17_Homework_{n}.md`, so all ten checks skipped on
// every run, including with the variable set. One answer now, here:
//
//   - EITHER variable names the folder holding `HWK1` .. `HWK3`. Both are
//     accepted because operators have been told both; if both are set they
//     must agree, or every suite that reads them refuses rather than guess.
//   - Unset, the default is the folder beside this checkout where the course
//     material lives on the machine that has it. RELATIVE, so no home directory
//     is written into a repository that is going public.
//   - `overrideSet` is what turns a missing file from a SKIP into a FAIL: an
//     operator who set the variable has said the files are there.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ENG17_ENV_VARS = ['ENG17_HWK_DIR', 'GB_ENG17_DIR'];
export const ENG17_DEFAULT_DIR = resolve(REPO, '..', '..', '..', 'Knoesen', 'ENG17-Assignments', 'New HWKs');

/** The folder, whether an operator named it, and which variable they used. */
export const eng17Dir = (env = process.env) => {
  const named = ENG17_ENV_VARS.filter(v => env[v]);
  if (named.length === 2 && resolve(env[named[0]]) !== resolve(env[named[1]])) {
    throw new Error(`ENG17_HWK_DIR and GB_ENG17_DIR are both set and name different folders `
      + `(${resolve(env[named[0]])} and ${resolve(env[named[1]])}). Set one, or make them agree.`);
  }
  return named.length
    ? { dir: resolve(env[named[0]]), overrideSet: true, via: named[0] }
    : { dir: ENG17_DEFAULT_DIR, overrideSet: false, via: null };
};

/** The path to homework `n`'s source. */
export const eng17Source = (n, env = process.env) =>
  join(eng17Dir(env).dir, `HWK${n}`, `ENG17_Homework_${n}.md`);

/**
 * What a suite should do about homework `n`: `run` with a path, or, when the
 * file is absent, `fail` if an operator named the folder and `skip` if not.
 * The reason is written for the person reading the output, and the two
 * absent cases never share a message.
 */
export const eng17Plan = (n, env = process.env) => {
  const { dir, overrideSet, via } = eng17Dir(env);
  const path = join(dir, `HWK${n}`, `ENG17_Homework_${n}.md`);
  if (existsSync(path)) return { action: 'run', path };
  if (overrideSet) {
    return { action: 'fail', path,
      why: `${via} is set, so HW${n} must be at ${path}, and it is not. A check that cannot find its file has tested nothing.` };
  }
  return { action: 'skip', path,
    why: `not at ${path}; set ENG17_HWK_DIR (or GB_ENG17_DIR) to the folder holding HWK1..HWK3 to run it` };
};
