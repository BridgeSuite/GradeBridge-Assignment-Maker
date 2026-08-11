// =====================================================
// Course public key (gb2) test runner
// =====================================================
// Plain Node (>=18) — no test framework. Transpiles the source with the
// esbuild that ships inside Vite and runs it against the same WebCrypto the
// browser uses.
//
//   npm test
//
// Covers validateCoursePublicKey() and buildAssignmentSpec(), plus a
// cross-app check that a key exported here actually drives the Student
// Submission app's gb2 encoder.
//
// The fixture (test keypair + a known-good SPKI PEM) is NOT committed — it
// contains a private key. Default location:
//
//   ../Encryption/gb2_test_fixture.json      (relative to the repo root)
//
// Override with:  GB2_FIXTURE=/path/to/gb2_test_fixture.json npm test
//
// Without it the suite still runs every fixture-independent check using
// ephemeral keypairs and reports the rest as SKIPPED.
// =====================================================

import { build } from 'esbuild';
import { webcrypto, createPrivateKey, privateDecrypt, constants as cryptoConstants } from 'node:crypto';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// Browser code reaches for the crypto / btoa / atob globals.
globalThis.crypto ??= webcrypto;

// ---------- tiny assertion harness ----------
let passed = 0, failed = 0, skipped = 0;
const results = [];
const check = (name, fn) => {
  try { fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const skip = (name, why) => { skipped++; results.push(`  SKIP  ${name} (${why})`); };
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (actual, expected, msg) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n          expected: ${e}\n          actual:   ${a}`);
};

// ---------- load the modules under test ----------
const outDir = mkdtempSync(join(tmpdir(), 'gb-maker-test-'));

// exportService pulls in jspdf / jszip / file-saver at module scope. None of
// them are on the buildAssignmentSpec path and jspdf does not load outside a
// browser, so stub them out rather than dragging a DOM in.
const stubHeavyDeps = {
  name: 'stub-heavy-deps',
  setup(b) {
    b.onResolve({ filter: /^(jspdf|jszip|file-saver)$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const stub = new Proxy(function(){}, { get: () => stub, apply: () => stub, construct: () => stub }); export default stub;',
      loader: 'js',
    }));
  },
};

const loadModule = async (entry, outName, opts = {}) => {
  const outfile = join(outDir, outName);
  await build({
    entryPoints: [entry],
    outfile,
    format: 'esm',
    target: 'es2022',
    bundle: true,
    absWorkingDir: dirname(entry),
    logLevel: 'silent',
    ...opts,
  });
  return import(pathToFileURL(outfile).href);
};

const crypto_ = await loadModule(join(REPO, 'services', 'cryptoService.ts'), 'cryptoService.mjs');
const exportSvc = await loadModule(join(REPO, 'services', 'exportService.ts'), 'exportService.mjs', {
  plugins: [stubHeavyDeps],
});

const { validateCoursePublicKey, normalizeCoursePublicKey, looksLikeCoursePublicKey, encryptJson, decryptJson } = crypto_;
const { buildAssignmentSpec } = exportSvc;

// ---------- helpers ----------
const spkiPem = (der) =>
  `-----BEGIN PUBLIC KEY-----\n${Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n').trimEnd()}\n-----END PUBLIC KEY-----\n`;

const genKey = async (bits) => {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']
  );
  return { pem: spkiPem(await webcrypto.subtle.exportKey('spki', pair.publicKey)), pair };
};

const makeAssignment = (extra = {}) => ({
  id: 'a1',
  courseCode: 'EEC1',
  title: 'Lab 1 In-Lab',
  preamble: 'Complete all parts.',
  problems: [{
    id: 'p1', name: 'Problem 1', description: '',
    subsections: [{ id: 's1', name: 'Part a', description: 'Do the thing', points: 100, submissionType: 'Text' }],
  }],
  aiGradingConfig: { model: 'claude-haiku-4-5-20251001', temperature: 0.1, maxTokens: 512 },
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  ...extra,
});

// ---------- fixture ----------
const fixturePath = process.env.GB2_FIXTURE
  ? resolve(process.env.GB2_FIXTURE)
  : resolve(REPO, '..', 'Encryption', 'gb2_test_fixture.json');
const fixture = existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, 'utf8')) : null;

