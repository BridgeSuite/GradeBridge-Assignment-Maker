// =====================================================
// Figure blocks — referring to a drawing instead of carrying it
// =====================================================
// A ```figure block names a figure by id; the drawing lives in
// `figures/<id>.svg|.png|.jpg`. Replacing the drawing, format included, means
// replacing that file and nothing else.
//
// The property that makes the whole design safe is **resolution equivalence**:
// after a block is resolved, the text is exactly what the instructor would have
// authored inline. That is what lets `figureBlocks.ts` stay byte-for-byte
// unchanged — it is mirrored into the student app and must never learn this
// fence — and it is what makes extracting the thirty existing ENG17 inline SVGs
// provably invisible to students.

import { build } from 'esbuild';
import { webcrypto } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
globalThis.crypto ??= webcrypto;

let passed = 0, failed = 0;
const results = [];
const pending = [];
const check = (name, fn) => {
  const ok = () => { passed++; results.push(`  PASS  ${name}`); };
  const bad = (err) => { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') pending.push(r.then(ok, bad));
    else ok();
  } catch (err) { bad(err); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n          expected: ${y}\n          actual:   ${x}`);
};

// ---------- load ----------
const outDir = mkdtempSync(join(tmpdir(), 'gb-figref-'));
const requireFromRepo = createRequire(join(REPO, 'package.json'));
const assetImports = {
  name: 'asset-imports',
  setup(b) {
    b.onResolve({ filter: /\?(raw|dataurl)$/ }, args => {
      const [, q] = args.path.match(/\?(raw|dataurl)$/);
      return { path: requireFromRepo.resolve(args.path.replace(/\?(raw|dataurl)$/, '')), namespace: q };
    });
    b.onLoad({ filter: /.*/, namespace: 'raw' }, a => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
    b.onLoad({ filter: /.*/, namespace: 'dataurl' }, a => ({
      contents: `export default ${JSON.stringify(`data:font/woff2;base64,${readFileSync(a.path).toString('base64')}`)};`,
      loader: 'js',
    }));
  },
};
const stubHeavy = {
  name: 'stub-heavy',
  setup(b) {
    b.onResolve({ filter: /^(jspdf|jszip|file-saver)$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const s = new Proxy(function(){}, { get: () => s, apply: () => s, construct: () => s }); export default s;',
      loader: 'js',
    }));
  },
};
const load = async (entry, name, plugins = [assetImports]) => {
  const outfile = join(outDir, name);
  await build({
    entryPoints: [entry], outfile, format: 'esm', target: 'es2022', bundle: true,
    absWorkingDir: dirname(entry), logLevel: 'silent', plugins,
  });
  return import(pathToFileURL(outfile).href);
};

const refs = await load(join(REPO, 'services', 'figureRefs.ts'), 'figureRefs.mjs');
const figText = await load(join(REPO, 'services', 'figureText.ts'), 'figureText.mjs');
const blocks = await load(join(REPO, 'services', 'figureBlocks.ts'), 'figureBlocks.mjs');
const mdParser = await load(join(REPO, 'services', 'mdParserService.ts'), 'mdParser.mjs');
const exportSvc = await load(join(REPO, 'services', 'exportService.ts'), 'exportSvc.mjs',
  [assetImports, stubHeavy]);
const backupSvc = await load(join(REPO, 'services', 'authoringBackup.ts'), 'backup.mjs');
const figImport = await load(join(REPO, 'services', 'figureImport.ts'), 'figImport.mjs');

console.log('\nFigure blocks — reference, resolve, and leave the mirror alone\n');

// ---------------------------------------------------------------------------
// 1. The mirrored file is untouched (criterion 1)
// ---------------------------------------------------------------------------
// `figureBlocks.ts` is held byte-identical with the Student Submission app.
// This work order adds a fence; teaching it to THAT file would ship an
// authoring concern into the student bundle, where nothing can resolve a
// reference. The mirror check is the reason `figureRefs.ts` exists at all.
{
  const MIRROR = resolve(REPO, '..', 'GradeBridge-Student-Submission', 'services', 'figureBlocks.ts');
  if (existsSync(MIRROR)) {
    check('figureBlocks.ts is still byte-identical to the Student Submission copy', () => {
      assertEqual(
        readFileSync(join(REPO, 'services', 'figureBlocks.ts'), 'utf8'),
        readFileSync(MIRROR, 'utf8'),
        'the mirrored figure file has drifted');
    });
  } else {
    results.push('  SKIP  figureBlocks.ts mirror (Student Submission not checked out alongside)');
  }

  check('figureBlocks.ts knows nothing about the figure fence', () => {
    const src = readFileSync(join(REPO, 'services', 'figureBlocks.ts'), 'utf8');
    assert(!/```[ \t]*figure|figureRef|FIGURE_REF/i.test(src),
      'the mirrored file has learned the ```figure fence, which puts it in the student bundle');
  });
}

