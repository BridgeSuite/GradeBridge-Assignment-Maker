/**
 * katexFonts.ts — KaTeX's glyph fonts as data URIs.
 *
 * Two consumers need the fonts embedded rather than linked:
 *   - the HTML exports, so an instructor's `assignment.html` renders correctly
 *     with no network at all;
 *   - the PDF rasteriser, because an SVG <foreignObject> image is forbidden from
 *     fetching anything, so a linked font would silently fall back to a serif.
 *
 * All 20 woff2 faces, ~340 KB of base64. Import this module DYNAMICALLY so it
 * lands in its own chunk and is fetched only when something is exported —
 * services/mathRender.ts does exactly that.
 *
 * `?dataurl` is a small Vite plugin in vite.config.ts (Vite's own `?inline` is
 * NOT honoured for these in a production build — it emits a hashed file and
 * hands back its URL). tests/run-tests.mjs teaches esbuild the same suffix, and
 * tests/bundle-tests.mjs builds for real and checks the bytes actually landed.
 */

import AMS_Regular from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2?dataurl';
import Caligraphic_Bold from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?dataurl';
import Caligraphic_Regular from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?dataurl';
import Fraktur_Bold from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?dataurl';
import Fraktur_Regular from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?dataurl';
import Main_Bold from 'katex/dist/fonts/KaTeX_Main-Bold.woff2?dataurl';
import Main_BoldItalic from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?dataurl';
import Main_Italic from 'katex/dist/fonts/KaTeX_Main-Italic.woff2?dataurl';
import Main_Regular from 'katex/dist/fonts/KaTeX_Main-Regular.woff2?dataurl';
import Math_BoldItalic from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?dataurl';
import Math_Italic from 'katex/dist/fonts/KaTeX_Math-Italic.woff2?dataurl';
import SansSerif_Bold from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?dataurl';
import SansSerif_Italic from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?dataurl';
import SansSerif_Regular from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?dataurl';
import Script_Regular from 'katex/dist/fonts/KaTeX_Script-Regular.woff2?dataurl';
import Size1_Regular from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2?dataurl';
import Size2_Regular from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2?dataurl';
import Size3_Regular from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2?dataurl';
import Size4_Regular from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2?dataurl';
import Typewriter_Regular from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?dataurl';

/** Keyed by the filename katex.min.css asks for, e.g. `KaTeX_Main-Regular.woff2`. */
export const KATEX_FONT_DATA_URIS: Record<string, string> = {
  'KaTeX_AMS-Regular.woff2': AMS_Regular,
  'KaTeX_Caligraphic-Bold.woff2': Caligraphic_Bold,
  'KaTeX_Caligraphic-Regular.woff2': Caligraphic_Regular,
  'KaTeX_Fraktur-Bold.woff2': Fraktur_Bold,
  'KaTeX_Fraktur-Regular.woff2': Fraktur_Regular,
  'KaTeX_Main-Bold.woff2': Main_Bold,
  'KaTeX_Main-BoldItalic.woff2': Main_BoldItalic,
  'KaTeX_Main-Italic.woff2': Main_Italic,
  'KaTeX_Main-Regular.woff2': Main_Regular,
  'KaTeX_Math-BoldItalic.woff2': Math_BoldItalic,
  'KaTeX_Math-Italic.woff2': Math_Italic,
  'KaTeX_SansSerif-Bold.woff2': SansSerif_Bold,
  'KaTeX_SansSerif-Italic.woff2': SansSerif_Italic,
  'KaTeX_SansSerif-Regular.woff2': SansSerif_Regular,
  'KaTeX_Script-Regular.woff2': Script_Regular,
  'KaTeX_Size1-Regular.woff2': Size1_Regular,
  'KaTeX_Size2-Regular.woff2': Size2_Regular,
  'KaTeX_Size3-Regular.woff2': Size3_Regular,
  'KaTeX_Size4-Regular.woff2': Size4_Regular,
  'KaTeX_Typewriter-Regular.woff2': Typewriter_Regular,
};
