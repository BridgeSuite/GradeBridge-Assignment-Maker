/**
 * mathRender.ts — the single source of truth for `$...$` / `$$...$$` math.
 *
 * Every place that has to turn authored text into an output — the app preview,
 * the HTML export, the grader document, the .tex export and the PDF — goes
 * through the splitter and one of the emitters below. Nothing hand-rolls `$`
 * handling, and no output round-trips math through a placeholder token, which
 * is the bug class that kept leaking `<<MATH_BLOCK_0>>` into .tex (and, via the
 * T1 `<<` ligature, `«MATH_BLOCK_0»` into the PDF compiled from it).
 *
 * Delimiter rules (documented in ASSIGNMENT_MD_SPEC.md §6, and identical to the
 * Student Submission app's components/KatexRenderer.tsx — keep them in lockstep):
 *   - inline `$...$`, display `$$...$$`
 *   - every `$` must be paired; an inline span may not contain a `$`
 *   - invalid LaTeX is never dropped: KaTeX renders its own inline error
 *     (`throwOnError: false`), and only a hard failure falls back to raw text.
 */

import katex from 'katex';
import katexCss from 'katex/dist/katex.min.css?raw';

// -----------------------------------------------------
// The splitter
// -----------------------------------------------------

export type MathSeg =
  | { kind: 'text'; value: string }
  | { kind: 'inline'; tex: string }
  | { kind: 'display'; tex: string };

/**
 * The one delimiter regex of record. Byte-identical to the Student Submission
 * app's splitter so authored math renders the same on both sides.
 */
export const MATH_DELIMITER_RE = /(\$\$[\s\S]+?\$\$|\$[^$]+?\$)/g;

export const splitMath = (input: string): MathSeg[] => {
  if (!input) return [];
  const segs: MathSeg[] = [];
  // String.split with a capturing group keeps the delimiters as their own parts.
  for (const part of input.split(MATH_DELIMITER_RE)) {
    if (!part) continue;
    if (part.length >= 4 && part.startsWith('$$') && part.endsWith('$$')) {
      segs.push({ kind: 'display', tex: part.slice(2, -2) });
    } else if (part.length >= 3 && part.startsWith('$') && part.endsWith('$')) {
      segs.push({ kind: 'inline', tex: part.slice(1, -1) });
    } else {
      segs.push({ kind: 'text', value: part });
    }
  }
  return segs;
};

/** True when the text has at least one math span the emitters would render. */
export const hasMath = (input: string): boolean =>
  !!input && splitMath(input).some(s => s.kind !== 'text');