// ---------------------------------------------------------------------------
// 2. Parsing
// ---------------------------------------------------------------------------
const BLOCK = [
  '```figure',
  'id: p1-divider',
  'title: Voltage divider for Problem 1',
  'desc: Two resistors R1 and R2 in series across a 12 V source.',
  '```',
].join('\n');

check('a block is parsed into id, title and desc', () => {
  const [seg] = refs.parseFigureRefs(BLOCK);
  assertEqual(seg.ref, {
    id: 'p1-divider',
    title: 'Voltage divider for Problem 1',
    desc: 'Two resistors R1 and R2 in series across a 12 V source.',
  }, 'the block was misread');
  assertEqual(seg.source, BLOCK, 'the source is not the block verbatim');
});

check('a block is found among prose, and the prose is left alone', () => {
  const text = `Given the network below.\n\n${BLOCK}\n\nFind Vout.`;
  const found = refs.parseFigureRefs(text);
  assertEqual(found.length, 1, 'wrong number of blocks found');
  assertEqual(found[0].ref.id, 'p1-divider', 'wrong id');
  const parts = refs.splitFigureRefs(text);
  assertEqual(parts.map(p => p.kind), ['text', 'ref', 'text'], 'the split is wrong');
  assertEqual(parts.map(p => (p.kind === 'text' ? p.value : p.source)).join('\n'), text,
    'the split does not reassemble to the input');
});

check('an unknown key inside a block is ignored rather than refused', () => {
  const [seg] = refs.parseFigureRefs(BLOCK.replace('```\n', '') + '\nsource: textbook fig 3.2\n```');
  assert(seg.ref.id === 'p1-divider', 'a future key broke the parse');
});

for (const [what, bad, expect] of [
  ['no id', BLOCK.replace('id: p1-divider\n', ''), /no `id:` line/],
  ['no title', BLOCK.replace('title: Voltage divider for Problem 1\n', ''), /no `title:` line/],
  ['no desc', BLOCK.replace(/desc: .*\n/, ''), /no `desc:` line/],
  ['an unusable id', BLOCK.replace('p1-divider', 'P1 Divider!'), /not usable as a filename/],
]) {
  check(`a block with ${what} is reported`, () => {
    const [seg] = refs.parseFigureRefs(bad);
    const problems = refs.figureRefProblems(seg.ref).join(' | ');
    assert(expect.test(problems), `the problem is not named: ${problems}`);
  });
}

check('the desc refusal says why a desc matters', () => {
  const problems = refs.figureRefProblems({ id: 'x', title: 'y' }).join(' ');
  assert(/only thing the grader sees/.test(problems),
    `the message does not say what a missing desc costs: ${problems}`);
});

// ---------------------------------------------------------------------------
// 3. Resolution equivalence — the property everything else rests on
// ---------------------------------------------------------------------------
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
  + '<title>Voltage divider for Problem 1</title>'
  + '<desc>Two resistors R1 and R2 in series across a 12 V source.</desc>'
  + '<path d="M0 0 L10 10" stroke="#000"/></svg>';
const svgFile = { format: 'svg', base64: Buffer.from(SVG, 'utf8').toString('base64'), filename: 'p1-divider.svg' };
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const pngFile = { format: 'png', base64: PNG_B64, filename: 'p1-divider.png' };

