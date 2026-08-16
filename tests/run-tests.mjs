// =====================================================
// Assignment Maker test runner
// =====================================================
// Plain Node (>=18) — no test framework. Transpiles the source with the
// esbuild that ships inside Vite and runs it against the same WebCrypto the
// browser uses.
//
//   npm test
//
// Covers validateCoursePublicKey() and buildAssignmentSpec(), plus a
// cross-app check that a key exported here actually drives the Student
// Submission app's gb2 encoder, plus the handwritten input-mode / medium
// round trip through .md export, .md import and grading_rubric.json.
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
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
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

// jsPDF and JSZip run fine under Node; file-saver needs a real browser. The
// PDF regression test uses this so it can inspect a real document.
const stubBrowserOnlyDeps = {
  name: 'stub-browser-only-deps',
  setup(b) {
    b.onResolve({ filter: /^(file-saver)$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const stub = new Proxy(function(){}, { get: () => stub, apply: () => stub, construct: () => stub }); export default stub;',
      loader: 'js',
    }));
  },
};

// mathRender.ts inlines KaTeX's stylesheet with `?raw` (Vite built-in), and
// katexFonts.ts turns the woff2 faces into data URIs with `?dataurl` (our own
// plugin, see vite.config.ts). esbuild needs told about both — keep this in
// step with the Vite plugin, and note that tests/bundle-tests.mjs is what
// checks the *real* build rather than this stand-in.
const requireFromRepo = createRequire(join(REPO, 'package.json'));
const assetImports = {
  name: 'asset-imports',
  setup(b) {
    b.onResolve({ filter: /\?(raw|dataurl)$/ }, args => {
      const [, query] = args.path.match(/\?(raw|dataurl)$/);
      return {
        path: requireFromRepo.resolve(args.path.replace(/\?(raw|dataurl)$/, '')),
        namespace: query,
      };
    });
    b.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'text',
    }));
    b.onLoad({ filter: /.*/, namespace: 'dataurl' }, args => ({
      contents: `export default ${JSON.stringify(
        `data:font/woff2;base64,${readFileSync(args.path).toString('base64')}`
      )};`,
      loader: 'js',
    }));
  },
};

const loadModule = async (entry, outName, opts = {}) => {
  const outfile = join(outDir, outName);
  const { plugins = [], ...rest } = opts;
  await build({
    entryPoints: [entry],
    outfile,
    format: 'esm',
    target: 'es2022',
    bundle: true,
    absWorkingDir: dirname(entry),
    logLevel: 'silent',
    plugins: [assetImports, ...plugins],
    ...rest,
  });
  return import(pathToFileURL(outfile).href);
};

const crypto_ = await loadModule(join(REPO, 'services', 'cryptoService.ts'), 'cryptoService.mjs');
const exportSvc = await loadModule(join(REPO, 'services', 'exportService.ts'), 'exportService.mjs', {
  plugins: [stubHeavyDeps],
});

const mdParser = await loadModule(join(REPO, 'services', 'mdParserService.ts'), 'mdParserService.mjs');
const inputModeSvc = await loadModule(join(REPO, 'services', 'inputModeService.ts'), 'inputModeService.mjs');
const mathRender = await loadModule(join(REPO, 'services', 'mathRender.ts'), 'mathRender.mjs');

// Same module, but with a real jsPDF so the PDF can actually be inspected.
const exportPdfSvc = await loadModule(join(REPO, 'services', 'exportService.ts'), 'exportServicePdf.mjs', {
  plugins: [stubBrowserOnlyDeps],
});

const { validateCoursePublicKey, normalizeCoursePublicKey, looksLikeCoursePublicKey, encryptJson, decryptJson } = crypto_;
const { buildAssignmentSpec, assignmentToMd, generateGradingRubric, convertSubmissionType,
        generateHTML, generateLaTeX, generateGraderHTML } = exportSvc;
