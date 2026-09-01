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
  reserved by character count alone.

  The **grader's** copy of the stem is checked separately: it carries each figure
  as its `<title>`/`<desc>` words and no `<svg>`/`<path>` at all, the prose around
  it is untouched, and the payload no longer grows with the drawing — doubling the
  path count leaves `problem_statement` identical. All three fallback rungs are
  exercised (desc, title-only, neither), along with the alt text of the image form.
  Student-facing output is asserted unchanged in the same check: the HTML still
  inlines the real SVG and the `.md` round trip still carries it.

  `services/figureBlocks.ts` is
  mirrored like the delimiter file, checked from both sides
  (`tests/figure-tests.mjs` in the Student app).

- **The authoring backup restores everything** (§13, 2026-08-31) — the round
  trip that is the whole point of the file. A fixture carrying **every field the
  type allows** goes out through `buildAuthoringBackup` and back through
  `readAuthoringBackup`, and must come back deep-equal. The fixture is not
  trusted to be complete on its own: a second check reads `types.ts` and asserts
  the fixture exercises every field `Assignment` and `Subsection` declare, so a
  field added later cannot slip past by being one nobody remembered to add to
  the fixture. A third drives the failure deliberately — drop a field from the
  serialised form and the deep-equality check must catch it.

  It also holds the two consequences that make the file worth having:
  `targetPoints` survives (the `.md` route loses it, and the damage is delayed a
  cycle — the reimport looks right and the *next* export halves every point) and
  `coursePublicKey` survives (losing it silently reverts gb2 to gb1). And the
  import warning is checked against a **real** student spec rather than a guess:
  it must name the prompts, the grader notes, the answer-space settings and the
  point target — and must **not** claim the course key is lost, because the
  whitelist carries it. A warning that overstates gets ignored.

- **The ZIP is split, and its notice cannot drift** (§13) — every entry is under
  `student/` or `instructor/` bar the notice at the root; `student/` holds only
  the PDF, the spec and (handwritten) the layout map, which must sit beside the
  PDF it travels with; the backup and the `.md` are in `instructor/`, and the
  backup is asserted **not** to be the file the Submission app loads. The notice
  is generated from the entry list, so the suite checks it names no file that is
  absent, names all four answer-bearing files, and never tells the instructor to
  hand out one of them. `template.pdf` is asserted instructor-side: it sets up
  the Gradescope outline, which is not a student task.

- **The student spec carries no answer key** (§12, 2026-08-31) — the guard that
  matters most in the suite. It takes a real export, decrypts `assignment_spec.json`
  the way a student's browser does, and asserts it holds **no grading prompt, no
  grader note and no grading configuration** — by key *and* by text, since the
  fixture's prompt and grader note both contain sentences a student must not see
  (one of them an answer value). This is the check that would have caught 17 of 17
  ENG17 HW1 grading prompts, `REFERENCE:` lines and worked answers included,
  sitting in the student's copy.

  The second half asserts the spec's **field set is exactly the whitelist** at
  every level — assignment, problem, sub-part — in both directions: nothing
  outside it, and everything the student app needs present. A blacklist is how
  `aiGradingPrompt` got in, so adding a field to `Assignment` now fails this test
  until someone decides deliberately. A third check compares
  `STUDENT_SPEC_FIELDS` against `GradeBridge-Student-Submission/types.ts`, which
  is where "what the student app reads" is actually defined (SKIP if that repo is
  not checked out alongside). Mutation-tested: reverting to a spread of the whole
  object fails three checks; quietly adding `aiGradingPrompt` to the whitelist
  fails one.

