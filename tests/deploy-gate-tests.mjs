// =====================================================
// The deploy gate, on every branch it refuses
// =====================================================
// `scripts/check-ci-green.mjs` stands between `npm run deploy` and production.
// **A gate tested only on the pass is not tested**, so every refusal branch is
// exercised here: a failed run, a cancelled run, a run still in progress, no run
// at all, and each of the several ways the API can fail to answer.
//
// HOW THIS TESTS THE REAL FILE WITHOUT WEAKENING IT
//
// The gate hardcodes `https://api.github.com`. It would be easy to make that an
// environment variable and point it at a stub — and that is exactly what must
// not be done. `GB_ALLOW_RED_CI` is a LOUD override: it prints, in full, that
// the build was never verified. An environment variable that redirected the API
// would be a SILENT one, because the gate would print "CI is green" on the word
// of whatever answered. A gate with a quiet way to make it open is not a gate.
//
// So the shipped file is left alone and each scenario runs a COPY with that one
// constant rewritten to a local stub server. The copy is diffed against the
// original first, and the test fails unless **exactly one line** differs. What
// runs is therefore the shipped logic, not a paraphrase of it.
//
// The gate reads `git rev-parse HEAD` and the origin remote from its working
// directory, so the copies run with cwd set to this repository and ask about a
// real commit. Only the answer is stubbed.

import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const GATE = join(REPO, 'scripts', 'check-ci-green.mjs');

let passed = 0, failed = 0;
const results = [];

/**
 * Checks are awaited one at a time, and the spawns inside them are ASYNC.
 *
 * `spawnSync` cannot be used here and the reason is worth keeping: it blocks the
 * parent's event loop, so the stub server in this process can never accept the
 * connection. The gate then does exactly what it should — refuses, after its
 * 15-second timeout, saying it could not reach the API — and every scenario
 * "passes" for the wrong reason while the suite takes five minutes. A test that
 * is green because the thing under test failed is worse than no test.
 */