const { parseMdToAssignment } = mdParser;
const { typeAllowedInMode, defaultTypeForMode, convertSubsectionToMode, strandedSubsectionLabels } = inputModeSvc;
const { splitMath, toHtml, toLatexBody, toPlainUnicode, toPdfText, hasMath } = mathRender;

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

console.log('\nAssignment Maker test suite — coursePublicKey (gb2) + handwritten round trip');
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

// =====================================================
// 5. Handwritten input mode + medium (stage 1)
// =====================================================
{
  const handwrittenAssignment = {
    id: 'hw1',
    courseCode: 'EEC130B',
    title: 'HW 3',
    inputMode: 'handwritten',
    preamble: 'Show all working on paper.',
    problems: [{
      id: 'p1', name: 'Waveguides', description: '',
      subsections: [
        {
          id: 's1', name: 'Cutoff frequency', description: 'Determine the cutoff frequency of the TE10 mode.',
          points: 60, submissionType: 'Handwritten', handwrittenGradingMode: 'ai',
          aiGradingPrompt: 'Required elements: (1) correct use of f_c = c/(2a). Award full marks for a correct value.',
        },
        {
          id: 's2', name: 'Field sketch', description: 'Sketch the field pattern.',
          points: 40, submissionType: 'Handwritten', handwrittenGradingMode: 'human',
          graderNote: 'Look for arrows normal to the walls. Award full marks when both E and H are shown.',
        },
      ],
    }],
    aiGradingConfig: { model: 'claude-haiku-4-5-20251001', temperature: 0.1, maxTokens: 512 },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  // --- .md export ---
  const md = assignmentToMd(handwrittenAssignment);
  check('md export: handwritten assignment carries the **Input:** line', () =>
    assert(/^\*\*Input:\*\* handwritten$/m.test(md), `no Input line in:\n${md}`));
  check('md export: AI part is tagged [handwritten] with a grading_prompt', () => {
    assert(/### \(a\) Cutoff frequency \[60 pts\] \[handwritten\]/.test(md), 'wrong tag for the AI part');
    assert(/^> grading_prompt: Required elements/m.test(md), 'grading_prompt blockquote missing');
  });
  check('md export: human part is tagged [handwritten:human] with a grader_note', () => {
    assert(/### \(b\) Field sketch \[40 pts\] \[handwritten:human\]/.test(md), 'wrong tag for the human part');
    assert(/^> grader_note: Look for arrows/m.test(md), 'grader_note blockquote missing');
  });
  check('md export: no grading_prompt is emitted for the human-handwritten part', () =>
    assert((md.match(/> grading_prompt:/g) || []).length === 1, 'grading_prompt emitted more than once'));

  // --- .md import ---
  const reimported = parseMdToAssignment(md);
  check('md import: inputMode comes back as handwritten', () =>
    assertEqual(reimported.inputMode, 'handwritten', 'inputMode lost on import'));
  const [subA, subB] = reimported.problems[0].subsections;
  check('md import: [handwritten] → Handwritten + ai, prompt preserved', () => {
    assertEqual(subA.submissionType, 'Handwritten', 'wrong submissionType');
    assertEqual(subA.handwrittenGradingMode, 'ai', 'wrong grading mode');
    assert(/f_c = c\/\(2a\)/.test(subA.aiGradingPrompt), 'grading prompt lost');
    assert(!('maxImages' in subA), 'handwritten part got a maxImages field');
  });
  check('md import: [handwritten:human] → Handwritten + human, note preserved', () => {
    assertEqual(subB.submissionType, 'Handwritten', 'wrong submissionType');
    assertEqual(subB.handwrittenGradingMode, 'human', 'wrong grading mode');
    assert(/arrows normal to the walls/.test(subB.graderNote), 'grader note lost');
  });
  check('md round trip is stable (export → import → export is identical)', () =>
    assertEqual(assignmentToMd(reimported), md, 'the second export differs from the first'));

  // --- grading_rubric.json ---
  const rubric = generateGradingRubric(handwrittenAssignment);
  check('rubric: AI handwritten part is ai_handwritten with its prompt and no max_images', () => {
    const r = rubric.rubrics.p0s0;
    assertEqual(r.grading_type, 'ai_handwritten', 'wrong grading_type');
    assert(r.grading_prompt.startsWith('Required elements'), `grading_prompt is "${r.grading_prompt}"`);
    assert(!('max_images' in r), 'max_images was written for a handwritten part');
  });
  check('rubric: human handwritten part is human_handwritten with an empty prompt', () => {
    const r = rubric.rubrics.p0s1;
    assertEqual(r.grading_type, 'human_handwritten', 'wrong grading_type');
    assertEqual(r.grading_prompt, '', 'a prompt was written for a human-graded part');
    assert(!('max_images' in r), 'max_images was written for a handwritten part');
  });

  // --- assignment_spec.json + student-app contract ---
  const spec = await buildAssignmentSpec(handwrittenAssignment);
  check('spec: inputMode ships in assignment_spec.json', () =>
    assertEqual(spec.inputMode, 'handwritten', 'inputMode did not survive into the spec'));
  check("spec: the handwritten submission element string is 'Answer as handwritten'", () =>
    assertEqual(convertSubmissionType('Handwritten'), ['Answer as handwritten'], 'contract string changed'));

  // --- electronic back-compat ---
  const legacyMd = [
    '# EEC1: Lab 1 In-Lab',
    '',
    '**Preamble:** Complete all parts.',
    '',
    '## Problem 1: Voltage divider',
    '',
    '### (a) Measured value [100 pts] [text]',
    'Report the measured output voltage.',
    '',
    '> grader_note: Expect 2.5 V.',
    '',
  ].join('\n');
  const legacy = parseMdToAssignment(legacyMd);
  check('back-compat: a .md with no **Input:** line imports as electronic', () =>
    assertEqual(legacy.inputMode, 'electronic', 'legacy file did not default to electronic'));
  check('back-compat: an electronic assignment exports no **Input:** line', () =>
    assert(!/\*\*Input:\*\*/.test(assignmentToMd(legacy)), 'the Input line leaked into an electronic file'));
  check('back-compat: a legacy electronic .md round-trips byte-for-byte', () =>
    assertEqual(assignmentToMd(legacy), legacyMd, 'the legacy file changed on round trip'));
  check('back-compat: electronic rubric grading types are unchanged', () => {
    const r = generateGradingRubric(legacy).rubrics.p0s0;
    assertEqual(r.grading_type, 'human', 'plain text is no longer human-graded');
    assertEqual(r.max_images, undefined, 'text parts should not carry max_images');
  });
}

// =====================================================
// 6. Input mode rules — what each mode offers, and what a switch does
// =====================================================
{
  const ALL = ['Text', 'Image', 'Text and Image', 'AI Graded: Short', 'Handwritten'];

  check('handwritten mode offers Handwritten and nothing else', () =>
    assertEqual(ALL.filter(t => typeAllowedInMode(t, 'handwritten')), ['Handwritten'], 'wrong medium set'));
  check('electronic mode offers every medium except Handwritten', () =>
    assertEqual(ALL.filter(t => typeAllowedInMode(t, 'electronic')),
      ['Text', 'Image', 'Text and Image', 'AI Graded: Short'], 'wrong medium set'));
  check('new sub-parts default to the mode\'s medium', () => {
    assertEqual(defaultTypeForMode('handwritten'), 'Handwritten', 'wrong handwritten default');
    assertEqual(defaultTypeForMode('electronic'), 'Text', 'wrong electronic default');
  });

  const imageSub = {
    id: 's1', name: 'Scope trace', description: 'Capture the waveform.', points: 10,
    submissionType: 'Image', maxImages: 3, imageGradingMode: 'auto',
    graderNote: 'Both cursors visible.',
  };
  const toHandwritten = convertSubsectionToMode(imageSub, 'handwritten');
  check('switch to handwritten: content survives, image fields are dropped', () => {
    assertEqual(toHandwritten.submissionType, 'Handwritten', 'wrong type');
    assertEqual(toHandwritten.handwrittenGradingMode, 'ai', 'should default to AI');
    assertEqual(toHandwritten.name, 'Scope trace', 'name lost');
    assertEqual(toHandwritten.points, 10, 'points lost');
    assertEqual(toHandwritten.graderNote, 'Both cursors visible.', 'grader note lost');
    assert(!('maxImages' in toHandwritten), 'maxImages survived');
    assert(!('imageGradingMode' in toHandwritten), 'imageGradingMode survived');
  });

  const handwrittenSub = {
    id: 's2', name: 'Derivation', description: 'Derive it.', points: 20,
    submissionType: 'Handwritten', handwrittenGradingMode: 'human',
    aiGradingPrompt: 'Required elements: (1) the derivation.',
  };
  const toElectronic = convertSubsectionToMode(handwrittenSub, 'electronic');
  check('switch to electronic: handwritten part becomes Electronic text, mode dropped', () => {
    assertEqual(toElectronic.submissionType, 'Text', 'wrong type');
    assert(!('handwrittenGradingMode' in toElectronic), 'handwrittenGradingMode survived');
    assertEqual(toElectronic.aiGradingPrompt, 'Required elements: (1) the derivation.', 'rubric lost');
    assertEqual(toElectronic.points, 20, 'points lost');
  });

  const mixed = [{ subsections: [imageSub, handwrittenSub] }];
  check('the warning lists exactly the parts a switch would convert', () => {
    assertEqual(strandedSubsectionLabels(mixed, 'handwritten'), ['1a. Scope trace — Image'],
      'wrong list switching to handwritten');
    assertEqual(strandedSubsectionLabels(mixed, 'electronic'), ['1b. Derivation — Handwritten'],
      'wrong list switching to electronic');
  });
  check('an all-handwritten assignment strands nothing when set to handwritten', () =>
    assertEqual(strandedSubsectionLabels([{ subsections: [handwrittenSub] }], 'handwritten'), [],
      'a compatible part was listed for conversion'));
}

// =====================================================
// 7. Math rendering — one module, every output
// =====================================================
// The bug this guards: services/exportService.ts used to protect math behind a
// `<<MATH_BLOCK_N>>` placeholder, then escape underscores — which rewrote the
// placeholder to `<<MATH\_BLOCK\_N>>` so the restore never matched. The token
// leaked into assignment.tex, and T1 fontenc turned the `<<` `>>` into
// guillemets in the compiled PDF. There is no placeholder any more; this suite
// exists so nobody reintroduces one.
{
  const mathAssignment = {
    id: 'm1',
    courseCode: 'EEC1',
    title: 'Lab 4 In-Lab',
    preamble: 'Bring a calculator; the divider uses $6\\,\\Omega$ resistors.',
    problems: [{
      id: 'p1',
      name: 'Resistor network with $V_{out}$',
      description: 'The bench kit holds six resistors of $6\\,\\Omega$, $\\{3\\,\\Omega, 5\\,\\Omega\\}$ and one 50% tolerance part.',
      subsections: [
        {
          id: 's1',
          name: 'Divider ratio',
          description: 'Show that $\\frac{17}{7}$ follows from $V_x$ and $V_{out}$, then evaluate $e^{-0.2(t-8)}$ at $t=8$.\n\n$$V_{out} = V_{in}\\frac{R_2}{R_1+R_2}$$',
          points: 60,
          submissionType: 'AI Graded: Medium',
          aiGradingPrompt: 'Required elements: (1) the ratio $\\frac{17}{7}$; (2) the $6\\,\\Omega$ value. Award full marks for both.',
        },
        {
          id: 's2',
          name: 'Bench photo',
          description: 'Photograph the board. Underscores_in_prose and 100% of the & symbols must survive.',
          points: 40,
          submissionType: 'Image',
          maxImages: 2,
          graderNote: 'Both leads visible; measured $6\\,\\Omega$ legible on the meter.',
        },
      ],
    }],
    aiGradingConfig: { model: 'claude-haiku-4-5-20251001', temperature: 0.1, maxTokens: 512 },
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  // --- the splitter ---
  check('splitMath separates inline, display and prose', () => {
    assertEqual(splitMath('a $x$ b $$y$$ c'), [
      { kind: 'text', value: 'a ' },
      { kind: 'inline', tex: 'x' },
      { kind: 'text', value: ' b ' },
      { kind: 'display', tex: 'y' },
      { kind: 'text', value: ' c' },
    ], 'wrong segmentation');
  });
  check('splitMath leaves prose with no math untouched', () => {
    assertEqual(splitMath('plain prose'), [{ kind: 'text', value: 'plain prose' }], 'prose was split');
    assert(hasMath('a $x$ b') === true, 'math not detected');
    assert(hasMath('50% and $5') === false, 'an unpaired dollar counted as math');
  });

  // --- .tex ---
  const tex = generateLaTeX(mathAssignment);
  check('tex: no MATH_BLOCK placeholder in any form', () => {
    assert(!/MATH.?_?BLOCK/.test(tex), 'a placeholder token leaked into the .tex');
    assert(!tex.includes('<<') && !tex.includes('>>'), 'raw << >> would become guillemets under T1');
  });
  check('tex: math spans are preserved verbatim', () => {
    assert(tex.includes('$6\\,\\Omega$'), 'inline math was altered');
    assert(tex.includes('$\\frac{17}{7}$'), 'a fraction was altered');
    assert(tex.includes('$e^{-0.2(t-8)}$'), 'an exponential was altered');
    assert(tex.includes('$V_{out}$'), 'the underscore-bearing span was altered');
    assert(tex.includes('$$V_{out} = V_{in}\\frac{R_2}{R_1+R_2}$$'), 'display math was altered');
    assert(tex.includes('$\\{3\\,\\Omega, 5\\,\\Omega\\}$'), 'set braces were altered');
  });
  check('tex: only the surrounding prose is escaped', () => {
    assert(tex.includes('Underscores\\_in\\_prose'), 'prose underscores were not escaped');
    assert(tex.includes('100\\% of the \\& symbols'), 'prose percent/ampersand were not escaped');
  });
  check('tex: a literal backslash in prose escapes once, not twice', () =>
    assertEqual(toLatexBody('path C:\\temp'), 'path C:\\textbackslash{}temp',
      'the escape braces were re-escaped'));

  // --- assignment.html + grader document ---
  const html = await generateHTML(mathAssignment);
  const graderHtml = await generateGraderHTML(mathAssignment);
  for (const [label, doc] of [['assignment.html', html], ['grader document', graderHtml]]) {
    check(`${label}: math is rendered by KaTeX at export time`, () => {
      assert(doc.includes('class="katex"'), 'no KaTeX output in the file');
      assert(!/MATH.?_?BLOCK/.test(doc), 'a placeholder token leaked in');
    });
    check(`${label}: no CDN MathJax and no leftover raw delimiters`, () => {
      assert(!/mathjax/i.test(doc), 'a MathJax script survived');
      assert(!doc.includes('$6\\,\\Omega$'), 'raw LaTeX was emitted instead of rendered math');
    });
    check(`${label}: KaTeX's stylesheet is inlined`, () =>
      assert(doc.includes('.katex{') || doc.includes('.katex {'), 'the KaTeX stylesheet is missing'));
    // The whole point of embedding: an instructor can open the file on a plane.
    check(`${label}: self-contained — every glyph font is a data URI, nothing is fetched`, () => {
      const externals = [...doc.matchAll(/url\((?!data:)["']?([^"')]+)["']?\)/g)].map(m => m[1]);
      assertEqual(externals, [], 'the file still references fonts off-document');
      assertEqual((doc.match(/data:font\/woff2;base64,/g) || []).length, 20,
        'not every KaTeX face was embedded');
      assert(!/<(?:script|link|img|iframe)\b/i.test(doc), 'the file loads a subresource');
      // The MathML namespace is an identifier, not a fetch — everything else is.
      const remote = [...new Set([...doc.matchAll(/https?:\/\/[^\s"')]+/g)].map(m => m[0]))]
        .filter(u => u !== 'http://www.w3.org/1998/Math/MathML');
      assertEqual(remote, [], 'the file still points at an external host');
    });
  }
  const escapedHtml = await generateHTML({ ...mathAssignment, preamble: '<script>alert(1)</script> & co' });
  check('assignment.html: prose is HTML-escaped', () =>
    assert(escapedHtml.includes('&lt;script&gt;'), 'raw HTML from a description reached the file'));

  // --- PDF ---
  {
    const pdf = await exportPdfSvc.createPDF(mathAssignment, 'student');
    const bytes = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    check('pdf: a real document is produced with no leaked token', () => {
      assert(bytes.startsWith('%PDF'), 'not a PDF');
      assert(!/MATH.?_?BLOCK/.test(bytes), 'a placeholder token leaked into the PDF');
    });
    // Node has no DOM, so this exercises the no-rasteriser fallback path.
    check('pdf: without a rasteriser, math degrades to readable WinAnsi text', () => {
      assert(bytes.includes('6 Ohm'), 'the ohm value is not readable in the PDF text');
      assert(!bytes.includes('\\Omega'), 'raw LaTeX was written into the PDF');
    });
    check('pdf: every string stays single-byte (jsPDF would garble UTF-16 in a standard font)', () => {
      const strings = bytes.match(/\(((?:\\.|[^\\()])*)\) Tj/g) || [];
      assert(strings.length > 0, 'no text operators found');
      const bad = strings.find(s => /\u0000/.test(s));
      assert(!bad, `a string was re-encoded as UTF-16BE: ${JSON.stringify(bad)}`);
    });
  }

  // --- plain-text conversions ---
  check('toPlainUnicode turns LaTeX into readable Unicode', () => {
    assertEqual(toPlainUnicode('six $6\\,\\Omega$ parts'), 'six 6 Ω parts', 'ohm form wrong');
    assertEqual(toPlainUnicode('$V_x$ and $V_{out}$'), 'Vₓ and Vₒᵤₜ', 'subscript handling wrong');
    assertEqual(toPlainUnicode('$R_{ab}$'), 'R_(ab)', 'an unmappable subscript should stay textual');
    assertEqual(toPlainUnicode('$\\frac{17}{7}$'), '17/7', 'fraction handling wrong');
    assertEqual(toPlainUnicode('$e^{-0.2(t-8)}$'), 'e^(-0.2(t-8))', 'exponent handling wrong');
    assertEqual(toPlainUnicode('$3 \\times 10^{8}$'), '3 × 10⁸', 'times/superscript handling wrong');
    assertEqual(toPlainUnicode('$\\{3\\,\\Omega, 5\\,\\Omega\\}$'), '{3 Ω, 5 Ω}',
      'escaped set braces should survive as literal characters');
    assertEqual(toPlainUnicode('$\\sqrt{x+1}$ and $\\text{RMS}$'), '√(x+1) and RMS', 'sqrt/text handling wrong');
  });
  check('toPdfText stays inside what jsPDF standard fonts can encode', () => {
    const out = toPdfText('six $6\\,\\Omega$ at $3 \\times 10^{8}$, $\\mu$F, $\\approx$ done — really');
    assert(!/[^\u0000-\u00FF]/.test(out), `non-Latin-1 characters survived: ${JSON.stringify(out)}`);
    assert(out.includes('6 Ohm'), `ohm not transliterated: ${out}`);
    assert(out.includes('~='), `approx not transliterated: ${out}`);
  });
  check('an unpaired dollar is left alone rather than swallowed', () => {
    assertEqual(toLatexBody('costs $5 and 50%'), 'costs \\$5 and 50\\%', 'stray dollar mishandled');
    assertEqual(toPdfText('costs $5 and 50%'), 'costs $5 and 50%', 'stray dollar mishandled');
  });

  // --- markdown round trip ---
  const mathMd = assignmentToMd(mathAssignment);
  check('md export: math is byte-identical to what was authored', () => {
    assert(mathMd.includes('$6\\,\\Omega$'), 'inline math changed on export');
    assert(mathMd.includes('$$V_{out} = V_{in}\\frac{R_2}{R_1+R_2}$$'), 'display math changed on export');
    assert(!/MATH.?_?BLOCK/.test(mathMd), 'a placeholder token leaked into the .md');
  });
  // The .md parser collapses blank lines inside a description — a pre-existing
  // format behaviour, unrelated to math. What must hold is that every math span
  // survives byte-for-byte, and that a second pass is a fixed point.
  const mathSpans = (s) => splitMath(s).filter(x => x.kind !== 'text')
    .map(x => (x.kind === 'display' ? `$$${x.tex}$$` : `$${x.tex}$`));
  check('md round trip: every math span survives byte-for-byte', () => {
    const back = parseMdToAssignment(mathMd);
    const before = mathAssignment.problems[0].subsections[0].description;
    const after = back.problems[0].subsections[0].description;
    assertEqual(mathSpans(after), mathSpans(before), 'a math span changed on round trip');
    assertEqual(mathSpans(back.preamble), mathSpans(mathAssignment.preamble), 'preamble math changed');
    assertEqual(mathSpans(back.problems[0].subsections[0].aiGradingPrompt),
      mathSpans(mathAssignment.problems[0].subsections[0].aiGradingPrompt), 'rubric math changed');
  });
  check('md round trip: a second pass is a fixed point', () => {
    const once = assignmentToMd(parseMdToAssignment(mathMd));
    assertEqual(assignmentToMd(parseMdToAssignment(once)), once, 'the export is not stable');
  });
}

// =====================================================
// 9. AI feedback — one per-assignment flag
// =====================================================
// Gates the student-facing, gradeless, pointer-only feedback. It does NOT gate
// grading, which follows the sub-part types. The feedback itself, the
// per-problem election and the cross-submission tally live in Gradescope; this
// app only records the instructor's choice and carries it into the spec.
{
  const withFlag = (aiFeedback) => makeAssignment({ inputMode: 'electronic', aiFeedback });

  const onMd = assignmentToMd(withFlag(true));
  const offMd = assignmentToMd(withFlag(false));
  const absentMd = assignmentToMd(makeAssignment());

  check('md export: the line is written only when the flag is on', () => {
    assert(/^\*\*AI Feedback:\*\* on$/m.test(onMd), `no AI Feedback line in:\n${onMd}`);
    assert(!/AI Feedback/.test(offMd), 'an "off" flag wrote a line');
    assert(!/AI Feedback/.test(absentMd), 'an unset flag wrote a line');
  });

  check('md export: off and absent produce byte-identical files', () =>
    assertEqual(offMd, absentMd, 'an explicit off differs from an absent flag'));

  check('md import: on reads as on, off and absent read as off', () => {
    assertEqual(parseMdToAssignment(onMd).aiFeedback, true, '"on" did not import as on');
    assertEqual(parseMdToAssignment(offMd).aiFeedback, false, 'an absent line did not import as off');
    const explicitOff = onMd.replace('**AI Feedback:** on', '**AI Feedback:** off');
    assertEqual(parseMdToAssignment(explicitOff).aiFeedback, false, '"off" did not import as off');
  });

  check('md import: only a clear yes switches a student-facing feature on', () => {
    for (const value of ['off', 'no', 'false', 'maybe', 'ON PLEASE', '']) {
      const md = onMd.replace('**AI Feedback:** on', `**AI Feedback:** ${value}`);
      assertEqual(parseMdToAssignment(md).aiFeedback, false, `"${value}" switched the flag on`);
    }
    for (const value of ['on', 'ON', 'On', 'yes', 'true', 'enabled']) {
      const md = onMd.replace('**AI Feedback:** on', `**AI Feedback:** ${value}`);
      assertEqual(parseMdToAssignment(md).aiFeedback, true, `"${value}" did not switch the flag on`);
    }
  });

  check('md round trip is a fixed point for on, off and absent', () => {
    for (const [label, md] of [['on', onMd], ['off', offMd], ['absent', absentMd]]) {
      assertEqual(assignmentToMd(parseMdToAssignment(md)), md, `${label} is not a fixed point`);
    }
  });

  check('the flag reaches the exported spec, and an old spec reads as off', async () => {
    assertEqual((await buildAssignmentSpec(withFlag(true))).aiFeedback, true, 'the flag is missing from the spec');
    assertEqual((await buildAssignmentSpec(withFlag(false))).aiFeedback, false, 'off did not reach the spec');
    // An assignment saved before the flag existed carries no field at all.
    const old = await buildAssignmentSpec(makeAssignment());
    assert(!('aiFeedback' in old), 'the field was invented for an assignment that never had it');
    assert(!old.aiFeedback, 'an absent field does not read as off');
  });

  check('the flag does not touch grading', () => {
    // Same assignment, flag flipped: the rubric the autograder reads is identical.
    const a = generateGradingRubric(withFlag(true));
    const b = generateGradingRubric(withFlag(false));
    assertEqual(a, b, 'the AI-feedback flag changed the grading rubric');
    assert(!JSON.stringify(a).includes('aiFeedback'), 'the flag leaked into the grading rubric');
  });

  check('a handwritten assignment carries the flag too', () => {
    const hw = makeAssignment({ inputMode: 'handwritten', aiFeedback: true });
    const md = assignmentToMd(hw);
    assert(/^\*\*Input:\*\* handwritten$/m.test(md), 'the Input line went missing');
    assert(/^\*\*AI Feedback:\*\* on$/m.test(md), 'the AI Feedback line went missing');
    const back = parseMdToAssignment(md);
    assertEqual([back.inputMode, back.aiFeedback], ['handwritten', true], 'a value was lost');
  });
}

// =====================================================
// 8. Cross-app — the mirrored delimiter file has not drifted
// =====================================================
// services/mathDelimiters.ts is held byte-identical in both repos. If they ever
// differ, an instructor authors math that renders one way in the Maker and
// another way for the student — which is how the export paths drifted apart in
// the first place. Cheapest possible guard: compare the two files.
{
  const MIRROR = join('services', 'mathDelimiters.ts');
  const here = join(REPO, MIRROR);
  const there = resolve(REPO, '..', 'GradeBridge-Student-Submission', MIRROR);

  if (existsSync(there)) {
    // Line endings are a checkout artefact (core.autocrlf), not a divergence.
    const norm = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    check('cross-app: services/mathDelimiters.ts is byte-identical in both repos', () =>
      assert(norm(here) === norm(there),
        `the mirrored file has diverged.\n          copy ${here}\n          over ${there} (or the other way) and re-run`));
  } else {
    skip('cross-app: services/mathDelimiters.ts is byte-identical in both repos',
      'Student Submission repo not alongside this one');
  }

  check('the mirrored file is the only splitter in this repo', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (/^(node_modules|dist|\.git)$/.test(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (full === here) continue;
        if (/\\\$\\\$\[\\s\\S\]/.test(readFileSync(full, 'utf8'))) offenders.push(full);
      }
    };
    walk(REPO);
    assertEqual(offenders.map(f => f.slice(REPO.length + 1)), [],
      'a second copy of the delimiter regex appeared');
  });
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
// Windows keeps a handle on the imported bundles; a temp file left behind is
// not a test failure.
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed > 0 ? 1 : 0);