console.log('\ncoursePublicKey (gb2) test suite');
console.log(`fixture: ${fixture ? fixturePath : `NOT FOUND at ${fixturePath}`}\n`);

// =====================================================
// 1. validateCoursePublicKey — the fixture key
// =====================================================
if (fixture) {
  const r = await validateCoursePublicKey(fixture.public_key_spki_pem);
  check('fixture SPKI public key validates as a 2048-bit RSA key', () => {
    assert(r.ok === true, `ok is ${r.ok}: ${r.error}`);
    assert(r.bits === 2048, `bits is ${r.bits}, expected 2048`);
    assert(!r.warning, `unexpected warning: ${r.warning}`);
  });

  const priv = await validateCoursePublicKey(fixture.private_key_pkcs8_pem);
  check('fixture PRIVATE key is rejected with the private-key message', () => {
    assert(priv.ok === false, 'a private key was accepted');
    assert(/private key/i.test(priv.error), `error was: "${priv.error}"`);
    assert(/public key only/i.test(priv.error), `error does not say what to paste instead: "${priv.error}"`);
  });

  const truncatedResult = await validateCoursePublicKey(fixture.public_key_spki_pem.slice(0, 120));
  check('a truncated paste is rejected', () => {
    assert(truncatedResult.ok === false, 'a truncated key was accepted');
    assert(typeof truncatedResult.error === 'string' && truncatedResult.error.length > 0, 'no error message');
  });

  const crlf = `  ${fixture.public_key_spki_pem.trim().replace(/\n/g, '\r\n')}  `;
  const crlfResult = await validateCoursePublicKey(crlf);
  check('a CRLF / untrimmed paste of the same key still validates', () => {
    assert(crlfResult.ok === true, `ok is ${crlfResult.ok}: ${crlfResult.error}`);
    assert(crlfResult.bits === 2048, `bits is ${crlfResult.bits}`);
  });
} else {
  for (const n of [
    'fixture SPKI public key validates as a 2048-bit RSA key',
    'fixture PRIVATE key is rejected with the private-key message',
    'a truncated paste is rejected',
    'a CRLF / untrimmed paste of the same key still validates',
  ]) skip(n, 'fixture not found');
}