// -----------------------------------------------------
// HTML (app preview, assignment.html, grader document)
// -----------------------------------------------------

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;')
   .replace(/</g, '&lt;')
   .replace(/>/g, '&gt;')
   .replace(/"/g, '&quot;')
   .replace(/'/g, '&#39;');

/** Render one math span. Never throws — a hard failure degrades to raw text. */
export const renderTex = (tex: string, displayMode: boolean): string => {
  try {
    return katex.renderToString(tex, {
      throwOnError: false,   // malformed LaTeX renders KaTeX's inline error, not an exception
      displayMode,
      output: 'htmlAndMathml',
      strict: false,
      trust: true,
    });
  } catch {
    const raw = displayMode ? `$$${tex}$$` : `$${tex}$`;
    return `<span class="math-error" style="color:#b91c1c;font-family:monospace">${escapeHtml(raw)}</span>`;
  }
};

/**
 * Text → self-contained HTML. Prose is escaped, math is KaTeX-rendered here and
 * now. No CDN script, nothing async: what the file says is what it shows.
 * Callers should set `white-space: pre-wrap` on the container so authored line
 * breaks survive, matching the app preview.
 */
export const toHtml = (input: string): string => {
  if (!input) return '';
  return splitMath(input)
    .map(seg => (seg.kind === 'text' ? escapeHtml(seg.value) : renderTex(seg.tex, seg.kind === 'display')))
    .join('');
};

/**
 * KaTeX's own stylesheet, inlined so an exported file lays math out correctly
 * with no network. Only the glyph fonts stay on the CDN (embedding all 20 woff2
 * files would add ~340 KB of base64 to every export); without them the layout is
 * still correct and the browser substitutes a serif face.
 */
export const katexStylesheet = (): string =>
  katexCss.replace(/url\(fonts\//g, 'url(https://cdn.jsdelivr.net/npm/katex@0.16/dist/fonts/');

// -----------------------------------------------------
// Raster (PDF) — the same KaTeX HTML, drawn to a canvas
// -----------------------------------------------------
// The page is drawn by the browser's own layout engine via an SVG
// <foreignObject>, so what lands in the PDF is exactly what the preview shows.
// (html2canvas was tried first and mis-places KaTeX's fraction rules — it draws
// `.frac-line` over the numerator, because it does not account for the strut
// that sets the line box. The browser has no such problem with itself.)

export interface RasterOptions {
  widthPx: number;
  fontSizePx: number;
  lineHeightPx: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  /** Device pixels per CSS pixel. 3 ≈ 288 dpi at PDF scale. */
  scale?: number;
}

const fontUrlPattern = () => /url\(["']?([^"')]+\.woff2)["']?\)/g;

/** Every KaTeX rule the running page has, whatever URLs the build gave them. */
const katexCssFromDocument = (): string => {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; } // cross-origin sheet
    for (const rule of Array.from(rules)) {
      if (/katex/i.test(rule.cssText)) css += rule.cssText + '\n';
    }
  }
  return css;
};

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

let embeddedCss: Promise<string> | null = null;

/**
 * KaTeX's stylesheet with the font files embedded as data URIs. An SVG image is
 * not allowed to fetch anything, so without this the raster would fall back to
 * a system serif. Built once per session (~360 KB) and cached.
 */
export const katexStylesheetWithFonts = (): Promise<string> => {
  if (embeddedCss) return embeddedCss;
  embeddedCss = (async () => {
    let css = typeof document !== 'undefined' ? katexCssFromDocument() : '';
    if (!fontUrlPattern().test(css)) css = katexStylesheet();

    const urls = [...new Set([...css.matchAll(fontUrlPattern())].map(m => m[1]))];
    await Promise.all(urls.map(async url => {
      try {
        const dataUrl = await blobToDataUrl(await (await fetch(url)).blob());
        css = css.split(url).join(dataUrl);
      } catch {
        // Leave the URL as-is: the glyphs degrade, the layout does not.
      }
    }));
    // Drop the woff/ttf fallbacks — they would still point off-document.
    return css.replace(/url\(["']?[^"')]+\.(?:woff|ttf)["']?\)\s*format\(["'][^"']*["']\)\s*,?/g, '');
  })();
  return embeddedCss;
};

/**
 * Render authored text (prose + math) to a canvas. Returns null wherever there
 * is no DOM, or if the browser refuses the image — callers fall back to
 * toPdfText() rather than emitting anything broken.
 */
export const renderTextToCanvas = async (
  text: string, opts: RasterOptions
): Promise<HTMLCanvasElement | null> => {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;

  const scale = opts.scale ?? 3;
  const boxCss = [
    `width:${opts.widthPx.toFixed(2)}px`,
    "font-family:'Times New Roman',Times,serif",
    `font-size:${opts.fontSizePx.toFixed(2)}px`,
    `line-height:${opts.lineHeightPx.toFixed(2)}px`,
    `font-weight:${opts.bold ? 700 : 400}`,
    `font-style:${opts.italic ? 'italic' : 'normal'}`,
    `color:${opts.color || '#000000'}`,
    'background:#ffffff',
    'white-space:pre-wrap',
    'overflow-wrap:break-word',
  ].join(';');

  const host = document.createElement('div');
  host.setAttribute('style', `position:fixed;left:-10000px;top:0;z-index:-1;${boxCss}`);
  host.innerHTML = toHtml(text);
  document.body.appendChild(host);

  let heightPx: number;
  let inner: string;
  try {
    // KaTeX's fonts only start loading once its spans are in the document, and
    // the measured height is wrong until they have.
    if (document.fonts?.ready) await document.fonts.ready;
    heightPx = Math.ceil(host.getBoundingClientRect().height);
    const serializer = new XMLSerializer();
    inner = Array.from(host.childNodes).map(n => serializer.serializeToString(n)).join('');
  } finally {
    host.remove();
  }
  if (!heightPx) return null;

  const css = await katexStylesheetWithFonts();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.widthPx.toFixed(2)}" height="${heightPx}">` +
      '<foreignObject width="100%" height="100%">' +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="${boxCss}">` +
          `<style>${css}</style>${inner}` +
        '</div>' +
      '</foreignObject>' +
    '</svg>';

  try {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(opts.widthPx * scale);
    canvas.height = Math.round(heightPx * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch (err) {
    console.warn('Math rasterisation failed; falling back to plain text.', err);
    return null;
  }
};

// -----------------------------------------------------
// LaTeX (assignment.tex)
// -----------------------------------------------------

const LATEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '#': '\\#',
  '_': '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  // `<<` and `>>` are guillemet ligatures under T1 fontenc — the exact mechanism
  // that turned a leaked placeholder into «MATH_BLOCK_0» in the compiled PDF.
  '<': '\\textless{}',
  '>': '\\textgreater{}',
};

/**
 * Escape LaTeX specials in prose. Single pass over a character class, so an
 * escape's own braces are never re-escaped (the old chained `.replace()` turned
 * a literal backslash into `\textbackslash\{\}`).
 */
export const escapeLatexText = (s: string): string =>
  s.replace(/[\\&%$#_{}~^<>]/g, c => LATEX_ESCAPES[c]);

/**
 * Text → LaTeX body. Prose is escaped; math is emitted verbatim with its
 * delimiters so pdflatex typesets it natively. There is no placeholder token,
 * so there is nothing that can fail to be restored.
 */
export const toLatexBody = (input: string): string => {
  if (!input) return '';
  return splitMath(input)
    .map(seg => {
      if (seg.kind === 'text') return escapeLatexText(seg.value);
      if (seg.kind === 'inline') return `$${seg.tex}$`;
      return `$$${seg.tex}$$`;
    })
    .join('');
};

// -----------------------------------------------------
// Plain text (PDF fallback, and any context that cannot typeset)
// -----------------------------------------------------

type Charset = 'unicode' | 'winansi';

// [unicode form, form safe for jsPDF's WinAnsi standard fonts]
const SYMBOLS: Record<string, [string, string]> = {
  // Greek — lower case
  alpha: ['α', 'alpha'], beta: ['β', 'beta'], gamma: ['γ', 'gamma'], delta: ['δ', 'delta'],
  epsilon: ['ε', 'epsilon'], varepsilon: ['ε', 'epsilon'], zeta: ['ζ', 'zeta'], eta: ['η', 'eta'],
  theta: ['θ', 'theta'], vartheta: ['ϑ', 'theta'], iota: ['ι', 'iota'], kappa: ['κ', 'kappa'],
  lambda: ['λ', 'lambda'], mu: ['μ', 'µ'], nu: ['ν', 'nu'], xi: ['ξ', 'xi'], pi: ['π', 'pi'],
  rho: ['ρ', 'rho'], sigma: ['σ', 'sigma'], tau: ['τ', 'tau'], upsilon: ['υ', 'upsilon'],
  phi: ['φ', 'phi'], varphi: ['φ', 'phi'], chi: ['χ', 'chi'], psi: ['ψ', 'psi'], omega: ['ω', 'omega'],
  // Greek — upper case
  Gamma: ['Γ', 'Gamma'], Delta: ['Δ', 'Delta'], Theta: ['Θ', 'Theta'], Lambda: ['Λ', 'Lambda'],
  Xi: ['Ξ', 'Xi'], Pi: ['Π', 'Pi'], Sigma: ['Σ', 'Sigma'], Upsilon: ['Υ', 'Upsilon'],
  Phi: ['Φ', 'Phi'], Psi: ['Ψ', 'Psi'], Omega: ['Ω', 'Ohm'],
  // Operators and relations
  times: ['×', '×'], cdot: ['·', '·'], div: ['÷', '÷'], pm: ['±', '±'], mp: ['∓', '-/+'],
  approx: ['≈', '~='], simeq: ['≃', '~='], sim: ['~', '~'], equiv: ['≡', '=='],
  neq: ['≠', '!='], ne: ['≠', '!='], leq: ['≤', '<='], le: ['≤', '<='],
  geq: ['≥', '>='], ge: ['≥', '>='], ll: ['≪', '<<'], gg: ['≫', '>>'],
  propto: ['∝', 'prop. to'], perp: ['⊥', 'perp'], parallel: ['∥', '||'], angle: ['∠', 'angle'],
  // Symbols
  infty: ['∞', 'inf'], partial: ['∂', 'd'], nabla: ['∇', 'grad'],
  int: ['∫', 'integral'], oint: ['∮', 'integral'], sum: ['Σ', 'sum'], prod: ['Π', 'prod'],
  circ: ['°', '°'], degree: ['°', '°'], prime: ['′', "'"],
  hbar: ['ħ', 'hbar'], ell: ['ℓ', 'l'], Re: ['ℜ', 'Re'], Im: ['ℑ', 'Im'],
  star: ['⋆', '*'], ast: ['∗', '*'], bullet: ['•', '•'],
  ldots: ['…', '...'], cdots: ['⋯', '...'], dots: ['…', '...'],
  in: ['∈', 'in'], notin: ['∉', 'not in'], forall: ['∀', 'for all'], exists: ['∃', 'exists'],
  // Arrows
  rightarrow: ['→', '->'], to: ['→', '->'], leftarrow: ['←', '<-'], gets: ['←', '<-'],
  leftrightarrow: ['↔', '<->'], Rightarrow: ['⇒', '=>'], Leftarrow: ['⇐', '<='],
  Leftrightarrow: ['⇔', '<=>'], mapsto: ['↦', '->'],
  // Roots (used by the \sqrt rewrite below)
  surd: ['√', 'sqrt'],
};

// Operator names LaTeX sets upright; they carry through as plain words.
const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'csc', 'sec', 'cot', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'lim', 'max', 'min', 'arg',
  'det', 'dim', 'gcd', 'deg', 'inf', 'sup',
]);

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ',
};

const SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
  a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ',
  o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ',
};

const until = (s: string, fn: (t: string) => string): string => {
  for (let i = 0; i < 12; i++) {
    const next = fn(s);
    if (next === s) return s;
    s = next;
  }
  return s;
};

const script = (body: string, marker: '^' | '_', table: Record<string, string>, charset: Charset): string => {
  if (charset === 'unicode' && body.length > 0 && [...body].every(c => c in table)) {
    return [...body].map(c => table[c]).join('');
  }
  return body.length === 1 ? `${marker}${body}` : `${marker}(${body})`;
};

// Parenthesise a fraction part unless it is already an atom.
const atom = (s: string): string => (/^[\w.]+$/.test(s.trim()) ? s.trim() : `(${s.trim()})`);

/** One math span's LaTeX → readable text. Best effort; never throws. */
const texToText = (tex: string, charset: Charset): string => {
  let s = tex;

  // Sizing and line-break commands carry no meaning in plain text.
  s = s.replace(/\\(?:left|right|big|Big|bigg|Bigg)\s*/g, '');
  s = s.replace(/\\\\/g, ' ');
  s = s.replace(/\\!/g, '');
  s = s.replace(/\\[,;:]/g, ' ');
  s = s.replace(/\\(?:quad|qquad|thinspace|enspace|medspace|thickspace)\b/g, ' ');
  s = s.replace(/\\ /g, ' ');

  // Font/mode wrappers: keep the contents, drop the command.
  s = until(s, t => t.replace(
    /\\(?:text|textrm|textbf|textit|textsf|texttt|mathrm|mathbf|mathit|mathsf|mathtt|mathcal|mathbb|bm|boldsymbol|operatorname|mbox|hbox)\s*\{([^{}]*)\}/g,
    '$1'
  ));

  // Roots and fractions, innermost first.
  const sqrtSign = charset === 'unicode' ? '√' : 'sqrt';
  s = until(s, t => t.replace(/\\sqrt\s*\[([^\][]*)\]\s*\{([^{}]*)\}/g, (_m, n, x) => `${atom(x)}^(1/${n})`));
  s = until(s, t => t.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_m, x) => `${sqrtSign}(${x})`));
  s = until(s, t => t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_m, a, b) => `${atom(a)}/${atom(b)}`));

  // Named symbols and functions. Anything unrecognised keeps its bare name
  // rather than leaking a backslash.
  s = s.replace(/\\([A-Za-z]+)/g, (_m, name: string) => {
    const sym = SYMBOLS[name];
    if (sym) return charset === 'unicode' ? sym[0] : sym[1];
    if (FUNCTIONS.has(name)) return name;
    return name;
  });

  // Scripts, braced form first so `x^{10}` beats `x^1`.
  s = until(s, t => t.replace(/\^\s*\{([^{}]*)\}/g, (_m, x) => script(x, '^', SUPERSCRIPTS, charset)));
  s = s.replace(/\^\s*([A-Za-z0-9])/g, (_m, x) => script(x, '^', SUPERSCRIPTS, charset));
  s = until(s, t => t.replace(/_\s*\{([^{}]*)\}/g, (_m, x) => script(x, '_', SUBSCRIPTS, charset)));
  s = s.replace(/_\s*([A-Za-z0-9])/g, (_m, x) => script(x, '_', SUBSCRIPTS, charset));

  // Grouping braces go; escaped ones are literal characters the author wants,
  // so `$\{3\,\Omega\}$` keeps its set braces.
  s = until(s, t => t.replace(/(^|[^\\])[{}]/g, '$1'));
  s = s.replace(/\\([{}$%&#_|])/g, '$1');
  return s.replace(/[ \t]+/g, ' ').trim();
};

const render = (input: string, charset: Charset): string => {
  if (!input) return '';
  return splitMath(input)
    .map(seg => {
      if (seg.kind === 'text') return seg.value;
      const body = texToText(seg.tex, charset);
      return seg.kind === 'display' ? `\n${body}\n` : body;
    })
    .join('');
};

/**
 * Best-effort LaTeX → Unicode, for any context that truly cannot typeset:
 * `$6\,\Omega$` → `6 Ω`, `$V_x$` → `Vₓ`, `$\frac{17}{7}$` → `17/7`.
 */
export const toPlainUnicode = (input: string): string => render(input, 'unicode');

/**
 * The PDF fallback. jsPDF's standard fonts are WinAnsi-encoded: hand them a
 * character outside that set and jsPDF silently re-encodes the whole string as
 * UTF-16BE, which the standard fonts render as garbage. So this variant sticks
 * to WinAnsi — `6 Ohm`, `V_x`, `17/7` — and a final pass transliterates anything
 * that slipped through from the prose itself.
 */
export const toPdfText = (input: string): string => toWinAnsi(render(input, 'winansi'));

// Characters that fall outside Latin-1, so jsPDF's standard fonts cannot
// encode them. Keys are \u-escaped so the table survives an
// encoding-blind editor.
const WINANSI_FALLBACKS: Record<string, string> = {
  '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"',
  '\u2013': '-', '\u2014': '--', '\u2026': '...', '\u2212': '-',
  '\u2009': ' ', '\u202F': ' ', '\u2007': ' ', '\u2060': '', '\u2022': '*',
  '\u03A9': 'Ohm', '\u2126': 'Ohm', '\u03BC': '\u00B5',
  '\u2248': '~=', '\u2264': '<=', '\u2265': '>=', '\u2260': '!=',
  '\u221A': 'sqrt', '\u221E': 'inf', '\u2192': '->', '\u2190': '<-',
  '\u22C5': '\u00B7', '\u2032': "'",
};

/**
 * Replace the characters jsPDF's standard fonts cannot encode. Unmapped
 * non-Latin-1 characters are left alone rather than dropped - losing an
 * instructor's text would be worse than one odd glyph.
 */
export const toWinAnsi = (s: string): string =>
  s.replace(/[^\u0000-\u00FF]/g, c => WINANSI_FALLBACKS[c] ?? c);
