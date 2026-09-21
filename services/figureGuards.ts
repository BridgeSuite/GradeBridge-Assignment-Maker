// =====================================================
// GUARDS ON A FIGURE FILE
// =====================================================
// A figure file is instructor-supplied and ends up printed on a sheet, inlined
// into every student's copy of the assignment, and scanned back. Each of those
// is a way for a bad file to cost something, so each has a guard.
//
// WHY GREYSCALE IS THE ONE THAT MATTERS MOST
//
// The scans are 8-bit greyscale, and that is how the marking stage proves it
// never altered a student's work: **any pixel with colour was added
// afterwards.** Author-supplied SVG used to be the only way colour could reach
// the page, and it is already refused. A colour PNG lifted from a textbook
// would be a second way in with no check on it at all. That is the gap this
// closes.
//
// Nothing is ever converted silently. A colour image is REFUSED, and the
// instructor is offered an explicit convert-to-greyscale action: a file that
// quietly changed on upload is a file whose printed form nobody chose.

import { FigureFile } from '../types';
import { FIGURE_FORMATS, FigureFormat } from './figureRefs';
import { COLUMN_X0_MM, COLUMN_X1_MM, DESC_LINE_MM, FIGURE_LINES } from './templateLayout';

// =====================================================
// THE THRESHOLDS, IN ONE PLACE
// =====================================================
// Kept together and named, so the numbers are visible and changeable without
// reading the checks that use them.

/**
 * How far apart R, G and B may be, per channel out of 255, and still count as
 * grey.
 *
 * Not zero. A greyscale original that has been through a JPEG round trip, or
 * been resaved by a scanner driver, comes back with channels a point or two
 * apart on edges; refusing those would refuse exactly the files this is meant
 * to accept. Eight is comfortably below anything a person would call coloured —
 * a pale tint is thirty or more — and comfortably above resampling noise.
 */
export const GREY_TOLERANCE = 8;

/** The floor for a raster figure at the size it will actually print. */
export const FIGURE_MIN_DPI = 300;

/**
 * The per-figure byte cap.
 *
 * Every figure is inlined into `assignment_spec.json`, which every student
 * downloads, and base64 adds a third on top. A megabyte of figure is already
 * 1.4 MB in the student's file, and an assignment may have a dozen.
 */
export const FIGURE_MAX_BYTES = 1024 * 1024;

// =====================================================
// The printed size a figure gets, from the page format itself
// =====================================================
// Not a hardcoded pixel count. The dpi floor has to mean "300 dpi at the size
// this will print", so it is computed from the same constants the generator
// reserves space with. If `FIGURE_LINES` or the column changes, this follows.

/** The box a figure is drawn into, in millimetres. */
export const FIGURE_BOX_MM = {
  width: COLUMN_X1_MM - COLUMN_X0_MM,
  height: FIGURE_LINES * DESC_LINE_MM,
};

/**
 * The size a `w x h` pixel image actually prints at, scaled to fit the box with
 * its aspect ratio preserved — which is what the generator does with it.
 */
export const figurePrintedSizeMm = (w: number, h: number): { width: number; height: number } => {
  if (!(w > 0) || !(h > 0)) return { width: 0, height: 0 };
  const scale = Math.min(FIGURE_BOX_MM.width / w, FIGURE_BOX_MM.height / h);
  return { width: w * scale, height: h * scale };
};

/** Dots per inch at printed size. Equal on both axes, since the fit is uniform. */
export const effectiveDpi = (w: number, h: number): number => {
  const printed = figurePrintedSizeMm(w, h);
  if (!(printed.width > 0)) return 0;
  return w / (printed.width / 25.4);
};

// =====================================================
// Reading just enough of a file to judge it
// =====================================================

const b64ToBytes = (b64: string): Uint8Array => {
  if (typeof atob === 'function') {
    const s = atob(b64);
    return Uint8Array.from(s, c => c.charCodeAt(0));
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
};

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface RasterInfo {
  width: number;
  height: number;
  /** PNG colour type, or the JPEG component count. */
  channels: number;
  interlaced: boolean;
}

const be32 = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** PNG IHDR, or null when this is not a PNG. */
export const readPngHeader = (bytes: Uint8Array): (RasterInfo & { bitDepth: number; colorType: number }) | null => {
  if (bytes.length < 33) return null;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_MAGIC[i]) return null;
  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null;
  return {
    width: be32(bytes, 16),
    height: be32(bytes, 20),
    bitDepth: bytes[24],
    colorType: bytes[25],
    channels: bytes[25],
    interlaced: bytes[28] === 1,
  };
};

/**
 * JPEG dimensions and component count, from the first SOF marker.
 *
 * **One component means greyscale.** Three means the file is encoded in colour,
 * and it is refused on that alone rather than on its pixels — see
 * `greyscaleProblem` for why that is the right call here and not a shortcut.
 */
export const readJpegHeader = (bytes: Uint8Array): RasterInfo | null => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0..SOF15, excluding the DHT/JPG/DAC markers that share the range.
    const isSof = marker >= 0xc0 && marker <= 0xcf
      && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        channels: bytes[i + 9],
        interlaced: marker === 0xc2, // progressive; not an obstacle to the header read
      };
    }
    i += 2 + len;
  }
  return null;
};