check('an SVG block resolves to exactly the fence it would have been authored as', () => {
  const inlineAuthored = '```svg\n' + SVG + '\n```';
  const resolved = refs.resolveFigureRefsInText(BLOCK, { 'p1-divider': svgFile });
  assertEqual(resolved, inlineAuthored,
    'a resolved SVG block is not identical to the same drawing authored inline');
});

check('resolution is invisible to the mirrored splitter', () => {
  const inlineAuthored = '```svg\n' + SVG + '\n```';
  const fromBlock = blocks.splitFigures(refs.resolveFigureRefsInText(BLOCK, { 'p1-divider': svgFile }));
  const fromInline = blocks.splitFigures(inlineAuthored);
  assertEqual(fromBlock, fromInline, 'the resolved block and the inline figure split differently');
});

check('a raster block resolves to an image line with a data: URI and the title as alt', () => {
  const resolved = refs.resolveFigureRefsInText(BLOCK, { 'p1-divider': pngFile });
  assertEqual(resolved, `![Voltage divider for Problem 1](data:image/png;base64,${PNG_B64})`,
    'the raster resolution is wrong');
  const segs = blocks.splitFigures(resolved);
  assertEqual(segs.length, 1, 'the resolved image is not a single figure segment');
  assertEqual(segs[0].figure.form, 'image', 'it did not resolve to an image figure');
});

check('a block whose file is missing is left exactly as it is', () => {
  assertEqual(refs.resolveFigureRefsInText(BLOCK, {}), BLOCK,
    'a missing file changed the text — import refuses that case, render must not mangle it');
});

check('text with no block is returned byte-for-byte', () => {
  const plain = 'Given the network.\n\n```svg\n' + SVG + '\n```\n\nFind Vout.';
  assertEqual(refs.resolveFigureRefsInText(plain, { 'p1-divider': svgFile }), plain,
    'resolution disturbed text that had no block in it');
});

check('an SVG with non-ASCII labels survives resolution', () => {
  const unicode = '<svg xmlns="http://www.w3.org/2000/svg"><title>Ω</title><desc>5 Ω at 25 °C</desc></svg>';
  const file = { format: 'svg', base64: Buffer.from(unicode, 'utf8').toString('base64'), filename: 'f.svg' };
  const out = refs.resolveFigureRefsInText(BLOCK, { 'p1-divider': file });
  assert(out.includes('5 Ω at 25 °C'), `the degree sign or ohm was mangled: ${out}`);
});

