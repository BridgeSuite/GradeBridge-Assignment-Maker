// =====================================================
// Figures written the normal markdown way, and the folder they live in
// =====================================================
// WORKORDER_AM_FIGURES_AND_FOLDER_IMPORT_2026-09-27.
//
// An author writes `![Transmission line circuit](figs/Fig-4.png)` and keeps the
// drawing in a `figs` folder beside the `.md`. Every route in (a chosen folder,
// a dropped folder, several files, a zip) must bring the `.md` and its images
// together, resolve each path once at import into a `data:` URI, and REFUSE
// rather than draw `[figure: ...]` when a drawing is missing or ambiguous.
//
// The folder here is built to the shape of EEC130A Homework 1's: the assignment
// beside a README and notes to this lane (one of which embeds a test
// assignment below a quoted first line), a `figs` subfolder with spare
// drawings, and a zip, a PDF and a LaTeX source that are nobody's figure. Its
// three figures are colour and under 300 dpi, as HW1's are, and must import.

import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import { suiteExit } from './suiteExit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

let passed = 0, failed = 0;
const results = [];
const check = async (name, fn) => {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n          expected: ${y}\n          actual:   ${x}`);
};

// ---------- load ----------
const outDir = mkdtempSync(join(tmpdir(), 'gb-figpath-'));
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
    b.onResolve({ filter: /^(jspdf|file-saver)$/ }, args => ({ path: args.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const s = new Proxy(function(){}, { get: () => s, apply: () => s, construct: () => s }); export default s;',
      loader: 'js',
    }));
  },
};
const load = async (rel, name, plugins = [assetImports]) => {
  const outfile = join(outDir, name);
  await build({
    entryPoints: [join(REPO, rel)], outfile, format: 'esm', target: 'es2022', bundle: true,
    platform: 'node', absWorkingDir: REPO, logLevel: 'silent', plugins,
  });
  return import(pathToFileURL(outfile).href);
};

const mdImport = await load('services/mdImport.ts', 'mdImport.mjs');
const figImport = await load('services/figureImport.ts', 'figImport.mjs');
const parser = await load('services/mdParserService.ts', 'parser.mjs');
const render = await load('services/mathRender.ts', 'render.mjs');
const exportSvc = await load('services/exportService.ts', 'export.mjs', [assetImports, stubHeavy]);
const JSZip = (await import(pathToFileURL(requireFromRepo.resolve('jszip')).href)).default;

console.log('\nFigures by path, and the folder they live in\n');

// ---------- fixtures ----------
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c;
});
const crc32 = (buf) => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** A small COLOUR PNG: well under 300 dpi at printed size, as HW1's are. */
const colourPng = (w = 120, h = 40) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0, o = 0; y < h; y++) { raw[o++] = 0; for (let x = 0; x < w; x++) { raw[o++] = 200; raw[o++] = 30; raw[o++] = 30; } }
  return new Uint8Array(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
};
/** A three-channel (colour) JPEG header at 500 x 350, as HW1's photograph is. */
const colourJpg = () => new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x5e, 0x01, 0xf4, 0x03,
  0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
]);
const text = (s) => new Uint8Array(Buffer.from(s, 'utf8'));

const HW = [
  '# DEMO130: Homework 1, Transmission Lines',
  '',
  '**Input:** handwritten',
  '**Sheet:** generic',
  '',
  '## Problem 1: Reflections',
  '',
  'Consider the circuit below.',
  '',
  '![Transmission line circuit with source, line Z0, and load ZL](figs/Fig-4.png)',
  '',
  '### (a) Gamma [1 pts] [handwritten:human]',
  'Find Gamma.',
  '',
  '## Problem 2: Alternative model',
  '',
  '![An alternative distributed circuit model](./figs/Fig-3a.png)',
  '',
  '### (a) Current [1 pts] [handwritten:human]',
  'Derive the current equation.',
  '',
  '## Problem 3: Coax',
  '',
  '![RG-59 cable cut open: A jacket, B return conductor](figs/wiki-rg59.jpg)',
  '',
  '### (a) Think [1 pts] [handwritten:human]',
  'Think about it.',
  '',
].join('\n');

const NOTE = [
  '> # WITHDRAWN. NOT A DEFECT.',
  '',
  '# TEST: Points grid',
  '',
  '## Problem 1: Two parts',
  '### (a) Integer [1 pts] [handwritten:human]',
].join('\n');

/** The HW1-shaped folder, as a chosen folder hands it over. */
const folder = ({ images = true, extra = [] } = {}) => {
  const files = [
    ['master/EEC130A_Homework1.md', text(HW)],
    ['master/README.md', text('# HW1-FQ26, the master\n\nNotes.\n')],
    ['master/2026-09-27 note to the lane.md', text(NOTE)],
    ['master/main.tex', text('\\documentclass{article}')],
    ['master/HW1.pdf', text('%PDF-1.4')],
    ['master/Homework1_submission.zip', text('PK not really')],
    ...(images ? [
      ['master/figs/Fig-4.png', colourPng()],
      ['master/figs/Fig-3a.png', colourPng(90, 30)],
      ['master/figs/wiki-rg59.jpg', colourJpg()],
      ['master/figs/Fig-5a.png', colourPng(60, 20)],
    ] : []),
    ...extra,
  ];
  return files.map(([path, bytes]) => ({ path, inFolder: true, read: async () => bytes }));
};

/** The whole route the Dashboard takes, minus storage: gather, parse, resolve both figure forms. */
const importOf = async (chosen) => {
  const g = await mdImport.gatherImport(chosen);
  const assignment = parser.parseMdToAssignment(g.content, []);
  const images = await figImport.resolveImagePaths(assignment, g.candidates, g.mdPath);
  return { g, images };
};
const refusal = async (fn) => {
  try { await fn(); } catch (e) { return e; }
  throw new Error('it was not refused');
};
const stems = (a) => a.problems.map(p => p.description);

// =====================================================
// CHECK 1: the folder imports, with its colour, low-dpi figures
// =====================================================
let fromFolder;
await check('CHECK 1: the HW1-shaped folder imports, and all three figures become data: URIs', async () => {
  fromFolder = await importOf(folder());
  assertEqual(fromFolder.images.problems, [], 'the folder was refused');
  assertEqual(fromFolder.g.mdPath, 'master/EEC130A_Homework1.md', 'the wrong .md was taken');
  assertEqual(fromFolder.images.resolved, 3, 'not every reference was resolved');
  const all = stems(fromFolder.images.assignment).join('\n');
  assert(!/\]\((\.\/)?figs\//.test(all), `a relative path survived: ${all}`);
  assertEqual((all.match(/\]\(data:image\/(png|jpeg);base64,/g) || []).length, 3, 'three data: URIs were not written');
});

await check('CHECK 1: every figure DRAWS, rather than printing [figure: ...]', () => {
  for (const d of stems(fromFolder.images.assignment)) {
    const html = render.toHtml(d);
    assert(html.includes('<img src="data:image/'), `a figure did not draw: ${html.slice(0, 200)}`);
    assert(!html.includes('[figure'), 'a placeholder was drawn');
  }
});

await check('CHECK 1: the README and the notes are set aside and named, not refused', () => {
  assertEqual(fromFolder.g.setAside.sort(),
    ['master/2026-09-27 note to the lane.md', 'master/README.md'], 'the other .md files were not named');
});

await check('CHECK 1: a zip inside a chosen folder is not unpacked, and a PDF is not read', async () => {
  let reads = 0;
  const chosen = folder().map(f => ({ ...f, read: async () => { if (/\.(zip|pdf)$/.test(f.path)) reads++; return f.read(); } }));
  await mdImport.gatherImport(chosen);
  assertEqual(reads, 0, 'the folder\'s zip or PDF was read');
});

await check('CHECK 1: the alt text is what the grader reads, and the notice says so', () => {
  const rubric = exportSvc.generateGradingRubric(fromFolder.images.assignment);
  const stmt = JSON.stringify(rubric);
  assert(stmt.includes('Transmission line circuit with source'), 'the alt text did not reach the rubric');
  assert(!/data:image|base64/.test(stmt), 'the drawing itself reached the rubric');
  assert(/description of what the drawing shows, not as a label/.test(figImport.altTextNotice(3)),
    'the notice does not say what the alt text is for');
});

// =====================================================
// CHECK 2: no images, refused, every reference listed with its path
// =====================================================
await check('CHECK 2: a folder with the .md and no images is refused, listing all three paths', async () => {
  const { images } = await importOf(folder({ images: false }));
  assertEqual(images.problems.length, 3, `not one line per missing figure: ${images.problems.join(' | ')}`);
  for (const p of ['figs/Fig-4.png', './figs/Fig-3a.png', 'figs/wiki-rg59.jpg']) {
    assert(images.problems.some(m => m.includes(p)), `the path ${p} is not named`);
  }
  assert(images.problems.every(m => /^Problem \d+: the image /.test(m)), 'a line does not say where the figure is');
});

// =====================================================
// CHECK 3: a dropped folder is the same route
// =====================================================
// The drop walks directory entries into the same ChosenFile list a chosen
// folder produces; walked here with entries shaped as a browser hands them over.
await check('CHECK 3: a dropped folder, walked, imports identically to the chosen one', async () => {
  const tree = folder();
  const fileEntry = (f) => ({
    isFile: true, isDirectory: false, fullPath: `/${f.path}`, name: f.path.split('/').pop(),
    file: (ok) => ok({ name: f.path.split('/').pop(), webkitRelativePath: '', arrayBuffer: async () => (await f.read()).buffer }),
  });
  const dirEntry = (prefix) => {
    const children = new Map();
    for (const f of tree.filter(f => f.path.startsWith(`${prefix}/`))) {
      const rest = f.path.slice(prefix.length + 1);
      const head = rest.split('/')[0];
      if (!children.has(head)) children.set(head, rest.includes('/') ? dirEntry(`${prefix}/${head}`) : fileEntry(f));
    }
    let given = false;
    return {
      isFile: false, isDirectory: true, fullPath: `/${prefix}`, name: prefix.split('/').pop(),
      createReader: () => ({ readEntries: (ok) => { ok(given ? [] : [...children.values()]); given = true; } }),
    };
  };
  const items = [{ kind: 'file', webkitGetAsEntry: () => dirEntry('master'), getAsFile: () => null }];
  const chosen = await mdImport.chosenFromDrop(items);
  const dropped = await importOf(chosen);
  assertEqual(dropped.images.problems, [], 'the dropped folder was refused');
  assertEqual(stems(dropped.images.assignment), stems(fromFolder.images.assignment), 'a dropped folder differs from a chosen one');
});

// =====================================================
// CHECKS 4 and 5: several files, and a zip, work as today
// =====================================================
await check('CHECK 4: the .md and its images chosen by hand (bare names) resolve by file name', async () => {
  const loose = folder().filter(f => /Homework1\.md$|\/figs\//.test(f.path))
    .map(f => ({ path: f.path.split('/').pop(), inFolder: false, read: f.read }));
  const r = await importOf(loose);
  assertEqual(r.images.problems, [], 'the hand-chosen files were refused');
  assertEqual(stems(r.images.assignment), stems(fromFolder.images.assignment), 'the result differs from the folder');
});

await check('CHECK 5: a zip of the folder imports identically', async () => {
  const zip = new JSZip();
  for (const f of folder()) zip.file(f.path, await f.read());
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  const r = await importOf([{ path: 'master.zip', inFolder: false, read: async () => bytes }]);
  assertEqual(r.images.problems, [], 'the zip was refused');
  assertEqual(stems(r.images.assignment), stems(fromFolder.images.assignment), 'the zip differs from the folder');
});

// =====================================================
// CHECK 6: two assignments is a refusal naming both
// =====================================================
await check('CHECK 6: a folder holding two assignment .md files is refused, naming both', async () => {
  const e = await refusal(() => mdImport.gatherImport(folder({
    extra: [['master/Homework2.md', text(HW.replace('Homework 1', 'Homework 2'))]],
  })));
  assert(e instanceof mdImport.ImportRefusal, `not a refusal: ${e.message}`);
  assert(e.message.includes('master/EEC130A_Homework1.md') && e.message.includes('master/Homework2.md'),
    `both are not named: ${e.message}`);
});

await check('CHECK 6: a folder whose .md files are none of them assignments is refused, naming them', async () => {
  const e = await refusal(() => mdImport.gatherImport(folder().filter(f => !/Homework1/.test(f.path))));
  assert(/None of these .md files is an assignment/.test(e.message) && e.message.includes('master/README.md'),
    `the refusal does not say why: ${e.message}`);
});

// =====================================================
// CHECK 7: never pick one
// =====================================================
await check('CHECK 7: a bare name that fits two files in different folders is refused, naming both', async () => {
  const md = HW.replace('(figs/Fig-4.png)', '(Fig-4.png)');
  const chosen = folder({ extra: [['master/old/Fig-4.png', colourPng()]] })
    .map(f => (/Homework1\.md$/.test(f.path) ? { ...f, read: async () => text(md) } : f));
  const { images } = await importOf(chosen);
  const line = images.problems.find(p => p.includes('Fig-4.png'));
  assert(line, `the ambiguity was resolved by picking one: ${images.problems.join(' | ') || '(no problems)'}`);
  assert(line.includes('master/figs/Fig-4.png') && line.includes('master/old/Fig-4.png'), `both are not named: ${line}`);
  assert(/will not choose/.test(line), `the refusal does not say it will not choose: ${line}`);
});

await check('CHECK 7: a path written in full is not ambiguous, even when the name recurs elsewhere', async () => {
  const { images } = await importOf(folder({ extra: [['master/old/figs/Fig-4.png', colourPng(10, 10)]] }));
  assertEqual(images.problems, [], 'a full path was treated as ambiguous');
  assertEqual(images.usedPaths.includes('master/figs/Fig-4.png'), true, 'the path as written was not the one used');
});

await check('CHECK 7: the matcher, step by step', () => {
  const m = figImport.matchImagePath;
  assertEqual(m('figs/a.png', 'hw/x.md', ['hw/figs/a.png', 'other/figs/a.png']), { kind: 'found', path: 'hw/figs/a.png' },
    'the path relative to the .md did not win');
  assertEqual(m('figs/a.png', 'x.md', ['p/figs/a.png', 'q/figs/a.png']).kind, 'ambiguous', 'a suffix fitting two was picked');
  assertEqual(m('a.png', 'x.md', ['figs/a.png']), { kind: 'found', path: 'figs/a.png' }, 'a unique name was not found');
  assertEqual(m('figs/a.png', 'x.md', ['b.png']).kind, 'missing', 'a missing file was found');
  assertEqual(m('figs/My%20Fig.png', 'x.md', ['figs/My Fig.png']), { kind: 'found', path: 'figs/My Fig.png' },
    'a url-encoded space was not decoded');
});

// =====================================================
// CHECK 8: not a figure format, or does not open, is refused by name
// =====================================================
await check('CHECK 8: a GIF, and a PNG that does not open, are each refused with the file named', async () => {
  const md = HW.replace('(figs/Fig-4.png)', '(figs/diagram.gif)').replace('(figs/wiki-rg59.jpg)', '(figs/broken.png)');
  const chosen = folder({ extra: [['master/figs/diagram.gif', text('GIF89a')], ['master/figs/broken.png', text('not a png')]] })
    .map(f => (/Homework1\.md$/.test(f.path) ? { ...f, read: async () => text(md) } : f));
  const { images } = await importOf(chosen);
  assert(images.problems.some(p => p.startsWith('master/figs/diagram.gif:') && /SVG, PNG or JPG/.test(p)),
    `the GIF was not refused by name: ${images.problems.join(' | ')}`);
  assert(images.problems.some(p => p.startsWith('master/figs/broken.png:') && /could not be opened/.test(p)),
    `the broken PNG was not refused by name: ${images.problems.join(' | ')}`);
});

// =====================================================
// CHECK 9: one rule for both figure forms
// =====================================================
await check('CHECK 9: a figure block and an image line naming the SAME file get the same verdict', async () => {
  const asBlock = (desc) => ({ problems: [{ description: desc, subsections: [] }] });
  const block = '```figure\nid: p1-circuit\ntitle: Circuit\ndesc: A circuit.\n```';
  const line = '![A circuit](figures/p1-circuit.png)';
  for (const [label, bytes, ok] of [['colour, low dpi', colourPng(), true], ['does not open', text('nope'), false]]) {
    const files = [{ path: 'figures/p1-circuit.png', bytes }];
    const viaBlock = await figImport.collectFigures(asBlock(block), files);
    const viaLine = await figImport.resolveImagePaths(asBlock(line), files, 'hw.md');
    assertEqual(viaBlock.problems.length === 0, ok, `${label}: the figure block got the wrong verdict`);
    assertEqual(viaLine.problems.length === 0, ok, `${label}: the image line got the wrong verdict`);
    if (!ok) assertEqual(viaBlock.problems, viaLine.problems, `${label}: the two forms are refused differently`);
  }
});

// =====================================================
// CHECK 10: no relative path reaches anything downstream
// =====================================================
await check('CHECK 10: a data:, http or https url is left exactly as written', async () => {
  const d = '![a](data:image/png;base64,AAAA)\n\n![b](https://example.org/b.png)\n\n![c](http://example.org/c.png)';
  const a = { problems: [{ description: d, subsections: [] }] };
  const r = await figImport.resolveImagePaths(a, [], 'x.md');
  assertEqual(r.problems, [], 'a self-contained url was treated as a file');
  assertEqual(r.assignment.problems[0].description, d, 'a self-contained url was rewritten');
});

await check('CHECK 10: the student spec, the rubric and Export .md carry no relative path', async () => {
  const a = fromFolder.images.assignment;
  const spec = JSON.stringify(await exportSvc.buildAssignmentSpec(a));
  const md = exportSvc.assignmentToMd(a);
  const rubric = JSON.stringify(exportSvc.generateGradingRubric(a));
  for (const [label, s] of [['student spec', spec], ['Export .md', md], ['rubric', rubric]]) {
    assert(!/figs\//.test(s), `a relative path reached the ${label}`);
  }
  assert(md.includes('](data:image/png;base64,'), 'Export .md does not carry the data: URI');
});

await check('CHECK 10: safeImageUrl still refuses a relative path at render time', () => {
  const html = render.toHtml('![a figure](figs/Fig-4.png)');
  assert(!html.includes('<img') && html.includes('[figure'), 'a relative path reached an <img src>');
});

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* windows handles */ }
suiteExit(passed, failed);
