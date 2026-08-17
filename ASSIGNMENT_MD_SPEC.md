# GradeBridge assignment markdown format

**What this is:** the reference for the `.md` format the Assignment Maker reads with **Import Markdown** and writes with **Export .md**. If you draft an assignment as markdown to import, follow this.

**Source of truth:** this document is derived from, and must stay in lockstep with, `services/mdParserService.ts` (import) and `services/exportService.ts` (export) in this repo, and their Python port `converter/convert.py`. If the code and this file disagree, the code wins, and this file is the bug. Last synced to the format as of 2026-08-17 (figures in the problem stem — §11; authored answer space, `> template: lines=N` — §7, §10).

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
| `**AI Feedback:** on` | no | Whether students may request AI feedback on any problem in this assignment. `on` or `off`; absent means **off**. Emitted by Export only when on, so older files stay byte-identical. |
| `**Preamble:** {text}` | no | Instructions shown to the student. Single line. |
| `**Due:** {anything}` | no | **Ignored on import** — due dates are managed in Canvas. Safe to include or omit. |

`inputMode` governs which mediums are valid (see §5): a `handwritten` assignment should use only `[handwritten]` / `[handwritten:human]` sub-parts; an `electronic` assignment should use everything except those.

`**AI Feedback:** on` allows students to request the one-time, gradeless AI feedback on any problem in
this assignment; `off` or an absent line disables it. It gates the student-facing feedback only, not
grading, which is governed by the sub-part type tags. The feedback itself, the per-problem one-time
election, and the tally are handled downstream in Gradescope, not by the Assignment Maker or the
Student app; this line only records the instructor's choice and carries it into the exported spec.

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
- Any text between the problem header and the first `### (...)` is the **problem description** — the problem *stem*. A **figure** belongs here (§11).

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
- **Figures are lifted out before the splitter runs** (§11). An SVG that reached `splitMath` would be
  shredded by a `$` in its path data, so `services/figureBlocks.ts` — mirrored the same way — takes
  the drawing out first, and only the text between figures is split.

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
| `> template: lines=N, sketch` | The printed handwritten template only. `lines=N` reserves **N writing lines** for the student's answer to this part, and the lines printed are exactly the region the layout map crops. `sketch` marks a drawing region (the space is reserved and left blank, no rules). Both optional, order-free — `> template: sketch` alone is valid. |

Omit `lines=N` and the part gets `DEFAULT_ANSWER_LINES` (6). The generator reserves exactly the
requested lines, prints them as ruled writing lines (blank space for a `sketch`), and never shrinks the question
text to make room: if a part's question and writing lines do not fit the rest of a page, the part starts
a new page, and a part whose answer exceeds a page continues onto the next. The older
`space=half|full|short|medium|tall|xtall` values still import, mapped to a line count, but Export
always writes `lines=N`.

```markdown
### (b) Field sketch [25 pts] [handwritten:human]
Sketch the transverse field pattern.

> template: lines=20, sketch

> grader_note: Look for arrows normal to the walls.
```

---

## 8. Round-trip and points

- **Export .md → Import Markdown is stable**: importing an exported file and re-exporting yields the same file. A legacy electronic file that has no `**Input:**` line round-trips unchanged, and so does a file carrying figures (§11).
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
| Each region | `1(a).`, the sub-part title, the points, the **question text**, a rule, then the part's authored number of **ruled writing lines** (blank space for a sketch). |

Prompt, problem and question text all go through the same KaTeX renderer as the other exports, so `$\delta_s$` and a bare `ω` print as glyphs rather than being garbled by jsPDF's Latin-1 fonts.

The prompt row is the authored sub-part name and nothing else. No page instruction is injected into it — the ruled lines beneath are the cue, and a continuation says so in its heading.

**Nothing is boxed.** Page-format §4.1 is explicit that there is no printed answer box, and the questions themselves ask students to box their final answer — so the student's box is the only box on the sheet. A region is a rule, then ruled writing lines, and nothing detects any of it: the crop comes from the declared rectangle alone.