/**
 * Inflate a PNG's IDAT stream.
 *
 * `DecompressionStream` and not `node:zlib`: it is global in the browser and in
 * Node 18 and later, so one path serves the app and the test suite, and the
 * module stays bundleable for the browser. `'deflate'` is the zlib-wrapped
 * form, which is what a PNG carries; `'deflate-raw'` would be the headerless one.
 */
const inflate = async (data: Uint8Array): Promise<Uint8Array> => {
  const copy = new Uint8Array(data);
  const stream = new Blob([copy.buffer as ArrayBuffer]).stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** Concatenated IDAT data. */
const pngIdat = (bytes: Uint8Array): Uint8Array => {
  const chunks: Uint8Array[] = [];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = be32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === 'IDAT') chunks.push(bytes.subarray(at + 8, at + 8 + len));
    if (type === 'IEND') break;
    at += 12 + len;
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
};

/** The PLTE palette, as RGB triples. */
const pngPalette = (bytes: Uint8Array): number[][] => {
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = be32(bytes, at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === 'PLTE') {
      const out: number[][] = [];
      for (let i = 0; i + 2 < len; i += 3) {
        out.push([bytes[at + 8 + i], bytes[at + 9 + i], bytes[at + 10 + i]]);
      }
      return out;
    }
    if (type === 'IEND') break;
    at += 12 + len;
  }
  return [];
};

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/**
 * Every pixel of a truecolour PNG, unfiltered, as RGB triples.
 *
 * Written out rather than taken from a library because the app has no image
 * dependency and this must run identically in the browser and in the test
 * suite. Only what the guard needs: 8-bit, non-interlaced, colour types 2 and 6.
 */
const pngTruecolourPixels = async (bytes: Uint8Array, hdr: { width: number; height: number; colorType: number; bitDepth: number }): Promise<number[][]> => {
  const raw = await inflate(pngIdat(bytes));
  const channels = hdr.colorType === 6 ? 4 : 3;
  const bpp = channels * (hdr.bitDepth / 8);
  const stride = hdr.width * bpp;
  const out: number[][] = [];
  let prev = new Uint8Array(stride);

  for (let y = 0; y < hdr.height; y++) {
    const at = y * (stride + 1);
    if (at >= raw.length) break;
    const filter = raw[at];
    const line = raw.subarray(at + 1, at + 1 + stride).slice();
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 0xff;
      else if (filter === 2) line[x] = (line[x] + b) & 0xff;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) line[x] = (line[x] + paeth(a, b, c)) & 0xff;
    }
    const step = hdr.bitDepth / 8;
    for (let x = 0; x < hdr.width; x++) {
      const o = x * bpp;
      out.push([line[o], line[o + step], line[o + 2 * step]]);
    }
    prev = line;
  }
  return out;
};

const isGrey = (r: number, g: number, b: number) =>
  Math.abs(r - g) <= GREY_TOLERANCE
  && Math.abs(g - b) <= GREY_TOLERANCE
  && Math.abs(r - b) <= GREY_TOLERANCE;

// =====================================================
// The guards
// =====================================================

/** One refusal, in the instructor's terms. */
export interface FigureProblem {
  /** Which guard refused, for the tests and for the convert offer. */
  guard: 'format' | 'size' | 'greyscale' | 'colour' | 'resolution' | 'unreadable';
  message: string;
  /** True when an explicit convert-to-greyscale would fix it. */
  convertible?: boolean;
}

/** The non-grey `fill` / `stroke` / `stop-color` rule, as applied to inline SVG. */
const NAMED_GREYS = new Set(['none', 'black', 'white', 'gray', 'grey', 'transparent', 'currentcolor', 'inherit']);

const svgColourIsGrey = (value: string): boolean => {
  const v = value.trim().toLowerCase();
  if (!v || NAMED_GREYS.has(v)) return true;
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1];
    const [r, g, b] = h.length === 3
      ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return isGrey(r, g, b);
  }
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgb) return isGrey(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  // A named colour that is not in the grey list, or a gradient url() — anything
  // unrecognised is treated as colour. A guard that passes what it cannot read
  // is not a guard.
  return false;
};

/** Every non-grey colour an SVG paints with, deduplicated. */
export const svgColourProblems = (svg: string): string[] => {
  const bad = new Set<string>();
  const re = /(?:fill|stroke|stop-color)\s*[:=]\s*["']?\s*([^"';>)\s]+(?:\([^)]*\))?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const value = m[1];
    if (!svgColourIsGrey(value)) bad.add(value.trim());
  }
  return [...bad];
};

/**
 * Everything wrong with a figure file, or an empty list.
 *
 * Async because judging a PNG's pixels means inflating it, and neither the
 * browser nor Node offers that synchronously.
 */
