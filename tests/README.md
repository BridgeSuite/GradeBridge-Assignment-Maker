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