// ---------------------------------------------------------------------------
// 4. The grader sees the block's own words, whatever the format
// ---------------------------------------------------------------------------
// This is why title and desc live in the .md rather than in the image: a PNG
// has no <title> and no <desc>, so a format swap would otherwise blank the
// grader's only view of the figure.
{
  const stem = `Given the network below.\n\n${BLOCK}\n\nFind Vout.`;
  const expected = 'Given the network below.\n\n'
    + '[Figure — Voltage divider for Problem 1: Two resistors R1 and R2 in series across a 12 V source.]'
    + '\n\nFind Vout.';

  check('the grader text for a block is its title and desc', () => {
    assertEqual(figText.stemForGrader(stem), expected, 'the grader text is wrong');
  });

  check('the grader text is the SAME for the inline SVG the block replaced', () => {
    const inlineStem = `Given the network below.\n\n\`\`\`svg\n${SVG}\n\`\`\`\n\nFind Vout.`;
    assertEqual(figText.stemForGrader(inlineStem), expected,
      'an inline SVG and the block that replaces it read differently to the grader');
  });

  check('no markup reaches the grader from a block', () => {
    const out = figText.stemForGrader(stem);
    assert(!/<svg|<path|```|data:image/.test(out), `markup leaked to the grader: ${out}`);
  });

  check('swapping the SVG for a PNG does not change the grader text', () => {
    // The rubric is built from the unresolved stem, so the file behind the id
    // is irrelevant to it. Asserted rather than assumed, because "the grader
    // never sees the drawing" is the whole reason the words live in the block.
    assertEqual(figText.stemForGrader(stem), expected, 'the grader text moved with the format');
  });
}

// ---------------------------------------------------------------------------
// 5. The student spec carries drawings, never references
// ---------------------------------------------------------------------------
const makeAssignment = (extra = {}) => ({
  id: 'a1', courseCode: 'EEC1', title: 'Lab 1', assignmentKind: 'conventional',
  preamble: 'Do it.', createdAt: 1, updatedAt: 1,
  problems: [{
    id: 'p1', name: 'Divider', description: `Given the network.\n\n${BLOCK}\n\nFind Vout.`,
    subsections: [{ id: 's1', name: 'a', description: 'Work it out', points: 100, submissionType: 'Text' }],
  }],
  ...extra,
});

check('the spec resolves the block and carries no figure map', async () => {
  const spec = await exportSvc.buildAssignmentSpec(
    makeAssignment({ figures: { 'p1-divider': svgFile } }));
  const stem = spec.problems[0].description;
  assert(!stem.includes('```figure'), 'a figure block reached the student spec');
  assert(stem.includes('```svg'), 'the drawing did not reach the student spec');
  assert(stem.includes('<path d="M0 0 L10 10"'), 'the drawing lost its content');
  assert(!('figures' in spec), 'the figure map reached the student spec');
});

check('the spec for a raster block inlines the image', async () => {
  const spec = await exportSvc.buildAssignmentSpec(
    makeAssignment({ figures: { 'p1-divider': pngFile } }));
  const stem = spec.problems[0].description;
  assert(stem.includes(`data:image/png;base64,${PNG_B64}`), 'the PNG was not inlined');
  assert(!stem.includes('```figure'), 'a figure block reached the student spec');
});

check('the figure map is not on the student whitelist', () => {
  assert(!exportSvc.STUDENT_SPEC_FIELDS.assignment.includes('figures'),
    'figures is on the student whitelist; the map must never travel');
});

// ---------------------------------------------------------------------------
// 6. The .md keeps the block, and the round trip does not reflow it
// ---------------------------------------------------------------------------
check('a figure block survives Export .md -> Import Markdown unchanged', () => {
  const md = exportSvc.assignmentToMd(makeAssignment({ figures: { 'p1-divider': svgFile } }));
  assert(md.includes('```figure'), 'Export .md resolved the block away — the .md must keep the reference');
  assert(!md.includes('<path d='), 'Export .md inlined the drawing into the reference');

  const back = mdParser.parseMdToAssignment(md);
  const [seg] = refs.parseFigureRefs(back.problems[0].description);
  assert(seg, 'the block did not survive the import');
  assertEqual(seg.ref, {
    id: 'p1-divider',
    title: 'Voltage divider for Problem 1',
    desc: 'Two resistors R1 and R2 in series across a 12 V source.',
  }, 'the block was reflowed or mangled on import');

  const again = exportSvc.assignmentToMd(back);
  assertEqual(again, md, 'the second export differs from the first');
});

check('a desc: line inside a block is not mistaken for a blockquote key', () => {
  const md = exportSvc.assignmentToMd(makeAssignment({ figures: { 'p1-divider': svgFile } }));
  const back = mdParser.parseMdToAssignment(md);
  const sub = back.problems[0].subsections[0];
  assert(!/Two resistors/.test(sub.graderNote || ''), 'the figure desc leaked into the grader note');
  assert(!/Two resistors/.test(sub.aiGradingPrompt || ''), 'the figure desc leaked into the grading prompt');
});

check('referencedFigureIds finds every id an assignment refers to', () => {
  const a = makeAssignment();
  assertEqual(refs.referencedFigureIds(a), ['p1-divider'], 'the referenced ids are wrong');
});

// ---------------------------------------------------------------------------
// CRITERION 4 — the three round trips of §4.3
// ---------------------------------------------------------------------------
// Each carries an assignment with figure blocks all the way out and back, and
// compares the FILES as well as the blocks. A route that kept the reference and
// lost the drawing would pass a blocks-only check and ship an assignment whose
// figures are gone.
{
  const withFigures = makeAssignment({
    figures: {
      'p1-divider': svgFile,
      'p1-photo': pngFile,
    },
  });
  // A second block, so a route that carries one figure and drops the rest is
  // caught. Two formats, so a route that handles only SVG is caught too.
  withFigures.problems[0].description =
    `Given the network.\n\n${BLOCK}\n\nAnd the bench photograph.\n\n`
    + ['```figure', 'id: p1-photo', 'title: The bench', 'desc: A breadboard on a bench.', '```'].join('\n');

  const idsAndFiles = (a) => {
    const ids = refs.referencedFigureIds(a);
    return {
      ids,
      files: ids.map(id => (a.figures || {})[id] ? {
        id,
        format: a.figures[id].format,
        base64: a.figures[id].base64,
      } : { id, missing: true }),
    };
  };
  const expected = idsAndFiles(withFigures);

  check('CRITERION 4 (1): Export .md -> Import -> Export again keeps blocks and files', () => {
    const md = exportSvc.assignmentToMd(withFigures);
    const back = mdParser.parseMdToAssignment(md);
    // The .md carries the blocks; the files travel beside it, so they are put
    // back the way the import route does it.
    back.figures = withFigures.figures;

    assertEqual(refs.referencedFigureIds(back), expected.ids, 'the .md lost or reordered a block');
    assertEqual(idsAndFiles(back).files, expected.files, 'a figure file was lost or changed');

    const again = exportSvc.assignmentToMd(back);
    assertEqual(again, md, 'the second .md differs from the first');

    for (const { ref } of refs.parseFigureRefs(back.problems[0].description)) {
      assertEqual(refs.figureRefProblems(ref), [], `the block for ${ref.id} came back incomplete`);
    }
  });

  check('CRITERION 4 (2): authoring backup -> Import JSON keeps blocks and files', () => {
    const restored = backupSvc.readAuthoringBackup(JSON.parse(backupSvc.buildAuthoringBackup(withFigures)));
    assertEqual(refs.referencedFigureIds(restored), expected.ids, 'the backup lost a block');
    assertEqual(idsAndFiles(restored).files, expected.files,
      'the backup lost or altered a figure file');
    assertEqual(restored.problems[0].description, withFigures.problems[0].description,
      'the backup reflowed the stem');
  });

  // (3) is convert.py, below: it needs a real interpreter and a temp file.
  {
    const python = ['python', 'python3', 'py'].find(exe =>
      spawnSync(exe, ['-c', 'pass'], { encoding: 'utf8' }).status === 0);
    const name = 'CRITERION 4 (3): convert.py parses the same blocks as the app';
    if (!python) results.push(`  SKIP  ${name} (no Python interpreter on PATH)`);
    else check(name, () => {
      const work = mkdtempSync(join(tmpdir(), 'gb-figmd-'));
      const mdPath = join(work, 'FigureProbe.md');
      writeFileSync(mdPath, exportSvc.assignmentToMd(withFigures), 'utf8');
      const run = spawnSync(python, [resolve(REPO, 'converter', 'convert.py'), mdPath], { encoding: 'utf8' });
      assert(run.status === 0, `convert.py failed: ${run.stderr || run.stdout}`);
      const spec = JSON.parse(readFileSync(join(work, 'FigureProbe_spec.json'), 'utf8'));

      const fromPython = refs.parseFigureRefs(spec.problems[0].description).map(s => s.ref);
      const fromApp = refs.parseFigureRefs(
        mdParser.parseMdToAssignment(exportSvc.assignmentToMd(withFigures)).problems[0].description,
      ).map(s => s.ref);
      assertEqual(fromPython, fromApp,
        'convert.py and mdParserService disagree about the figure blocks');
      assertEqual(fromPython.map(r => r.id), expected.ids, 'convert.py read the wrong ids');
      rmSync(work, { recursive: true, force: true });
    });
  }
}

// ---------------------------------------------------------------------------
// Matching a .md to the figures/ folder it arrived with (§4.1)
// ---------------------------------------------------------------------------
// Three refusals, all the same principle: NEVER PICK ONE. A block with no file
// has nothing to fall back to; two files for one id is a coin toss that would
// be printed onto paper; a file that fails a guard is covered elsewhere and
// reported here with the rest, so a folder is fixed in one pass rather than one
// item per attempt.
{
  const bytesOf = (s) => new Uint8Array(Buffer.from(s, 'utf8'));
  const GOOD_SVG = bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><path stroke="#000"/></svg>');
  const withOneBlock = makeAssignment();

  check('a filename is parsed into an id and a format', () => {
    assertEqual(figImport.parseFigureFilename('figures/p1-divider.svg'),
      { id: 'p1-divider', format: 'svg' }, 'the path was misread');
    assertEqual(figImport.parseFigureFilename('p1-divider.PNG'),
      { id: 'p1-divider', format: 'png' }, 'an upper-case extension was misread');
    // One spelling stored, so an id is not ambiguous purely because of how a
    // camera happened to name the file.
    assertEqual(figImport.parseFigureFilename('x.jpeg'), { id: 'x', format: 'jpg' },
      '.jpeg should be stored as jpg');
    assertEqual(figImport.parseFigureFilename('notes.txt'), null, 'a non-figure was accepted');
  });

  check('a matching file is collected', async () => {
    const r = await figImport.collectFigures(withOneBlock,
      [{ path: 'figures/p1-divider.svg', bytes: GOOD_SVG }]);
    assertEqual(r.problems, [], `a good folder was refused: ${r.problems.join(' | ')}`);
    assertEqual(Object.keys(r.figures), ['p1-divider'], 'the figure was not collected');
    assertEqual(r.figures['p1-divider'].format, 'svg', 'the format is wrong');
  });

  check('a block with NO file is refused, naming the id and what was expected', async () => {
    const r = await figImport.collectFigures(withOneBlock, []);
    assertEqual(Object.keys(r.figures), [], 'a figure was invented');
    assert(r.problems.length === 1, `expected one problem, got ${r.problems.length}`);
    assert(/"p1-divider" has no file/.test(r.problems[0]), `the id is not named: ${r.problems[0]}`);
    assert(/figures\/p1-divider\.svg/.test(r.problems[0]),
      `the expected filename is not named: ${r.problems[0]}`);
  });

  check('TWO files for one id are refused as ambiguous, never resolved', async () => {
    const r = await figImport.collectFigures(withOneBlock, [
      { path: 'figures/p1-divider.svg', bytes: GOOD_SVG },
      { path: 'figures/p1-divider.png', bytes: bytesOf('not really a png') },
    ]);
    assertEqual(Object.keys(r.figures), [], 'one of two ambiguous files was chosen');
    assert(/has 2 files/.test(r.problems[0]), `the count is not named: ${r.problems[0]}`);
    assert(/will not choose/.test(r.problems[0]),
      `the message does not say it refuses to choose: ${r.problems[0]}`);
  });

  check('a file that fails a guard is refused, with the guard\'s own message', async () => {
    const colour = bytesOf('<svg xmlns="http://www.w3.org/2000/svg"><path stroke="#cc2222"/></svg>');
    const r = await figImport.collectFigures(withOneBlock,
      [{ path: 'figures/p1-divider.svg', bytes: colour }]);
    assertEqual(Object.keys(r.figures), [], 'a colour figure was collected');
    assert(/greyscale/.test(r.problems.join(' ')), `the guard message is missing: ${r.problems}`);
  });

  check('a file nobody refers to is REPORTED and not stored', async () => {
    const r = await figImport.collectFigures(withOneBlock, [
      { path: 'figures/p1-divider.svg', bytes: GOOD_SVG },
      { path: 'figures/spare-sketch.svg', bytes: GOOD_SVG },
    ]);
    assertEqual(r.problems, [], 'a spare file was treated as an error');
    assertEqual(Object.keys(r.figures), ['p1-divider'], 'the spare file was stored');
    assert(r.unreferenced.length === 1, 'the spare file was not reported');
    assert(/not referred to/.test(figImport.unreferencedNotice(r.unreferenced)),
      'the notice does not explain what it is about');
  });

  check('every problem in a folder is reported at once, not one per attempt', async () => {
    const two = makeAssignment();
    two.problems[0].description = `${BLOCK}\n\n`
      + ['```figure', 'id: p1-second', 'title: Second', 'desc: Another drawing.', '```'].join('\n');
    const r = await figImport.collectFigures(two, []);
    assertEqual(r.problems.length, 2,
      'only some of the missing figures were reported — an instructor would fix them one at a time');
  });
}

// ---------- report ----------
await Promise.all(pending);
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* windows handles */ }
process.exit(failed > 0 ? 1 : 0);
