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
| `**Submit at:** {address}` | no | Where students hand the work in. Printed on page 1 of the handwritten sheet, under **When you have finished writing** (§10). Single line; whitespace is collapsed. **Absent means that whole section is not printed** — not a placeholder and not a gapped sentence. Emitted by Export only when set, so older files stay byte-identical. |
| `` ```pem `` fenced block | no | The **course public key** (SPKI PEM), the field that turns gb2 encryption on. A fenced block rather than a row, because a 4096-bit key is fourteen lines. Read from the metadata region only. Emitted by Export only when set, so older files stay byte-identical. See below. |
| `**Preamble:** {text}` | no | Instructions shown to the student. Single line. |
| `**Due:** {anything}` | no | **Ignored on import** — due dates are managed in Canvas. Safe to include or omit. |

**`inputMode` governs which mediums are valid (see §5), and this is a MUST.**
A `handwritten` assignment **must** use only `[handwritten]` /
`[handwritten:human]` sub-parts; an `electronic` assignment **must** use
everything except those.

**An assignment mixing the two is a mixed-medium assignment, and Export
refuses it**, naming the offending sub-parts. Both directions otherwise
produce an answer that cannot be collected, silently: a handwritten
assignment gives a typed part a printed box to photograph and leaves a
human grader no document to read, and an electronic assignment gives a
handwritten part a `region_id` pointing at a layout map that was never
written.

**The check is at export, not at authoring**, because a hand-written `.md`
reaches Export without passing through the editor.

**Mixed-medium is not `hybrid`** (§12). `hybrid` is a reserved per-part value
meaning one answer that is both writing and a drawing. It is unrelated to
mixing mediums across an assignment.

`**Submit at:**` carries the submission address, and it is a **value rather than a constant** on purpose. The
standing instructions on page 1 name no institution and no deployment, because the tool is meant for use
beyond the campus that commissioned it and its text has to be true wherever it prints; a hardcoded URL in
the generator would be the same violation one step along, and would have printed a dead address onto every
sheet of the term this suite was renamed and moved hosts. So the address belongs to the author. If it is
absent, the tool prints **nothing at all** about submitting rather than a sentence with a gap in it — a
sheet reading "go to ______" is worse than one that says nothing, because a hundred copies of it are printed
before anyone notices. An export with no address set warns once, at the moment of generation, and proceeds:
collecting the pages some other way is a legitimate workflow.

The address does **not** travel in `assignment_spec.json` (§13's whitelist). A student reading the spec is
already inside the app, so there would be nothing to tell them.

`**AI Feedback:** on` allows students to request the one-time, gradeless AI feedback on any problem in
this assignment; `off` or an absent line disables it. It gates the student-facing feedback only, not
grading, which is governed by the sub-part type tags. The feedback itself, the per-problem one-time
election, and the tally are handled downstream in Gradescope, not by the Assignment Maker or the
Student app; this line only records the instructor's choice and carries it into the exported spec.

### The course public key

```pem
-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA...
-----END PUBLIC KEY-----
```

The block sits in the metadata region, above the first `## Problem`. Its contents are the
armoured SPKI PEM exactly as it would be pasted anywhere else — nothing is re-encoded and
nothing is reconstructed on import.

**Why a fenced block and not a metadata row.** Every other row in the table above is
single-line by construction, and a 4096-bit SPKI PEM is fourteen lines. The alternative
considered was a single line carrying the base64 body alone, with the armour rebuilt on import;
it was rejected because it invents a second representation of a key that is armoured
everywhere else it appears — the editor's paste box, `assignment_spec.json`, the `.pem` file the
institution issues, the autograder — and a reader meeting that line could not tell what it was.

**It is read from the metadata region only.** A `` ```pem `` block below the first `## Problem`
is prose, not the course key, so an assignment that quotes a public key in a question is not
misread as configuring one.

**Emitted only when set.** A file with no key has no block, which is what every file written
before 2026-09-05 looks like, and what an assignment using the standard (gb1) encoding means.

**A malformed block rejects the key, never the file.** The assignment imports without a key —
so exports fall back to gb1 — and the importer says so. Refusing the whole file would lock the
author out of the one screen where a bad key can be replaced. The check is
`looksLikeCoursePublicKey` in the parser (structural, synchronous) and `validateCoursePublicKey`
in the app (a real WebCrypto import); both are the checks the export and the editor already use.

**The key is not a secret and this block does not make it one.** It is the *public* half. It
already ships to every student inside `assignment_spec.json` (§13's whitelist includes
`coursePublicKey`), because the student's browser is what encrypts with it. What must never
appear in a `.md`, or anywhere else that travels, is the private half — the institution holds
that and this app never touches it.

**Why it is in the `.md` at all.** The `.md` is meant to be the source: the instructor authors
there and the app imports it. Until 2026-09-05 the format could not express `coursePublicKey`,
so `Export .md` → `Import Markdown` dropped it in silence, the next export fell back to the
unhardened gb1 encoding, and nothing reported it. Anything the app holds that the `.md` cannot
express is a place where the source of truth quietly moves into browser storage.

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
## Problem 3: Short reflection [10 pts] [ai-graded:short]
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

An unrecognised type tag falls back to `text`. So does a **retired** tag — one this
app once wrote but no longer authors — and the import surfaces a line naming the
sub-part, so a file written against an older spec opens rather than failing.

### What a description may contain

**Despite the `.md` extension, this is not a markdown document.** It is a
line-oriented plain-text format that borrows markdown's file extension and three of
its constructs. Everything else you type reaches the student as the characters you
typed.

That sentence is here because three things say otherwise: the file is `.md`, the
format is called "assignment markdown", and the button says *Import Markdown*. An
author who infers markdown from those, and reads the rest of this spec closely, still
ships literal asterisks to students — which is exactly what happened on 2026-09-02, to
a generated authoring path that put `**D5-1.1.1**` at the head of every sub-part
description and carried the asterisks into `assignment.html`, `assignment.tex`, the
grader document and the student PDF of three assignments.

A description is **escaped plain text plus three exceptions**.
`services/mathRender.ts` (`toHtml`) escapes every prose segment. Only these are
rendered:

| Construct | Becomes | See |
|---|---|---|
| `$...$`, `$$...$$` | KaTeX math | §6 |
| `![alt](url)` | an image | §11 |
| ` ```svg ` fence | inline SVG | §11 |

**No other markdown is processed.** `**bold**`, `*italic*`, `` `code` ``,
`[link](url)` and `# heading` reach the student as the characters you typed. A
`- item` list is not a list — it renders as a dash followed by text, which looks
right only because of the next rule.