- **The export contract** (§12, 2026-08-31) — the guard that makes the spec
  sentence real rather than advice. **No exported artifact carries a model name,
  a temperature or a token budget**: the rubric JSON, the decrypted spec JSON and
  the layout CSV are all scanned, over what `buildExportEntries()` actually
  writes rather than a hand-built object. It scans **keys**, not raw text —
  engineering prose says "temperature" and "model" constantly, and a substring
  scan would cry wolf on every thermal problem ever set, which is how a guard
  gets deleted; a model *identifier* (`claude-…`) is scanned as text, since that
  shape does not occur in prose. The fixture's own prose says both words on
  purpose. Mutation-tested: putting `ai_grading_config` back fails two checks.

  The second half covers **`answer_modality`**, which is *optional*: a written
  answer declares `"text"`, a `sketch` declares `"figure"`, and an `[image]` or
  `[text+image]` part declares **nothing**, because the app does not know — a
  wrong value in a routing field is worse than a missing one precisely because it
  does not prompt anyone to ask. That asymmetry is asserted directly (hardcoding
  `'text'` for every part fails). The reserved `"hybrid"` is never emitted, every
  part of a handwritten assignment carries the field, and it **agrees with
  `is_drawing`** in the layout map for every region — the two are
  deliberately duplicated so no consumer has to join two files to learn one fact,
  which only holds if they cannot drift. Both values have to appear or the check
  proves nothing. Also mutation-tested, in both directions (hardcode the value,
  and drop the field).

  Acceptance is covered too: a pre-change spec carrying `aiGradingConfig` loads,
  says nothing about it, and does not carry it back out; and the `.md` round trip
  is still byte-stable, since the markdown format never carried any of this.

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
rather than being squeezed; long prose is reserved in full and never scaled, with
the one remaining clamp (prose that cannot fit a page at all) reported to the
author. A text region is ruled at `WRITING_LINE_MM` and a sketch region is left
blank. The prompt row carries no injected "write your answer below this line" —
the PDF's own text operators are searched for all three retired sentences.

**The instructions page** (2026-09-01). Page 1 of a handwritten sheet carries the
standing instructions and the preamble and nothing else, **by design** — it used
to be emergent, and the suite now holds the four properties that makes it. Page 1
carries no region and no row in the map, so nothing on it is ever cropped; `N`
counts it and the page-1 QR decodes `k=1`; the standing instructions are drawn on
page 1 and nowhere else, each sanctioned sentence appearing exactly once; and an
instructions page that overflows **refuses** the export and says by how many
millimetres.

The fourth is the one with history: **the tool refuses a preamble that repeats a
standing instruction**, matched on normalised six-word windows rather than exact
strings, because "almost word for word" is the shape the failure took when ENG17's
first preamble draft reproduced the print instruction. The suite drives a
near-miss paraphrase and asserts the failure names the duplicated sentence, and
drives an on-topic preamble to assert it is left alone — a check that fires on
ordinary authoring would be turned off within a week.

Mutation-tested: letting problems back onto page 1 makes generation refuse
outright (naming every region it placed there), and making the overflow
unreportable fails guard 4. Electronic assignments are asserted to get neither an
instructions page nor the standing instructions.

**A region is never shorter than its authored line count** (2026-08-31). The
regression fixture that did not exist, which is why a three-line reduction on
page 1 of ENG17 HW1 survived two rounds of review: every older fixture has an
empty problem stem, and the stem is what triggers the bug. The suite now drives a
problem whose shared setup is long enough that a 14-line answer cannot also fit
beneath it, and asserts the part still gets its 14 lines — by the setup being
printed on a page of its own, with the part following under a `(continued)`
heading. A shorter stem, where a clean page holds both, must **not** strand the
setup: the givens belong directly above the question whenever they can be, and a
stranded setup costs a whole sheet. A part that fits nowhere still takes its page
rather than burning a blank one first.

The guard itself is a numbered self-test check, so it **refuses** rather than
warns, and that is asserted through the real generator. Mutation-tested: putting
`Math.min(wanted, fits)` back fails four checks, one of them by
`generateTemplate` throwing and naming the part and the shortfall. A second check
holds the dichotomy that stops the reduction returning by another route — every
region is either exactly its authored height or grown to the bottom cap, and
there is no third outcome.

**No split answers, and no unclaimed paper** (2026-08-18). A part is placed
exactly once: no `part_id` owns two regions, in any shape of assignment, and a
part whose authored lines outgrow an empty page takes the page rather than
spilling a one-line orphan onto the next. What used to be checked as "continues
with an `x2` region and loses no line" is now checked as its opposite. Against
that, the **last region on every page runs to the bottom margin**: the suite
asserts it ends within one `WRITING_LINE_MM` pitch of the margin, that its
declared rectangle still passes the 262 mm bottom limit, and that growing it kept
`y1 = y0 + n x pitch` — the identity that puts the last rule on the rectangle's
own edge. Because that region is deliberately larger than its authored size, the
authored-size checks now exempt it and assert it exactly for every other region.

