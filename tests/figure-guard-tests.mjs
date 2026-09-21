// =====================================================
// Guards on a figure file
// =====================================================
// Format, size, greyscale, colour, resolution. Each refuses a real file rather
// than a fixture asserted to be bad, and each is MUTATION-TESTED: the check is
// deliberately broken and the test must fail. A guard nobody has watched fail
// is a guard nobody knows is connected.
//
// The PNGs here are built byte by byte in this file — IHDR, IDAT, IEND, with a
// real deflate stream — so the pixels being judged are pixels that exist, and a
// colour PNG is genuinely colour rather than a flag saying so.

import { build } from 'esbuild';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

let passed = 0, failed = 0;
const results = [];
const check = async (name, fn) => {
  try { await fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const outDir = mkdtempSync(join(tmpdir(), 'gb-guard-'));
const requireFromRepo = createRequire(join(REPO, 'package.json'));
/**
 * A mutant is written BESIDE the original, not into a temp directory.
 *
 * It imports `./figureRefs` and `./templateLayout` by relative path, so a copy
 * anywhere else cannot resolve them. The temporary file is removed in the
 * `finally`, and it is untracked, so the repository guards do not see it.
 */
const scratchNames = [];
const load = async (entry, name, source) => {
  const outfile = join(outDir, name);
  let entryPoint = entry;
  if (source !== undefined) {
    entryPoint = join(dirname(entry), `__mutant-${name.replace(/[^a-z0-9]+/gi, '-')}.ts`);
    writeFileSync(entryPoint, source, 'utf8');
    scratchNames.push(entryPoint);
  }
  try {
    await build({
      entryPoints: [entryPoint], outfile, format: 'esm', target: 'es2022', bundle: true,
      absWorkingDir: dirname(entry), logLevel: 'silent',
    });
    return await import(pathToFileURL(outfile).href + `?v=${name}`);
  } finally {
    if (source !== undefined) { try { rmSync(entryPoint, { force: true }); } catch { /* ignore */ } }
  }
};

const GUARDS = join(REPO, 'services', 'figureGuards.ts');
const guards = await load(GUARDS, 'guards.mjs');

console.log('\nFigure guards — format, size, greyscale, colour, resolution\n');

// ---------------------------------------------------------------------------
// Real PNGs, built here
// ---------------------------------------------------------------------------
const crc32 = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A non-interlaced 8-bit PNG. `pixel(x, y)` returns [r, g, b]. */
const makePng = (w, h, pixel, colorType = 2) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const channels = colorType === 0 ? 1 : colorType === 6 ? 4 : 3;
  const raw = Buffer.alloc(h * (1 + w * channels));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      if (colorType === 0) raw[o++] = r;
      else { raw[o++] = r; raw[o++] = g; raw[o++] = b; if (channels === 4) raw[o++] = 255; }
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
};

const asFile = (buf, format, filename) =>
  ({ format, base64: buf.toString('base64'), filename });

// Big enough to clear the dpi floor: the box is ~191.9 x 51.4 mm, so a wide
// figure needs ~2267 px across to reach 300 dpi.
const BIG = { w: 2400, h: 600 };
const greyPixel = (x, y) => { const v = (x + y) % 256; return [v, v, v]; };
const colourPixel = (x, y) => (x === 5 && y === 5 ? [220, 30, 30] : greyPixel(x, y));

const greyPng = makePng(BIG.w, BIG.h, greyPixel);
const colourPng = makePng(BIG.w, BIG.h, colourPixel);
const smallPng = makePng(200, 50, greyPixel);
const truegreyPng = makePng(BIG.w, BIG.h, greyPixel, 0);

const problemsOf = async (file, mod = guards) =>
  (await mod.figureFileProblems(file)).map(p => `${p.guard}: ${p.message}`);
const guardsHit = async (file, mod = guards) =>
  (await mod.figureFileProblems(file)).map(p => p.guard);

// ---------------------------------------------------------------------------
// The thresholds are named and computed, not hardcoded pixels
// ---------------------------------------------------------------------------
await check('the printed box comes from the page format, not a constant', () => {
  assert(Math.abs(guards.FIGURE_BOX_MM.width - 191.9) < 0.01,
    `the figure box width is ${guards.FIGURE_BOX_MM.width}, not the writing column`);
  assert(Math.abs(guards.FIGURE_BOX_MM.height - 51.44) < 0.1,
    `the figure box height is ${guards.FIGURE_BOX_MM.height}`);
});

await check('effective dpi is measured at printed size', () => {
  // A 2400 px wide figure fits the box by width, printing 191.9 mm across.
  const dpi = guards.effectiveDpi(2400, 600);
  assert(Math.abs(dpi - 2400 / (191.9 / 25.4)) < 0.01, `dpi came out as ${dpi}`);
  assert(dpi > 300, `a 2400 px figure should clear the floor, got ${dpi}`);
  assert(guards.effectiveDpi(200, 50) < 300, 'a 200 px figure should not clear the floor');
});

// ---------------------------------------------------------------------------
// Each guard refuses its own bad case
// ---------------------------------------------------------------------------
await check('a clean greyscale PNG passes every guard', async () => {
  const hit = await guardsHit(asFile(greyPng, 'png', 'clean.png'));
  assert(hit.length === 0, `a good figure was refused: ${(await problemsOf(asFile(greyPng, 'png', 'clean.png'))).join(' | ')}`);
});

await check('a greyscale-typed PNG passes without needing its pixels read', async () => {
  assert((await guardsHit(asFile(truegreyPng, 'png', 'grey.png'))).length === 0,
    'a colour-type-0 PNG was refused');
});

await check('GREYSCALE: a colour PNG is refused, and the refusal is convertible', async () => {
  const found = await guards.figureFileProblems(asFile(colourPng, 'png', 'colour.png'));
  const grey = found.find(p => p.guard === 'greyscale');
  assert(grey, `a colour PNG passed: ${found.map(p => p.guard).join(', ') || '(no problems)'}`);
  assert(grey.convertible === true, 'the refusal does not offer conversion');
  assert(/scans are greyscale/.test(grey.message), `the message does not say why: ${grey.message}`);
  assert(/1 of \d+ pixels are coloured/.test(grey.message),
    `the message does not count the offending pixels: ${grey.message}`);
});

await check('GREYSCALE: near-grey pixels inside the tolerance are accepted', async () => {
  const nearly = makePng(BIG.w, BIG.h, (x, y) => {
    const v = 120; return [v, v + guards.GREY_TOLERANCE, v];
  });
  assert(!(await guardsHit(asFile(nearly, 'png', 'nearly.png'))).includes('greyscale'),
    'a file inside the stated tolerance was refused');
});

await check('GREYSCALE: just outside the tolerance is refused', async () => {
  const over = makePng(BIG.w, BIG.h, () => {
    const v = 120; return [v, v + guards.GREY_TOLERANCE + 1, v];
  });
  assert((await guardsHit(asFile(over, 'png', 'over.png'))).includes('greyscale'),
    'a file outside the stated tolerance was accepted');
});

await check('RESOLUTION: a PNG below 300 dpi at printed size is refused', async () => {
  const found = await guards.figureFileProblems(asFile(smallPng, 'png', 'small.png'));
  const res = found.find(p => p.guard === 'resolution');
  assert(res, `a 200x50 figure passed the resolution guard`);
  assert(/200x50 pixels/.test(res.message), `the message does not name the size: ${res.message}`);
  assert(/at least 300 dpi/.test(res.message), `the message does not name the floor: ${res.message}`);
});

await check('SIZE: a figure over the cap is refused', async () => {
  const big = { format: 'png', base64: Buffer.alloc(guards.FIGURE_MAX_BYTES + 1).toString('base64'), filename: 'huge.png' };
  assert((await guardsHit(big)).includes('size'), 'an oversized figure passed the size guard');
});

await check('SIZE: the refusal explains who pays for it', async () => {
  const big = { format: 'png', base64: Buffer.alloc(guards.FIGURE_MAX_BYTES + 1).toString('base64'), filename: 'huge.png' };
  const found = await guards.figureFileProblems(big);
  const size = found.find(p => p.guard === 'size');
  assert(/every student/.test(size.message), `the message does not say why: ${size.message}`);
});

await check('FORMAT: anything but SVG, PNG or JPG is refused, and the message lists them', async () => {
  const found = await guards.figureFileProblems({ format: 'gif', base64: 'AA==', filename: 'x.gif' });
  assert(found.length === 1 && found[0].guard === 'format', 'a GIF was not refused on format');
  assert(/SVG, PNG or JPG/.test(found[0].message), `the message does not list the formats: ${found[0].message}`);
});

await check('COLOUR: an SVG that paints in colour is refused', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" stroke="#cc2222"/></svg>';
  const found = await guards.figureFileProblems(asFile(Buffer.from(svg), 'svg', 'c.svg'));
  const colour = found.find(p => p.guard === 'colour');
  assert(colour, 'a colour SVG passed');
  assert(/#cc2222/.test(colour.message), `the offending colour is not named: ${colour.message}`);
});

await check('COLOUR: a greyscale SVG passes', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M0 0" stroke="#000000" fill="none"/><rect fill="rgb(128,128,128)"/>'
    + '<circle stroke="black"/></svg>';
  assert((await guardsHit(asFile(Buffer.from(svg), 'svg', 'g.svg'))).length === 0,
    `a greyscale SVG was refused: ${(await problemsOf(asFile(Buffer.from(svg), 'svg', 'g.svg'))).join(' | ')}`);
});

