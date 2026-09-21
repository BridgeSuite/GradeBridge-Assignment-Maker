// =====================================================
// CONVERT A COLOUR FIGURE TO GREYSCALE, WHEN ASKED
// =====================================================
// `WORKORDER_AM_FIGURES_AND_FINALIZE_2026-09-21` §5 said: refuse a colour image
// **and offer an explicit convert-to-greyscale action; never convert silently.**
// The build refused and then declined to convert at all, which is only half of
// that and leaves the instructor to find an image editor.
//
// **An instructor pressing a button labelled "Convert to greyscale" is not a
// silent conversion.** The refusal comes first, the offer is a separate
// decision, and the result is shown before it counts as done.
//
// THE CONVERTED FILE GOES BACK THROUGH EVERY GUARD, not just the one that
// refused it. Conversion changes the bytes, so it changes the size, and a
// re-encode of a large colour PNG can come out bigger than the cap even though
// it is now grey. Re-running only the greyscale check would let exactly that
// through, and the instructor would meet the size refusal later, on a file they
// had already been told was fixed.

import { FigureFile } from '../types';
import { figureFileProblems, FigureProblem } from './figureGuards';

/**
 * Rec. 601 luma. The weights matter: a flat average of R, G and B turns a red
 * trace and a blue trace into the same mid grey, which is exactly the
 * distinction a circuit diagram uses colour to make. Luma keeps them apart,
 * which is the best a greyscale copy can do.
 */
const LUMA = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

const bytesFromBase64 = (b64: string): Uint8Array => {
  if (typeof atob === 'function') return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return new Uint8Array(Buffer.from(b64, 'base64'));
};

const base64FromBytes = (bytes: Uint8Array): string => {
  if (typeof btoa === 'function') {
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64');
};

/** Non-grey `fill` / `stroke` / `stop-color` values, rewritten to their luma. */
const greyscaleSvg = (svg: string): string =>
  // SIX-DIGIT HEX FIRST. With `#[0-9a-f]{3}` earlier in the alternation,
  // `#cc2222` matches as `#cc2` and the trailing `222` is left behind, so the
  // "converted" drawing comes out with `#8b8b8b222` in it -- still colour by
  // any reading, and refused by the guard a moment later. Longest alternative
  // first is the whole fix.
  svg.replace(/(fill|stroke|stop-color)(\s*[:=]\s*["']?\s*)(#[0-9a-f]{6}|#[0-9a-f]{3}|rgba?\([^)]*\))/gi,
    (whole, prop: string, sep: string, value: string) => {
      let r: number, g: number, b: number;
      const v = value.toLowerCase();
      if (v.startsWith('#')) {
        const h = v.slice(1);
        [r, g, b] = h.length === 3
          ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
          : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      } else {
        const m = v.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
        if (!m) return whole;
        [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      }
      const y = Math.max(0, Math.min(255, Math.round(LUMA(r, g, b))));
      const hex = y.toString(16).padStart(2, '0');
      return `${prop}${sep}#${hex}${hex}${hex}`;
    });

/**
 * Re-encode a raster figure as greyscale.
 *
 * Uses a canvas, which is what the browser has. **This is the one part of the
 * figure pipeline that cannot run in Node**, so it is isolated here behind a
 * clear failure rather than spread through the guards: the tests exercise the
 * SVG path and the guard that judges the result, and the raster re-encode is
 * exercised in the app.
 */
const greyscaleRaster = async (file: FigureFile): Promise<FigureFile> => {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') {
    throw new Error('Converting a photograph or scan to greyscale needs a browser.');
  }
  const bytes = bytesFromBase64(file.base64);
  const type = file.format === 'png' ? 'image/png' : 'image/jpeg';
  const bitmap = await createImageBitmap(new Blob([bytes.buffer as ArrayBuffer], { type }));

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not open a canvas to convert the image.');
  ctx.drawImage(bitmap, 0, 0);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const y = LUMA(d[i], d[i + 1], d[i + 2]);
    d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(image, 0, 0);

  // PNG out, whatever went in. A JPEG re-encode would add its own artefacts on
  // top of the original's, and the result is a line drawing where they show.
  const blob: Blob = await new Promise((done, fail) =>
    canvas.toBlob(b => (b ? done(b) : fail(new Error('The browser could not save the converted image.'))), 'image/png'));

  const name = file.filename.replace(/\.[^.]+$/, '');
  return {
    format: 'png',
    base64: base64FromBytes(new Uint8Array(await blob.arrayBuffer())),
    filename: `${name}-grey.png`,
  };
};

export interface ConversionResult {
  file?: FigureFile;
  /** Why the converted file is still not usable. Empty when it is. */
  problems: FigureProblem[];
}

/**
 * Convert, then judge the result by every rule a fresh upload is judged by.
 *
 * Returns the converted file only when it passes all of them, so a caller
 * cannot accidentally use a conversion that merely fixed the colour.
 */
export const convertToGreyscale = async (file: FigureFile): Promise<ConversionResult> => {
  let converted: FigureFile;
  try {
    converted = file.format === 'svg'
      ? { ...file, base64: base64FromBytes(new TextEncoder().encode(
          greyscaleSvg(typeof atob === 'function'
            ? new TextDecoder().decode(bytesFromBase64(file.base64))
            : Buffer.from(file.base64, 'base64').toString('utf8')))) }
      : await greyscaleRaster(file);
  } catch (err) {
    return {
      problems: [{
        guard: 'unreadable',
        message: err instanceof Error ? err.message : 'The image could not be converted.',
      }],
    };
  }

  const problems = await figureFileProblems(converted);
  return problems.length ? { problems } : { file: converted, problems: [] };
};
