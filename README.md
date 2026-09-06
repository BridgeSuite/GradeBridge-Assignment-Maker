# GradeBridge Assignment Maker

Author structured assignments with LaTeX and figures, and export the printable sheet, the student file and the grading materials your grading workflow needs — entirely in your browser.

Assignments come in two **input modes**. In **electronic** mode the student types answers and uploads images in the Student Submission app. In **handwritten** mode the app generates a printable QR-registered sheet: the student prints it, writes on it by hand, photographs the pages, and the Submission app crops each answer region from the photographs. One assignment is one mode — you choose it in the editor, and it decides which question types are available and what the export contains.

![License](https://img.shields.io/badge/license-MIT-green.svg)

**[Live App](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)** | **[Student Submission App](https://bridgesuite.github.io/GradeBridge-Student-Submission/)**

---

## The Apps

GradeBridge apps share an encryption contract and a Gradescope-Docker autograder pattern. This app handles lab reports, mini-projects and homework — typed, image-based and AI-graded responses in electronic mode, and printed-and-photographed work in handwritten mode.

| App | Who uses it | What it does |
|---|---|---|
| **Assignment Maker** (this app) | Instructor | Create assignments, configure grading, export ZIP |
| **[Student Submission](https://github.com/BridgeSuite/GradeBridge-Student-Submission)** | Student | Load assignment, fill answers, download submission files |

### What the export ZIP contains

**The ZIP is for you. It MUST NOT be given to students** — four files in
`instructor/` contain the answer key. **Post the two files at the root that are
not in a folder, and nothing else.** The archive is laid out so that is easy to
do correctly, and it carries a generated notice at the root naming every file.

`{stem}` below is `{CourseCode}_{Title}`, with spaces replaced by underscores.

| Entry | Mode | What it is |
|---|---|---|
| `00_INSTRUCTOR_ONLY_DO_NOT_DISTRIBUTE.txt` | both | Generated at export time from the actual entry list; names every file and who it is for |
| `{stem}.pdf` | both | **GIVE TO STUDENTS.** Electronic: the handout. **Handwritten: the sheet itself** — the QR-registered pages the student prints and writes on |
| `{stem}_OPEN_IN_APP.json` | both | **GIVE TO STUDENTS.** The one file they load into the Submission app. **Encoded** (`gb1:` envelope) and built from a whitelist, so it carries no grading prompt, grader note or answer key — and on a handwritten assignment it carries the layout map inside it, so there is no second file to load and nothing to open |
| `instructor/layout_{TemplateID}.csv` | **handwritten only** | **Your copy** of the map the Submission app crops answers by, for setting up the Gradescope outline. The student's copy is inside `{stem}_OPEN_IN_APP.json`, byte for byte. **Do not post this**: students no longer need it, and it is the map their answers are cut from |
| `instructor/{stem}_authoring_backup.json` | both | **The backup that restores everything.** Unencrypted, the whole authoring object. This is what `Import JSON` should be given |
| `instructor/{stem}.md` | both | The authored source, for the `.md` round trip |
| `instructor/{stem}_grading_rubric.json` | both | **Private — for the Gradescope autograder** |
| `instructor/{stem}_grader_document.html` | both | **Private — rubrics and answer keys**, for you and your TAs |
| `instructor/assignment.html` | both | Readable copy |
| `instructor/assignment.tex` | both | Editable LaTeX source |
| `instructor/template.pdf` | **electronic only** | The boxed answer-region sheet for setting up the Gradescope outline. That is an instructor task, so it is not a student file. A handwritten assignment does not produce one — `{stem}.pdf` already *is* the answer surface, and a second boxed PDF only invites printing the wrong one |

Ten entries in either mode. Built by `buildExportEntries` in
`services/exportService.ts`; `ASSIGNMENT_MD_SPEC.md` §13 is the contract.

**Changed 2026-09-06:** the student package used to be a `{stem}_FOR_STUDENTS.zip`
nested in this archive. A student had to open it to reach the sheet they print,
and that put the layout map — plain text, editable, and the file that decides
where their answers are cut from — in front of them, along with a second
candidate to upload. There is no student zip any more.

---

## Submission Types and Grading Modes

Each subsection has a **Type** selector and a **Grading** selector. The two branch based on medium.

**Which types are available depends on the assignment's input mode.** An electronic
assignment uses Text, Image and Text + Image; a handwritten one uses Handwritten
for every part. The editor enforces this, and switching an existing assignment
between modes converts its parts.

### Text questions *(electronic)*

`Type: [Text] [Image] [Text + Image]  |  Grading: [Human] | AI: [Binary] [Short] [Medium] [Long]`

| Grading selection | What it means | Autograded? |
|---|---|---|
| **Human** | TA reviews the student's written answer | No |
| **AI: Binary** | Student states yes/no and briefly justifies; AI grades | Yes — 2 bands, 20 word min |
| **AI: Short** | Student answers a focused concept question; AI grades | Yes — 3 bands, 50 word min |
| **AI: Medium** | Student explains a mechanism or relationship; AI grades | Yes — 4 bands, 100 word min |
| **AI: Long** | Student analyses trade-offs or synthesises across concepts; AI grades | Yes — 5 bands, 150 word min |

### Image questions *(electronic)*

`Type: [Text] [Image] [Text + Image]  pages: __  |  Grading: [Human Inspection] [AI Inspection]`

| Grading selection | What it means | Autograded? |
|---|---|---|
| **Human Inspection** *(default)* | TA reviews the uploaded image | No |
| **AI Inspection** | Autograder checks `images_submitted > 0`; awards full marks automatically | Yes |

Set the number of image pages allowed with the **pages** field (e.g. 6 for a quiz transcript).

### Text + Image questions *(electronic)*

`Type: [Text] [Image] [Text + Image]  image pages: __  |  Grading: [Human]`

Student submits both a written answer and one or more supporting images in a single subsection slot. Always human-graded — the TA reviews both the text response and the uploaded image(s) in the PDF. Set the maximum number of image pages with the **image pages** field.

### Handwritten questions

`Type: [Handwritten]  |  Grading: [AI] [Human]`

The whole assignment is printed and answered on paper. The app generates a
QR-registered sheet; the student prints it at 100%, writes in the bordered answer
box under each part, photographs the pages, and the Submission app uses the QR
codes and corner marks to find each box and crop it.

| Grading selection | What it means | Autograded? |
|---|---|---|
| **AI** | The crop is transcribed (OCR) and then AI-graded against the part's `grading_prompt` | Yes |
| **Human** | The TA grades from the crop; no OCR | No |

Two things are set per part rather than per assignment:

- **How much room the student gets.** Each part reserves a number of writing
  lines. A part that asks for more room than a page can give moves to a page that
  can hold it — page count flexes, and question text is never shrunk to fit.
- **Whether the answer is a drawing.** A sketch part reserves the same space with
  no ruled lines, and declares itself as a figure rather than as writing so the
  grading system does not send a circuit diagram to a text transcriber.

Both are written in the `.md` with a `> template:` line — see
[Submission Type Tags](#submission-type-tags) below.

**Page 1 is always an instructions page**, carrying the standing instructions and
your preamble and no questions; problems begin on page 2. It is not cropped and
is not graded. The full page format is in `ASSIGNMENT_MD_SPEC.md` §10.

**There is no name, student ID or date field on the sheet**, deliberately — see
[Data & Privacy](#student-privacy).

---

## Point Scaling

The editor header shows a running total of all subsection points. You can set any point total you like — 100 is the default, but 50, 150, or any other value works equally well.

**To change the total:**
1. Enter the desired total in the **Target** field in the editor header.
2. If the current total does not match the target, a **Rescale** button appears.
3. Click **Rescale** — all subsection values scale proportionally, with any rounding remainder absorbed by the highest-value subsection.

The target is saved with the assignment and applied automatically at ZIP export (including the grading rubric and assignment spec).

---

## Quick Start

### Option A — Start from scratch
1. Open the [Live App](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)
2. Click **New Assignment**
3. Fill in course code, title, and preamble
4. Add problems and subsections; use the **Type** and **Grading** selectors
5. For AI-graded questions, write the grading rubric in the rubric field
6. Click **Export** to download the ZIP

### Option B — Import a Markdown file (recommended for bulk authoring)
1. Author an assignment in `.md` format (see [Markdown Format](#markdown-assignment-format) below)
2. Click **Import Markdown** on the dashboard
3. The app parses the file instantly and opens it in the editor
4. Review, fine-tune, and export

### Option C — Generate and iterate with Claude Code
The `.md` format is plain text, so an assistant can write one from your lab
manual and read back whatever you changed afterwards. Point it at
[Markdown Assignment Format](#markdown-assignment-format) below and at
`ASSIGNMENT_MD_SPEC.md`, which is the authoritative format contract and is
written to be handed to a tool.

The loop, which means you never have to explain your edits in prose:

1. The assistant generates `DEMO101_Lab1_Prelab.md` from your lab manual
2. Click **Import Markdown** → assignment opens in the editor
3. Make changes in the UI (adjust points, tweak descriptions, edit rubrics)
4. Click **Export .md** (top-right of editor) → downloads the updated `.md` with all changes
5. Next session: *"read DEMO101_Lab1_Prelab.md"* — it sees exactly the current state, no explanation needed

---

## Markdown Assignment Format

Assignments can be authored as plain `.md` files and imported directly into the app.

### File Structure

Two equivalent formats are supported — use whichever is more natural:

**Multi-subsection problems** (standard — required when a problem has more than one part):
```markdown
# {CourseCode}: {Assignment Title}

**Preamble:** One or two sentences of general instructions for students.

## Problem {N}: {Problem Name}
Optional problem description shared across subsections.

### ({letter}) {Subsection Name} [{points} pts] [{type}]
Subsection description. LaTeX supported (see Math notation).

> grading_prompt: Rubric text here. (ai-graded subsections only)
```

**Flat single-subsection problems** (shorthand — points and type on the `##` line):
```markdown
## Problem {N}: {Problem Name} [{points} pts] [{type}]
Subsection description. LaTeX supported (see Math notation).

> grading_prompt: Rubric text here. (ai-graded subsections only)
```

The parser auto-promotes a flat problem into a single `(a)` subsection on import. Both formats round-trip correctly through Export .md.

### Submission Type Tags

| Tag | Creates | Notes |
|---|---|---|
| `[text]` | Text answer box | Human-graded by default |
| `[image]` | Single image upload | Human Inspection by default |
| `[image:N]` | Image upload, N pages | e.g. `[image:6]` for a quiz transcript |
| `[text+image]` | Text answer + single image upload | Human-graded; TA reviews both |
| `[text+image:N]` | Text answer + N image pages | e.g. `[text+image:2]` |
| `[ai-graded:binary]` | Yes/no free-text, AI graded | 20 word min; 2 grading bands |
| `[ai-graded:short]` | Short free-text, AI graded | 50 word min; 3 grading bands |
| `[ai-graded:medium]` | Medium free-text, AI graded | 100 word min; 4 grading bands |
| `[ai-graded:long]` | Long free-text, AI graded | 150 word min; 5 grading bands |
| `[handwritten]` | Handwritten answer, OCR then AI graded | Handwritten assignments only |
| `[handwritten:human]` | Handwritten answer, TA grades from the crop | Handwritten assignments only |

The first seven are for **electronic** assignments; the two `handwritten` tags
are for **handwritten** ones. A handwritten assignment declares itself with a
`**Input:** handwritten` line under the title — absent means electronic.

**Handwritten parts take no image count.** Pages are an assignment-level pool,
not a per-part count, so `[handwritten:3]` is not a thing.

### The `> template:` line *(handwritten only)*

One optional line per handwritten sub-part, controlling the printed sheet:

```markdown
### (a) Derive the cutoff frequency [12 pts] [handwritten]
State your assumptions and show the algebra.

> template: lines=14
> grading_prompt: Required elements: (1) ...; (2) ...

### (b) Sketch the field pattern [8 pts] [handwritten:human]
Label the direction and the relative magnitude.

> template: sketch
> grader_note: Look for ...
```

| Option | Effect |
|---|---|
| `lines=N` | Reserve **N** writing lines for this answer. The lines printed are exactly the region the layout map crops, so this is the space the grader sees. Absent means 6 |
| `sketch` | A drawing region: the same reserved space, left blank with no rules, and declared as `answer_modality: "figure"` in the rubric |

Both are optional and order-free — `> template: sketch` alone is valid, and so is
`> template: lines=20, sketch`. A part that asks for more lines than fit beneath
its own problem stem is moved to a page that can give them rather than being
silently shortened.

Which grading block a handwritten part takes follows its tag: `[handwritten]` is
AI-graded and takes `> grading_prompt:`; `[handwritten:human]` takes
`> grader_note:`.

### Math notation (LaTeX)

Subsection descriptions support LaTeX math, rendered with KaTeX.

- **Inline:** single dollars, `$...$` — e.g. `$V_x = 6\,\text{V}$`, `$I = 0.1\,V_x$`.
- **Display:** double dollars, `$$...$$` — a centered block equation.
- Use LaTeX for anything with structure: subscripts `$V_x$`, fractions `$\frac{17}{7}$`,
  exponentials `$e^{-0.2(t-8)}$`, Greek and units `$\Omega$`. Plain text is fine for a bare symbol
  with no structure.
- Every `$` must be paired; an inline expression may not contain a `$`; a literal dollar sign in
  prose will be mis-parsed as a delimiter. Invalid LaTeX is never dropped silently: KaTeX flags the
  offending part in the rendered output (rendering uses `throwOnError: false`), and if rendering fails
  outright the raw expression is shown with its delimiters. Keep the LaTeX valid.

Single-dollar inline works because rendering uses a custom splitter (`components/FormattedText.tsx`),
not KaTeX auto-render. The exported PDF (`services/exportService.ts`) uses the same `$...$` and
`$$...$$` delimiters, and the Student Submission app uses the same convention, so what you preview is
what the student sees.

### Grading Prompt Format

Every `[ai-graded:*]` subsection must have a `> grading_prompt:` block. The rubric must be fully self-contained — the autograder sees only the rubric and the student's response, nothing else.

Every rubric (except binary) must begin with a `Required elements:` list. Bands are defined by how many elements are present.

**Binary (2 bands):**
```
> grading_prompt: The correct answer is YES. Award full marks for any response that
> clearly and correctly answers yes to the question, regardless of phrasing used.
> Award no credit for responses that give the incorrect answer or are non-committal.
> Do not deduct marks for grammar or writing style.
```

**Short (3 bands):**
```
> grading_prompt: Required elements: (1) [complete technical statement]; (2) [complete technical statement].
> Award full marks for responses that correctly address both elements.
> Award partial credit for responses that correctly address only one element, or address both with a significant inaccuracy.
> Award no credit for responses that address neither element or are off-topic.
> Do not deduct marks for grammar or writing style.
```

**Medium (4 bands)** and **Long (5 bands)** follow the same pattern with 3 and 4 required elements respectively.

### Complete Example

```markdown
# DEMO101: Lab 1 Prelab

**Preamble:** Complete all problems before your scheduled lab session.

## Problem 1: AI Exploration

### (a) Original quiz prompt draft [5 pts] [image]
Take a screenshot of your draft prompt and add your name before uploading.

Your name must be visible in the image before uploading.

### (b) Quiz transcript [10 pts] [image:6]
Run the quiz and capture the complete exchange. Zoom your browser out if needed to fit more content per image.

Your name must be visible in the image before uploading.

## Problem 2: Formal Reflection

### (a) Written reflection [75 pts] [ai-graded:long]
Write a formal reflection of 150–250 words addressing the three required points.

> grading_prompt: Required elements: (1) differential wiring protects signal quality by measuring
> the voltage difference between two lines rather than one line against ground, so equal noise on
> both lines cancels at the differential input; (2) a specific mechanism term (common-mode rejection
> or quantization error) is used to explain a physical process, not merely named; (3) a specific
> concrete wiring mistake is identified with its observable consequence.
> Award full marks for responses that correctly address all three elements.
> Award most marks for responses that correctly address two elements, with one minor gap.
> Award partial credit for responses that correctly address one element.
> Award minimal credit for responses that correctly address only one element partially.
> Award no credit for responses that address none of the elements or are off-topic.
> Do not deduct marks for grammar or writing style.

## Problem 3: Software Installation

### (a) Scopy screenshot [10 pts] [image]
Connect your M2K, open Scopy, and upload a screenshot confirming device recognition.

Your name must be visible in the image before uploading.
```

Point total: 5 + 10 + 75 + 10 = **100 pts** ✓

---

## Grading Rubric JSON

The exported `{Course}_{Title}_grading_rubric.json` is the file your Gradescope autograder reads. Keep it private — do not distribute to students.

```json
{
  "assignment_id": "DEMO101_Lab1_Prelab",
  "course_code": "DEMO101",
  "assignment_title": "Lab 1 Prelab",
  "rubrics": {
    "p1s0": {
      "subsection_id": "p1s0",
      "max_points": 75,
      "grading_type": "ai",
      "answer_modality": "text",
      "grading_prompt": "Required elements: (1) ...; (2) ...",
      "min_words": 150
    },
    "p0s0": {
      "subsection_id": "p0s0",
      "max_points": 5,
      "grading_type": "human_image",
      "grading_prompt": ""
    }
  }
}
```

**The rubric never carries a model name, a temperature or a token budget.** The Assignment Maker
describes the work; the grading system decides how to grade it and allocates its own resources. A
test fails if any exported artifact grows one. See `ASSIGNMENT_MD_SPEC.md` §12.

`grading_type` values:

| Value | Meaning |
|---|---|
| `"ai"` | AI-graded text response (scored) |
| `"human"` | TA reviews text response (also used for Text + Image) |
| `"human_image"` | TA reviews uploaded image |
| `"ai_image_completion"` | Auto-award if `images_submitted > 0` |
| `"ai_handwritten"` | Handwritten part, OCR then AI-graded from the page crop |
| `"human_handwritten"` | Handwritten part, TA grades from the page crop |

`answer_modality` is **optional**: `"text"` (a written answer), `"figure"` (a drawing — a `handwritten`
part authored `> template: sketch`), or **absent** where the app does not know — an `[image]` or
`[text+image]` part is answered with a picture but carries no modality declaration. `"hybrid"` is
reserved and not emitted. Do not read an absent field as `"text"`. Every part of a handwritten
assignment carries it, and it agrees with `is_drawing` in `layout_{TemplateID}.csv`.

---

## Data & Privacy

### Student privacy

**This tool collects no student-identifying information, and prints none.**

- **No export path carries a name or student ID field**, in either input mode.
  There is no such line on a handwritten sheet, on a typed sheet, or in the
  LaTeX source. A test asserts it on the built artifact in both modes and fails
  if one is reintroduced.
- **The handwritten sheet tells the student not to write one**: *"Do not write
  your name or student ID anywhere on these pages. You are identified when you
  upload."*
- **Identity is established by the student's authenticated upload** to their
  institution's learning management system, under the agreement the institution
  already holds. This tool is not part of that step and never sees the result.
- **The student file carries no grading material.** `{stem}_OPEN_IN_APP.json` is
  built from an explicit whitelist, and a content check asserts that no grading
  prompt, grader note or reference answer reaches any student-facing artifact,
  by content rather than by field name.

### Where your data goes

**Your assignments never leave your browser.** They are held in
`localStorage`, and every export is generated locally and saved by your browser's
own download. There is no account, no backend and no telemetry: nothing you author
is transmitted anywhere.

**The page contacts nothing but the server it was served from.** Not the CSS
framework, not the typefaces, not the maths renderer — all of them are compiled
or embedded into the app's own files and served from the same origin. Loading the
built app and recording every request, the list of third-party origins fetched at
page load, and after exercising the dashboard, the editor and the preview, is
**empty**.

Exports are built in the browser and saved through your browser's own download.
There is no upload step anywhere in this app, which is why your assignments
staying local is a property of its design rather than a promise about a server.

A test asserts it, on the built output rather than on the source: any host in a
fetch position — in the HTML, in the stylesheet, or in any emitted script — fails
the suite. Inter and Merriweather are served from this site under their SIL Open
Font Licences, which the build emits alongside them.

- **Export your JSON regularly** — data is lost if browser cache is cleared
- **The export ZIP is instructor-only and MUST NOT be given to students.** Four files in its `instructor/` folder contain answers: `{stem}_grader_document.html`, `{stem}_grading_rubric.json`, `{stem}_authoring_backup.json` and `{stem}.md`. Students receive only the two files at the archive root that are not in a folder: `{stem}.pdf` and `{stem}_OPEN_IN_APP.json`. The ZIP carries a generated `00_INSTRUCTOR_ONLY_DO_NOT_DISTRIBUTE.txt` at its root naming every file.
- **`{stem}_authoring_backup.json` (in `instructor/`) is the file that restores an assignment completely** — the whole authoring object, unencrypted, including the grading prompts, grader notes, answer-space settings, the point target and the course public key. It is what Import JSON should be given. `{stem}_OPEN_IN_APP.json` (the student spec) restores only what a student needs, and Import Markdown misses `config`; both now say so on import rather than losing your work silently. (Import Markdown used to miss `targetPoints` too — fixed 2026-09-01, it now reads the file's own total — and `coursePublicKey`, fixed 2026-09-05, which the `.md` now carries as a fenced `` ```pem `` block.)
- **`aiGradingPrompt` and `graderNote` are NOT in the student spec (`{stem}_OPEN_IN_APP.json`).** The student's file is built from an explicit whitelist of the fields the Submission app reads, so no grading prompt, grader note, answer key or reference solution travels to a student's browser. Until 2026-08-31 the spec was the whole assignment object and did carry every prompt — if you hold an export made before then, treat its rubrics as disclosed. Nothing had been distributed.
- **To reload an assignment as a template, use `Export .md` → `Import Markdown`**, which carries the prompts and grader notes in full. Importing an exported student spec restores the questions but not the grading material, because that material is no longer in the file.
- Your rubrics reach the autograder by their proper route, `{Course}_{Title}_grading_rubric.json`, which stays with you

---

## Course public key (hardened `gb2` submissions)

Optional, per assignment, in the editor under the preamble. Paste the **public**
key issued for your course — SPKI PEM, starting with
`-----BEGIN PUBLIC KEY-----` — and it is carried in the exported
`{stem}_OPEN_IN_APP.json` as `coursePublicKey`, and in the exported `.md` as a
fenced `` ```pem `` block at the top of the file, so `Export .md` →
`Import Markdown` gives the key back. Until 2026-09-05 that round trip dropped
it in silence and the next export quietly fell back to `gb1`.

Setting a key selects the hardened `gb2` envelope for submissions; leaving it
empty keeps the existing `gb1` default. Under `gb2` a per-submission AES key is
wrapped with your course key, so only the autograder's matching private key can
open a submission.

**What a submission actually contains is not specified here.** This app does not
build submissions, and a second copy of another app's contract drifts the moment
that contract moves. The payload, its encodings and its filenames are specified
in the Student Submission app's
[`AUTOGRADER_ZIP_SPEC.md`](https://github.com/BridgeSuite/GradeBridge-Student-Submission/blob/main/AUTOGRADER_ZIP_SPEC.md),
**which governs**. This page previously restated that contract, went stale when
it changed, and described the student's name as travelling in places it no
longer does.

Identity comes from the student's authenticated upload to their institution's
LMS.

The field validates on blur and reports the key size. It refuses PKCS#1 keys
(`BEGIN RSA PUBLIC KEY`) and — emphatically — anything containing a private
key. **This app never generates keypairs and must never be given a private
key**; your institution issues the pair and holds the private half. An
assignment whose key does not validate will not save, and will not export.

Leaving the field empty keeps today's behaviour exactly.

---

## Local Development

```bash
git clone https://github.com/BridgeSuite/GradeBridge-Assignment-Maker.git
cd GradeBridge-Assignment-Maker
npm install
git config core.hooksPath .githooks   # runs tsc and the suite before a push

npm run dev       # → http://localhost:3000/GradeBridge-Assignment-Maker/
npm run build     # production build
npm run test      # the full suite — see tests/README.md
npm run deploy    # deploy to GitHub Pages (SSH remote required)
```

`npm test` runs five suites in one command: the app's own tests, the page-format
template tests, a real production build inspected for what it emits, and two
scans of the repository itself (no personal name, absolute path or image
metadata; no tracked session document). CI runs the same thing on every push.

**Tech stack:** React 18 · TypeScript · Vite · Tailwind CSS · KaTeX · jsPDF · JSZip · Lucide

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Import Markdown fails | Check heading levels (`#`, `##`, `###`) and tag format (`[N pts] [type]`). Both flat and subsection formats are supported — see Markdown Format above |
| LaTeX not rendering | Check the expression: every `$` must be paired, and an inline `$...$` may not contain a `$`. KaTeX is bundled into the app, so this is never a network problem — invalid LaTeX is flagged in place rather than dropped |
| PDF generation slow | Large images slow down PDF generation — reduce image count or size |
| Lost work | Export JSON backup regularly; localStorage is cleared with browser cache |
| Deploy returns 403 | SSH remote required — run `git remote set-url origin git@github.com:BridgeSuite/GradeBridge-Assignment-Maker.git` |

---

## Links

- **Live App:** [bridgesuite.github.io/GradeBridge-Assignment-Maker](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)
- **Student App:** [bridgesuite.github.io/GradeBridge-Student-Submission](https://bridgesuite.github.io/GradeBridge-Student-Submission/)
- **Issues:** [GitHub Issues](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues)

---

MIT License · © 2026 The Regents of the University of California · Provided free by **UC Davis**
