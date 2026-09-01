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
const pointsSvc = await loadModule(join(REPO, 'services', 'pointsService.ts'), 'pointsService.mjs');
const figures = await loadModule(join(REPO, 'services', 'figureBlocks.ts'), 'figureBlocks.mjs');
const layoutSvc = await loadModule(join(REPO, 'services', 'templateLayout.ts'), 'templateLayout.mjs');
const retiredSvc = await loadModule(join(REPO, 'services', 'retiredTypes.ts'), 'retiredTypes.mjs');
const backupSvc = await loadModule(join(REPO, 'services', 'authoringBackup.ts'), 'authoringBackup.mjs');

// Same module, but with a real jsPDF so the PDF can actually be inspected.
const exportPdfSvc = await loadModule(join(REPO, 'services', 'exportService.ts'), 'exportServicePdf.mjs', {
  plugins: [stubBrowserOnlyDeps],
});

const { validateCoursePublicKey, normalizeCoursePublicKey, looksLikeCoursePublicKey, encryptJson, decryptJson } = crypto_;
const { buildAssignmentSpec, assignmentToMd, generateGradingRubric, convertSubmissionType,
        generateHTML, generateLaTeX, generateGraderHTML, STUDENT_SPEC_FIELDS } = exportSvc;
const { parseMdToAssignment } = mdParser;
const { typeAllowedInMode, defaultTypeForMode, convertSubsectionToMode, strandedSubsectionLabels } = inputModeSvc;
const { splitMath, toHtml, toLatexBody, toPlainUnicode, toPdfText, hasMath } = mathRender;
const { apportionPoints, tooManyPartsForTarget } = pointsSvc;
const { splitFigures, figureSegsToSource, hasFigure, trimAroundFigures, figureLabel,
        figurePlaceholder, sanitizeSvg, namespaceSvgIds, prepareSvgForInline } = figures;