await check('COLOUR: an unrecognised paint value is treated as colour, not waved through', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#gradient)"/></svg>';
  assert((await guardsHit(asFile(Buffer.from(svg), 'svg', 'u.svg'))).includes('colour'),
    'a gradient reference was accepted — a guard that passes what it cannot read is not a guard');
});

await check('JPEG: a three-channel JPEG is refused as colour', async () => {
  // SOI, then an SOF0 saying 3 components at 2400x600.
  const jpg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x09, 0x60, 0x03,
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);
  const found = await guards.figureFileProblems(asFile(jpg, 'jpg', 'c.jpg'));
  const grey = found.find(p => p.guard === 'greyscale');
  assert(grey, `a 3-channel JPEG passed: ${found.map(p => p.guard).join(', ') || '(none)'}`);
  assert(grey.convertible === true, 'the JPEG refusal does not offer conversion');
});

await check('JPEG: a single-channel JPEG passes', async () => {
  const jpg = Buffer.from([
    0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x02, 0x58, 0x09, 0x60, 0x01,
    0x01, 0x11, 0x00,
  ]);
  assert(!(await guardsHit(asFile(jpg, 'jpg', 'g.jpg'))).includes('greyscale'),
    'a greyscale JPEG was refused');
});

await check('UNREADABLE: a file that is not the format it claims is refused, not assumed grey', async () => {
  const found = await guards.figureFileProblems(asFile(Buffer.from('not a png at all, really not'), 'png', 'x.png'));
  assert(found.some(p => p.guard === 'unreadable'), 'a non-PNG claiming to be a PNG was accepted');
});