Question text is set at a fixed 9 pt and is never scaled down. Each part reserves its authored answer
space (`> template: lines=N`, §7) and the generator honours it: the question prints at full size and
exactly N writing lines are ruled. When a page cannot hold a part's question plus its writing lines, the
part moves to a new page rather than the text being shrunk; a part whose answer needs more than a page
continues onto the next. Heights are estimated from character count, not measured, so the map is
identical in a browser and in a test and `layout_id` stays stable across them.

**There is no name, student ID or date field, deliberately.** Identity comes from Gradescope authenticating the upload, so a blank for it is redundant; students are told not to write their name on the pages, so a labelled blank is a mixed message; a filled-in name is exactly the PII the band gate exists to keep out; and grading is meant to be blind to identity. Appendix C of the page-format spec says the same — because the app authenticates the student, there is no identity page.

### How the pages are laid out

Pack, then break. Nothing is derived from points, and nothing is squeezed to avoid a break:

1. **Every problem starts a new page**, carrying its heading and shared setup text.
2. Its parts then **pack down the page**: a part's prompt, its fixed-size question text, and its N ruled lines. When the **next** part's prompt, text and lines do not fit in what is left of the page, that part **breaks to a new page**. However many fit at their authored sizes is however many the page carries.
3. If a single part's prompt, text and writing area **exceed a whole page**, it **continues**: same `part_id`, `region_id` suffixed `x2`, heading `(continued)`.
4. Never squeeze to avoid a break. A break is the correct outcome — paper is cheap, unreadable text is not.

**Rule 3 means a part can own more than one region.** The continuation row carries the same `part_id` and a `region_id` suffixed `x2`, so the Submission app receives two crops for one answer. The spec allows this — `region_id` is unique, `part_id` is a display string — but a consumer that assumed one crop per part will be surprised, so: **group crops by `part_id`, and grade the part once.**

### Two more things to know

- **The QR is the same on every copy.** One class-wide master, no per-student code; the app identifies the student from their login, not from the paper.
- **Nothing printed may enter the QR's keep-out**, so the first prompt row on every page starts below it. The generator checks the ink it actually laid down, not just the layout, and refuses to emit a template where anything overlaps the symbol — text over the modules can stop it decoding, and the QR is the whole registration mechanism.

---

## 11. Figures

A figure sits in the **problem stem** — between `## Problem N:` and the first `### (a)` sub-part — and is context for every part of that problem. A problem may have none.

**Nothing may assume one figure per problem.** A textbook sometimes prints one drawing for two numbered problems, so the same figure content appearing on two problems is valid and is *not* a duplicate to collapse. Each copy is inlined with its own id namespace, so neither can capture the other's markers, gradients or clip paths.

### The two accepted forms

**A fenced ` ```svg ` block** holding a complete SVG document. This is the form to use for circuits, plots and anything else generated from source:

````markdown
## Problem 1: Two-resistor divider

The circuit below is driven by $V_{in} = 10$ V.

```svg
<svg viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg">
  <title>divider circuit for Problem 1</title>
  ...
