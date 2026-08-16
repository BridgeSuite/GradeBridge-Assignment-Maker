# GradeBridge assignment markdown format

**What this is:** the reference for the `.md` format the Assignment Maker reads with **Import Markdown** and writes with **Export .md**. If you draft an assignment as markdown to import, follow this.

**Source of truth:** this document is derived from, and must stay in lockstep with, `services/mdParserService.ts` (import) and `services/exportService.ts` (export) in this repo, and their Python port `converter/convert.py`. If the code and this file disagree, the code wins, and this file is the bug. Last synced to the format as of 2026-08-15 (QR page-format templates).

---

## 1. File shape at a glance

```markdown
# EEC130A: Homework 3

**Input:** handwritten
**Preamble:** Work each problem on a fresh sheet of paper.

## Problem 1: TE10 Mode in a Rectangular Waveguide
An air-filled WR-90 guide, a = 2.29 cm, b = 1.02 cm.

### (a) Cutoff frequency [12 pts] [handwritten]
Determine the cutoff frequency of the TE10 mode.
> grading_prompt: Award full marks for correct use of f_c = c/(2a). Accept 6.55 GHz +/- 2%.

### (b) Field sketch [8 pts] [handwritten:human]
Sketch the transverse E-field and justify the maximum.
> grader_note: Look for a single half-sine across the wide dimension, max at center.
```

---

## 2. Metadata (top of file)

| Line | Required | Meaning |
|---|---|---|
| `# {COURSE}: {TITLE}` | **yes** | Course code and assignment title. Exactly one, first. Format: `# EEC130A: Homework 3`. |
| `**Input:** handwritten` | no | Marks the whole assignment as handwritten. Any other value, or the line being absent, means **electronic**. Emitted by Export only for handwritten assignments, so older electronic files have no such line. |
| `**Template ID:** {ID}` | no | Handwritten only. Goes in the printed QR as the layout key (`[A-Z0-9]{1,12}`, unique across the course). Emitted only when the author pinned one; absent means it is derived from the course code and title. |
| `**Preamble:** {text}` | no | Instructions shown to the student. Single line. |
| `**Due:** {anything}` | no | **Ignored on import** — due dates are managed in Canvas. Safe to include or omit. |

`inputMode` governs which mediums are valid (see §5): a `handwritten` assignment should use only `[handwritten]` / `[handwritten:human]` sub-parts; an `electronic` assignment should use everything except those.

---

## 3. Problems

Two accepted forms.

**Standard (a problem with lettered sub-parts):**
```markdown
## Problem 2: Terminated Transmission Line
A lossless 50-ohm line terminated in Z_L = 75 + j25 ohm.

### (a) Reflection coefficient [15 pts] [ai-graded:short]
...
### (b) VSWR [10 pts] [text]
...
```
- Header: `## Problem {N}: {Title}` (the number is for humans; sub-parts are ordered by appearance).
- Any text between the problem header and the first `### (...)` is the **problem description**.

**Flat (a problem that is itself a single sub-part):** put the points and type tag on the problem header.
```markdown
## Problem 3: Short reflection [10 pts] [ai-graded:formative]
Describe one thing that surprised you in lab.
> grading_prompt: Full credit for any genuine, on-topic reflection of 2+ sentences.
```
This auto-promotes to a single sub-part `(a)` with the problem's body as its description.

---

## 4. Sub-parts

```
### ({letter}) {name} [{points} pts] [{type}]
```
- `{letter}` — `a`, `b`, `c`, ... in lowercase parentheses.
- `{name}` — the sub-part title.
- `{points}` — a whole number, written `[12 pts]` (`pt` also accepted).
- `{type}` — one type tag from §5. **The `[... pts]` and `[type]` brackets are both required** on a sub-part header.
- Any non-blockquote text on the following lines is the sub-part **description**.

An unrecognised type tag falls back to `text`.

---

## 5. Type tags

| Tag | Medium | Graded how |
|---|---|---|
| `text` | Typed text (shown in the app as **Electronic text**) | Human |
| `image` | One image upload | Human |
| `image:N` | Up to **N** image uploads | Human |
| `text+image` | Typed text plus one image | Human (text), image reviewed alongside |
| `text+image:N` | Typed text plus up to **N** images | Human |
| `ai-graded:binary` | Typed text, ~20–40 words | AI first pass |
| `ai-graded:short` | Typed text, ~50–100 words | AI first pass |
| `ai-graded:medium` | Typed text, ~100–150 words | AI first pass |
| `ai-graded:long` | Typed text, ~150–250 words | AI first pass |
| `ai-graded:formative` | Typed text, feedback-oriented | AI first pass |
| `handwritten` | Handwritten answer (photographed, transcribed) | AI first pass (OCR then grade) |
| `handwritten:human` | Handwritten answer | Human (TA grades from the crop, no OCR) |

