// =====================================================
// Hash an export, entry by entry, from any checkout of this repo
// =====================================================
// Used two ways, and the two must hash identically, which is why they share
// this file:
//
//   1. `node tests/exportHashes.mjs <repoRoot> <out.json>` writes the goldens in
//      `tests/fixtures/pre_generic_sheet_goldens.json`. They were written from
//      `d6f4af5`, the deployed build before the generic answer page existed, and
//      are the "before" half of a before-and-after comparison.
//
//      REGENERATED ONCE, 2026-09-25, for WORKORDER_AM_ASSIGNMENT_KIND_TRAVELS:
//      the student spec gained `assignmentKind`, so the two `_OPEN_IN_APP.json`
//      hashes per fixture moved (Math 0fd3a7bd -> 3e97e11a, Handwritten
//      67917dcf -> 46f3c573). Every other entry is still d6f4af5's, unchanged
//      by the regeneration; the decoded specs differ by that one field only.
//   2. `tests/generic-sheet-tests.mjs` hashes the same fixtures with the code as
//      it stands and asserts every hash is unchanged. That is the suite's proof
//      that an ELECTRONIC export and a PRINTED-SHEET export did not move by a
//      byte when the generic sheet was added.
//
// Three things vary between runs and are not content, so they are pinned or
// removed, exactly as the ENG17 harness in app_records does it: the parser's
// random ids and timestamps; gb1's random IV (the student file is decrypted
// before hashing); and jsPDF's creation date and file id.
//
// Nothing else is allowed to vary, including the dependency tree. The two HTML
// documents embed KaTeX's stylesheet and rendered markup, and CI run 22 failed
// on them when a floating install resolved a newer KaTeX than the machine that
// wrote these goldens. The fix is the tracked `package-lock.json`, which pins
// KaTeX, jsPDF and qrcode-generator everywhere, not an exemption here: every
// entry is compared byte for byte, on every machine. `_katex` stays in the
// goldens as a recorded fact and gates nothing.

import { build } from 'esbuild';
import { createHash, webcrypto } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

globalThis.crypto ??= webcrypto;
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = resolve(HERE, '..');
const req = createRequire(join(MAIN, 'package.json'));

/** The KaTeX this checkout's export path would embed. */
export const katexVersion = () => req('katex/package.json').version;

/** The fixtures the goldens cover, one per path that must not move. */
export const GOLDEN_FIXTURES = [
  // Electronic: typed and image answers, a student PDF, the template PDF.
  'Math_Fixture.md',
  // Handwritten on the printed sheet: the QR sheet, the map, the spec with the map.
  'Handwritten_HW_Fixture.md',
];

const plugins = [{
  name: 'golden', setup(b) {
    b.onResolve({ filter: /^file-saver$/ }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'const s=new Proxy(function(){},{get:()=>s,apply:()=>s,construct:()=>s});export default s;',
      loader: 'js',
    }));
    b.onResolve({ filter: /\?(raw|dataurl)$/ }, a => {
      const [, q] = a.path.match(/\?(raw|dataurl)$/);
      return { path: req.resolve(a.path.replace(/\?(raw|dataurl)$/, '')), namespace: q };
    });
    b.onLoad({ filter: /.*/, namespace: 'raw' }, a => ({ contents: readFileSync(a.path, 'utf8'), loader: 'text' }));
    b.onLoad({ filter: /.*/, namespace: 'dataurl' }, a => ({
      contents: `export default ${JSON.stringify('data:font/woff2;base64,' + readFileSync(a.path).toString('base64'))};`,
      loader: 'js',
    }));
  },
}];

/** Bundle a checkout's export path into one module. */
export const loadExportPath = async (repoRoot) => {
  const out = mkdtempSync(join(tmpdir(), 'gb-golden-'));
  const entry = join(out, 'entry.ts');
  const p = (rel) => JSON.stringify(join(resolve(repoRoot), rel).split('\\').join('/'));
  writeFileSync(entry, [
    `export * from ${p('services/exportService.ts')};`,
    `export { parseMdToAssignment } from ${p('services/mdParserService.ts')};`,
    `export { decryptJson } from ${p('services/cryptoService.ts')};`,
  ].join('\n'));
  await build({
    entryPoints: [entry], outfile: join(out, 'b.mjs'), format: 'esm', target: 'es2022', bundle: true,
    nodePaths: [join(MAIN, 'node_modules')], logLevel: 'silent', plugins,
  });
  return import(pathToFileURL(join(out, 'b.mjs')).href);
};

const toBuffer = async (v) =>
  typeof v === 'string' ? Buffer.from(v, 'utf8')
  : v instanceof Uint8Array ? Buffer.from(v)
  : Buffer.from(await v.arrayBuffer());

/** Hash one entry, with the non-content variation removed. */
export const hashEntry = async (m, v) => {
  let buf = await toBuffer(v);
  let s = buf.toString('latin1');
  if (s.startsWith('gb1:')) buf = Buffer.from(JSON.stringify(await m.decryptJson(s)), 'utf8');
  s = buf.toString('latin1');
  if (s.startsWith('%PDF')) {
    buf = Buffer.from(s.replace(/\/CreationDate \(D:[^)]*\)/g, '').replace(/\/ID \[[^\]]*\]/g, ''), 'latin1');
  }
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
};

/** Parse a fixture with its ids and timestamps pinned. */
export const pinnedAssignment = (m, mdText) => {
  const a = { ...m.parseMdToAssignment(mdText), id: 'fixed-id', createdAt: 1700000000000, updatedAt: 1700000000000 };
  a.problems = a.problems.map((p, i) => ({
    ...p, id: `p${i}`, subsections: p.subsections.map((s, j) => ({ ...s, id: `p${i}s${j}` })),
  }));
  return a;
};

/** Every export entry and every file inside the student package, hashed. */
export const hashExport = async (m, assignment) => {
  const JSZip = (await import(pathToFileURL(req.resolve('jszip')).href)).default;
  const a = m.normalizePointsConfirmed(assignment);
  const entries = await m.buildExportEntries(a);
  const { outer, studentZipName } = await m.buildOuterEntries(entries, a);
  const hashes = {};
  for (const [n, v] of Object.entries(entries)) hashes[n] = await hashEntry(m, v);
  const z = await JSZip.loadAsync(outer[studentZipName]);
  const pkg = {};
  for (const n of Object.keys(z.files).sort()) {
    if (!z.files[n].dir) pkg[n] = await hashEntry(m, await z.files[n].async('uint8array'));
  }
  return { entries: hashes, studentPackage: pkg };
};

// CLI: write the goldens from a given checkout.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [repoRoot, outJson] = process.argv.slice(2);
  const m = await loadExportPath(repoRoot);
  const result = { _katex: katexVersion() };
  for (const f of GOLDEN_FIXTURES) {
    const md = readFileSync(join(MAIN, 'tests', 'fixtures', f), 'utf8');
    result[f] = await hashExport(m, pinnedAssignment(m, md));
  }
  writeFileSync(outJson, JSON.stringify(result, null, 2) + '\n');
  for (const [f, r] of Object.entries(result)) {
    if (f.startsWith('_')) continue;
    console.log(basename(f), Object.keys(r.entries).length, 'entries,', Object.keys(r.studentPackage).length, 'packaged');
  }
}