**The three that are rendered are not a curated subset, and there is no fourth
coming.** A figure is lifted out before escaping because block content has to become
a real element (§11); math goes to KaTeX because math is a feature (§6). Nobody ever
decided that `**bold**` should not work — bold was never a feature, so there is no
subset to finish. Three reasons it stays that way, recorded so the next author does
not re-ask: escaping prose is a **security property**, currently simple and provable,
and a markdown renderer trades it for typography; there are **three output paths**
(HTML, LaTeX and the student PDF) and a construct that rendered in one and not
another would show the grader something the student never saw; and a change to text
rendering **can move `layout_id`**, because glyph metrics change pagination and
printed paper is already in students' hands.

**Line breaks are significant.** An authored newline is a newline and leading
indentation is preserved on every surface the assignment is *displayed* on — the
editor preview, the student's screen, `assignment.html`, the grader document and
`assignment.pdf`. Every container is `white-space: pre-wrap`. Use them; do not
flatten a multi-line step onto one line.

**The one exception is `assignment.tex`.** LaTeX reads a single newline as a space,
and the export adds no `\\` and no `\obeylines`, so a multi-line description compiles
as one flowed paragraph. That file is for a human to read and hand-edit (§12) and no
student or grader surface is affected — but if you compile it, this is why the lines
ran together.

**Blank lines inside a description are dropped on import**, as is the blank line
between the description's first line and the rest; what survives is joined with single
newlines. A hand-authored file is therefore normalised on its **first** import. §8's
round-trip guarantee starts from the *exported* file, not from yours.

**A `>` line is removed rather than printed.** It is a grading block (§7), not a
markdown blockquote, so it leaves the description and goes to the field it names.

*Corrected 2026-09-02.* This paragraph used to say that a `#` line was dropped from a
problem description and kept in a sub-part description. That was measured and true, and
it contradicted the promise three paragraphs above — *everything else you type reaches
the student as the characters you typed*. **The promise was the better of the two, so
the parser changed**: no description filter drops a line for beginning with `#` any
more, at any of the three sites, and the import now warns, naming the part and quoting
the line, because a heading-shaped line is nearly always a mistake even though it is
never silently deleted. Silent content loss is worse than a stray character — a literal
`#` is visible and gets fixed on the first preview, while a dropped line is found by a
student who is missing a sentence.

**A grading block belongs to the sub-part it grades.** A problem heading carries no
grading fields, so `> grading_prompt:` and `> grader_note:` are read only under a
`### (a) …` heading (§7). Write one against a `## Problem N:` heading and it is dropped
and the import says so, naming the problem and where the block belongs.

*Fixed 2026-09-03; recorded here because the failure is worth remembering.* Until that
date the problem-description site did not drop `>` lines while both other sites did.
On a problem with sub-parts nothing read one there, so the block was **neither routed
nor dropped — it was printed**, into `description`, which is on the student-spec
whitelist (§12). A `> grader_note:` written one heading too high therefore travelled
into `assignment_spec.json`, the student's PDF and the printed sheet. No ENG17 file
was affected and nothing was ever exposed.

**Why this one mattered more than a predicate.** The 2026-08-31 whitelist lists which
*fields* may reach a student, and it closed the door `aiGradingPrompt` walked through.
It could not close this one, by construction: the text was not in `graderNote`, it was
in `description`, which is on the list and must be. **A whitelist of fields cannot see
an answer key smuggled into an allowed field as prose.** So the protection moved from
the schema to the content: `npm test` now asserts that no grading prompt or grader note
reaches **any** student-facing artifact — the spec, the student PDF's extracted text,
the layout CSV and every `student/` entry in the export — by marker vocabulary, by whole
string, by bulk word overlap, and by the `REFERENCE:` clause alone at a tighter bar. That
guard does not know about `>` and does not need to; it closes every route of this shape,
including the ones nobody has thought of yet.

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
| `handwritten` | Handwritten answer (photographed, transcribed) | AI first pass (OCR then grade) |
| `handwritten:human` | Handwritten answer | Human (TA grades from the crop, no OCR) |

Notes:
- **Handwritten sub-parts take no image count.** Pages are an assignment-level pool, not a per-part count, so `handwritten:3` is not a thing — use `[handwritten]` or `[handwritten:human]`.
- The word-count ranges for the `ai-graded:*` tiers are suggestions surfaced in the UI, not enforced.

---

## 6. Math notation

Math is one of the **three** constructs a description renders; everything else in it is escaped plain text, and §4 (*What a description may contain*) is the list.

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

**Before writing a grading prompt, read §12.** It says who reads each exported artifact and what each
one is authoritative for. Two things an author most needs to know here:

- **What you write in these blockquotes does not reach the student.** `grading_prompt` and
  `grader_note` go to `{stem}_grading_rubric.json` and the grader document, both of which stay with
  the instructor. They are excluded from `assignment_spec.json` by construction (§12). Until
  2026-08-31 they were *not* — the student's copy carried every prompt, `REFERENCE:` lines and worked
  answers included — so if you are reading an export made before then, treat it as disclosed.
- **A grading prompt says what a good answer contains — never how to grade it.** Not which model
  should read it, how hot it should run, or how many tokens it is worth. **The Assignment Maker
  describes the work; the grading system decides how to grade it**, from the question type and the
  materials it is given.

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
requested lines, prints them as ruled writing lines inside a bordered box (an empty box for a `sketch`), and never shrinks the question
text to make room. **`lines=N` is a floor, and it is enforced**: a numbered self-test check refuses to
emit a template carrying any region shorter than its authored count, naming the part and the shortfall
in millimetres and lines. Until 2026-08-31 it was not enforced, and it was not being honoured — see
§10 rule 3.

The generator's behaviour is otherwise unchanged: if a part's question and writing lines do not fit the rest of a page, the part starts
a new page, and a part whose answer exceeds a whole page simply takes the page. An answer is never
split across two pages. Where a page has room left under the last part, that part's box and its ruled lines run on
to the bottom margin, so the extra paper belongs to a region that is actually cropped and graded. A part
asking for fewer lines than a **28 mm** box holds gets 28 mm anyway — below that a box is too small to
find reliably and too small to read. The older
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
- **The guarantee holds between *exported* files.** A hand-authored or generated file may be normalised once, on its first import, and that is not a defect: blank lines inside a description are dropped (§4) and a figure gains the separating blank line Export writes (§11). From the first export onward the file is stable. A workflow that generates `.md` and diffs it against an export should pre-empt the normaliser rather than read the difference as a change.
- On export, sub-part points are **normalised** to the assignment's target total, so the numbers you write are relative weights; the exported file shows the scaled values.
- **The file's own total is the target.** Import Markdown sets the assignment's target to the sum of the sub-part points it just read. A `.md` carries already-scaled values, so its own sum is the total its author intended, and adopting it makes the export an identity rather than a silent transformation. Only a **new, empty** assignment starts at the 100 default — it is the one case with nothing to infer from. `converter/convert.py` does the same, and writes `targetPoints` into the spec it emits.
- **The export never silently rescales.** When the authored total and the target disagree, the export stops and asks, naming both numbers and what will happen. Declining writes nothing. The Target box and the Rescale button are unchanged: an instructor who wants a rescale still gets one, deliberately.
  - *Added 2026-09-01.* The target used to come from an invisible default whenever the file did not carry one, so a 200-point assignment listed as 200 and exported as 100. **Points sit outside the `layout_id` hash**, so every hash check, page count and geometry test passes on a halved assignment — there is no downstream check that can ever catch this, which is why the guard is at the moment of the transformation and why a badge was not enough.

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