**The column check is bound to the column it is named after.** It used to test
against `REGION_X_MAX_MM` (203.9) while content is drawn to `COLUMN_X1_MM`
(192.9), so a printed row could stand 11 mm out into the right margin and pass —
which is why the unwrapped heading below did not trip it until it was 13 mm past
the column. The bound is now 23.0 / 192.9 with 0.25 mm of tolerance, and the
suite mutation-tests it: an ink box reaching x = 195 mm — inside the old bound,
outside the new one — must produce exactly one failure, naming the row. The real
template's widest legitimate ink lands exactly on 192.9 (the region top rule
spans the full column), which is what the tolerance is for; the header line keeps
its exemption at x = 20.0.

**The problem heading is wrapped, and can never refuse an export.** It was the
one printed row drawn as a single unwrapped, untruncated line, and two ENG17 HW4
titles ran out of the writing column once ` (continued)` was appended — the ink
check then refused the whole export. The suite drives a 97-character title, and
the HW4 `(continued)` shape itself, and asserts every drawn heading line stays
inside `COLUMN_X1_MM` and that the reservation covers the lines drawn. A title
past `MAX_HEADING_LINES` is asserted to **ellipsise** (plain ASCII "...", read
back out of the PDF's own text operators) rather than throw: losing the tail of an
absurd title is a visible degradation, a refused export is not.

**A stem's prose never shares a raster with its figure.** The two used to go into
one scale-to-fit canvas, so a drawing over its `FIGURE_LINES` allotment scaled the
prose down with it and the stem printed smaller than its own sub-parts. The suite
generates a stem carrying an inline SVG and asserts there are two ink entries, not
one — `problem text N` and `figure in problem text N` — that the prose starts at the
top of the stem block and stops before the figure, that the prose's box never
includes any of the figure's allotment, and that a figure-free stem is still drawn
as a single raster with no figure block at all.

**Authored text is never scaled.** The property is checked on the page, not in
the source: every authored-text ink box measures a whole number of `DESC_LINE_MM`
line-heights, which a scaled raster cannot. A stem and a description in the same
document must both come out on that grid. The other half is asserted too — a
question longer than a page makes the generator **refuse to emit**, with a message
naming the part and saying to split the problem, rather than shrinking it.

The reservation behind that is calibrated against the render font rather than
assumed: a check measures real ENG17-shaped question text with jsPDF's Times
metrics and asserts `estimateDescLines` is **≥** the real wrap. If the estimator
ever drifts from the renderer, that check goes red before a stem overruns its box.

**The ruling** is read back out of the PDF's own graphics operators: interior
writing lines dashed at 0.5 pt / 0.75 grey, the dash set after the solid border
and reset afterwards so nothing else inherits it, and the pitch exactly
`WRITING_LINE_MM`.

**Every answer region is boxed** (2026-08-31; page-format §4.1 and §8.5 carry the
amendment that reversed the old "nothing is boxed" rule). The suite scans the
PDF's `re` operators and asserts **exactly one** stroke-only rectangle per
gradeable part, at the border's own path — inset half a stroke from the column so
the ink lands inside it — and that the retired 0.3 mm top rule is not drawn as
well. It asserts the declared rectangle is the box **interior**, one border stroke
in on every side, and that no recorded border edge falls inside any declared
rectangle: what is cropped never contains the frame. It checks every box is the
full option-C width (12.0–203.9), no box is under the 28 mm floor, and every box
closes at or above y 257.0, clear of the bottom registration corners. It reads the
page-1 instruction back out of the PDF and asserts it now **names** the box — and
still never tells a student to draw one, because a hand-drawn rectangle is another
candidate for a rectangle detector; if a final-answer mark is ever wanted it is a
circle.

**Nothing prints in colour, and nothing but its own rules is printed inside a
box.** A figure declaring a non-grey `fill` or `stroke` refuses the export (greys
and `#ffffff` do not — all thirty ENG17 figures are `#111111` on white). Ink
landing inside a declared rectangle refuses it too, which is the case the
collision check cannot see: the ruled band starts a full pitch below the box's top
edge, so a question that overran into the top of the box beneath it would slip
past. Both checks are exercised with a deliberate offender and asserted to name it.

**The `re`-operator suite cannot run a real detector** — that needs pixels and
OpenCV, which are not `npm test` dependencies. The blank-sheet detector run
(`EEC100_Final_Format_Spec` §8 check 6) was done out of band against the five real
ENG17 homeworks; the numbers are in
`docs/session/COMPLETION_AM_ANSWER_BOX_2026-08-31.md`.

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