// =====================================================
// 2. validateCoursePublicKey — fixture-independent cases
// =====================================================
{
  const k2048 = await genKey(2048);
  const r2048 = await validateCoursePublicKey(k2048.pem);
  check('an ephemeral 2048-bit key validates with no warning', () => {
    assert(r2048.ok === true, `ok is ${r2048.ok}: ${r2048.error}`);
    assert(r2048.bits === 2048 && !r2048.warning, `bits ${r2048.bits}, warning ${r2048.warning}`);
  });

  const k4096 = await genKey(4096);
  const r4096 = await validateCoursePublicKey(k4096.pem);
  check('a 4096-bit key validates with no warning (contract size)', () => {
    assert(r4096.ok === true, `ok is ${r4096.ok}: ${r4096.error}`);
    assert(r4096.bits === 4096 && !r4096.warning, `bits ${r4096.bits}, warning ${r4096.warning}`);
  });

  const k3072 = await genKey(3072);
  const r3072 = await validateCoursePublicKey(k3072.pem);
  check('an off-contract 3072-bit key warns but is NOT hard-blocked', () => {
    assert(r3072.ok === true, 'a usable off-size key was hard-blocked');
    assert(r3072.bits === 3072, `bits is ${r3072.bits}`);
    assert(typeof r3072.warning === 'string' && /2048|4096/.test(r3072.warning),
      `warning does not name the expected sizes: "${r3072.warning}"`);
  });

  const cases = [
    ['empty string', '', /empty|no key/i],
    ['whitespace only', '   \n  ', /empty|no key/i],
    ['plain garbage', 'not a key at all', /SPKI|BEGIN PUBLIC KEY/i],
    ['PKCS#1 header', '-----BEGIN RSA PUBLIC KEY-----\nMIIBCgKCAQEA\n-----END RSA PUBLIC KEY-----', /PKCS#1|SPKI/i],
    ['a PKCS#8 private key header', '-----BEGIN PRIVATE KEY-----\nMIIEvg==\n-----END PRIVATE KEY-----', /private key/i],
    ['an OpenSSH private key', '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----', /private key/i],
    ['BEGIN with no END', '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq', /BEGIN|END/i],
    ['empty PEM body', '-----BEGIN PUBLIC KEY-----\n\n-----END PUBLIC KEY-----', /empty/i],
    ['non-key base64 body', '-----BEGIN PUBLIC KEY-----\nbm90YWtleQ==\n-----END PUBLIC KEY-----', /import|RSA|usable/i],
  ];
  for (const [label, input, pattern] of cases) {
    const r = await validateCoursePublicKey(input);
    check(`rejects ${label} with a specific message`, () => {
      assert(r.ok === false, `accepted "${label}"`);
      assert(typeof r.error === 'string' && r.error.length > 0, 'no error message');
      assert(pattern.test(r.error), `message does not explain the problem: "${r.error}"`);
    });
  }

  check('normalizeCoursePublicKey trims and converts CRLF to LF', () => {
    assertEqual(normalizeCoursePublicKey('  a\r\nb  \n'), 'a\nb', 'normalisation wrong');
    assertEqual(normalizeCoursePublicKey(''), '', 'empty input should stay empty');
  });
  check('looksLikeCoursePublicKey screens PEMs without importing', () => {
    assert(looksLikeCoursePublicKey(k2048.pem) === true, 'rejected a valid SPKI PEM');
    assert(looksLikeCoursePublicKey('-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----') === false,
      'accepted a private key');
    assert(looksLikeCoursePublicKey(undefined) === false, 'accepted a non-string');
    assert(looksLikeCoursePublicKey('') === false, 'accepted an empty string');
  });
}

// =====================================================
// 3. buildAssignmentSpec — what lands in assignment_spec.json
// =====================================================
{
  const bare = makeAssignment();
  const bareSpec = await buildAssignmentSpec(bare);
  check('no key: coursePublicKey is absent from the spec entirely', () =>
    assert(!('coursePublicKey' in bareSpec), 'the field was added to a keyless assignment'));
  check('no key: spec is byte-for-byte identical to the assignment (gb1 unaffected)', () =>
    assert(JSON.stringify(bareSpec) === JSON.stringify(bare),
      'the serialized spec changed for an assignment with no key'));

  for (const [label, value] of [['empty string', ''], ['whitespace only', '  \n '], ['undefined', undefined]]) {
    const a = makeAssignment({ coursePublicKey: value });
    const spec = await buildAssignmentSpec(a);
    check(`key set to ${label}: field omitted from the spec`, () =>
      assert(!('coursePublicKey' in spec), `field present with value ${JSON.stringify(spec.coursePublicKey)}`));
  }

  if (fixture) {
    const pem = fixture.public_key_spki_pem;
    const spec = await buildAssignmentSpec(makeAssignment({ coursePublicKey: pem }));
    check('key set: spec carries the exact PEM', () =>
      assert(spec.coursePublicKey === normalizeCoursePublicKey(pem),
        'the exported PEM does not match what was set'));
    check('key set: everything else in the spec is unchanged', () => {
      const { coursePublicKey, ...rest } = spec;
      assertEqual(rest, makeAssignment(), 'other spec fields were altered');
    });

    // export -> encode -> decode -> reimport
    const decoded = await decryptJson(await encryptJson(spec));
    check('the key survives the gb1 spec encode/decode round trip', () =>
      assert(decoded.coursePublicKey === normalizeCoursePublicKey(pem),
        'the key changed passing through the spec envelope'));

    let threw = null;
    try {
      await buildAssignmentSpec(makeAssignment({ coursePublicKey: '-----BEGIN PUBLIC KEY-----\nbm90YWtleQ==\n-----END PUBLIC KEY-----' }));
    } catch (err) { threw = err; }
    check('an invalid key stops the export instead of shipping a broken spec', () => {
      assert(threw !== null, 'export proceeded with an unusable key');
      assert(/Export stopped/.test(threw.message), `unexpected message: "${threw.message}"`);
    });

    let threwPriv = null;
    try {
      await buildAssignmentSpec(makeAssignment({ coursePublicKey: fixture.private_key_pkcs8_pem }));
    } catch (err) { threwPriv = err; }
    check('a private key can never reach the exported spec', () => {
      assert(threwPriv !== null, 'a private key was exported');
      assert(/private key/i.test(threwPriv.message), `unexpected message: "${threwPriv.message}"`);
    });
  } else {
    for (const n of [
      'key set: spec carries the exact PEM',
      'the key survives the gb1 spec encode/decode round trip',
      'an invalid key stops the export instead of shipping a broken spec',
      'a private key can never reach the exported spec',
    ]) skip(n, 'fixture not found');
  }
}

// =====================================================
// 4. Cross-app — the exported key drives the Student app's gb2 encoder
// =====================================================
{
  const studentCrypto = resolve(REPO, '..', 'GradeBridge-Student-Submission', 'cryptoService.ts');
  if (fixture && existsSync(studentCrypto)) {
    const student = await loadModule(studentCrypto, 'studentCryptoService.mjs');

    // Exactly what the Maker would ship.
    const spec = await buildAssignmentSpec(makeAssignment({ coursePublicKey: fixture.public_key_spki_pem }));

    // Exactly what the Student app would do with it.
    const payload = student.deidentifyForGb2({
      student_name: 'Jane Smith',
      course_code: spec.courseCode,
      assignment_id: `${spec.courseCode}_${spec.title.replace(/\s+/g, '_')}`,
      submission_data: { p0s0: { answer: 'ok', images_submitted: 0 } },
    });
    const gb2 = await student.encryptJsonGb2(payload, spec.coursePublicKey);

    // Exactly what the autograder would do with that.
    const raw = Buffer.from(gb2.slice(4), 'base64');
    const wrappedKeyLen = raw.readUInt16BE(0);
    const contentKey = privateDecrypt(
      { key: createPrivateKey(fixture.private_key_pkcs8_pem), padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      raw.subarray(2, 2 + wrappedKeyLen)
    );
    const aesKey = await webcrypto.subtle.importKey('raw', contentKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const opened = JSON.parse(Buffer.from(await webcrypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.subarray(2 + wrappedKeyLen, 2 + wrappedKeyLen + 12) },
      aesKey,
      raw.subarray(2 + wrappedKeyLen + 12)
    )).toString('utf8'));

    check('cross-app: a spec exported here produces a gb2 submission the course key opens', () =>
      assertEqual(opened, payload, 'the round trip through both apps lost or changed the payload'));
    check('cross-app: that submission carries no student identity', () =>
      assert(!('student_name' in opened), 'student_name reached the autograder payload'));
  } else {
    const why = !fixture ? 'fixture not found' : 'Student Submission repo not alongside this one';
    skip('cross-app: a spec exported here produces a gb2 submission the course key opens', why);
  }
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
rmSync(outDir, { recursive: true, force: true });
process.exit(failed > 0 ? 1 : 0);