For a handwritten assignment, **the page-format sheet is the assignment**. Export ZIP puts it at the archive root as `{stem}.pdf` — there is no separate template to go and find, and no second PDF to pick between:

| File in the ZIP | Handwritten | Electronic |
|---|---|---|
| `{stem}.pdf` | **The page-format sheet**: four corner marks, the QR, the question text and one ruled answer area per part, on every page. Print this. | The usual assignment paper. |
| `{stem}_OPEN_IN_APP.json` | The spec the Submission app loads, **with the layout map inside it** (§13). | The spec the Submission app loads. |
| `instructor/layout_{TemplateID}.csv` | The instructor's copy of the sidecar map, for setting up the Gradescope outline. Its content hash is written into every page's QR. **Not a student file** — the student's copy travels inside the upload file. | — |
| `instructor/template.pdf` | — *(not exported: the sheet above already is the answer surface, and a second boxed one only invites printing the wrong PDF)* | The boxed answer-region sheet, for setting up the Gradescope outline — an instructor task, so it is not a student file. |

The two readable documents, the grading rubric, the grader document, the authoring backup and the `.md` are in both modes — see §13 for the shape of the archive and what may be handed out.

The editor's **QR Template** button emits the same sheet plus its map as a standalone ZIP, for regenerating after a layout edit without rebuilding the whole export.

**The PDF and the map must travel together, and since 2026-09-06 they cannot come apart**: the map is embedded verbatim in `{stem}_OPEN_IN_APP.json` rather than shipped beside the sheet (§13). The PDF is useless without the map its QR hashes to, and the Submission app refuses to crop when the hash does not match — which is the point: a stale map would otherwise register perfectly and cut the wrong rectangles with no error anywhere. Handing a student two files that must match was the arrangement in which they could be mismatched; one file cannot be.

The geometry is not ours to choose. It is fixed by `GradeBridge2026/QR Format Page/GradeBridge_Page_Format_v1.md`, transcribed into `services/pageFormat.ts`, and enforced by the spec 8.7 self-test that runs on every generation — a template that fails any check is not emitted at all.

### What the printed sheet holds

**The sheet is the whole assignment.** A student prints it, reads it, writes on it and photographs it — there is no companion document, so everything they need to answer is on the paper:

| Where | What |
|---|---|
| Top 25 mm, every page | The QR, the four corner marks, one header line. Nothing else, ever. |
| **Page 1, all of it** | The **instructions page**: course and title, the standing instructions, then the author's **preamble** under its own heading. No problem, no answer region, no row in the map. See below. |
| Above each problem's first part | `Problem 2: Rectangular waveguide` and the problem's **shared setup text**. On a later page the heading repeats as `(continued)`; the setup does not. |
| Each region | `1(a).`, the sub-part title, the points, the **question text**, then a **bordered box** holding the part's authored number of **ruled writing lines** (blank space for a sketch). |

Prompt, problem and question text all go through the same KaTeX renderer as the other exports, so `$\delta_s$` and a bare `ω` print as glyphs rather than being garbled by jsPDF's Latin-1 fonts.

The prompt row is the authored sub-part name and nothing else. No page instruction is injected into it — the box beneath it is the cue, and a problem carried onto another page says so in its heading.

**Every answer is boxed** (2026-08-31; this reverses the 2026-08-17 rule and page-format §4.1 and §8.5 carry the amendment). One part, one box: solid, continuous, black, **1 pt**, a true rectangle with square corners, no fill, stacked vertically, the full **x 12.0–203.9** writing column wide, never under **28 mm** tall, and always closing at or above **y 257.0** so it clears the bottom registration corners.

*Why, given the old rule said the opposite.* A printed box does four jobs and only the first is obvious: it says where to write; **it is a fiducial**, so a detector perspective-corrects from the box's own corners and nothing depends on the answer landing where the map predicted; it bounds the crop; and it makes the whitespace that returned markup needs. The fiducial job is worth *more* to homework than to an exam, because homework arrives as a phone photograph of a possibly curled page and page-format §6 measures corner-mark detection falling from 4 of 4 to 2 of 4 on a page rotated by six degrees. Both reasons the box was removed have since gone: the spec sentence is amended, and ENG17 HWK1–HWK3 as rebuilt on 30–31 August ask students to box nothing. **If a final-answer mark is ever wanted again, the instruction is to *circle* it** — a circle cannot be a candidate for a rectangle detector.

**The declared rectangle in `layout_{TemplateID}.csv` is the box INTERIOR**, inside the border stroke, and the border is drawn immediately outside it — so a crop never carries the border's own ink, and the exam track's `answerbox.sty`, which records the inner area, agrees. The crop still comes from the declared rectangle alone; nothing in the consume path detects the box. The box is redundancy, not a new dependency.

**There is no separate top rule.** The border replaced it. Drawing both puts two horizontal lines 2.5 mm apart at the top of every region, which is noise.

**Nothing prints in colour**, and it is now asserted. The scans are 8-bit greyscale and that is load bearing: it is what lets the marking stage prove it never altered the student's work, since any pixel with colour was added afterwards. Author-supplied SVG was the one way colour could reach the page, so a figure declaring a non-grey `fill`, `stroke` or `stop-color` **refuses the export**. All thirty ENG17 figures are `#111111` on `#ffffff` and are unaffected.

**The writing lines are dashed, at a 9 mm pitch.** Dashed because a solid horizontal rule beside handwritten maths is the exact shape of a fraction bar, a minus sign or an overbar, and a grader reads it as one; a dash gives the same alignment and skew reference with no long connected run to mistake for a glyph. 9 mm because at 8 mm a sub- or superscript (`V_{32} = V_3 - V_2`) pushes into the next line's zone. They print at 0.5 pt in 75% grey — heavy enough to survive a toner-saving laser, pale enough to threshold out cleanly, since students print these themselves. The region's own top rule stays solid: it is a separator above the writing area, not a line anyone writes maths against. A sketch region carries no rules at all.