const { estimateDescLines } = layoutSvc;
const { degradeRetiredTypes } = retiredSvc;
const { buildAuthoringBackup, isAuthoringBackup, readAuthoringBackup, describeImportGaps } = backupSvc;

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
// 10. Points apportionment
// =====================================================
// The old code rounded every part then dumped the whole rounding remainder on
// the largest one. On a 47-part, 200-point assignment that left a part worth
// −6, which reached the exported rubric and the student spec; the QR template's
// self-test was the first thing that ever checked. Largest-remainder
// apportionment replaces it.
{
  const sum = (xs) => xs.reduce((a, b) => a + b, 0);

  // The three real ENG17 assignments that surfaced this. Points read off the
  // .md headers; the second and third produced negative parts.
  const HW1 = [6,4,5,5,20,4,5,11,14,6,14,6,14,6,6,6,8,4,4,8,4,14,6,6,4,5,5];
  const HW2 = [4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4];
  const many = Array.from({ length: 41 }, () => 5);

  check('no part can come out negative or zero, on the assignments that broke it', () => {
    for (const [label, pts] of [['HW1-shaped', HW1], ['47 equal parts', HW2], ['41 equal parts', many]]) {
      const out = apportionPoints(pts, 100);
      assertEqual(out.filter(v => v <= 0), [], `${label}: a part came out non-positive`);
      assertEqual(sum(out), 100, `${label}: does not sum to the target`);
    }
  });

  check('the exact case from the failing export: 47 parts, 200 points', () => {
    const out = apportionPoints(HW2, 100);
    assertEqual(sum(out), 100, 'does not sum to 100');
    assert(Math.min(...out) >= 1, `smallest part is ${Math.min(...out)}`);
    assert(Math.max(...out) <= 3, `one part absorbed too much: ${Math.max(...out)}`);
  });

  check('a part keeps its share instead of absorbing the whole remainder', () => {
    // HW1: the 20-point part is 10% of 200, so it must stay worth 10 of 100.
    // The old code made it 7 — the same as a 14-point part.
    const out = apportionPoints(HW1, 100);
    assertEqual(out[4], 10, 'the 20-point part did not keep its 10% share');
    assertEqual(sum(out), 100, 'does not sum to 100');
  });

  check('a small part is never scaled out of existence', () => {
    // 1 point in a 400-point assignment is 0.25 of 100 — floors to zero.
    const out = apportionPoints([1, 399], 100);
    assertEqual(out, [1, 99], 'a 1-point part was rounded away');
    const many1 = apportionPoints([1, 1, 1, 997], 100);
    assert(many1.every(v => v >= 1), `a part hit zero: ${many1.join(',')}`);
    assertEqual(sum(many1), 100, 'does not sum to 100');
  });

  check('scaling up works too, and stays exact', () => {
    assertEqual(apportionPoints([1, 1, 1], 100), [34, 33, 33], 'wrong split scaling up');
    assertEqual(sum(apportionPoints([3, 7], 100)), 100, 'does not sum to 100');
    assertEqual(apportionPoints([3, 7], 100), [30, 70], 'exact shares were disturbed');
  });

  check('it is idempotent and leaves an already-correct total alone', () => {
    const once = apportionPoints(HW1, 100);
    assertEqual(apportionPoints(once, 100), once, 'a second pass changed the result');
    assertEqual(apportionPoints([50, 50], 100), [50, 50], 'an exact total was disturbed');
  });

  check('degenerate inputs do not throw or invent points', () => {
    assertEqual(apportionPoints([], 100), [], 'empty input');
    assertEqual(apportionPoints([0, 0], 100), [0, 0], 'all-zero points should stay zero');
    assertEqual(apportionPoints([5, 5], 0), [5, 5], 'a zero target should change nothing');
    assertEqual(apportionPoints([5, 5], NaN), [5, 5], 'a NaN target should change nothing');
  });

  check('more graded parts than points: it gives up rather than zeroing anyone', () => {
    // 150 parts cannot each hold >= 1 point out of 100. Every part stays worth
    // something and the total overshoots, which the self-test then surfaces.
    const out = apportionPoints(Array.from({ length: 150 }, () => 2), 100);
    assert(out.every(v => v >= 1), 'a part was zeroed');
    assert(tooManyPartsForTarget(Array.from({ length: 150 }, () => 2), 100), 'the condition was not detected');
  });

  check('the whole export path survives the assignment that failed', async () => {
    const subs = HW2.map((pts, i) => ({
      id: `s${i}`, name: `Part ${i}`, description: '', points: pts,
      submissionType: 'Handwritten', handwrittenGradingMode: 'ai',
    }));
    // Three problems, so the shape matches a real assignment.
    const problems = [subs.slice(0, 20), subs.slice(20, 35), subs.slice(35)].map((ss, i) => ({
      id: `p${i}`, name: `Problem ${i + 1}`, description: '', subsections: ss,
    }));
    const a = { ...makeAssignment(), inputMode: 'handwritten', problems };

    const rubric = generateGradingRubric(a);
    const bad = Object.values(rubric.rubrics).filter(r => !(r.max_points > 0));
    assertEqual(bad.map(r => `${r.subsection_id}=${r.max_points}`), [],
      'the grading rubric still carries a non-positive max_points');
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

// =====================================================
// 11. Figures — lifted before the math splitter, on every surface
// =====================================================
// The bug this guards: an SVG document is full of characters `splitMath` and
// KaTeX mis-handle — a `$` in path data or an attribute value reads as a math
// delimiter — so a drawing that reaches the splitter is shredded into text
// fragments and KaTeX spans, and nothing downstream notices. ENG17's
// check_math.js would report the file clean while it happened. Figures come out
// first, everywhere, and go back at their anchor.
{
  const FIXTURE = resolve(REPO, 'tests', 'fixtures', 'ENG17_FigureFixture.md');
  const fixtureMd = readFileSync(FIXTURE, 'utf8').replace(/\r\n/g, '\n');

  // --- the splitter ---
  check('splitFigures separates a fenced svg block from the prose around it', () => {
    const src = 'lead\n\n```svg\n<svg viewBox="0 0 1 1"/>\n```\n\ntail';
    const segs = splitFigures(src);
    assertEqual(segs.map(s => s.kind), ['text', 'figure', 'text'], 'wrong segmentation');
    assertEqual(segs[1].figure, { form: 'svg', svg: '<svg viewBox="0 0 1 1"/>' }, 'the svg was not lifted whole');
  });

  check('the split is exact — every form reassembles to the input byte-for-byte', () => {
    for (const src of [
      'a\n```svg\n<svg>X</svg>\n```\nb',
      '```svg\n<svg>X</svg>\n```',
      '```svg\n<svg>X</svg>\n```\n',
      '```svg\nA\n```\n![x](data:image/png;base64,AA)\n',
      'prose only, no figure',
      '```svg\nan unterminated fence\nis still lifted',
      '',
    ]) {
      assertEqual(figureSegsToSource(splitFigures(src)), src, `reassembly changed: ${JSON.stringify(src)}`);
    }
  });

  check('a markdown image on its own line is a figure; one inside a sentence is prose', () => {
    assert(hasFigure('![plot](data:image/png;base64,AA)') === true, 'a lone image was not lifted');
    assert(hasFigure('see ![plot](data:image/png;base64,AA) above') === false, 'an inline image was lifted');
    assert(hasFigure('no figures here') === false, 'prose counted as a figure');
  });

  check('trimAroundFigures drops the one newline either side, and nothing else', () => {
    const segs = trimAroundFigures(splitFigures('a\n\n```svg\n<svg/>\n```\n\nb'));
    assertEqual(segs.map(s => (s.kind === 'text' ? s.value : 'FIG')), ['a\n', 'FIG', '\nb'],
      'the authored blank line either side was not preserved');
  });

  // --- ordering: the SVG must never reach splitMath ---
  {
    const withDollar = '```svg\n<svg viewBox="0 0 9 9"><text>cost $5 each, $9 total</text></svg>\n```';
    check('a `$` inside a drawing is not a math delimiter', () => {
      assert(hasMath(withDollar) === true,
        'sanity: the raw block does look like math to splitMath — which is the whole point');
      const html = toHtml(withDollar, 'f-');
      assert(!/class="katex"/.test(html), 'KaTeX rendered part of the SVG');
      assert(html.includes('cost $5 each, $9 total'), `the drawing's own text was altered:\n${html}`);
      assert(html.includes('<svg'), 'the SVG did not survive into the HTML');
    });
    check('math beside a figure still renders', () => {
      const html = toHtml(`Given $V_{in} = 10$ V.\n\n${withDollar}\n\nFind $V_{out}$.`, 'f-');
      assertEqual((html.match(/class="katex"/g) || []).length > 0, true, 'the prose math was not rendered');
      assert(html.includes('cost $5 each, $9 total'), 'the figure was shredded by the math pass');
    });
  }

  // --- round trip ---
  const fixture2 = parseMdToAssignment(fixtureMd);
  check('md import: the fenced block lands in the problem stem, verbatim', () => {
    const stem = fixture2.problems[0].description;
    assert(stem.includes('```svg'), `no figure in the stem:\n${stem}`);
    assert(stem.includes('<title>divider circuit for Problem 1</title>'), 'the SVG title was lost');
    assert(stem.includes('#arrow { fill: #000000 }'), 'a `#` line inside the SVG was filtered out as a heading');
    assert(stem.includes('marker-end="url(#arrow)"'), 'a wrapped attribute line was dropped');
    assert(stem.startsWith('The circuit below is driven by $V_{in} = 10$ V.'), 'the stem prose was lost');
  });
  check('md import: a figure line is not mistaken for a blockquote or a header', () => {
    assertEqual(fixture2.problems[0].subsections[0].graderNote, 'Expect 2/3.', 'the grader note was disturbed');
    assertEqual(fixture2.problems.length, 4, 'the figure block split a problem in two');
  });
  check('md import: the image form lands in the stem', () => {
    assert(/^!\[measured magnitude response\]\(data:image\/gif/.test(fixture2.problems[2].description),
      `the image figure did not survive: ${fixture2.problems[2].description}`);
  });
  check('md round trip: the figure fixture is byte-identical through import → export', () =>
    assertEqual(assignmentToMd(fixture2), fixtureMd, 'the file changed on round trip'));
  check('md round trip: a second pass is a fixed point', () => {
    const once = assignmentToMd(parseMdToAssignment(fixtureMd));
    assertEqual(assignmentToMd(parseMdToAssignment(once)), once, 'the export is not stable');
  });
  check('md export: a problem with no figure emits nothing new', () => {
    const plain = makeAssignment();
    assert(!/```svg|!\[/.test(assignmentToMd(plain)), 'a figure block was invented');
    assertEqual(assignmentToMd(parseMdToAssignment(assignmentToMd(plain))), assignmentToMd(plain),
      'a figure-free assignment stopped round-tripping');
  });
  check('two problems may carry the same figure — neither is deduped away', () => {
    const [p1, p2] = fixture2.problems;
    const fig = s => splitFigures(s).find(x => x.kind === 'figure').source;
    assertEqual(fig(p2.description), fig(p1.description), 'the shared figure did not survive on both problems');
  });

  // --- ids ---
  check('inlining namespaces the ids, so a shared figure cannot capture the other copy', () => {
    const svg = '<svg><defs><marker id="arrow"/><style>#arrow { fill: red }</style></defs>'
      + '<path marker-end="url(#arrow)"/><use href="#arrow"/></svg>';
    const a = prepareSvgForInline(svg, 'p0-');
    const b = prepareSvgForInline(svg, 'p1-');
    for (const [label, out, prefix] of [['first', a, 'p0-'], ['second', b, 'p1-']]) {
      assert(out.includes(`id="${prefix}arrow"`), `${label}: the id was not prefixed`);
      assert(out.includes(`url(#${prefix}arrow)`), `${label}: the url() reference was not prefixed`);
      assert(out.includes(`href="#${prefix}arrow"`), `${label}: the href reference was not prefixed`);
      assert(out.includes(`#${prefix}arrow { fill: red }`), `${label}: the CSS selector was not prefixed`);
    }
    assert(a !== b, 'both copies got the same id namespace');
  });
  check('an SVG with no ids is left exactly as authored', () =>
    assertEqual(namespaceSvgIds('<svg><rect/></svg>', 'p-'), '<svg><rect/></svg>', 'the drawing was rewritten'));
  check('an inlined drawing is as wide as it says it is, and never wider than the column', () => {
    // viewBox only: without an intrinsic width the browser stretches a replaced
    // element to 100% of its container — a 240x120 circuit filling the page.
    const viewBoxOnly = prepareSvgForInline('<svg viewBox="0 0 240 120"><rect/></svg>', 'q-');
    assert(/style="width:240px;max-width:100%;height:auto"/.test(viewBoxOnly),
      `the viewBox width was not adopted: ${viewBoxOnly}`);
    const declared = prepareSvgForInline('<?xml version="1.0"?>\n<svg viewBox="0 0 800 400" width="800"/>', 'q-');
    assert(!declared.includes('<?xml'), 'the XML prolog was inlined into the page');
    assert(/max-width:100%/.test(declared) && !/width:800px/.test(declared),
      `a declared width was overridden: ${declared}`);
  });
  check('a drawing cannot bring script with it', () => {
    const out = sanitizeSvg('<svg><script>alert(1)</script><rect onclick="steal()" onload=x /><a href="javascript:x">t</a></svg>');
    assert(!/script/i.test(out), `a script survived: ${out}`);
    assert(!/onclick|onload/i.test(out), `an event handler survived: ${out}`);
    assert(!/javascript:/i.test(out), `a javascript: URL survived: ${out}`);
    assert(out.includes('<rect'), 'the drawing itself was removed');
  });
  check('the placeholder names the drawing from its <title>', () => {
    assertEqual(figureLabel({ form: 'svg', svg: '<svg><title>circuit for Problem 3</title></svg>' }),
      'circuit for Problem 3', 'the title was not read');
    assertEqual(figurePlaceholder({ form: 'svg', svg: '<svg/>' }), '[figure]', 'wrong untitled placeholder');
    assertEqual(figurePlaceholder({ form: 'image', alt: 'Bode plot', url: 'data:image/png;base64,AA' }),
      '[figure: Bode plot]', 'the alt text was not used');
  });

  // --- the exports ---
  {
    const html = await generateHTML(fixture2);
    const graderHtml = await generateGraderHTML(fixture2);
    for (const [label, doc] of [['assignment.html', html], ['grader document', graderHtml]]) {
      check(`${label}: the drawing is inlined, not escaped into prose`, () => {
        assert(doc.includes('<svg viewBox="0 0 240 120"'), 'the SVG was not inlined');
        assert(!doc.includes('&lt;svg'), 'the SVG source was escaped into the page as text');
        assert(doc.includes('cost $5 each, $9 total'), "the drawing's own text was altered");
      });
      check(`${label}: the two copies of the shared figure get different id namespaces`, () => {
        const ids = [...doc.matchAll(/<marker id="([^"]+)"/g)].map(m => m[1]);
        assertEqual(ids.length, 2, `expected the figure twice, found ${ids.length}`);
        assert(ids[0] !== ids[1], `both copies declare the same id: ${ids[0]}`);
      });
      check(`${label}: the image form becomes an <img>`, () =>
        assert(/<img src="data:image\/gif;base64,[^"]+" alt="measured magnitude response"/.test(doc),
          'the markdown image did not render'));
    }

    const tex = generateLaTeX(fixture2);
    check('tex: a figure degrades to a placeholder, never raw SVG source', () => {
      assert(!/<svg|viewBox/.test(tex), 'SVG source leaked into the .tex');
      assert(tex.includes('[figure: divider circuit for Problem 1]'), `no placeholder in:\n${tex.slice(0, 1200)}`);
      assert(!tex.includes('<<') && !tex.includes('>>'), 'raw << >> would become guillemets under T1');
    });

    const pdf = await exportPdfSvc.createPDF(fixture2, 'student');
    const bytes = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    check('pdf: without a rasteriser a figure degrades to a short placeholder line', () => {
      assert(bytes.startsWith('%PDF'), 'not a PDF');
      assert(!/viewBox|<svg/.test(bytes), 'raw SVG source was written into the PDF');
      assert(bytes.includes('[figure: divider circuit for Problem 1]'),
        'the placeholder line is not in the PDF text');
    });

    const rubric = generateGradingRubric(fixture2);
    check('rubric: the grader gets the figure as words, never as path data', () => {
      // §11 used to send the stem verbatim, SVG included — ~143k tokens of
      // `<path d="…">` per student per grading pass on the ENG17 set, carried so
      // a grader forbidden to reason from the drawing could decline to use it.
      const r = rubric.rubrics.p0s0;
      assert(!/<svg|<path|viewBox|```svg/.test(r.problem_statement),
        `SVG source reached the grading rubric:\n${r.problem_statement.slice(0, 400)}`);
      assert(r.problem_statement.includes('[Figure: divider circuit for Problem 1]'),
        `the figure's own words are missing:\n${r.problem_statement}`);
      // The prose around it is untouched and still in place.
      assert(r.problem_statement.includes('The circuit below is driven by $V_{in} = 10$ V.'),
        `the stem prose was disturbed:
${r.problem_statement}`);
      assertEqual(rubric.rubrics.p0s1.problem_statement, r.problem_statement,
        'the two parts of one problem disagree about the stem');
    });

    check('rubric: the grader payload no longer scales with the drawing', () => {
      // The real property, and the one that does not depend on how big a test
      // fixture happens to be: what the grader carries is the figure's *words*,
      // so it is constant no matter how much geometry the drawing holds. ENG17
      // measured the old behaviour at ~143k tokens per student per pass.
      const withPaths = (n) => ({
        ...fixture2,
        problems: [{
          ...fixture2.problems[0],
          description: [
            'For the bridge circuit provided: a 20 V source and six resistors.',
            '',
            '```svg',
            '<svg viewBox="0 0 400 240"><title>bridge circuit</title>'
              + '<desc>A 20 V source across a bridge of six resistors, nodes A to D lettered.</desc>'
              + Array.from({ length: n }, (_, i) => `<path d="M ${i} 20 H 220 V 100 H 20 Z" fill="none"/>`).join('')
              + '</svg>',
            '```',
          ].join('\n'),
        }],
      });
      const statement = (n) => generateGradingRubric(withPaths(n)).rubrics.p0s0.problem_statement;

      const small = statement(200), large = statement(400);
      assertEqual(small, large, 'the grader payload still grows with the drawing');
      assert(!/<path/.test(small), 'path geometry survived into the grading rubric');
      assert(small.length * 50 < withPaths(200).problems[0].description.length,
        `the stem only shrank to ${small.length} of ${withPaths(200).problems[0].description.length} bytes`);
      // Grader-facing only: every student-facing render still inlines the real
      // drawing, and the authored .md still carries the full <svg>.
      assert(html.includes('<svg viewBox="0 0 240 120"'), 'the student HTML lost the drawing');
      assert(assignmentToMd(fixture2).includes('```svg'), 'the .md round trip lost the drawing');
    });

    check('rubric: the markdown image form becomes its alt text', () => {
      const r = rubric.rubrics.p2s0;
      assert(r.problem_statement.includes('[Figure: measured magnitude response]'),
        `the image alt text is missing:\n${r.problem_statement}`);
      assert(!r.problem_statement.includes('data:image/'),
        'a data: URI reached the grading rubric');
    });

    check('rubric: the <desc> fallback degrades instead of blocking', () => {
      // The ENG17 <desc> set is still being authored, so all three rungs matter.
      const stem = (svg) => ({
        ...fixture2,
        problems: [{ ...fixture2.problems[0], description: `Given the network.\n\n\`\`\`svg\n${svg}\n\`\`\`` }],
      });
      const statement = (svg) => generateGradingRubric(stem(svg)).rubrics.p0s0.problem_statement;

      assert(statement('<svg viewBox="0 0 9 9"><title>bridge circuit</title>'
        + '<desc>A 20 V source across a bridge of six resistors, nodes A to D lettered.</desc></svg>')
        .includes('[Figure — bridge circuit: A 20 V source across a bridge of six resistors, nodes A to D lettered.]'),
        'title and desc together were not used');
      assert(statement('<svg viewBox="0 0 9 9"><title>bridge circuit</title></svg>')
        .includes('[Figure: bridge circuit]'), 'a title-only figure did not fall back to its title');
      assert(statement('<svg viewBox="0 0 9 9"><rect width="9" height="9"/></svg>')
        .includes('[figure]'), 'a figure with neither title nor desc did not fall back to [figure]');
    });
    check('rubric: a problem with no stem carries no problem_statement at all', () =>
      assert(!('problem_statement' in rubric.rubrics.p3s0),
        'an empty stem was written into the rubric'));
  }

  // --- the printed handwritten template ---
  check('template layout: text is counted per paragraph, uncapped, plus a slack line', () => {
    // No ceiling — a long stem reserves its full height and prints at full size
    // rather than being crushed into eight lines. The advance and the slack line
    // both over-reserve on purpose: text is never scaled, so a short reservation
    // would overrun rather than shrink.
    const width = 169.9;
    const perLine = Math.max(20, Math.floor(width / (9 * 0.62 * 25.4 / 72)));
    for (const text of ['', 'A short line.', 'x'.repeat(400), 'x'.repeat(20000), 'one\n\ntwo\nthree']) {
      // A blank line inside a block still costs a line — it is a paragraph break.
      const expected = text.trim()
        ? text.split('\n').reduce((n, p) => n + Math.max(1, Math.ceil(p.trim().length / perLine)), 0) + 1
        : 0;
      assertEqual(estimateDescLines(text, width), expected, `reservation moved for: ${JSON.stringify(text.slice(0, 20))}`);
    }
  });

  check('template layout: the reservation covers what the render font actually needs', async () => {
    // The calibration this rests on, asserted rather than assumed: for real
    // question text the estimate must be >= the lines the render font wraps to.
    // Measured with jsPDF's own metrics for Times, the family
    // renderTextToCanvas sets. If this ever goes red the estimator has drifted
    // from the renderer and stems will start overrunning their boxes.
    const width = 169.9;
    const jsPdfMod = await import('jspdf');
    const JsPDF = jsPdfMod.jsPDF || jsPdfMod.default;
    const doc = new JsPDF({ unit: 'mm', format: [215.9, 279.4] });
    doc.setFont('times', 'normal');
    doc.setFontSize(9);
    const samples = [
      'For the bridge circuit provided (text problem 1.11): a 20 V source and six resistors, with every node lettered on the drawing. Take the bottom node as the reference.',
      'A uniform plane wave at 1 GHz propagates in a medium with sigma = 4 S/m and mu_r = 1. Determine the skin depth, the attenuation constant, the phase constant, and the intrinsic impedance, stating units for each and showing the formula you used at every step.',
      'Given $V_{32} = V_3 - V_2$ and $I_{ab} = (V_a - V_b)/R$, find every branch current in the network shown, expressing each in mA to three significant figures.',
      'Find every group of two or more elements in series.',
    ];
    for (const text of samples) {
      const real = doc.splitTextToSize(text, width).length;
      const estimated = estimateDescLines(text, width);
      assert(estimated >= real,
        `the estimate under-reserves: ${estimated} lines for text that wraps to ${real}\n          ${text.slice(0, 60)}…`);
    }
  });
  check('template layout: a figure reserves a block, not eight lines of character count', () => {
    const width = 169.9;
    const svgStem = 'Given the circuit.\n\n```svg\n' + '<svg viewBox="0 0 9 9">' + 'x'.repeat(3000) + '</svg>\n```';
    const lines = estimateDescLines(svgStem, width);
    assert(lines > 8, `a figure-bearing stem reserved only ${lines} lines — the drawing would be a smudge`);
    assert(lines < 24, `a figure-bearing stem reserved ${lines} lines — that is the whole page`);
  });

  // --- the mirrored file ---
  {
    const MIRROR = join('services', 'figureBlocks.ts');
    const here = join(REPO, MIRROR);
    const there = resolve(REPO, '..', 'GradeBridge-Student-Submission', MIRROR);
    if (existsSync(there)) {
      const norm = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
      check('cross-app: services/figureBlocks.ts is byte-identical in both repos', () =>
        assert(norm(here) === norm(there),
          `the mirrored file has diverged.\n          copy ${here}\n          over ${there} (or the other way) and re-run`));
    } else {
      skip('cross-app: services/figureBlocks.ts is byte-identical in both repos',
        'Student Submission repo not alongside this one');
    }
  }
}

// =====================================================
// 12. Retired types — AI Formative is gone, but a file carrying it still opens
// =====================================================
// The authoring path is removed: no pill, no export mapping, no enum member.
// What is left is the one-way door — an .md or a saved project written before
// the removal degrades to Text and says which sub-part changed.
{
  const RETIRED_MD = [
    '# EEC1: Lab 9 Post-Lab',
    '',
    '**Preamble:** Complete all parts.',
    '',
    '## Problem 1: Reflection',
    '',
    '### (a) What surprised you [40 pts] [ai-graded:formative]',
    'Describe one thing that surprised you in lab.',
    '> grading_prompt: Required elements: (1) a specific observation.',
    '',
    '### (b) Measured value [60 pts] [text]',
    'State the measured resistance.',
    '> grader_note: 4.7 kilohm ± 5%.',
    '',
  ].join('\n');

  const warnings = [];
  const retiredAssignment = parseMdToAssignment(RETIRED_MD, warnings);
  const partA = retiredAssignment.problems[0].subsections[0];

  check('retired: an .md carrying the retired tag imports as a Text sub-part', () => {
    assertEqual(partA.submissionType, 'Text', 'the retired tag did not degrade to Text');
    assertEqual(partA.points, 40, 'the points did not survive the degrade');
    assert(partA.description.includes('surprised you in lab'),
      'the description was lost with the type');
    assert(partA.minWords === undefined, `a degraded part kept minWords: ${partA.minWords}`);
  });

  check('retired: the authored rubric survives, as a grader note', () => {
    assert(!partA.aiGradingPrompt,
      `a part that is no longer AI graded kept an invisible AI prompt: ${partA.aiGradingPrompt}`);
    assert((partA.graderNote || '').includes('a specific observation'),
      `the authored rubric was dropped instead of kept as a grader note: ${partA.graderNote}`);
    assert(assignmentToMd(retiredAssignment).includes('grader_note: Required elements'),
      'the preserved rubric does not survive the .md export');
  });

  check('retired: the import warns, naming the sub-part', () => {
    assertEqual(warnings.length, 1, `expected exactly one warning, got ${warnings.length}`);
    assert(warnings[0].includes('What surprised you'),
      `the warning does not name the sub-part: ${warnings[0]}`);
    assert(warnings[0].includes('retired'),
      `the warning does not say the type was retired: ${warnings[0]}`);
  });

  check('retired: a file with no retired tag warns about nothing', () => {
    const clean = [];
    parseMdToAssignment(RETIRED_MD.replace('[ai-graded:formative]', '[ai-graded:short]'), clean);
    assertEqual(clean, [], 'a clean file produced warnings');
  });

  check('retired: nothing downstream can write the retired tag or grading type', () => {
    const md = assignmentToMd(retiredAssignment);
    assert(!md.includes('formative'), 'the .md export still writes the retired tag');
    const rubric = generateGradingRubric(retiredAssignment);
    const types = Object.values(rubric.rubrics).map(r => r.grading_type);
    assert(!types.includes('ai_formative'),
      `the rubric still emits ai_formative: ${JSON.stringify(types)}`);
    assertEqual(types, ['human', 'human'], 'the degraded part is not graded as plain human text');
  });

  check('retired: a saved project carrying the retired value degrades on load', () => {
    const stored = makeAssignment();
    stored.problems[0].subsections[0].name = 'Design reflection';
    stored.problems[0].subsections[0].submissionType = 'AI Formative';
    const found = degradeRetiredTypes(stored);
    assertEqual(stored.problems[0].subsections[0].submissionType, 'Text',
      'a stored retired value was left in place');
    assertEqual(found.length, 1, `expected one warning, got ${found.length}`);
    assert(found[0].includes('Design reflection'),
      `the warning does not name the sub-part: ${found[0]}`);
  });

  check('retired: an assignment with no retired value is left alone', () => {
    const clean = makeAssignment();
    assertEqual(degradeRetiredTypes(clean), [], 'a clean assignment reported a degrade');
    assertEqual(clean.problems[0].subsections[0].submissionType, 'Text', 'a clean part was rewritten');
  });
}

// =====================================================
// 9. The export contract (ASSIGNMENT_MD_SPEC.md §12)
// =====================================================
// Two guards, both over the artifacts a real export actually writes rather than
// a hand-built object:
//
//   1. No exported artifact carries a grading-system resource decision. The
//      Assignment Maker describes the work; the grading system decides how to
//      grade it. `ai_grading_config` was deleted on 2026-08-31 after two agents
//      spent a cycle escalating a 512-token ceiling that nothing ever read.
//      Without this check the spec sentence is only advice.
//   2. Every rubric item declares `answer_modality`, and it agrees with
//      `is_drawing` in the layout map. The two are deliberately duplicated so a
//      consumer never has to join two files to learn one fact — which only
//      holds if they cannot drift.
{
  const MODALITIES = ['text', 'figure', 'hybrid'];

  // Keys, not raw text: real question prose says "temperature" and "model" all
  // the time in an engineering course, and a substring scan would cry wolf on
  // every thermal problem ever set. A model *identifier* is scanned as text,
  // because that shape does not occur in prose.
  const RESOURCE_KEY = /^(model|model_name|temperature|max_?tokens|top_?[pk])$/i;
  const MODEL_ID = /claude-[a-z0-9]/i;

  const resourceKeys = (node, path = '$') => {
    if (Array.isArray(node)) return node.flatMap((v, i) => resourceKeys(v, `${path}[${i}]`));
    if (node && typeof node === 'object') {
      return Object.entries(node).flatMap(([k, v]) => [
        ...(RESOURCE_KEY.test(k) ? [`${path}.${k} = ${JSON.stringify(v)}`] : []),
        ...resourceKeys(v, `${path}.${k}`),
      ]);
    }
    return [];
  };

  // A handwritten assignment exercises every artifact at once: it is the only
  // mode that writes a layout map, and its sketch part is the only thing that
  // produces answer_modality "figure". The prose deliberately says "model" and
  // "temperature" — a guard that a course on heat transfer would trip is a
  // guard someone will delete.
  const contractAssignment = {
    id: 'xc1', courseCode: 'ENG17', title: 'HW 1',
    inputMode: 'handwritten',
    preamble: 'Show all working. Ambient temperature is 300 K unless stated.',
    problems: [{
      id: 'p1', name: 'Thermal model of the divider', description: '',
      subsections: [
        {
          id: 's1', name: 'Node equations',
          description: 'Write the node equations, and state the model you assume for the source temperature.',
          points: 60, submissionType: 'Handwritten', handwrittenGradingMode: 'ai',
          answerLines: 8,
          aiGradingPrompt: 'Required elements: (1) one equation per node; (2) a stated source model.',
        },
        {
          id: 's2', name: 'Field sketch', description: 'Sketch the field pattern.',
          points: 40, submissionType: 'Handwritten', handwrittenGradingMode: 'human',
          answerLines: 10, isDrawing: true,
          graderNote: 'Arrows normal to the walls, and the answer is 1.2 V.',
        },
      ],
    }],
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  let entries = null, entryError = null;
  try { entries = await exportPdfSvc.buildExportEntries(contractAssignment); }
  catch (err) { entryError = err; }

  if (!entries) {
    skip('export contract: exported artifacts carry no grading-resource field',
      `buildExportEntries threw: ${entryError && entryError.message}`);
    skip('export contract: answer_modality present and agrees with is_drawing',
      'no export entries');
  } else {
    const csvName = Object.keys(entries).find(n => /\/layout_.*\.csv$/.test(n));
    const rubricName = Object.keys(entries).find(n => n.endsWith('_grading_rubric.json'));
    const specName = Object.keys(entries).find(n => n.endsWith('assignment_spec.json'));

    check('export contract: the ZIP holds a rubric, an encrypted spec and a layout map', () => {
      assert(rubricName, `no grading rubric in: ${Object.keys(entries).join(', ')}`);
      assert(csvName, `no layout map in: ${Object.keys(entries).join(', ')}`);
      assert(typeof entries[specName] === 'string', 'no spec JSON');
    });

    const rubricJson = entries[rubricName];
    const layoutCsv = entries[csvName];
    const specJson = JSON.stringify(await decryptJson(entries[specName]));

    check('export contract: no exported artifact carries a model, temperature or token budget', () => {
      for (const [label, text] of [['grading rubric', rubricJson], ['assignment spec', specJson]]) {
        assertEqual(resourceKeys(JSON.parse(text)), [],
          `the ${label} carries a grading-system resource decision`);
        assert(!MODEL_ID.test(text), `the ${label} names a model: ${text.match(MODEL_ID)}`);
      }
      const header = layoutCsv.split('\n')[0].split(',').map(c => c.trim());
      assertEqual(header.filter(c => RESOURCE_KEY.test(c)), [],
        'the layout map has a grading-resource column');
      assert(!MODEL_ID.test(layoutCsv), 'the layout map names a model');
      assert(!/ai_grading_config/.test(rubricJson + specJson + layoutCsv),
        'ai_grading_config is back in an exported artifact');
    });

    // GUARD 1 — the one that matters. A real export, decrypted the way a
    // student's browser decrypts it, must contain no grading material at all.
    // This is the check that would have caught 17 of 17 ENG17 grading prompts,
    // REFERENCE lines and worked answers included, sitting in the student's copy.
    check('student spec: a decrypted export carries no prompt, no grader note and no config', () => {
      const spec = JSON.parse(specJson);
      const banned = ['aiGradingPrompt', 'graderNote', 'aiGradingConfig'];
      const keysIn = (node, path = '$') => {
        if (Array.isArray(node)) return node.flatMap((v, i) => keysIn(v, `${path}[${i}]`));
        if (node && typeof node === 'object') {
          return Object.entries(node).flatMap(([k, v]) => [
            ...(banned.includes(k) ? [`${path}.${k}`] : []), ...keysIn(v, `${path}.${k}`),
          ]);
        }
        return [];
      };
      assertEqual(keysIn(spec), [], 'the student spec carries grading material');
      // Not just the key — the text. The fixture's prompt and grader note both
      // contain sentences a student must not see; assert neither reached them.
      assert(!specJson.includes('Required elements'), 'a grading prompt\'s text is in the student spec');
      assert(!specJson.includes('Arrows normal to the walls'), "a grader note's text is in the student spec");
      assert(!specJson.includes('1.2 V'), 'an answer key value is in the student spec');
    });

    // GUARD 2 — the field set IS the whitelist, at every level. Adding a field
    // to `Assignment` now fails this until someone decides deliberately, which
    // is the whole reason the spec is built forwards rather than by subtraction.
    check('student spec: the field set is exactly the whitelist, at every level', () => {
      const spec = JSON.parse(specJson);
      const extra = (obj, allowed, where) =>
        Object.keys(obj).filter(k => !allowed.includes(k)).map(k => `${where}.${k}`);

      assertEqual(extra(spec, STUDENT_SPEC_FIELDS.assignment, 'assignment'), [],
        'the spec carries a field outside the whitelist');
      for (const [i, prob] of spec.problems.entries()) {
        assertEqual(extra(prob, STUDENT_SPEC_FIELDS.problem, `problems[${i}]`), [],
          'a problem carries a field outside the whitelist');
        for (const [j, sub] of prob.subsections.entries()) {
          assertEqual(extra(sub, STUDENT_SPEC_FIELDS.subsection, `problems[${i}].subsections[${j}]`), [],
            'a sub-part carries a field outside the whitelist');
        }
      }
      // The other half: everything the student app needs is actually there.
      for (const k of ['id', 'courseCode', 'title', 'preamble', 'problems', 'createdAt', 'updatedAt']) {
        assert(k in spec, `the spec is missing ${k}, which the student app reads`);
      }
      for (const sub of spec.problems.flatMap(p => p.subsections)) {
        for (const k of ['id', 'name', 'description', 'points', 'submissionType']) {
          assert(k in sub, `a sub-part is missing ${k}, which the student app reads`);
        }
      }
    });

    // The whitelist is only as good as its agreement with the app it is a
    // whitelist FOR, and that app is a separate repo. Compare the two directly.
    const studentTypes = resolve(REPO, '..', 'GradeBridge-Student-Submission', 'types.ts');
    const checkOrSkip = existsSync(studentTypes) ? check
      : (name) => skip(name, 'GradeBridge-Student-Submission is not checked out alongside');
    checkOrSkip('student spec: the whitelist matches what the Student Submission app declares', () => {
      const src = readFileSync(studentTypes, 'utf8');
      const fieldsOf = (iface) => {
        const body = src.match(new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`))[1];
        return [...body.matchAll(/^\s*(\w+)\??:/gm)].map(m => m[1]);
      };
      // Every field the student app declares must be one we are allowed to send.
      // There is no exemption list any more: `dueDate` / `dueTime` were the only
      // entries and were deleted from both repos on 2026-08-31, being required
      // fields that were never present. If this needs an exemption again, the
      // question to ask first is whether the field should exist at all.
      const missing = fieldsOf('Assignment').filter(f => !STUDENT_SPEC_FIELDS.assignment.includes(f));
      assertEqual(missing, [], 'the student app declares an assignment field the whitelist does not send');
      const subMissing = fieldsOf('Subsection').filter(f => !STUDENT_SPEC_FIELDS.subsection.includes(f));
      assertEqual(subMissing, [], 'the student app declares a sub-part field the whitelist does not send');
    });

    check('export contract: every handwritten rubric item declares an answer_modality', () => {
      const { rubrics } = JSON.parse(rubricJson);
      const items = Object.entries(rubrics);
      assert(items.length > 0, 'no rubric items');
      for (const [key, item] of items) {
        // Every part of a handwritten assignment declares one: `sketch` says
        // figure and everything else is writing.
        assert('answer_modality' in item, `${key} has no answer_modality`);
        assert(MODALITIES.includes(item.answer_modality),
          `${key} declares answer_modality ${JSON.stringify(item.answer_modality)}`);
        assert(item.answer_modality !== 'hybrid', `${key} emitted the reserved value "hybrid"`);
      }
    });

    check('export contract: answer_modality agrees with is_drawing in the layout map', () => {
      const { rubrics } = JSON.parse(rubricJson);
      const rows = layoutCsv.trim().split('\n').slice(1).map(line => {
        const c = line.split(',');
        return { partId: c[3], isDrawing: c[9] === '1' };
      });
      // The map is keyed by part_id (`1(a)`, or a plain `2` for a lone part);
      // the rubric is keyed by p{i}s{j}. Rebuild the display string the way
      // enumerateParts() does, out of what the rubric itself carries.
      const partsPerProblem = {};
      for (const item of Object.values(rubrics)) {
        partsPerProblem[item.problem_number] = (partsPerProblem[item.problem_number] || 0) + 1;
      }
      let compared = 0;
      for (const [key, item] of Object.entries(rubrics)) {
        const partId = partsPerProblem[item.problem_number] === 1
          ? `${item.problem_number}`
          : `${item.problem_number}(${item.subsection_letter})`;
        const row = rows.find(r => r.partId === partId);
        assert(row, `no layout row for ${key} (part_id ${partId})`);
        assertEqual(item.answer_modality, row.isDrawing ? 'figure' : 'text',
          `${key} (part_id ${partId}) disagrees with the map's is_drawing`);
        compared++;
      }
      assertEqual(compared, rows.length, 'not every region was compared');
      // Both values have to be exercised, or the check proves nothing.
      const seen = [...new Set(Object.values(rubrics).map(r => r.answer_modality))].sort();
      assertEqual(seen, ['figure', 'text'], 'the fixture did not exercise both modalities');
    });
  }

  // `answer_modality` is OPTIONAL and is written only where the app actually
  // knows. An `[image]` part is answered with a picture but declares nothing —
  // `isDrawing` is handwritten-only — and `"text"` there would be a false
  // statement in a field whose only purpose is routing. A wrong value is worse
  // than a missing one precisely because it does not prompt anyone to ask.
  check('export contract: a written answer declares "text"; a picture declares nothing', () => {
    const mixed = makeAssignment({
      problems: [{
        id: 'p1', name: 'Mixed', description: '',
        subsections: [
          { id: 's1', name: 'Written', description: 'Explain.', points: 25, submissionType: 'Text' },
          { id: 's2', name: 'AI written', description: 'Explain.', points: 25, submissionType: 'AI Graded: Short' },
          { id: 's3', name: 'Photo', description: 'Photograph the board.', points: 25, submissionType: 'Image', maxImages: 1 },
          { id: 's4', name: 'Caption + photo', description: 'Caption it.', points: 25, submissionType: 'Text and Image', maxImages: 1 },
        ],
      }],
    });
    const { rubrics } = generateGradingRubric(mixed);
    assertEqual(rubrics.p0s0.answer_modality, 'text', 'a text part did not declare text');
    assertEqual(rubrics.p0s1.answer_modality, 'text', 'an AI-graded text part did not declare text');
    assert(!('answer_modality' in rubrics.p0s2),
      `an [image] part declared ${JSON.stringify(rubrics.p0s2.answer_modality)} — it knows no modality`);
    assert(!('answer_modality' in rubrics.p0s3),
      `a [text+image] part declared ${JSON.stringify(rubrics.p0s3.answer_modality)} — it knows no modality`);
    // Everything that IS written stays inside the documented set.
    for (const [key, item] of Object.entries(rubrics)) {
      if ('answer_modality' in item) {
        assert(MODALITIES.includes(item.answer_modality),
          `${key} declares answer_modality ${JSON.stringify(item.answer_modality)}`);
      }
    }
  });

  // The markdown format never carried any of this, so the round trip should be
  // untouched by the removal — assert it rather than assume it.
  check('export contract: dropping the grader config left the .md round trip byte-stable', () => {
    const md = assignmentToMd(contractAssignment);
    assertEqual(assignmentToMd(parseMdToAssignment(md)), md, '.md round trip is not byte-stable');
  });
}

// Acceptance 3: a spec exported before this change carries `aiGradingConfig`.
// It must load, say nothing about it, and not carry it back out.
{
  const stale = {
    ...makeAssignment(),
    aiGradingConfig: { model: 'claude-haiku-4-5-20251001', temperature: 0.1, maxTokens: 512 },
  };
  const spec = await buildAssignmentSpec(stale);
  const rubric = JSON.stringify(generateGradingRubric(stale));

  check('export contract: a pre-change spec loads and does not re-export the stale field', () => {
    assert(!('aiGradingConfig' in spec), 'the stale grader config rode back out in the spec');
    assert(!/ai_grading_config|claude-/.test(rubric), 'the stale grader config reached the rubric');
  });
}

// =====================================================
// 10. The authoring backup — the one file that restores everything
// =====================================================
// The privacy notice tells instructors the export ZIP is their backup, and
// until 2026-08-31 nothing in it restored an assignment completely:
// `assignment_spec.json` correctly drops the grading material and `answerLines`
// (losing which repaginates the sheet and moves `layout_id`), `Export .md`
// drops `targetPoints`, `coursePublicKey` and `config`, and the ZIP did not
// contain the `.md` at all. Completeness is now one property of one file, and
// this is its one test.
{
  // A fixture carrying EVERY field the type allows. This is the point of the
  // round trip: it must fail when a field is added to `Assignment` and not
  // carried, so the guarantee cannot rot into "complete as of whenever".
  //
  // It is deliberately a SUPERSET rather than a valid authoring combination — a
  // handwritten part does not really carry `maxImages` or `imageGradingMode`.
  // The backup is a container and must round-trip whatever it is handed; the
  // check below compares the fixture against `types.ts` so a new field cannot
  // slip past by being one nobody thought to put in it.
  const everything = {
    id: 'restore-1',
    courseCode: 'ENG17',
    title: 'HW 1',
    inputMode: 'handwritten',
    pageFormatId: 'ENG17HW1',
    aiFeedback: true,
    preamble: 'Show all working on paper.',
    targetPoints: 200,
    // A real key when the fixture is available, so the spec-building checks
    // below exercise the validating path rather than a placeholder.
    coursePublicKey: fixture ? fixture.public_key_spki_pem : '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n',
    problems: [{
      id: 'p1', name: 'Divider', description: 'A stem with a $V_s$ in it.',
      subsections: [
        {
          id: 's1', name: 'Node equations', description: 'Write them.',
          points: 120, submissionType: 'Handwritten', handwrittenGradingMode: 'ai',
          answerLines: 14, isDrawing: false, maxImages: 2, imageGradingMode: 'human',
          config: 'extra-data-here',
          aiGradingPrompt: 'Required elements: (1) one equation per node. REFERENCE: the answer is 1.2 V.',
          graderNote: 'Look for KCL at both nodes.',
          minWords: 100,
        },
        {
          id: 's2', name: 'Field sketch', description: 'Sketch it.',
          points: 80, submissionType: 'Handwritten', handwrittenGradingMode: 'human',
          answerLines: 20, isDrawing: true,
          graderNote: 'Arrows normal to the walls.',
        },
      ],
    }],
    createdAt: 1700000000000,
    updatedAt: 1700000000123,
  };

  check('authoring backup: the round trip is deep-equal, every field carried', () => {
    const restored = readAuthoringBackup(JSON.parse(buildAuthoringBackup(everything)));
    assertEqual(restored, everything, 'the authoring backup lost or altered something');
  });

  // The guarantee has to be checked against the TYPE, not against the fixture,
  // or it decays the moment someone adds a field the fixture forgot.
  check('authoring backup: the fixture covers every field `Assignment` declares', () => {
    const src = readFileSync(resolve(REPO, 'types.ts'), 'utf8');
    const fieldsOf = (iface) => {
      const body = src.match(new RegExp(`export interface ${iface} \\{([\\s\\S]*?)\\n\\}`))[1];
      return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map(m => m[1]);
    };
    const missing = fieldsOf('Assignment').filter(f => !(f in everything));
    assertEqual(missing, [],
      'the fixture does not exercise every Assignment field — the round trip cannot prove completeness');
    const subFields = fieldsOf('Subsection');
    const covered = everything.problems.flatMap(p => p.subsections).flatMap(Object.keys);
    assertEqual(subFields.filter(f => !covered.includes(f)), [],
      'the fixture does not exercise every Subsection field');
  });

  check('authoring backup: a field added to the assignment and not carried is caught', () => {
    // The failure mode the round trip exists to catch, driven deliberately.
    const withNewField = { ...everything, someFieldAddedLater: 'value' };
    const stripped = JSON.parse(buildAuthoringBackup(withNewField));
    delete stripped.assignment.someFieldAddedLater;
    let caught = false;
    try { assertEqual(readAuthoringBackup(stripped), withNewField, 'x'); } catch { caught = true; }
    assert(caught, 'a dropped field passed the deep-equality check');
  });

  check('authoring backup: it is self-describing, and a student spec is not mistaken for one', async () => {
    const backup = JSON.parse(buildAuthoringBackup(everything));
    assert(isAuthoringBackup(backup), 'a backup is not recognised as one');
    const spec = await buildAssignmentSpec(makeAssignment());
    assert(!isAuthoringBackup(spec), 'a student spec was recognised as a backup');
    assert(!isAuthoringBackup({}), 'an empty object was recognised as a backup');
    let threw = null;
    try { readAuthoringBackup(spec); } catch (err) { threw = err; }
    assert(threw, 'reading a non-backup as a backup did not throw');
  });

  check('authoring backup: a newer format version is refused, not silently half-read', () => {
    const future = { ...JSON.parse(buildAuthoringBackup(everything)), format_version: 99 };
    let threw = null;
    try { readAuthoringBackup(future); } catch (err) { threw = err; }
    assert(threw && /newer version/.test(threw.message), `expected a version refusal, got ${threw && threw.message}`);
  });

  // Acceptance 3: the delayed damage. The .md carries already-scaled points, so
  // a targetPoints-losing route looks right on reimport and halves everything on
  // the NEXT export. The backup must not have that shape.
  check('authoring backup: targetPoints survives, so the next export does not halve the points', () => {
    const restored = readAuthoringBackup(JSON.parse(buildAuthoringBackup(everything)));
    assertEqual(restored.targetPoints, 200, 'targetPoints was lost — the next export would normalise to 100');
    assertEqual(restored.coursePublicKey, everything.coursePublicKey, 'the course key was lost — gb2 would revert to gb1');
    const total = restored.problems.flatMap(p => p.subsections).reduce((n, s) => n + s.points, 0);
    assertEqual(total, 200, 'the points did not come back at the target total');
  });

  // What Import JSON says when it is handed the lossy file. Run against a REAL
  // student spec, so the message is checked against what the whitelist actually
  // drops rather than against a guess about it.
  const gapCheck = fixture ? check
    : (name) => skip(name, 'needs the gb2 fixture key to build a spec');
  gapCheck('authoring backup: a student spec import names what it is about to lose', async () => {
    const spec = await buildAssignmentSpec(everything);
    const joined = describeImportGaps(spec).join(' | ');
    assert(joined.length > 0, 'importing a student spec reported no loss at all');
    for (const expected of ['grading prompts', 'grader notes', 'answer-space', 'point target']) {
      assert(joined.includes(expected), `the warning does not mention ${expected}: ${joined}`);
    }
    // coursePublicKey IS in the student whitelist, so it is NOT lost — and the
    // message must not claim it is. A warning that overstates gets ignored.
    assert(!joined.includes('course public key'),
      `the warning claims the course key is lost, but the spec carries it: ${joined}`);
  });

  check('authoring backup: a complete file is not warned about, and absence is not invented', () => {
    assertEqual(describeImportGaps(everything), [], 'a complete assignment was warned about');
    // An assignment that genuinely never had prompts is not told it lost them...
    const plain = { ...makeAssignment(), targetPoints: 100, coursePublicKey: 'x' };
    const gaps = describeImportGaps(plain).join(' | ');
    assert(!gaps.includes('point target'), 'a present targetPoints was reported as missing');
    assert(!gaps.includes('course public key'), 'a present coursePublicKey was reported as missing');
  });
}

// =====================================================
// 11. The ZIP is split, and the notice inside it is generated
// =====================================================
{
  let entries = null;
  try { entries = await exportPdfSvc.buildExportEntries(makeAssignment({ targetPoints: 100 })); }
  catch { /* reported below */ }

  if (!entries) {
    skip('export ZIP: student/ and instructor/ split', 'buildExportEntries threw');
  } else {
    const names = Object.keys(entries);
    const NOTICE = '00_INSTRUCTOR_ONLY_DO_NOT_DISTRIBUTE.txt';

    check('export ZIP: every entry is in student/ or instructor/, except the notice', () => {
      const stray = names.filter(n => n !== NOTICE && !n.startsWith('student/') && !n.startsWith('instructor/'));
      assertEqual(stray, [], 'an entry sits outside both folders');
      assert(names.includes(NOTICE), `the notice is missing from: ${names.join(', ')}`);
    });

    check('export ZIP: student/ holds only what a student may receive', () => {
      const student = names.filter(n => n.startsWith('student/')).map(n => n.slice('student/'.length));
      // An electronic assignment: the PDF and the spec, nothing else.
      assertEqual(student.sort(), ['assignment.pdf', 'assignment_spec.json'],
        'the student folder holds something it should not');
    });

    check('export ZIP: the backup and the .md are both in instructor/', () => {
      assert(names.some(n => n.startsWith('instructor/') && n.endsWith('_authoring_backup.json')),
        `no authoring backup in: ${names.join(', ')}`);
      assert(names.some(n => n.startsWith('instructor/') && n.endsWith('.md')),
        `no .md in: ${names.join(', ')}`);
      // Guard 3: the backup must never be the file the Submission app loads.
      assert(!names.some(n => n.startsWith('student/') && n.includes('authoring_backup')),
        'the authoring backup is in the student folder');
      const spec = names.find(n => n.endsWith('assignment_spec.json'));
      assert(!spec.includes('authoring_backup'), 'the spec and the backup are the same file');
    });

    check('export ZIP: the backup in the ZIP really is the whole assignment', () => {
      const a = makeAssignment({ targetPoints: 100 });
      const name = names.find(n => n.endsWith('_authoring_backup.json'));
      assertEqual(readAuthoringBackup(JSON.parse(entries[name])), a,
        'the ZIP\'s backup is not deep-equal to the assignment exported');
    });

    // Guard 5. A notice that drifts out of step with the folder is worse than
    // none, because it will be believed.
    check('export ZIP: the notice names only files that are actually there', () => {
      const notice = entries[NOTICE];
      assert(/MUST NOT|DO NOT GIVE/.test(notice), 'the notice does not say the ZIP must not be given to students');
      const base = n => n.slice(n.lastIndexOf('/') + 1);
      const present = new Set(names.map(base));
      // Every filename-looking token the notice mentions must exist in the ZIP.
      const mentioned = [...notice.matchAll(/^\s{2}(\S+)\s/gm)].map(m => m[1]);
      assert(mentioned.length >= 5, `the notice names too few files: ${JSON.stringify(mentioned)}`);
      const phantom = mentioned.filter(m => !present.has(m));
      assertEqual(phantom, [], 'the notice names a file that is not in the ZIP');
    });

    check('export ZIP: the notice names every answer-bearing file, and no student file', () => {
      const notice = entries[NOTICE];
      // Every instructor file is either named as answer-bearing or is on this
      // list of ones known to carry none. Adding a file to instructor/ therefore
      // FORCES a decision: name it in the notice, or say here why it is safe.
      // Checking only the four known suffixes would be tautological — it would
      // pass for a fifth answer-bearing file nobody remembered to declare, which
      // is exactly how a generated notice drifts back into being a lie.
      const CARRIES_NO_ANSWERS = ['assignment.html', 'assignment.tex', 'template.pdf'];
      const instructorFiles = names
        .filter(n => n.startsWith('instructor/'))
        .map(n => n.slice(n.lastIndexOf('/') + 1));
      const undeclared = instructorFiles.filter(f => !notice.includes(f) && !CARRIES_NO_ANSWERS.includes(f));
      assertEqual(undeclared, [],
        'an instructor file is neither named in the notice nor declared answer-free');
      const answerFiles = instructorFiles.filter(f => notice.includes(f));
      assert(answerFiles.length === 4,
        `expected 4 answer-bearing files named in the notice, found ${JSON.stringify(answerFiles)}`);
      // The "give students" list must be exactly the student folder.
      const give = notice.slice(notice.indexOf('Give students'));
      for (const f of names.filter(n => n.startsWith('student/')).map(n => n.slice('student/'.length))) {
        assert(give.includes(f), `the notice does not tell the instructor to hand out ${f}`);
      }
      for (const f of answerFiles) {
        assert(!give.includes(f), `the notice tells the instructor to hand out ${f}, which contains answers`);
      }
    });
  }

  // Handwritten: the layout map travels with the PDF, in student/.
  let hw = null;
  try {
    hw = await exportPdfSvc.buildExportEntries({
      ...makeAssignment(), inputMode: 'handwritten',
      problems: [{ id: 'p1', name: 'P', description: '', subsections: [
        { id: 's1', name: 'A', description: 'Do it.', points: 100, submissionType: 'Handwritten', handwrittenGradingMode: 'ai' },
      ] }],
    });
  } catch { /* reported below */ }

  if (!hw) {
    skip('export ZIP: the layout map travels with the PDF', 'buildExportEntries threw');
  } else {
    check('export ZIP: the layout map travels with the PDF, both in student/', () => {
      const student = Object.keys(hw).filter(n => n.startsWith('student/'));
      assert(student.some(n => n.endsWith('assignment.pdf')), 'no PDF in student/');
      assert(student.some(n => /\/layout_.*\.csv$/.test(n)), 'the layout map is not beside the PDF');
      assert(!Object.keys(hw).some(n => n.startsWith('instructor/') && n.endsWith('.csv')),
        'the layout map is in the instructor folder, away from the PDF it must travel with');
    });
  }
}

// =====================================================
// THE FILE'S OWN TOTAL IS THE TARGET, AND NOTHING RESCALES SILENTLY
// =====================================================
// Points are outside the layout_id hash. Every hash check, page count and
// geometry test in this suite and the next passes on a halved assignment, so
// nothing downstream can see this — the checks have to sit on the import and on
// the transformation itself. On 2026-09-01 a 200-point ENG17 homework exported
// at 100 three times, twice for operators who already knew about the trap.
{
  const { normalizePointsConfirmed, rescaleNotice, rescaleConfirmationMessage,
          isRescaleDeclined, setRescaleConfirm } = exportSvc;

  const totalOf = a => a.problems.flatMap(p => p.subsections).reduce((n, s) => n + s.points, 0);
  const rubricTotal = a => Object.values(generateGradingRubric(a).rubrics)
    .reduce((n, r) => n + r.max_points, 0);

  // Answer the question, and record that it was asked.
  const asked = [];
  const answering = (reply) => { asked.length = 0; setRescaleConfirm(m => { asked.push(m); return reply; }); };

  const TARGET_FIXTURE = resolve(REPO, 'tests', 'fixtures', 'ENG17_TargetPointsFixture.md');
  const md = readFileSync(TARGET_FIXTURE, 'utf8');

  // 1. Import a 200-point .md and export WITHOUT touching the Target box.
  check('md import adopts the file\u2019s own total as the target', () => {
    const a = parseMdToAssignment(md);
    assertEqual(totalOf(a), 200, 'the fixture no longer totals 200');
    assertEqual(a.targetPoints, 200, 'targetPoints was not taken from the file');
  });

  check('a 200-point .md exports at 200 with nothing typed into the Target box', () => {
    answering(false);   // declining must never come up: there is nothing to rescale
    const a = parseMdToAssignment(md);
    assertEqual(rescaleNotice(a), null, 'an untouched import wants to rescale itself');
    const out = normalizePointsConfirmed(a);
    assertEqual(totalOf(out), 200, 'the export rescaled a 200-point assignment');
    assertEqual(rubricTotal(out), 200, 'the grading rubric does not total 200');
    assertEqual(asked, [], 'the instructor was asked about a rescale that was not happening');
  });

  check('every part keeps the points its author wrote \u2014 not just the total', () => {
    answering(true);
    const a = parseMdToAssignment(md);
    const before = a.problems.flatMap(p => p.subsections).map(s => s.points);
    const after = normalizePointsConfirmed(a).problems.flatMap(p => p.subsections).map(s => s.points);
    assertEqual(after, before, 'a part value moved');
    assertEqual(before, [40, 35, 45, 35, 45], 'the fixture\u2019s per-part values changed');
  });

  // 2. An authoring backup carries targetPoints explicitly. Keep honouring it.
  check('an authoring backup with targetPoints 200 exports at 200', () => {
    answering(false);
    const authored = parseMdToAssignment(md);
    const restored = readAuthoringBackup(JSON.parse(buildAuthoringBackup(authored)));
    assertEqual(restored.targetPoints, 200, 'the backup lost the point target');
    assertEqual(totalOf(normalizePointsConfirmed(restored)), 200, 'a restored backup was rescaled');
    assertEqual(asked, [], 'a backup at its own target was questioned');
  });

  // 3. A NEW, EMPTY assignment is the one case with nothing to infer from.
  check('a new assignment still defaults to 100, and still rescales to it', () => {
    answering(true);
    const draft = makeAssignment({
      problems: [{ id: 'p1', name: 'Problem 1', description: '', subsections: [
        { id: 's1', name: 'a', description: '', points: 10, submissionType: 'Text' },
        { id: 's2', name: 'b', description: '', points: 30, submissionType: 'Text' },
      ] }],
    });
    assertEqual(draft.targetPoints, undefined, 'the fixture pinned a target');
    assertEqual(rescaleNotice(draft), { authoredTotal: 40, targetPoints: 100 }, 'wrong notice');
    assertEqual(totalOf(normalizePointsConfirmed(draft)), 100, 'a 40-point draft did not scale to 100');
    assertEqual(asked.length, 1, 'the rescale happened without asking');
  });

  check('an .md with no points anywhere pins no target', () => {
    const a = parseMdToAssignment('# X: Y\n\n## Problem 1: P\n\n### (a) A [0 pts] [text]\nDo it.\n');
    assertEqual(a.targetPoints, undefined, 'a zero total was adopted as a target');
  });

  // 4. Declining stops the export before anything is written.
  check('a target that disagrees with the total is put to the instructor, with both numbers', () => {
    answering(true);
    const a = { ...parseMdToAssignment(md), targetPoints: 100 };
    normalizePointsConfirmed(a);
    assertEqual(asked.length, 1, 'the export rescaled without asking');
    assert(/\b200\b/.test(asked[0]) && /\b100\b/.test(asked[0]),
      `the question names neither total: "${asked[0]}"`);
    assert(/rescale/i.test(asked[0]), `the question does not say what happens: "${asked[0]}"`);
  });

  // `check` is synchronous, so the one await here is done up front.
  // The key below is not a key: reaching buildAssignmentSpec would throw about
  // that instead, which is what proves the export stopped before building.
  answering(false);
  const declined = { ...parseMdToAssignment(md), targetPoints: 100 };
  let downloadErr = null;
  try {
    await exportSvc.exportService.downloadZIP({ ...declined, coursePublicKey: 'not a key' });
  } catch (err) { downloadErr = err; }

  check('declining the rescale stops the export and writes nothing', () => {
    let threw = null;
    try { normalizePointsConfirmed(declined); } catch (err) { threw = err; }
    assert(threw, 'declining rescaled anyway');
    assert(isRescaleDeclined(threw), `the caller cannot tell a decline from a failure: ${threw}`);
    assertEqual(totalOf(declined), 200, 'the declined assignment was mutated');
    assert(isRescaleDeclined(downloadErr),
      `downloadZIP got past the question before stopping: ${downloadErr && downloadErr.message}`);
  });

  check('the message is the two numbers and the consequence, in the instructor\u2019s words', () => {
    const m = rescaleConfirmationMessage({ authoredTotal: 200, targetPoints: 100 });
    assert(m.includes('totals 200 points'), `no authored total: "${m}"`);
    assert(m.includes('export target is 100'), `no target: "${m}"`);
    // window.confirm's buttons are unlabelled, so the message has to say which
    // is which — on their own lines, which is the bit an edit can quietly lose.
    assert(/\nOK\b/.test(m) && /\nCancel\b/.test(m), `OK and Cancel are not on their own lines: ${JSON.stringify(m)}`);
  });

  // Leave the seam as production found it — later suites export too.
  setRescaleConfirm(() => true);
}

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
// Windows keeps a handle on the imported bundles; a temp file left behind is
// not a test failure.
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(failed > 0 ? 1 : 0);