Notes:
- **Handwritten sub-parts take no image count.** Pages are an assignment-level pool, not a per-part count, so `handwritten:3` is not a thing — use `[handwritten]` or `[handwritten:human]`.
- The word-count ranges for the `ai-graded:*` tiers are suggestions surfaced in the UI, not enforced.

---

## 6. Math notation

Descriptions and other rendered text support LaTeX via KaTeX. **One module — `services/mathRender.ts`
— owns every conversion**, and the delimiters themselves live in `services/mathDelimiters.ts`, which
is **mirrored byte-for-byte into the Student Submission app**. The preview, `assignment.html`, the
grader document, `assignment.tex`, `assignment.pdf` and the student's screen all go through it, so
math cannot render differently in one place than another.

- Inline: `$...$`. Display: `$$...$$`.
- Single-dollar inline is supported because the app splits with its own regex
  (`/(\$\$[\s\S]+?\$\$|\$[^\$]+?\$)/g`, `splitMath()`) and calls `katex.renderToString`, rather than
  using KaTeX auto-render.
- Every `$` must be paired, an inline span may not contain a `$`, and a literal dollar in prose is
  mis-parsed. Invalid LaTeX is never dropped silently: KaTeX flags the offending part inline
  (`throwOnError: false`), and the raw text is shown with its delimiters only if rendering fails
  outright.
- The Student Submission app imports the **same file** (`services/mathDelimiters.ts`), so authored
  math displays identically to the student. Edit one copy, copy it to the other; both repos' `npm
  test` fails if they diverge.

What each output does with a math span:

| Output | Handling |
|---|---|
| App preview | `katex.renderToString` (bundled KaTeX, no CDN) |
| `assignment.html`, grader document | Same call, at export time. KaTeX's stylesheet **and all 20 glyph fonts** are embedded, so the file needs no network at all — it costs ~360 KB and opens correctly offline. No MathJax, nothing async. |
| `assignment.tex` | Prose is escaped, math is emitted **verbatim** so pdflatex typesets it natively |
| `assignment.pdf` | The KaTeX HTML is rasterised through an SVG `<foreignObject>` and placed as an image; blocks with no math stay vector text. If rasterising is unavailable the block degrades to readable plain text (`6 Ohm`, `V_x`, `17/7`) — never a placeholder token. |

Use LaTeX for structured math (subscripts, fractions, exponentials, Greek, units); plain text is
fine for a bare symbol.

`npm test` includes a math regression suite (`tests/run-tests.mjs` §7) over
`tests/fixtures/EEC1_MathFixture.md`, a mirror check against the Student Submission repo (§8), and
`tests/bundle-tests.mjs`, which builds for real and checks the fonts actually landed in the bundle.
Anything that touches escaping, the delimiters, or the asset pipeline must keep all three green.

---

## 7. Grading instructions (blockquotes)

Attach grading guidance to a sub-part with a blockquote **immediately under** it. Two keys, and which one you use depends on how the sub-part is graded:

| Key | Use it for | Purpose |
|---|---|---|
| `> grading_prompt:` | the `ai-graded:*` tiers **and** `handwritten` (AI) | The rubric/prompt the AI grades against. |
| `> grader_note:` | `text`, `image`, `text+image`, and `handwritten:human` | The human grader's reference: expected answer / what to look for. Never shown to students. |

Wrap long guidance across multiple lines by starting each continuation line with `>`; the lines are joined into one value:
```markdown
> grading_prompt: Required elements: (1) correct use of f_c = c/(2a);
> (2) numeric answer within 2%; (3) units stated.
```

A `handwritten` (AI) sub-part should carry a `> grading_prompt:`; a `handwritten:human` sub-part should carry a `> grader_note:`.

A third key configures the **printed QR template** (§10) and is handwritten-only:

| Key | Purpose |
|---|---|
| `> template: space={half\|full}, sketch` | Whether this part shares its template page with one other (`half`, the default) or takes a page to itself (`full`), and whether it is a sketch. Both parts are optional and order does not matter — `> template: sketch` alone is valid. |

Omit the line and the part shares a page, which is what every assignment written before templates existed does. A sketch always takes a full page. The older `space=short|medium|tall|xtall` values still import — `xtall` reads as `full`, the rest as `half`.

```markdown
### (b) Field sketch [25 pts] [handwritten:human]
Sketch the transverse field pattern.

> template: sketch

> grader_note: Look for arrows normal to the walls.
```

---

## 8. Round-trip and points

- **Export .md → Import Markdown is stable**: importing an exported file and re-exporting yields the same file. A legacy electronic file that has no `**Input:**` line round-trips unchanged.
- On export, sub-part points are **normalised** to the assignment's target total (default 100), so the numbers you write are relative weights; the exported file shows the scaled values.

---

## 9. Two complete examples

**Electronic assignment (mixed mediums):**
```markdown
# EEC1: Lab 4 Prelab

**Preamble:** Answer in your own words; show any circuit sketches.

