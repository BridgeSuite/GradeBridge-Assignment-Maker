# Assignment Maker tests

`npm test` runs `run-tests.mjs`. Plain Node (>= 18), no test framework: it
transpiles the source with the esbuild that ships inside Vite and runs it
against the same WebCrypto the browser uses.

- **`validateCoursePublicKey()`** — the fixture key reports 2048-bit; 2048 and
  4096 pass clean; an off-contract 3072-bit key warns but is not hard-blocked;
  and every rejection path returns a message that says what is actually wrong
  (private key, PKCS#1, missing END line, empty body, non-key base64, garbage).
- **`buildAssignmentSpec()`** — with no key the serialized spec is byte-for-byte
  what it was before gb2 existed; with a key it carries the exact PEM and
  nothing else changes; an unusable key or a private key aborts the export
  rather than shipping a spec students cannot submit against.
- **Cross-app** — a spec built here is handed to the Student Submission app's
  `encryptJsonGb2()`, and the fixture private key opens the result. This is the
  check that would catch the two apps drifting apart.

- **Handwritten input mode** — the `[handwritten]` / `[handwritten:human]` media
  round-trip through `.md` export, `.md` import and `grading_rubric.json`, and a
  pre-handwritten electronic `.md` still round-trips byte-for-byte.
- **Math rendering** (§7) — the regression suite for the recurring
  `<<MATH_BLOCK_N>>` leak. Over `fixtures/EEC1_MathFixture.md` it asserts that no
  output contains a placeholder token in any form, that `.tex` keeps `$...$` /
  `$$...$$` verbatim while escaping only the surrounding prose, that
  `assignment.html` and the grader document carry real KaTeX output, no MathJax
  and **no external reference of any kind** (fonts embedded as data URIs), that
  a real jsPDF document degrades to WinAnsi-safe text with no UTF-16 strings,
  and that `.md` round-trips every math span byte-for-byte. Anything that
  touches escaping must keep this green.
- **Delimiter mirror** (§8) — `services/mathDelimiters.ts` is held byte-identical
  in the Student Submission repo. This compares the two files (SKIP if that repo
  is not checked out alongside) and greps the tree for a second copy of the
  regex. The Student app runs the same check from its side, in
  `tests/math-delimiter-tests.mjs`.
- **Figures** (§11) — over `fixtures/ENG17_FigureFixture.md`. The split is exact
  (every form reassembles byte-for-byte); a ` ```svg ` block never reaches
  `splitMath`, so a `$` in the drawing's own text is not read as a delimiter
  while math beside it still renders; the block survives the parser's line
  filters (a `#` CSS selector, a wrapped attribute, a `>`-leading line); import →
  export is byte-identical for none / inline-svg / shared-figure; each inlined
  copy gets its own id namespace; `.tex` and a rasteriser-less `.pdf` degrade to
  `[figure: ...]` and never to raw SVG; the rubric carries `problem_statement`
  only when the problem has a stem; and a figure-free description is still
  reserved by character count alone. `services/figureBlocks.ts` is
  mirrored like the delimiter file, checked from both sides
  (`tests/figure-tests.mjs` in the Student app).

## `tests/templateTests.mjs`

The **spec 8.7 self-test** for the GradeBridge page-format QR template, all eight
checks. Spec: `GradeBridge2026/QR Format Page/GradeBridge_Page_Format_v1.md`.

Checks 1–7 go through `services/templateSelfTest.ts` — the same code that gates
every generation in the app, so this suite and the running app cannot disagree
about what compliant means.

Check 8 ("render the PDF and run the real detector over it") needs pixels, so it
lives here:

- **The QR.** Each page's symbol is rasterised at the canonical 300 dpi and
  decoded with **jsQR**, a real decoder. It reports the symbol's own mode and
  version, so check 6 is *verified* rather than asserted — alphanumeric mode at
  version 4, decoded `k` and `N` correct, decoded `layout_id` matching the map.
- **The marks.** The spec 3.2 detector, implemented as written: a 30 mm window on
  each nominal centre, area 0.5x–2.0x, fill ratio ≥ 0.85 counted in **pixels**
  (the spec is explicit that contour area nearly admits a QR finder pattern as a
  false fiducial), aspect 0.80–1.25, 4 of 4, each centroid within 1.0 mm.

That raster is built from the same constants the PDF is drawn from, so it proves
the geometry decodes and detects — but a jsPDF drawing bug would slip past it.
So the **PDF's own content stream** is parsed too, and its `re` operators checked
back against those constants: four 5 mm squares per page at the Appendix A
positions, a printed white quiet-zone field per page, every QR module inside the
declared symbol rectangle, and exactly one text line per page in the identity
band at the spec 8.4 anchor. Between the two halves, both "is the geometry right"
and "did it reach the paper" are covered.

There is a **third** layer, added by the 2026-08-15 correction. Checks 1–7 look
at the layout; the ink is not the layout. A prompt row can sit at a perfectly
legal y while its right-aligned points label overruns into the QR's column —
which is exactly what shipped, and what the layout could not see. So the
generator records every box it puts ink in and, after drawing and before handing
back the blob, asserts none of them touch the QR keep-out, the identity band, or
the outside of the writing column. This suite then re-checks that ink against the
keep-out, and decodes each QR **with every ink box on its page filled black over
the symbol** — level H recovers 30%, so "it looks fine" is not evidence.

That guard is mutation-tested: putting `FIRST_PROMPT_TOP_MM` back to its pre-fix
value makes the generator refuse to emit at all, naming the offender
(`page 2 points label at x 182.5–192.9, y 32.0–35.8 mm`).

The rest of the suite covers the parts a spec cannot check for you: part-id
numbering, the `layout_id` stale-map guard actually changing when a rectangle
moves, the `.md` round trip of the `**Template ID:**` and `> template:` keys, no
identity field or em-dash reaching the page, and Appendix C — that none of the
exam generator's choices leaked into a homework template.

**Authored answer space** (2026-08-17) is checked here too, since it is the whole
sizing model: the authored line count is what is reserved, what is ruled and what
the map crops; points influence nothing; parts pack down a page and then break
rather than being squeezed; a part whose answer exceeds a page continues with an
`x2` region and no line is lost across the break; long prose is reserved in full
and never scaled, with the one remaining clamp (prose that cannot fit a page at
all) reported to the author. A text region is ruled at `WRITING_LINE_MM` and a
sketch region is left blank. The prompt row carries no injected "write your answer
below this line" — the PDF's own text operators are searched for all three retired
sentences.

**A stem's prose never shares a raster with its figure.** The two used to go into
one scale-to-fit canvas, so a drawing over its `FIGURE_LINES` allotment scaled the
prose down with it and the stem printed smaller than its own sub-parts. The suite
generates a stem carrying an inline SVG and asserts there are two ink entries, not
one — `problem text N` and `figure in problem text N` — that the prose starts at the
top of the stem block and stops before the figure, that the prose's box never
includes any of the figure's allotment, and that a figure-free stem is still drawn
as a single raster with no figure block at all.

**Nothing is boxed** (page-format §4.1). The suite scans the PDF's `re`
operators for a rectangle matching any declared region and asserts there is none,
then ties the drawn writing area to the cropped one the way that survives without
a frame: every ruled line falls inside the declared rectangle. It also reads the
page-1 instruction back out of the PDF and asserts it says "write on the ruled
lines" and that the word "box" is printed nowhere — the questions themselves ask
students to box their final answer, so the sheet must not spend that word.

`> template:` parsing is compared **against `converter/convert.py`** over
`fixtures/ENG17_AnswerSpaceFixture.md`, which covers `lines=N`, an absent
directive, `lines` with `sketch`, and a legacy `space=full`. The check runs the
real converter in a temp directory (SKIP if no Python is on PATH) — the two
parsers are only ever right together.

One thing this suite **cannot** check: Node has no DOM, so the KaTeX rasteriser
is unavailable and the generator falls back to WinAnsi-safe vector text. The test
asserts that fallback is safe (no UTF-16BE strings, no raw LaTeX); the glyph path
itself was verified in Chrome — see "UI verification" below.

## `tests/bundle-tests.mjs`

`npm test` then runs a real `vite build` into a temp directory and inspects the
output. It exists because of a specific miss: `services/katexFonts.ts` first
used Vite's built-in `?inline`, which inlines in dev but in a production build
emits a hashed `.woff2` and hands back its URL. Every other test stayed green
while the shipped HTML quietly went back to fetching fonts. It checks the fonts
are a lazy chunk (not in the entry bundle), that all 20 faces are really
embedded, and that no MathJax or KaTeX CDN reference survives anywhere.

`exportService.ts` imports jspdf / jszip / file-saver at module scope. The main
load stubs all three; the math suite loads it a second time with a real jsPDF
(which does run under Node) so it can inspect an actual PDF, stubbing only
file-saver. The runner also teaches esbuild the `?raw` import that
`mathRender.ts` uses to inline KaTeX's stylesheet.

The PDF's math **rasteriser** needs a browser and so is not covered here — Node
exercises the plain-text fallback. It was verified in Chrome against the same
fixture (see "UI verification" below).

## The fixture

Tests need `gb2_test_fixture.json` — a throwaway 2048-bit keypair plus a
known-good SPKI PEM.

It is **not committed**: it contains a private key, test-only or not, and this
repo is public. Default lookup is `../Encryption/gb2_test_fixture.json`
relative to the repo root; override with `GB2_FIXTURE`:

```bash
GB2_FIXTURE=/path/to/gb2_test_fixture.json npm test
```

Without it the suite still runs every fixture-independent check using ephemeral
keypairs and reports the rest as SKIPPED. The cross-app check additionally
needs `GradeBridge-Student-Submission` checked out alongside this repo.

**Never add a private key to this repo.** This app handles public keys only —
it neither generates keypairs nor accepts a private one.

## UI verification

The paste field itself was exercised in the running app on 2026-08-10 (Chrome,
`npm run dev`): the fixture key shows "Valid RSA public key (2048-bit) —
exported specs will carry it"; a private key, a PKCS#1 key, garbage, and a
truncated paste each show their specific error; an empty box reports the gb1
default. The key saves to localStorage, survives a reload into the editor, and
re-validates on load without needing another blur.

Math rendering was exercised on 2026-08-15 (Chrome, `npm run dev`) by importing
`fixtures/EEC1_MathFixture.md` and generating every output:

- `assignment.pdf` / `template.pdf` — fractions, roots, sub/superscripts, Greek
  and the display equation all typeset correctly; escaped set braces survive;
  the answer-region box still fills the page. Both PDFs in ~0.7 s.
- `assignment.html` — renders offline-correct with the inlined KaTeX stylesheet;
  prose escapes (`_`, `&`, `#`, `\`) intact.
- `assignment.tex` — compiled with `pdflatex` (TeX Live 2025): no errors, no
  placeholder token, no `«»` guillemets, all math typeset natively.

The QR template was exercised on 2026-08-15 (Chrome, `npm run dev`) from
`fixtures/EEC130B_Handwritten_HW3.md` — 5 parts over 3 pages, generated in 37 ms:

- All three pages carry four corner marks and the QR; the header line reads
  "GradeBridge {id} page k of N" and is the **only** text above y = 25 mm on any
  page (checked by reading the PDF's own text operators, not by eye).
- The page-1 furniture — title, name/ID/date line, print instruction — sits at
  y = 30.1, 35.2 and 39.7 mm, all below the band.
- The sidecar's first region starts at y = 50.0 mm on page 1 (under the
  furniture) and 38.0 mm on pages 2–3 (clear of the QR keep-out at 37 mm).
- The sketch part is the only row with `is_drawing = 1`.
- Exporting the ZIP adds `{id}_qr_template.pdf` and `layout_{id}.csv`; an
  electronic assignment's ZIP is unchanged.

Re-verified after the 2026-08-15 correction, same fixture now carrying Greek in
the prompts (`Skin depth $\delta_s$`, `Attenuation constant $\alpha$`, the
`$TE_{10}$` mode, `$\Gamma$`): four pages, 2/1/1/1 regions, generated in ~0.6 s.
δₛ, σ, μᵣ, α, β, λ_g and `f_c = c/(2a)` all print as glyphs. No identity field, no
em-dash, no UTF-16 string, no ink in the QR keep-out — points labels sit at
y = 38/44/156 mm against a keep-out ending at 37.