export const figureFileProblems = async (file: FigureFile): Promise<FigureProblem[]> => {
  const problems: FigureProblem[] = [];

  if (!FIGURE_FORMATS.includes(file.format as FigureFormat)) {
    return [{
      guard: 'format',
      message: `${file.filename}: this is not a figure format the app accepts. `
        + `Use SVG, PNG or JPG.`,
    }];
  }

  const bytes = b64ToBytes(file.base64);

  if (bytes.length > FIGURE_MAX_BYTES) {
    problems.push({
      guard: 'size',
      message: `${file.filename} is ${(bytes.length / 1024 / 1024).toFixed(2)} MB, over the `
        + `${(FIGURE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB limit for one figure. Every figure is `
        + `copied into the file each student downloads, so a large one is paid for by every student.`,
    });
  }

  if (file.format === 'svg') {
    const svg = typeof atob === 'function'
      ? new TextDecoder().decode(bytes)
      : Buffer.from(bytes).toString('utf8');
    const colours = svgColourProblems(svg);
    if (colours.length) {
      problems.push({
        guard: 'colour',
        message: `${file.filename} paints in colour (${colours.slice(0, 4).join(', ')}`
          + `${colours.length > 4 ? `, and ${colours.length - 4} more` : ''}). Figures must be `
          + `greyscale: the scans are greyscale, and that is what proves the marking stage never `
          + `altered a student's work.`,
      });
    }
    return problems;
  }

  // --- raster: dimensions, then colour -------------------------------------
  const hdr = file.format === 'png' ? readPngHeader(bytes) : readJpegHeader(bytes);
  if (!hdr || !(hdr.width > 0) || !(hdr.height > 0)) {
    problems.push({
      guard: 'unreadable',
      message: `${file.filename} could not be read as a ${file.format.toUpperCase()}. `
        + `It may be truncated, or saved in a different format from its extension.`,
    });
    return problems;
  }

  const dpi = effectiveDpi(hdr.width, hdr.height);
  if (dpi < FIGURE_MIN_DPI) {
    const printed = figurePrintedSizeMm(hdr.width, hdr.height);
    problems.push({
      guard: 'resolution',
      message: `${file.filename} is ${hdr.width}x${hdr.height} pixels, which is `
        + `${Math.round(dpi)} dpi at the size it prints (${printed.width.toFixed(0)}x`
        + `${printed.height.toFixed(0)} mm). Figures must be at least ${FIGURE_MIN_DPI} dpi at `
        + `printed size, or the scanner reads a blur. Rescan or re-export it larger.`,
    });
  }

  const colourMessage = `${file.filename} is not greyscale. Figures must be: the scans are `
    + `greyscale, and that is what proves the marking stage never altered a student's work.`;

  if (file.format === 'jpg') {
    // THE ONE PLACE A HEADER STANDS IN FOR THE PIXELS, and it is deliberate.
    // Decoding JPEG by hand is a DCT implementation, which is not a thing to
    // hand-roll inside a guard. The component count is what the encoder itself
    // recorded: one component IS greyscale, three means the file is carrying
    // colour channels whether or not every pixel happens to be grey.
    // Refusing the second is not a false positive in any sense that matters —
    // the convert action re-encodes it as greyscale, which is the form the
    // pipeline wants anyway.
    if (hdr.channels !== 1) {
      problems.push({ guard: 'greyscale', convertible: true, message: colourMessage
        + ` This JPEG is encoded with ${hdr.channels} colour channels; convert it to greyscale.` });
    }
    return problems;
  }

  // PNG: colour types 0 and 4 are greyscale by construction.
  const png = hdr as RasterInfo & { colorType: number; bitDepth: number };
  const colorType = png.colorType;
  const bitDepth = png.bitDepth;
  if (colorType === 0 || colorType === 4) return problems;

  if (colorType === 3) {
    const offending = pngPalette(bytes).filter(([r, g, b]) => !isGrey(r, g, b));
    if (offending.length) {
      problems.push({ guard: 'greyscale', convertible: true, message: colourMessage
        + ` Its palette has ${offending.length} colour entr${offending.length === 1 ? 'y' : 'ies'}.` });
    }
    return problems;
  }

  if (hdr.interlaced || bitDepth !== 8) {
    problems.push({
      guard: 'unreadable',
      message: `${file.filename} is an ${hdr.interlaced ? 'interlaced' : `${bitDepth}-bit`} PNG, `
        + `which this check cannot read pixel by pixel. Re-save it as a non-interlaced 8-bit PNG, `
        + `or as greyscale, so the colour check can be carried out rather than assumed.`,
    });
    return problems;
  }

  try {
    const pixels = await pngTruecolourPixels(bytes, { ...hdr, colorType, bitDepth });
    const offending = pixels.filter(([r, g, b]) => !isGrey(r, g, b));
    if (offending.length) {
      const pct = ((offending.length / pixels.length) * 100).toFixed(1);
      problems.push({ guard: 'greyscale', convertible: true, message: colourMessage
        + ` ${offending.length} of ${pixels.length} pixels are coloured (${pct}%).` });
    }
  } catch (err) {
    problems.push({
      guard: 'unreadable',
      message: `${file.filename} could not be decoded to check its colour `
        + `(${err instanceof Error ? err.message : String(err)}). A figure whose colour cannot be `
        + `checked is refused rather than assumed grey.`,
    });
  }

  return problems;
};
