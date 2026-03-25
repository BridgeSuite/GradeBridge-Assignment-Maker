# GradeBridge Assignment Maker

Create structured assignments with LaTeX support and Gradescope AI-autograding integration — entirely in your browser.

![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**[Live App](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)** | **[Student Submission App](https://bridgesuite.github.io/GradeBridge-Student-Submission/)**

---

## The Two-App Workflow

| App | Who uses it | What it does |
|---|---|---|
| **Assignment Maker** (this app) | Instructor | Create assignments, configure grading, export ZIP |
| **[Student Submission](https://github.com/BridgeSuite/GradeBridge-Student-Submission)** | Student | Load assignment, fill answers, download submission files |

**Export ZIP contains six files:**

| File | Purpose |
|---|---|
| `assignment_spec.json` | Students load this into the Submission app |
| `assignment.pdf` | Student-facing assignment handout |
| `template.pdf` | Gradescope upload template |
| `assignment.html` | Web-viewable version |
| `assignment.tex` | Editable LaTeX source |
| `{Course}_{Title}_grading_rubric.json` | **Private — upload to Gradescope autograder** |

---

## Submission Types & Grading Modes

Each subsection has a **Grading Mode** toggle that sets both the question type and point value in one click:

| Toggle | Points | Type set to | Autograded? |
|---|---|---|---|
| **Completion Auto** | 1 pt | unchanged | — |
| **Completion Human** | 3 pts | unchanged | TA reviews |
| **AI Reflective** | 100 pts | AI Reflective | Yes — AI rubric |

Submission types available:

| Type | Student submits | Notes |
|---|---|---|
| `Text` | Typed answer | LaTeX math supported |
| `Image` | Photo / screenshot | Set max pages with the Pages field |
| `AI Reflective` | Reflective text | AI-graded against your rubric; live word counter for students |
| `True/False` | Toggle button | Set the correct answer in the editor |

---

## Quick Start

### Option A — Start from scratch
1. Open the [Live App](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)
2. Click **New Assignment**
3. Fill in course code, title, due date, and instructions
4. Add problems and subsections; use the **Grading Mode** toggles
5. For AI Reflective questions, write a grading rubric in the rubric field
6. Click **Export** to download the ZIP

### Option B — Import a Markdown file (recommended for bulk authoring)
1. Author an assignment in `.md` format (see [Markdown Format](#markdown-assignment-format) below)
2. Click **Import Markdown** on the dashboard
3. The app parses the file instantly and opens it in the editor
4. Review, fine-tune, and export

> **Tip:** Use Claude Code (CC) to generate the `.md` file from your lab manual — see [CC Prompt](#cc-prompt-generate-md-from-a-lab-manual) below.

### Option C — Iterating with Claude Code (CC)

The `.md` format enables a tight CC iteration loop so you never need to manually explain changes:

1. CC generates `EEC1_Lab1_InLab.md` from your lab manual
2. Click **Import Markdown** → assignment opens in the editor
3. Make changes in the UI (adjust points, tweak descriptions, add rubrics, reorder problems)
4. Click **Export .md** (top-right of editor) → downloads the updated `.md` with all your changes reflected
5. Next CC session: *"read EEC1_Lab1_InLab.md"* — CC sees exactly the current state, no explanation needed

This keeps the `.md` file as the single source of truth across both the app and CC.

---

## Markdown Assignment Format

Assignments can be authored as plain `.md` files and imported directly into the app. This is the recommended workflow for bulk assignment preparation.

### File Structure

```markdown
# {CourseCode}: {Assignment Title}

**Due:** YYYY-MM-DD at HH:MM
**Preamble:** One or two sentences of general instructions for students.

## Problem {N}: {Problem Name}
Optional problem description. One paragraph max. LaTeX supported with $...$.

### ({letter}) {Subsection Name} [{points} pts] [{type}]
Optional subsection description. LaTeX supported.

> grading_prompt: Rubric text. Only for ai-reflective subsections.

> correct_answer: true
```
*(true-false only — value must be exactly `true` or `false`)*

### Submission Type Tags

| Tag | Creates | Notes |
|---|---|---|
| `[text]` | Text answer box | Default |
| `[image]` | Single image upload | |
| `[image:N]` | Image upload, N pages | e.g. `[image:3]` |
| `[ai-reflective]` | Reflective text, AI graded | Must include `> grading_prompt:` |
| `[true-false]` | True / False toggle | Must include `> correct_answer: true` or `false` |

### Auto-Upgrade Rule

**If a `> grading_prompt:` block is present on any subsection, the importer automatically sets the type to `AI Reflective`** — the point value in the `[N pts]` tag is always respected. This means you can add a rubric to an existing question (e.g. one tagged `[text]`) and the importer will upgrade the type automatically while keeping whatever points you set.

### Grading Prompt Format

```
> grading_prompt: Award {high} pts for responses that {specific full-marks criteria}.
> Award {mid} pts for responses that {partial credit criteria}.
> Award 0–{low} pts for responses that {minimal/no credit criteria}.
> Do not deduct marks for grammar or writing style.
```

Multi-line blockquotes (each line starting with `>`) are joined into a single rubric string.

### Metadata Fields

| Field | Required | Format |
|---|---|---|
| Course code + title | Yes | `# EEC1: Lab 2 Prelab` |
| Due date | Yes | `**Due:** 2026-04-15 at 23:59` |
| Preamble | No | `**Preamble:** Complete before lab session.` |

### Complete Example

```markdown
# EEC1: Lab 2 Prelab

**Due:** 2026-04-15 at 23:59
**Preamble:** Complete all problems before your scheduled lab session. Show all working for calculation questions.

## Problem 1: RC Circuit Analysis

Analyze the RC low-pass filter circuit with $R = 10\,k\Omega$ and $C = 100\,nF$.

### (a) Sketch the circuit [5 pts] [image:2]
Draw the circuit schematic and label all component values.

### (b) Calculate cutoff frequency [10 pts] [text]
Calculate the cutoff frequency using $f_c = \frac{1}{2\pi RC}$. Show full working.

### (c) Is this a low-pass filter? [5 pts] [true-false]
Based on your analysis above, is this circuit a low-pass filter?

> correct_answer: true

## Problem 2: Signal Acquisition

### (a) Reflection [100 pts] [ai-reflective]
Explain why differential wiring was used and how it affects noise rejection.

> grading_prompt: Award 80–100 pts for responses that correctly identify common-mode noise rejection
> as the primary benefit, explain the role of the differential amplifier, and connect this to the
> specific lab circuit. Award 50–79 pts for responses that mention noise reduction without fully
> explaining the mechanism. Award 0–49 pts for vague or off-topic responses.
> Do not deduct marks for grammar or writing style.
```

---

## CC Prompt — Generate .md from a Lab Manual

Use this prompt with Claude Code (CC) to generate a GradeBridge `.md` file directly from your lab manual or assignment description.

**How to use:**
1. Open Claude Code in the `CCAssignmentMaker` directory (or any directory containing `ASSIGNMENT_MD_SPEC.md`)
2. Copy the prompt below and paste your source material at the bottom
3. CC will produce a `.md` file — save it, then use **Import Markdown** in the app

---

```
Read ASSIGNMENT_MD_SPEC.md in this directory before proceeding — it is the authoritative format specification.
Then read the source material I have provided below and generate a GradeBridge assignment .md file following
that specification exactly.

## Output Format Specification

The output must be a single markdown file with this exact structure:

# {CourseCode}: {Assignment Title}

**Due:** YYYY-MM-DD at HH:MM
**Preamble:** One or two sentences of general instructions for students.

## Problem {N}: {Problem Name}
Optional problem description. One paragraph max. LaTeX supported with $...$.

### ({letter}) {Subsection Name} [{points} pts] [{type}]
Optional subsection description. LaTeX supported.

> grading_prompt: Rubric text here. (ai-reflective only)

> correct_answer: true
(true-false only — value must be exactly true or false)

## Submission Types

Use exactly these tags:

| Tag | Use for |
|---|---|
| [text] | Calculation, short answer, derivation |
| [image] | Hand-drawn circuit, schematic, graph, data table |
| [image:N] | Image submission requiring N pages |
| [ai-reflective] | Open-ended reflective or conceptual question graded by AI |
| [true-false] | Binary true/false question |

## Rules You Must Follow

1. Extract or infer the course code and assignment title from the source material
2. If no due date is in the source, use a placeholder: **Due:** YYYY-MM-DD at 23:59
3. Write a concise preamble (1–2 sentences) appropriate for the assignment type
4. Break the assignment into logical problems matching the structure of the source material
5. For each problem, create subsections that map to individual deliverables or questions
6. Assign point values that sum to 100 (or a clear multiple of 10 if specified in the source)
7. Choose the most appropriate submission type for each subsection:
   - Use [image] for anything hand-drawn, sketched, or measured on paper
   - Use [text] for calculations, numerical answers, and short written responses
   - Use [ai-reflective] for open-ended questions asking students to explain, reflect, or justify
   - Use [true-false] for direct binary conceptual checks
8. Every [ai-reflective] subsection MUST have a > grading_prompt: block
9. Every [true-false] subsection MUST have a > correct_answer: true or > correct_answer: false
10. Grading prompts must be specific — define full marks, partial credit, and zero clearly
11. Do not add markdown elements not in this spec (no tables, no code blocks, no horizontal rules)
12. LaTeX math is supported anywhere using $...$ for inline and $$...$$ for display math

## Grading Prompt Standard

Every [ai-reflective] grading prompt must follow this structure:

> grading_prompt: Award {high range} pts for responses that {specific criteria for full marks}.
> Award {mid range} pts for responses that {criteria for partial credit}.
> Award 0–{low} pts for responses that {criteria for minimal/no credit}.
> Do not deduct marks for grammar or writing style.

Make the criteria concrete and tied to the specific concepts in the question.

## Source Material

[PASTE YOUR LAB MANUAL SECTION OR ASSIGNMENT DESCRIPTION BELOW THIS LINE]
```

---

## Grading Rubric JSON

The exported `{Course}_{Title}_grading_rubric.json` is the file your Gradescope autograder reads. Keep it private — do not distribute to students.

```json
{
  "assignment_id": "EEC1_Lab2_Prelab",
  "course_code": "EEC1",
  "rubrics": {
    "p0s0": {
      "subsection_id": "p0s0",
      "max_points": 100,
      "grading_type": "ai",
      "grading_prompt": "Award 80–100 pts for...",
      "min_words": 250
    },
    "p1s0": {
      "subsection_id": "p1s0",
      "max_points": 1,
      "grading_type": "human",
      "grading_prompt": ""
    }
  }
}
```

`grading_type` values: `"ai"` (AI-graded), `"human"` (TA-reviewed), `"true_false"` (auto-checked).

---

## Data & Privacy

- All data stored in browser `localStorage` — nothing is sent to any server
- **Export your JSON regularly** — data is lost if browser cache is cleared
- `aiGradingPrompt` (your rubric) is stored in `assignment_spec.json` so you can reload assignments as templates; the Student Submission app does not display it to students

---

## Local Development

```bash
git clone https://github.com/BridgeSuite/GradeBridge-Assignment-Maker.git
cd GradeBridge-Assignment-Maker
npm install
npm run dev       # → http://localhost:3000/GradeBridge-Assignment-Maker/
npm run build     # production build
npm run deploy    # deploy to GitHub Pages
```

**Tech stack:** React 18 · TypeScript · Vite · Tailwind CSS · KaTeX · jsPDF · JSZip · Lucide

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Import Markdown fails | Check file follows the spec exactly — heading levels and tag format are strict |
| LaTeX not rendering | Refresh page; KaTeX loads from CDN |
| PDF generation slow | Large images slow down PDF generation — reduce image count or size |
| Lost work | Export JSON backup regularly; localStorage is cleared with browser cache |

---

## Links

- **Live App:** [bridgesuite.github.io/GradeBridge-Assignment-Maker](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)
- **Student App:** [bridgesuite.github.io/GradeBridge-Student-Submission](https://bridgesuite.github.io/GradeBridge-Student-Submission/)
- **Issues:** [GitHub Issues](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues)

---

MIT License · Provided free by **[BridgeSuite](https://github.com/BridgeSuite)**