**One font size across the whole sheet. Question text is never scaled — at all.** Stem, sub-part
prompt, sub-part description and preamble all print at 9 pt, and nothing shrinks any of them to make
something fit. A drawing may be scaled into its reserved block; words may not. Each part reserves its
authored answer space (`> template: lines=N`, §7) and the generator honours it: the question prints at
full size and at least N writing lines are ruled. When a page cannot hold a part's question plus its
writing lines, the part moves to a new page; a part whose answer needs more than a page takes the whole
page. The problem **heading** is wrapped to the writing column like any other block — a long title, or
a title carrying ` (continued)`, runs onto a second line rather than out of the column.

Heights are estimated from character count, never measured — the map is hashed into every page's QR, so
it has to be identical in a browser and in a test. The estimate therefore **over-reserves on purpose**
(`CHAR_ADVANCE_EM` = 0.62 against a render font measuring 0.40, plus a slack line per block): with
nothing scaled to fit, a short reservation would not shrink the text, it would overrun. Text is also
always rendered at the full writing column, so a line breaks where the text runs out of column and
never because a box was made narrow.

**A question that cannot fit a page is refused, not shrunk.** The generator emits nothing and names the
part and the overflow; splitting the problem is the author's call and nobody else can make it.

**There is no name, student ID or date field anywhere in what this app produces, deliberately.** This is not a property of the handwritten sheet alone. It holds on every export path and in both input modes.

The app is a **de-identified processing step**. Identity comes from the authenticated upload, which is the identity of record, so a blank for it is redundant; students are told not to write their name on the pages, so a labelled blank is a mixed message; a filled-in name is exactly the PII the band gate exists to keep out; and grading is meant to be blind to identity, which a blank labelled "Student Name" invites the student to defeat with a pen. Appendix C of the page-format spec says the same: because the app authenticates the student, there is no identity page.

*Enforced, not merely stated.* `npm test` builds the export in **each input mode** and asserts that no `student/` entry, and not `instructor/assignment.tex`, carries a name, student ID or date field. It reads the **built artifact**, extracted PDF text included, rather than the source. It matches a labelled blank rather than the words themselves, so the standing instruction telling students not to write a name is not mistaken for a field, and a test holds that distinction in both directions.

*History, so this is not re-decided.* `CORRECTION_AM_QR_TEMPLATE_2026-08-15.md` section 1 ordered the removal. It was applied to the handwritten template and to nothing else, and the guard written with it grepped the template source, so the typed-mode student PDF and the LaTeX export kept their identity line for three weeks with the policy documented in three places. Both were removed on 2026-09-03 and the guard was replaced with the one described above.

### Page 1 is the instructions page

**For `**Input:** handwritten`, page 1 carries the standing instructions and the author's preamble,
and nothing else. Always** — not when the preamble happens to be long enough. Three guarantees follow,
and the self-test holds all three rather than leaving them to be inferred:

- **Page 1 carries no rows in `layout_{TemplateID}.csv`, and is therefore never cropped.** Nothing a
  student writes on it is collected, because there is nothing on it to collect from.
- **`N` counts it.** Every problem opens a page, so `N` is at least problems-plus-one; it is more
  whenever a problem needs more than one page, which is ordinary.
- **`k=1` is always the instructions page**, in every handwritten assignment. That is a fact the
  Submission app, the student and any instruction anyone writes can all rely on.

It used to be emergent, and that is why it is now stated. ENG17 wrote a preamble long enough to push
Problem 1 onto page 2; it worked, and it was a side effect. Twenty words shorter and the instructions
would have been squeezed beside a circuit diagram with nothing announcing it; a re-tuning of
`CHAR_ADVANCE_EM`, entirely reasonable on its own terms, would have done the same. Then the writing
column widened and the region-height fix landed, and the break stopped happening — silently, which is
the whole problem with an emergent first page.

**An instructions page that does not fit refuses the export and names the overflow**, the same
treatment a question too long for a page already gets. That is what makes `k=1` an invariant rather
than a usual case: "problems begin on page 2" would otherwise quietly break the moment the standing
instructions plus a long preamble ran past the bottom.

### Who writes what on it

> **The tool owns instructions about the sheet and the submission. The author's preamble owns
> instructions about the work.**

The boundary exists because it was crossed. ENG17's first preamble draft opened by repeating the
tool's print instruction almost word for word, because it was written without looking at the exported
page — two authors writing standing instructions into one page with no rule about who owned what, and
neither able to see the other's. **The self-test refuses an export whose preamble repeats a standing
instruction**, matching on normalised six-word windows rather than exact strings, because "almost word
for word" is the shape the failure actually takes.

The tool prints, once, on page 1, in this order: that the work must be the student's own; how to print
the sheet and check the corner marks; not to write a name or student ID; that only what is inside a
box is collected, and that the box wants a composed answer rather than a workspace; how to cancel
abandoned work; to write darker rather than bigger; and — **only when `**Submit at:**` is set** — how
to hand the work in. The author's preamble keeps everything about the work — show your working, give
units, course conventions such as a cover-sheet rule, and **what assistance is permitted**.

### When you have finished writing

Until 2026-09-06 the tool claimed the submission half of that boundary and left it empty. Page 1
carried `Your own work`, `Before you start`, `As you work` and the preamble, and said **nothing about
submitting**: no mention that an app exists, no address, nothing about photographing pages. A student
printed sixteen sheets, did the work properly, and was left holding paper with no stated next step.
The preamble could not fill the gap without breaking the split, and an author who tried would trip the
duplicate-instruction guard.

The section is the four steps in order — go to the address, load the assignment `.zip`, photograph each
page, check each photograph — followed by one unnumbered line telling the student to keep their printed
pages until the grade is posted. The steps are numbered and the last line is not, and that difference
carries meaning: a student who photographs before loading the assignment file has to start again, while
the sections above are independent statements.

**It is the one conditional section on the page**, and `**Submit at:**` is what conditions it (§2).
Every line in it is held to the governing rule below, and none of it is worth anything to the automatic
reader alone: *check each photograph* helps a human grader just as much, since a page too dark to read
is unreadable to anyone, and the student is the only person who can retake it; *keep your printed pages*
is the student's own protection in a dispute and the only copy of the original that exists.

**The address changes nothing about the geometry.** Page 1 carries no regions, so `layout_id` is
identical whether an address is set, unset, or changed — the same property the instructions page was
given in the first place, and a test holds it.