const check = async (name, fn) => {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const skip = (name, why) => results.push(`  SKIP  ${name} (${why})`);
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log('\nDeploy gate — every refusal branch\n');

// ---------------------------------------------------------------------------
// 1. The shipped file is the Student Submission file, byte for byte
// ---------------------------------------------------------------------------
// Ported rather than rewritten, so the two stay diffable. The slug is derived
// from the origin remote, which is why no edit was needed to repoint it.
const ORIGINAL = resolve(REPO, '..', 'GradeBridge-Student-Submission', 'scripts', 'check-ci-green.mjs');
const gateSource = readFileSync(GATE, 'utf8');

if (existsSync(ORIGINAL)) {
  await check('the gate is byte-identical to the Student Submission original', () => {
    assert(readFileSync(ORIGINAL, 'utf8') === gateSource,
      'the two copies have drifted — port the change rather than letting them differ');
  });
} else {
  skip('the gate is byte-identical to the Student Submission original',
    'GradeBridge-Student-Submission is not checked out alongside');
}

await check('predeploy runs the gate before the build', () => {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
  const pre = pkg.scripts.predeploy || '';
  assert(pre.includes('check-ci-green.mjs'), `predeploy does not run the gate: ${pre}`);
  assert(pre.indexOf('check-ci-green.mjs') < pre.indexOf('build'),
    `the gate must run BEFORE the build, not after it: ${pre}`);
});

await check('the gate hardcodes the real API host', () => {
  assert(/const API = 'https:\/\/api\.github\.com';/.test(gateSource),
    'the API host is no longer a hardcoded constant — if it became configurable, '
    + 'the gate gained a silent way to be pointed at something that always says yes');
});

// ---------------------------------------------------------------------------
// 2. A stub that answers exactly what each scenario needs
// ---------------------------------------------------------------------------
let reply = { status: 200, body: JSON.stringify({ total_count: 0, workflow_runs: [] }) };
let lastUrl = null;

const server = createServer((req, res) => {
  lastUrl = req.url;
  if (reply.hangup) { req.socket.destroy(); return; }
  res.writeHead(reply.status, { 'Content-Type': reply.contentType || 'application/json' });
  res.end(reply.body);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}`;

const work = mkdtempSync(join(tmpdir(), 'gb-gate-'));

/**
 * The shipped gate with its API constant repointed, and nothing else touched.
 * The one-line assertion is what makes running the copy equivalent to running
 * the original.
 */
const makeCopy = (name, extra = (s) => s) => {
  const copy = extra(gateSource.replace(
    "const API = 'https://api.github.com';",
    `const API = '${base}';`));
  const path = join(work, name);
  writeFileSync(path, copy, 'utf8');
  return { path, copy };
};

const { path: gateCopy, copy: copySource } = makeCopy('gate-under-test.mjs');

await check('the copy under test differs from the shipped gate by exactly one line', () => {
  const a = gateSource.split('\n'), b = copySource.split('\n');
  assert(a.length === b.length, `line count changed: ${a.length} -> ${b.length}`);
  const differing = a.map((line, i) => (line === b[i] ? null : i)).filter((i) => i !== null);
  assert(differing.length === 1,
    `expected exactly one differing line, got ${differing.length}: ${differing.join(', ')}`);
  assert(/const API =/.test(a[differing[0]]),
    `the differing line is not the API constant: ${a[differing[0]]}`);
});

const run = (env = {}, script = gateCopy) => new Promise((done, fail) => {
  const child = spawn(process.execPath, [script], {
    cwd: REPO, env: { ...process.env, GB_ALLOW_RED_CI: '', ...env },
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  child.on('error', fail);
  child.on('close', (status) => done({ status, out }));
});

const runsBody = (runs) => JSON.stringify({ total_count: runs.length, workflow_runs: runs });
const aRun = (over = {}) => ({
  name: 'tests', run_number: 11, status: 'completed', conclusion: 'success',
  html_url: 'https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/actions/runs/1', ...over,
});

// ---------------------------------------------------------------------------
// 3. The pass, so the refusals below mean something
// ---------------------------------------------------------------------------
await check('green CI passes, and the run is named', async () => {
  reply = { status: 200, body: runsBody([aRun()]) };
  const { status, out } = await run();
  assert(status === 0, `a green run was refused (exit ${status}):\n${out}`);
  assert(/CI is green/.test(out), `no green line printed:\n${out}`);
  assert(/tests #11/.test(out), `the run is not named:\n${out}`);
  assert(/actions\/runs\/1/.test(out), `the run URL is not printed:\n${out}`);
});

await check('the query asks about the full 40-character HEAD sha', () => {
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).stdout.trim();
  assert(lastUrl && lastUrl.includes(`head_sha=${sha}`),
    `the gate asked ${lastUrl}, which does not carry the full sha ${sha}`);
});

// ---------------------------------------------------------------------------
// 4. Every refusal branch the work order names
// ---------------------------------------------------------------------------
const refuses = (name, setup, expect) => check(name, async () => {
  reply = setup;
  const { status, out } = await run();
  assert(status === 1, `expected a refusal (exit 1), got exit ${status}:\n${out}`);
  assert(/REFUSING TO DEPLOY/.test(out), `it did not say it was refusing:\n${out}`);
  assert(expect.test(out), `the reason does not match ${expect}:\n${out}`);
  // Every refusal must tell the operator how to proceed deliberately. A refusal
  // with no stated recourse is the shape this project treats as a defect.
  assert(/GB_ALLOW_RED_CI=1 npm run deploy/.test(out),
    `the refusal does not name the override, so it offers no recourse:\n${out}`);
});

await refuses('a FAILED run is refused',
  { status: 200, body: runsBody([aRun({ conclusion: 'failure' })]) },
  /CI is not green/);

await refuses('a CANCELLED run is refused',
  { status: 200, body: runsBody([aRun({ conclusion: 'cancelled' })]) },
  /CI is not green/);

await refuses('a run still IN PROGRESS is refused',
  { status: 200, body: runsBody([aRun({ status: 'in_progress', conclusion: null })]) },
  /CI has not finished/);

await refuses('a QUEUED run is refused',
  { status: 200, body: runsBody([aRun({ status: 'queued', conclusion: null })]) },
  /CI has not finished/);

await refuses('NO RUN AT ALL is refused, and said to be a real absence',
  { status: 200, body: JSON.stringify({ total_count: 0, workflow_runs: [] }) },
  /no CI run exists[\s\S]*REAL absence/);

await refuses('one green run alongside one red run is refused',
  { status: 200, body: runsBody([aRun(), aRun({ run_number: 12, conclusion: 'failure' })]) },
  /CI is not green/);

// --- the several ways the API can fail to answer ---------------------------
await refuses('HTTP 403 is refused as a failure to LOOK',
  { status: 403, body: '{}' },
  /rate limit, or forbidden[\s\S]*failure to LOOK/);

await refuses('HTTP 429 is refused as a failure to LOOK',
  { status: 429, body: '{}' },
  /rate limit, or forbidden/);

await refuses('HTTP 404 is refused as a misdirected query, not an absent run',
  { status: 404, body: '{}' },
  /no such repository or endpoint[\s\S]*not an absent run/);

await refuses('HTTP 500 is refused as a failure to LOOK',
  { status: 500, body: '{}' },
  /returned HTTP 500[\s\S]*failure to LOOK/);

await refuses('a body that is not JSON is refused as a failure to READ',
  { status: 200, body: '<html>nope</html>', contentType: 'text/html' },
  /not JSON[\s\S]*failure to READ/);

await refuses('JSON of the wrong shape is refused as a failure to READ',
  { status: 200, body: JSON.stringify([1, 2, 3]) },
  /unexpected shape[\s\S]*failure to READ/);

await refuses('a body with no workflow_runs array is NOT read as an empty list',
  { status: 200, body: JSON.stringify({ message: 'Not Found', documentation_url: 'x' }) },
  /carried no workflow_runs array[\s\S]*unreadable answer is NOT an empty one/);

await refuses('an internally inconsistent response is refused',
  { status: 200, body: JSON.stringify({ total_count: 0, workflow_runs: [aRun()] }) },
  /internally inconsistent/);

await refuses('a dropped connection is refused',
  { hangup: true, status: 200, body: '' },
  /could not reach the GitHub API[\s\S]*failure to LOOK/);

// --- the branch that cannot fire in normal operation -----------------------
// The gate validates its own request before sending it, so an abbreviated sha
// cannot masquerade as "no run exists" — the incident of 2026-09-09. It is
// unreachable while `git rev-parse HEAD` returns 40 characters, so the only way
// to exercise it is to shorten the sha, which is the edit it guards against.
{
  const { path } = makeCopy('gate-short-sha.mjs', (s) =>
    s.replace("sha = git('rev-parse', 'HEAD');", "sha = git('rev-parse', 'HEAD').slice(0, 7);"));
  await check('an abbreviated sha is caught before it can look like an absent run', async () => {
    reply = { status: 200, body: JSON.stringify({ total_count: 0, workflow_runs: [] }) };
    const { status, out } = await run({}, path);
    assert(status === 1, `expected a refusal, got exit ${status}:\n${out}`);
    assert(/query would be malformed/.test(out), `wrong reason:\n${out}`);
    assert(/defect in the gate, not a verdict about CI/.test(out),
      `it did not distinguish a broken query from a CI verdict:\n${out}`);
    assert(!/no CI run exists/.test(out),
      'a malformed query was reported as an absent run — the exact 2026-09-09 confusion');
  });
}

// ---------------------------------------------------------------------------
// 5. The override, which must work and must never be quiet
// ---------------------------------------------------------------------------
await check('GB_ALLOW_RED_CI publishes anyway, and says loudly what it skipped', async () => {
  reply = { status: 200, body: runsBody([aRun({ conclusion: 'failure' })]) };
  const { status, out } = await run({ GB_ALLOW_RED_CI: '1' });
  assert(status === 0, `the override did not let the deploy through (exit ${status}):\n${out}`);
  assert(/OVERRIDDEN/.test(out), `the override was silent:\n${out}`);
  assert(/Would have refused: CI is not green/.test(out),
    `it did not name the reason it would have refused:\n${out}`);
  assert(/has NOT been verified by CI/.test(out),
    `it did not say the build is unverified:\n${out}`);
});

await check('the override also reports on an absent run rather than on a red one only', async () => {
  reply = { status: 200, body: JSON.stringify({ total_count: 0, workflow_runs: [] }) };
  const { status, out } = await run({ GB_ALLOW_RED_CI: 'yes' });
  assert(status === 0, `exit ${status}:\n${out}`);
  assert(/Would have refused: no CI run exists/.test(out), `wrong reason named:\n${out}`);
});

for (const value of ['0', 'false', 'FALSE', '']) {
  await check(`GB_ALLOW_RED_CI=${JSON.stringify(value)} does NOT count as set`, async () => {
    reply = { status: 200, body: runsBody([aRun({ conclusion: 'failure' })]) };
    const { status, out } = await run({ GB_ALLOW_RED_CI: value });
    assert(status === 1, `a red run was published with the override ${JSON.stringify(value)}:\n${out}`);
  });
}

// ---------------------------------------------------------------------------
// 6. Report
// ---------------------------------------------------------------------------
// RESULTS FIRST, THEN CLEANUP (WORKORDER_AM_NO_BROWSER_DIALOGS_2026-09-24,
// item 3). The cleanup used to run bare, BEFORE anything was printed, so an
// EBUSY from a Windows file lock would have failed the suite with no output at
// all, which is worse than the no-FAIL-line signature fixed in two other suites.
// Cleanup is not a check: it retries, and a failure is a note.
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
server.close();
try {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
} catch (err) {
  console.log(`  note: could not remove ${work} (${err.code}); it is a temp directory and is left behind`);
}
process.exit(failed > 0 ? 1 : 0);