</svg>
```

### (a) Divider ratio [30 pts] [text]
Find $V_{out}/V_{in}$ for the circuit shown.
````

- ` ```svg ` opens the block on a line of its own; a bare ` ``` ` closes it.
- Give the `<svg>` a **`viewBox`** — that is what lets it scale to the column it lands in instead of overflowing at whatever pixel width it was drawn at.
- Give it a **`<title>`** — it names the drawing for a screen reader, and it is what the plain-text placeholder says where a drawing cannot be drawn: `[figure: divider circuit for Problem 1]`. Without one the placeholder is a bare `[figure]`.
- The drawing is inlined into the page, so `<script>`, `on*` handlers and `javascript:` URLs are stripped on the way in.

**A raw image**, as the fallback for anything that is neither a circuit nor a plot: a Markdown image **alone on its own line**.

```markdown
![measured magnitude response](data:image/png;base64,iVBORw0KGgo...)
```

- The URL should be a **`data:` URI**, so the `.md` stays one self-contained file and `assignment.html` still opens with no network. An absolute `http(s)` URL renders on screen but breaks that guarantee, and it cannot be drawn into `assignment.pdf` at all.
- There are **no asset paths**: the Assignment Maker is a browser app that imports a single `.md` and has nothing to resolve a relative path against.
- `![alt](url)` *inside* a sentence is prose, not a figure. It must be the whole line.

### The parser must lift the figure out first — this is a hard requirement

The figure block comes out of the text **before the `$...$` / `$$...$$` math splitter runs and before any HTML escaping**, and goes back at its anchor when rendering. `services/figureBlocks.ts` is the one place that does it, mirrored byte-for-byte into the Student Submission app exactly as `services/mathDelimiters.ts` is (§6), so preview and student screen cannot disagree.

The reason is specific. An SVG document is full of characters the splitter mis-handles: a `$` in path data or an attribute value reads as a math delimiter, and a drawing that reaches `splitMath` is shredded into text fragments and KaTeX spans. Nothing downstream notices — ENG17's `tools/check_math.js` reports the file **clean** while it happens. Green checker, destroyed source. Ordering is the only defence, which is why it is stated here rather than left to each surface.

The same lift protects the parser's own line filters, which throw away blank lines and lines starting with `#` or `>` — all three legitimate inside an SVG (a CSS id selector in a `<style>`, a wrapped attribute).

### Where it renders

| Surface | What it does |
|---|---|
| App preview (`components/FormattedText.tsx`) | Inlines the `<svg>`; images become `<img>` |
| Student app (`components/KatexRenderer.tsx` → `LatexContent`) | The same, via the mirrored splitter |
| `assignment.html`, grader document | The same, at export time. Inline SVG keeps the file self-contained; an `http(s)` image URL does not |
| `assignment.pdf` | The browser draws the block — prose, KaTeX and the drawing together — and the raster is placed as an image. Where there is no rasteriser it degrades to the **short placeholder line**, `[figure: ...]`, never to raw SVG source |
| `assignment.tex` | The placeholder in an `\fbox` — pdflatex cannot typeset an inline SVG without an external file |
| Handwritten QR template | Drawn into its own reserved block of about 51 mm, **separately from the stem's prose**, rather than being counted as thousands of characters of prose. The two are never rasterised together: a figure may be scaled to fit its block, question text may not, so a drawing that runs over cannot shrink the words beside it |
| `{stem}_grading_rubric.json` | Every rubric entry carries `problem_statement`: the problem stem with the prose verbatim and **each figure reduced to its own words** — `[Figure — {title}: {desc}]` from the SVG's `<title>` and `<desc>`, falling back to `[Figure: {title}]` and then `[figure]`; a Markdown image uses its alt text. **No `<svg>` or `<path>` reaches the grader.** Written only when the problem has a stem |

**The grader gets the figure's words, not the drawing.** `problem_statement` names each figure by its `<title>`/`<desc>`; the SVG source does not go into the grading rubric. It went in verbatim at first, and ENG17 measured what that cost: ~143k tokens of `<path d="…">` per student per full grading pass, about a million across a class of 30, carried so a grader **forbidden by policy to reason from the drawing** could decline to use it. A `<desc>` written under the "describe only what a sighted student can see" rule is a few hundred bytes, more useful to a model than coordinates, and leaks strictly less than the geometry.

**So write `<title>` and `<desc>` on every figure** — they are what the grader reads, and what a screen reader announces. A grading prompt should stay figure-agnostic: no clause's verdict may depend on reading the drawing.

Students are unaffected: `assignment_spec.json` and every rendered surface carry the real drawing, and the authored `.md` still holds the full `<svg>`.

### Round trip

Import → Export reproduces the file byte-for-byte:

- A problem with **no figure** exports exactly as it did before figures existed — no new line, no new block.
- A problem **with** a figure round-trips the fenced block, SVG document and all, verbatim.
- Two problems sharing the same figure keep both copies.

A figure is separated from the prose around it by one blank line, which is the form Export writes; a hand-authored file that omits the blank line gains one on its first round trip and is stable from then on, the same way point normalisation behaves.