**The integrity block names no institution, and none may be named.** "The work you submit must be your
own. Submitting work that is not your own is academic misconduct." That is true wherever the sheet is
printed, which it has to be: this tool is meant for use beyond the course and the campus that
commissioned it, and a named code, an office, a penalty schedule or a reporting route all differ by
institution and would be wrong somewhere. It is the split extended one step — **the tool states the
obligation, the author states the policy.** An author citing their institution's code by name does it
in the preamble, where course and campus specifics already live.

> **Open, and it belongs to the author: what assistance is permitted.** The standing text does not say
> whether a calculator, a textbook, a classmate, a study group or an AI assistant is allowed, because
> that varies by course and by institution. **Decide it in the preamble.** If you do not, your course
> inherits the previous course's unstated assumption, which is the failure this note exists to
> prevent.

**On "the box is not scratch paper."** The item about running out of room used to end *"the boxes are
sized for a full answer; if you are running out of room, there is usually a shorter route"*. That
treats running out of room as a **sizing** problem and answers it by telling a student who needed the
room that they took the long way. Running out of room is a **composition** problem: the sheet now says
to work the problem out on scratch paper and write into the box the solution you want read. That
teaches something, drops the implicit accusation, makes the space question largely disappear, and is
honest about the artifact — a box that collects only what is inside it should say plainly that it
wants a solution rather than a workspace.

**The governing rule for anything added to the tool's half:**

> **If a piece of advice would only ever help the automatic reader, it does not belong in front of
> students. No mark, anywhere in any rubric, for following any of it.**

Adopted from `EEC100_Final_Student_Note_2026-08-28.md`. Centralising these sentences means a bad one
appears on every sheet in the system rather than one course's, so the bar goes **up**: every line must
earn its place with a human grader too. That rule is why "resting each line of writing on a rule" was
dropped on 2026-09-01 — true, useful to the OCR pass, and of no interest to a student or a human
grader.

The closing line, *"Neat handwriting is not marked. Clear working is."*, is not decoration. Students
read "your work is scanned" as "my handwriting is being judged", and the anxious response is to write
larger and slower, which costs them time and helps nobody.

### How the pages are laid out

Pack, then break. Nothing is derived from points, and nothing is squeezed to avoid a break:

1. **Page 1 is the instructions page** and carries no part. **Problems begin on page 2.**
2. **Every problem starts a new page**, carrying its heading and shared setup text.
3. Its parts then **pack down the page**: a part's prompt, its fixed-size question text, and its box of N ruled lines. When the **next** part's prompt, text and box do not fit in what is left of the page — or the box that would be left for it is under 28 mm — that part **breaks to a new page**. However many fit at their authored sizes is however many the page carries.
4. **A region is never shorter than its authored line count.** Growing is allowed; shrinking is not. When a page cannot give a part its N lines, the part moves to a page that can. Since page 1 carries no part, every page a part can stand on begins at the same height, so there is exactly **one** thing left that takes room away which another page would not: **the problem's shared setup**, printed once above the problem's first part. So there is one escape, and it is the unusual-looking one: the shared setup is printed on **a page of its own**, and the part follows on the next page under a `(continued)` heading. That is the only way a part authored more lines than fit beneath its own stem can still be given them, and giving them is not optional.

   A break only happens when the better page can actually deliver the authored count. Breaking to gain a line or two without reaching it would trade a blank sheet for nothing, so in that case the part simply takes the page it is on.