## Problem 1: Node analysis
### (a) Write the node equations [20 pts] [ai-graded:medium]
State the KCL equations at nodes A and B.
> grading_prompt: Full marks for correct KCL at both nodes with consistent sign convention.

### (b) Photograph your breadboard [10 pts] [image]
> grader_note: Confirm the divider is wired as specified; no grading of values.
```

**Handwritten assignment:**
```markdown
# EEC130A: Homework 3

**Input:** handwritten

## Problem 1: Rectangular waveguide
### (a) Cutoff frequency [12 pts] [handwritten]
Determine the cutoff frequency of the TE10 mode.
> grading_prompt: Correct use of f_c = c/(2a); answer 6.55 GHz within 2%.

### (b) Field sketch and justification [8 pts] [handwritten:human]
> grader_note: One half-sine across the wide dimension, maximum at the center.
```

---

## 10. Handwritten templates (QR page format)

For a handwritten assignment, **the page-format sheet is the assignment**. Export ZIP puts it in as `assignment.pdf` — there is no separate template to go and find, and no second PDF to pick between:

| File in the ZIP | Handwritten | Electronic |
|---|---|---|
| `assignment.pdf` | **The page-format sheet**: four corner marks, the QR, the question text and one ruled answer area per part, on every page. Print this. | The usual assignment paper. |
| `layout_{TemplateID}.csv` | The sidecar map the Submission app crops by. Its content hash is written into every page's QR. | — |
| `template.pdf` | — *(not exported: the sheet above already is the answer surface, and a second boxed one only invites printing the wrong PDF)* | The boxed answer-region sheet, for the Gradescope outline. |

`assignment_spec.json`, `assignment.html`, `assignment.tex`, the grading rubric and the grader document are unchanged in both modes.

The editor's **QR Template** button emits the same sheet plus its map as a standalone ZIP, for regenerating after a layout edit without rebuilding the whole export.

**The PDF and the map must travel together.** The PDF is useless without the map its QR hashes to, and the Submission app refuses to crop when the hash does not match — which is the point: a stale map would otherwise register perfectly and cut the wrong rectangles with no error anywhere.

The geometry is not ours to choose. It is fixed by `GradeBridge2026/QR Format Page/GradeBridge_Page_Format_v1.md`, transcribed into `services/pageFormat.ts`, and enforced by the spec 8.7 self-test that runs on every generation — a template that fails any check is not emitted at all.

### What the printed sheet holds

**The sheet is the whole assignment.** A student prints it, reads it, writes on it and photographs it — there is no companion document, so everything they need to answer is on the paper:

| Where | What |
|---|---|
| Top 25 mm, every page | The QR, the four corner marks, one header line. Nothing else, ever. |
| Page 1, under the band | Course and title, the print instruction, then the assignment **preamble**. |
| Above each problem's first part | `Problem 2: Rectangular waveguide` and the problem's **shared setup text**. On a later page the heading repeats as `(continued)`; the setup does not. |
| Each region | `1(a).`, the sub-part title, the points, the **question text**, a rule, then blank writing space. |

Prompt, problem and question text all go through the same KaTeX renderer as the other exports, so `$\delta_s$` and a bare `ω` print as glyphs rather than being garbled by jsPDF's Latin-1 fonts.

Prose competes with writing space, and prose can be arbitrarily long. When a page cannot hold both, **the prose is squeezed first** — down to a single line per block if it comes to that — so a writing area never falls below 22 mm and never runs past the bottom of the page. The rendered text is scaled into whatever box survives, so nothing is silently cut off.

Those reservations are estimated from character count rather than measured. The map is hashed into every page's QR, so a millimetre of difference between a browser and a test would change `layout_id` and make the template refuse to crop.

**There is no name, student ID or date field, deliberately.** Identity comes from Gradescope authenticating the upload, so a blank for it is redundant; students are told not to write their name on the pages, so a labelled blank is a mixed message; a filled-in name is exactly the PII the band gate exists to keep out; and grading is meant to be blind to identity. Appendix C of the page-format spec says the same — because the app authenticates the student, there is no identity page.

### How much room a part gets

**At most two answer regions per page**, set by rule rather than derived from points:

| Setting | Effect |
|---|---|
| `half` (default) | Shares the page with one other part. The two split the usable height by points, bounded so neither drops below 35%. |
| `full` | The part takes a page to itself. |
| a sketch | Always `full`. |

Points influence the split within a shared page but never the page count, which is what keeps the sheets predictable.

### Two more things to know

- **The QR is the same on every copy.** One class-wide master, no per-student code; the app identifies the student from their login, not from the paper.
- **Nothing printed may enter the QR's keep-out**, so the first prompt row on every page starts below it. The generator checks the ink it actually laid down, not just the layout, and refuses to emit a template where anything overlaps the symbol — text over the modules can stop it decoding, and the QR is the whole registration mechanism.