await check('UNREADABLE: an interlaced PNG is refused rather than passed unchecked', async () => {
  const png = Buffer.from(makePng(BIG.w, BIG.h, colourPixel));
  png[8 + 8 + 12] = 1; // IHDR interlace byte
  const found = await guards.figureFileProblems(asFile(png, 'png', 'i.png'));
  assert(found.some(p => p.guard === 'unreadable'),
    'an interlaced PNG was judged without its pixels being read');
});

// ---------------------------------------------------------------------------
// MUTATION TESTS — break each check and confirm a test fails
// ---------------------------------------------------------------------------
// Criterion 5. Every guard above is re-run against a deliberately broken copy
// of the module, and the case it exists for must stop being refused.
const source = readFileSync(GUARDS, 'utf8');

const mutate = async (label, from, to, file, guard) => {
  await check(`MUTATION (${label}): breaking the check makes the refusal disappear`, async () => {
    assert(source.includes(from), `the mutation anchor is gone from the source: ${from}`);
    const broken = await load(GUARDS, `mutant-${label}.mjs`, source.replace(from, to));
    const before = await guardsHit(file);
    const after = await guardsHit(file, broken);
    assert(before.includes(guard), `the shipped guard does not refuse this file: ${before.join(', ')}`);
    assert(!after.includes(guard),
      `the mutant still refused it, so this test does not actually exercise the ${guard} check`);
  });
};

// The whole predicate, not one of its three comparisons: `isGrey` tests r-g,
// g-b and r-b, so breaking only the first still catches [220, 30, 30] on the
// third. That near-miss is worth keeping in view — a mutation that leaves a
// redundant path intact proves nothing about the path it did break.
await mutate('greyscale',
  'const isGrey = (r: number, g: number, b: number) =>',
  'const isGrey = (r: number, g: number, b: number) => true ||',
  asFile(colourPng, 'png', 'colour.png'), 'greyscale');

await mutate('resolution', 'if (dpi < FIGURE_MIN_DPI) {', 'if (false) {',
  asFile(smallPng, 'png', 'small.png'), 'resolution');

await mutate('size', 'if (bytes.length > FIGURE_MAX_BYTES) {', 'if (false) {',
  { format: 'png', base64: Buffer.alloc(guards.FIGURE_MAX_BYTES + 1).toString('base64'), filename: 'h.png' },
  'size');

await mutate('svg colour', 'if (colours.length) {', 'if (false) {',
  asFile(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path stroke="#cc2222"/></svg>'), 'svg', 'c.svg'),
  'colour');

await mutate('format', 'if (!FIGURE_FORMATS.includes(file.format as FigureFormat)) {', 'if (false) {',
  { format: 'gif', base64: 'AA==', filename: 'x.gif' }, 'format');

// ---------- report ----------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
for (const f of scratchNames) { try { rmSync(f, { force: true }); } catch { /* ignore */ } }
try { rmSync(outDir, { recursive: true, force: true }); } catch { /* windows handles */ }
process.exit(failed > 0 ? 1 : 0);