5. If a single part's prompt, text and writing area **exceed the roomiest page there is**, the part takes the whole page. **An answer is never split across pages** — the next page is no bigger, so a break cannot help, and what splitting produced instead was a 15 mm orphan: one writing line under a repeated heading, which is not somewhere anyone finishes an answer.
6. **The last box on each page runs to the bottom margin** (`y 257.0`, five millimetres above the format's own limit so the box closes clear of the bottom registration corners). Earlier parts on the page keep exactly their authored lines; the final one absorbs the slack. Blank paper below a region is paper a student may write on that is never cropped and never graded, so the rectangle is extended to claim it. A sketch region grows the same way and stays unruled.
7. Never squeeze to avoid a break, and never squeeze instead of one. A break is the correct outcome — paper is cheap, and a student given less room than the assignment says is not.

**Every `part_id` gets exactly one region.** The map still *permits* a part to own more than one — `region_id` is the unique key and `part_id` is a display string the spec lets repeat — and a consumer should still **group crops by `part_id` and grade the part once**, so that nothing breaks if the shape ever comes back. As of 2026-08-18 the generator does not produce it.

### Two more things to know

- **The QR is the same on every copy.** One class-wide master, no per-student code; the app identifies the student from their login, not from the paper.
- **Nothing printed may enter the QR's keep-out**, so the first prompt row on every page starts below it. The generator checks the ink it actually laid down, not just the layout, and refuses to emit a template where anything overlaps the symbol — text over the modules can stop it decoding, and the QR is the whole registration mechanism.
- **Nothing printed may leave the writing column** (x 12.0–203.9, plus 0.25 mm for rounding), checked the same way, against the ink rather than the layout. The column *is* the page-wide safe area now: it used to stop at 23.0/192.9 so a rectangle could never touch a registration corner at any y, and it buys 22 mm of writing width on every line by capping every box at y 257.0 instead, which only costs height on the last box of each page. The header line no longer needs an exemption here — spec 8.4 anchors it at x = 20.0, which was left of the old column and is inside the new one — but it keeps one from the corner keep-out check, since (20.0, 10.0) is inside the NW corner by design.
- **Nothing but its own writing lines may be printed inside a box**, and **no box may be under 28 mm**. Both are checked at generation and both refuse the template.

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

---

## 12. Who reads each exported artifact

**The Assignment Maker describes the work; the grading system decides how to grade it; the student spec
carries only what the student is allowed to see; and exactly one file restores everything.**

Both halves of that sentence are here because both were broken on the same day, and both were found by
reading an exported artifact that never said who reads it.

**The student spec was carrying the answer key.** `assignment_spec.json` was the whole `Assignment`
object, gb1-encoded, which meant it shipped `aiGradingPrompt` on every sub-part. For ENG17 Homework 1
that was 17 of 17 grading prompts, each with a `REFERENCE:` line giving the worked answer, the solution
route and the known failure modes — Problem 5's states the answer is 1.2 V and derives it. `graderNote`
travelled the same way on any assignment with a `handwritten:human` part. It was decrypted in about a
minute on 2026-08-31 using this app's own exported `decryptJson` and nothing a student does not already
have. Six fields reached the student that the Submission app never reads. **Nothing had been
distributed**, so nothing was in circulation, but the mechanism was live. See "The student spec is a
whitelist" below.

**And the rubric was configuring the grader.** On the same day two agents spent a cycle on a false
alarm. An exported `{stem}_grading_rubric.json` carried
`"ai_grading_config": {"model": "claude-haiku-4-5-20251001", "temperature": 0.1, "max_tokens": 512}`.
Both agents reasoned correctly — a 512-token ceiling on the
smallest model in the family really would bind on a prompt that asks a grader to review a method, name
a misconception and find the first wrong line — and escalated. The whole thing was moot: the field had
no consumers anywhere in the suite, nobody had chosen 512 per assignment (it was hardcoded on import),
and the grading and OCR code that exists picks its own model and ceiling from its own CLI. The field
was deleted on 2026-08-31 and a test now fails if any exported artifact grows one back.

**Do not delete these two paragraphs as obvious.** They are the reason the sentence above exists, and
the sentence is what stops the next recurrence. In both cases the failure was documentation, not code:
the artifacts never said who reads them. So, per artifact:

| Artifact | Read by | Authoritative for | Never carries |
|---|---|---|---|
| `{stem}_OPEN_IN_APP.json` (the student spec) | the Student Submission app | what the student is asked, how they are allowed to answer it, and — handwritten only — **the layout map, embedded verbatim** (§13) | **grading prompts, grader notes, answer keys, reference solutions, grading-resource settings** — anything a student must not see |
| `instructor/{stem}_authoring_backup.json` | this app, on Import JSON | **restoring an assignment completely** — it is the only artifact that does | *(no restriction: it is the whole assignment, and it is why the ZIP must never be given to students)* |
| `layout_{TemplateID}.csv` | the page consumer that crops (§10) — reached through `{stem}_OPEN_IN_APP.json`, or as the instructor's own copy under `instructor/` | **where** each region is on the page — nothing else | anything a grader needs in order to grade |
| `{stem}_grading_rubric.json` | the grading system | what each item asks, what it is worth, what a grader is told, and the answer's **modality** | **model names, temperature, token budgets, or any other grading-system resource decision** |
| `{stem}_grader_document.html` | a human TA, on screen or on paper | the answer key and the rubric in readable form | anything machine-parsed — nothing may depend on its markup |
| `{stem}.pdf` | the student, on paper | the whole assignment | identity fields — no name, ID or date blank (§10) |
| `instructor/{stem}.md` | this app, on Import Markdown; and a human editing it | the authored source — the format an author actually writes | *(it carries the grading prompts, so it is instructor-only)* |
| `assignment.html`, `assignment.tex` | a human, for reading and hand-editing | the assignment as a document | anything the other artifacts are authoritative for |

The grading system is **told the type of question and given the supporting materials, and allocates its
own resources from there.** How many tokens a grader needs, which model it runs, how hot it runs — none
of that is an authoring decision, none of it can be made well from this side of the boundary, and a
value written here is a value some consumer will one day obey.

### The student spec is a whitelist, and the direction is the point

`assignment_spec.json` is built from an **explicit list of the fields the Student Submission app
reads** — not from the `Assignment` object with fields subtracted.

**A blacklist is how the answer key got in.** `aiGradingPrompt` was added for the grader, the spec
shipped everything it had, and nothing objected. With a whitelist, **the next field anyone adds is
excluded by default** and reaches students only when someone decides it should. The failure mode of a
blacklist is silent; the failure mode of a whitelist is a missing feature that somebody notices.

| Level | Always written | Written only when present |
|---|---|---|
| assignment | `id`, `courseCode`, `title`, `preamble`, `problems`, `createdAt`, `updatedAt` | `inputMode`, `aiFeedback`, `coursePublicKey` |
| problem | `id`, `name`, `description`, `subsections` | — |
| sub-part | `id`, `name`, `description`, `points`, `submissionType` | `minWords`, `maxImages`, `config` |

"Only when present" is presence, not truthiness: `aiFeedback: false` is a real answer and survives,
while an assignment written before the flag existed stays without the field and its spec is
byte-for-byte what it was.

The list lives in `services/exportService.ts` as `STUDENT_SPEC_FIELDS`, and the test suite compares it
against `GradeBridge-Student-Submission/types.ts`, which is where "what the student app reads" is
actually defined. The two cannot drift silently.

### And the whitelist is not enough on its own

**A whitelist of fields cannot see an answer key smuggled into an allowed field as prose.**

Read the table above again: `description` is on it, at both levels, and has to be — it is the
question. On 2026-09-02 a second route was found into the same room. A `> grader_note:` written
against a `## Problem N:` heading rather than a `### (a)` heading was read by nothing, so it was
neither routed to a field nor dropped: it was **printed**, into `description`, and travelled to the
student with the field list fully intact and objecting to nothing. The predicate was fixed on
2026-09-03 (§4) and no assignment was ever affected — but that is one route, and the reason it is
written up here is that the schema could not have caught it and cannot catch the next one.

So there is a second guard, and it works on **content**. `npm test` collects every `aiGradingPrompt`
and `graderNote` in an assignment and asserts that none of them reaches any student-facing artifact —
`assignment_spec.json`, the student PDF's extracted text, `layout_*.csv`, and every `student/` entry
in the export ZIP — four ways:

| Strand | Catches | Tolerance |
|---|---|---|
| marker vocabulary (`grader_note`, `Award full marks`, …) | the structural signature of a grading block | zero |
| whole grading string, verbatim | a directive pasted wholesale | zero |
| bulk word overlap | a large slab pasted with no marker in it | a measured bar |
| `REFERENCE:` clause overlap | one pasted sentence — the line that says what the answer is | a tighter measured bar |

It runs over the real ENG17 homeworks and over fixtures built to leak, and each of the last two has a
test that watches it fail: remove the strand and the fixture's leak goes undetected.

**Neither bar is chosen; both are measured**, because grading prompts legitimately quote the circuit
they grade and a bar set by taste would fire on that. The measurements, and how to re-derive them, are
recorded beside the checks in `tests/templateTests.mjs`. If a real assignment ever trips one, report
the phrase rather than raising the bar.

**Why the fourth strand exists.** The third was built for a slab of prompt. The likelier authoring
mistake is smaller: an author reaches for the one line that says what the answer is, not the paragraph
around it. That sentence is shorter than the third strand's bar and carries no marker vocabulary, so
it was the one sentence no strand could see. It is caught at a tighter bar because a `REFERENCE:`
clause is structurally the part of a prompt that the stem does *not* say — measured across the real
homeworks its legitimate overlap with student text is half that of a whole prompt. A grading string
with no `REFERENCE:` clause is not scanned at the tighter bar at all; the third strand covers it, and
applying the tighter one would fire on legitimate prose.

**Where this guard stops, stated so the gap is known rather than discovered.** It catches pasted
*text*, at two scales. It does not catch a **transcribed number**: `Answer: 4.6 A` is three words, no
overlap rule at any bar reaches it, and one that did would fire on every stem that legitimately prints
a component value. Detecting that needs a different kind of check, and nothing measured so far
supports building one.

**Nothing is lost by this.** Grading material reaches the grader by its proper route,
`{stem}_grading_rubric.json`, which stays with the instructor and goes to the autograder — this changed
nothing about what the grader receives. **The authoring round trip is `Export .md` → `Import
Markdown`**, which carries `> grading_prompt:` and `> grader_note:` in full (§7). Re-importing an
*exported spec* as a template no longer restores the grading material, because that material is no
longer in the file; use the `.md`.

**On the encryption.** `services/cryptoService.ts` states its threat model plainly: the gb1 key is
embedded in the shipped bundle and duplicated across three codebases, so this is **tamper resistance,
not confidentiality**. That was reasonable for the payload it was written for; reference solutions were
added to that payload later and the note was never revisited. The rule that follows is the one above —
the spec must never carry material whose disclosure matters — and it is now enforced by construction
rather than by care. Rotating the key is a separate question and is deliberately not coupled to this:
once the grading material is out, deterrent-grade encoding is adequate for what remains.

### `answer_modality` — the declaration a grader does need

A rubric item carries `answer_modality` **wherever the app knows it**. It exists because the ingest
contract requires it:

> **Routing SHALL be by declared modality from the authoring stage, not guessed at read time.**
> (`GradeBridge_OCR_Transcription_v1.5_addendum` §3, T19)

| Value | Meaning |
|---|---|
| `"text"` | The answer is writing — a `text` or `ai-graded:*` part, or a `handwritten` part that is not a sketch. |
| `"figure"` | The answer is a drawing — a `handwritten` part authored `> template: sketch` (§7). |
| `"hybrid"` | **Reserved, never emitted.** The exam track declares text, figure or hybrid per part; this app has one boolean today. Reserving the value now makes adding it later additive rather than a migration. |
| *(field absent)* | **The app does not know.** An `[image]` or `[text+image]` part is answered with a picture but carries no modality declaration, since `sketch` is handwritten-only. |

**The field is optional, and an absent field means an absence.** It is written only where the app
actually knows the modality. It would be easy to write `"text"` for an `[image]` part and have the
field always present — and it would be a false statement in a field whose only purpose is routing. A
wrong value is worse than a missing one precisely because it does not prompt anyone to ask: the first
consumer that routes on it would be misled by data that looks authoritative. So a consumer must handle
the field being absent, and must not read absence as `"text"`.

Every part of a **handwritten** assignment carries the field, which is the case that matters — it is
the only mode with a layout map to agree with.

`answer_modality` and `is_drawing` in `layout_{TemplateID}.csv` are **deliberately duplicated** and must
agree. They are not redundant: the two artifacts have different consumers and different lifetimes, and
no consumer should have to join two files to learn one fact. A test asserts they agree.

**Open question, not yet decided.** There is no authoring surface for `hybrid` — a part that wants both
working and a sketch. Deciding one means choosing a tag or a `> template:` option, and that is a
separate call, deliberately not invented here. The `[image]` and `[text+image]` case is **no longer
open**: those parts omit the field rather than misdeclare it (above), and giving them a real modality
would need the same authoring decision `hybrid` needs. Neither gap blocks anything — no consumer routes
on modality for an electronic assignment, and there is no layout map for one to disagree with.

---

## 13. The export ZIP: what restores your work, and what must never leave your hands

**The export ZIP is for the instructor. It MUST NOT be given to students.** Four of its files contain
the answer key. It is laid out so that saying so is unnecessary:

```
00_INSTRUCTOR_ONLY_DO_NOT_DISTRIBUTE.txt   generated at export time, names every file
{stem}_FOR_STUDENTS.zip                     ATTACH THIS. Stored, not deflated.
  {stem}.pdf                                  they print it and write on it
  {stem}_OPEN_IN_APP.json                     they load it into the app
instructor/
  {stem}_authoring_backup.json              THE BACKUP — restores everything
  {stem}.md                                 the authored source
  {stem}_grading_rubric.json                for the autograder
  {stem}_grader_document.html               for you and your TAs
  assignment.html, assignment.tex           readable/hand-editable copies
  layout_{TemplateID}.csv                   handwritten only; YOUR copy, for the Gradescope outline
  template.pdf                              electronic only; for the Gradescope outline
```

The shape exists because prose alone was not enough: having removed the answer key from the student
spec, the largest remaining disclosure path is an instructor handing out the whole ZIP, and "attach the
one file that is not in a folder" is a thing a person can actually do correctly. The notice is
**generated from the entry list**, never hand-maintained — a notice that drifts out of step with the
folder is worse than none, because it will be believed. A test asserts every file it names is present,
that it names all four answer-bearing files, and that it never tells anyone to hand out one of them.

Nothing in the suite unzips this archive by a hand-written path, so the shape breaks no consumer.

### One download, ONE file to attach, and the map inside the spec

**The student package is one file, and that is what an instructor attaches.** `student/` is gone from
the written archive; its two files live inside `{stem}_FOR_STUDENTS.zip` and nowhere else, so no second
copy can drift and there is nothing loose to post by mistake — or, worse, to attach only half of.

| File | What a student does with it |
|---|---|
| `{stem}.pdf` | Print it. On a handwritten assignment this *is* the answer surface. |
| `{stem}_OPEN_IN_APP.json` | Load it into the Submission app. One file, nothing to open, and the layout map is inside it. |

**Both moves happened on 2026-09-06 and the second corrected the first.** The two student files were
briefly loose at the archive root. That was wrong for a reason the first change did not weigh: an
instructor building a Canvas assignment attaches **one** file, so two loose files means selecting and
attaching both — **assembly, which is the thing this whole line of work exists to remove.** The reason
they were moved out has since gone: the package then held three files, one of them an editable CSV, so
a student opening it faced a confusing choice. The map now travels inside the spec, so the package
holds exactly two files and both names say what to do with them.

**The map travels inside the spec, verbatim.** The spec payload gained two optional fields,
`layoutCsvName` and `layoutCsv` — both present or both absent, never one — and `layoutCsv` holds **the
exact text of `instructor/layout_{TemplateID}.csv`: not reformatted, not converted to JSON, not
normalised.**

That is not fastidiousness, it is the whole reason this is safe. `layout_id` is the SHA-256 of
`canonicalMapSerialization(rows)` — the **parsed rows**, not the file bytes — so a consumer that
embeds the same text and parses it with the same parser gets identical rows *by construction*, and the
hash cannot move. Reformat the text on the way in and that stops being a fact and becomes an argument.
The hash is printed into the QR on every page of every sheet already in existence: every other mistake
in the export is a redeploy, this one is a reprint.

Asserted before a byte is written, over the artifact rather than the intention: the spec is decoded
exactly as a student's browser decodes it and its `layoutCsv` compared character for character with
the copy written to `instructor/`. A difference of one character **stops the export**. So does a spec
carrying one of the two fields, a handwritten spec carrying neither, and an electronic spec carrying
either.

**And again after packaging**, out of the bytes of the zip that will ship: two entries at its root, no
prefix, nothing answer-bearing, and the map inside the packaged spec still byte-identical to the
instructor's copy. That check is not a restatement of the one above — a prefix added while writing, an
entry written twice, or a spec re-encoded on the way in are all invisible to a check that stops at the
entry map.

The instructor keeps a copy of the map because setting up the Gradescope outline is an instructor
task. It is under `instructor/` and **must not be posted**: the notice says so by name, because an
instructor who remembers the old rule that "the map must travel with the PDF" would otherwise post it,
and nothing downstream would object.

### The names

| Name | For | Why it reads that way |
|---|---|---|
| `{stem}_INSTRUCTOR_ONLY.zip` | the instructor | the one download; **contains the grading rubric** |
| `{stem}_FOR_STUDENTS.zip` | the instructor | the one file to attach to Canvas, ready as it comes |
| `{stem}.pdf` | the student | a PDF has one obvious use, so it needs no instruction |
| `{stem}_OPEN_IN_APP.json` | the student | a `.json` is inert to a student, so it carries the instruction — and it names the destination that is **not** the grading site |

**Why not `_UPLOAD`** (decided 2026-09-06, after it was the first proposal). The student workflow
contains **two uploads**: this file into the Submission app, and the finished submission archive into
Gradescope. "Upload" is therefore the one word that appears at both destinations, which makes it the
one word that cannot tell them apart — and the failure it invites is a student uploading their
assignment file to Gradescope, where it is accepted and the autograder fails. `_OPEN_IN_APP` names the
destination that is not the grading site.

Naming the app instead was considered and rejected: **"GradeBridge" and "Gradescope" are four
characters apart and both begin "Grade"**, so a filename that names the product discriminates worse
than one that does not.

**This renamed the export download.** What used to arrive as `{stem}_Export.zip` is now
`{stem}_INSTRUCTOR_ONLY.zip`; folders already unzipped from an older download keep the name they have.
`Export` is the word that failed — it named the operation and said nothing about who the file was for,
so the reader had to already know.

**The two files inside the package deliberately do not say `FOR_STUDENTS`.** That suffix tells an
*instructor* which file to attach, and it belongs on the package, not on its contents. The two names
inside are read by a student, to whom "for students" says nothing they do not already know. Exactly
one of them carries an instruction, and it is the one whose misuse is the failure.

The student files are selected by **filtering the same entry map the archive is built from**, never
from a second list of filenames — two lists is how the two would come to disagree about what is
student-facing, and the disagreement would be silent. Before a byte is written it is asserted: every
entry came from `student/`, none is nested, no instructor file or notice is among them, and the
contents are *exactly* the two files. Anything else **stops the export** rather than producing an
archive that goes to a whole class at once and cannot be recalled.

The package is **stored, not deflated** — it is already a compressed archive, so deflating it again
costs time on every export and saves nothing. The archive around it *is* deflated, which is what makes
that exception load-bearing rather than a restatement of JSZip's default.

**One download per user gesture, and that is not a style choice.** Measured in Chrome 152 on
2026-09-06: three programmatic downloads from a single user gesture delivered **one** file, with the
other two silently dropped — no exception, nothing in the console — and once Chrome had blocked
automatic downloads for the site, a *single* download from it failed silently too. An export that
produces one archive cannot break that rule; a rule saying "never call this twice" is one someone has
to keep.

### Which file restores your work

**`instructor/{stem}_authoring_backup.json`, and only that one.** It holds the entire authoring object,
unencrypted, and Import JSON restores it exactly. The others each lose something, and until 2026-08-31
they lost it *silently* — the import succeeded, nothing warned, and the assignment opened looking
complete:

| Route | Restores | Loses |
|---|---|---|
| `{stem}_authoring_backup.json` → Import JSON | **everything** | — |
| `{stem}.md` → Import Markdown | prompts byte-for-byte, `answerLines`, `handwrittenGradingMode`, `inputMode`, `pageFormatId`, `aiFeedback`, **`targetPoints`, reconstructed from the file's own total** (2026-09-01), and **`coursePublicKey`** (2026-09-05) | `config` |
| `{stem}_OPEN_IN_APP.json` → Import JSON | what a student needs | `aiGradingPrompt`, `graderNote`, `answerLines`, `handwrittenGradingMode`, `targetPoints` |

Two of those losses are worse than they look:

- **`answerLines`.** Every part reverts to the six-line default, so the sheet repaginates and
  `layout_id` moves. You do not get your assignment back; you get a different one that looks like
  yours.
- **`targetPoints`, and the damage is delayed by one cycle.** The `.md` carries already-scaled point
  values, so the reimport reads 200 and everything looks right. The *target* is gone, so the NEXT
  export normalises to the default 100 and halves every point. The instructor sees a correct
  assignment, exports it, and gets a different one.
  **Fixed at the source on 2026-09-01** (§8): the `.md` route no longer loses the target, because the
  import reconstructs it from the file's own total, and any remaining disagreement between the total
  and the target is put to the instructor before the export writes anything. The warning stayed —
  naming the loss was never a substitute for not losing it, and it was not enough: the amber badge was
  showing on all three ENG17 homeworks each of the three times they exported at half their points.

**Import now names what a file does not carry**, at the one moment the instructor can act on it. It
reports absence rather than inferring it from the file's kind, so an assignment that genuinely has no
grading prompts is not warned about prompts it never had — a warning nobody believes is silent loss
with extra steps.

### Why completeness is one file's job

Each artifact gets one job, so the guarantees stop fighting each other: the spec is **minimal**, the
`.md` is **human-writable**, the backup is **complete**. Completeness is now one property of one file
with one test — a round trip over a fixture that carries every field the type declares, checked
against `types.ts` itself so it fails when a field is added and not carried. Before, completeness was
something that had to be re-verified on two other routes every time anyone touched `Assignment`, which
is a guarantee that decays quietly.

The backup is **unencrypted**, deliberately and consistently: the grader document and the grading
rubric sit beside it in the clear and are already full of answers. Encrypting a backup only makes it
harder to recover from — and recovery is the entire point of the file.
