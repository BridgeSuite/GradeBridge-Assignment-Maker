# GradeBridge Assignment Maker

Create structured assignments with LaTeX support and Gradescope AI-autograding integration — entirely in your browser.

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**[Live App](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)** | **[Student Submission App](https://bridgesuite.github.io/GradeBridge-Student-Submission/)**

---

## The GradeBridge AI Ecosystem

GradeBridge AI runs two parallel pipelines that share the same encryption contract and the same Gradescope-Docker autograder pattern. **This app belongs to the lab pipeline.**

### Lab pipeline (this app)
For lab reports, mini-projects, and homework with mixed text, image, and AI-graded responses.

| App | Who uses it | What it does |
|---|---|---|
| **Assignment Maker** (this app) | Instructor | Create assignments, configure grading, export ZIP |
| **[Student Submission](https://github.com/BridgeSuite/GradeBridge-Student-Submission)** | Student | Load assignment, fill answers, download submission files |

### MQ pipeline (sibling apps)
For timed multiple-choice quizzes drawn from a portable SQLite question bank. Useful for pre-lecture reading checks and vendor-independent quiz delivery.

| App | Who uses it | What it does |
|---|---|---|
| **[MQ Assignment Maker](https://github.com/BridgeSuite/GradeBridge-MQ-Assignment-Maker)** | Instructor | Filter question bank, set time limit, export encrypted assignment (with optional 1.5x / 2x SDC accommodation variants) |
| **[MQ Student Submission](https://github.com/BridgeSuite/GradeBridge-MQ-Student-Submission)** | Student | Take a timed quiz, sign the honor pledge, download encrypted ZIP for Gradescope |

See the [GradeBridge-AI parent repo](https://github.com/BridgeSuite/GradeBridge-AI) for documentation, the worked example, and pipeline diagrams.

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

## Submission Types and Grading Modes

Each subsection has a **Type** selector and a **Grading** selector. The two branch based on medium:

### Text questions

`Type: [Text] [Image]  |  Grading: [Human] | AI: [Binary] [Short] [Medium] [Long]`

| Grading selection | What it means | Autograded? |
|---|---|---|
| **Human** | TA reviews the student's written answer | No |
| **AI: Binary** | Student states yes/no and briefly justifies; AI grades | Yes — 2 bands, 20 word min |
| **AI: Short** | Student answers a focused concept question; AI grades | Yes — 3 bands, 50 word min |
| **AI: Medium** | Student explains a mechanism or relationship; AI grades | Yes — 4 bands, 100 word min |
| **AI: Long** | Student analyses trade-offs or synthesises across concepts; AI grades | Yes — 5 bands, 150 word min |

### Image questions

`Type: [Text] [Image]  pages: __  |  Grading: [Human Inspection] [AI Inspection]`

| Grading selection | What it means | Autograded? |
|---|---|---|
| **Human Inspection** *(default)* | TA reviews the uploaded image | No |
| **AI Inspection** | Autograder checks `images_submitted > 0`; awards full marks automatically | Yes |

Set the number of image pages allowed with the **pages** field (e.g. 6 for a quiz transcript).

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

### Option C — Generate with Claude Code (recommended)
Use the two-phase CC workflow to generate `.md` files from lab manual source material. See `CCAssignmentMaker/CC_PROMPT.md` for the ready-to-use prompt.

### Option D — Iterate with Claude Code
The `.md` format enables a tight CC iteration loop so you never need to manually explain changes:

1. CC generates `EEC1_Lab1_Prelab.md` from your lab manual
2. Click **Import Markdown** → assignment opens in the editor
3. Make changes in the UI (adjust points, tweak descriptions, edit rubrics)
4. Click **Export .md** (top-right of editor) → downloads the updated `.md` with all changes
5. Next CC session: *"read EEC1_Lab1_Prelab.md"* — CC sees exactly the current state, no explanation needed

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
Subsection description. LaTeX supported.

> grading_prompt: Rubric text here. (ai-graded subsections only)
```

**Flat single-subsection problems** (shorthand — points and type on the `##` line):
```markdown
## Problem {N}: {Problem Name} [{points} pts] [{type}]
Subsection description. LaTeX supported.

> grading_prompt: Rubric text here. (ai-graded subsections only)
```

The parser auto-promotes a flat problem into a single `(a)` subsection on import. Both formats round-trip correctly through Export .md.

### Submission Type Tags

| Tag | Creates | Notes |
|---|---|---|
| `[text]` | Text answer box | Human-graded by default |
| `[image]` | Single image upload | Human Inspection by default |
| `[image:N]` | Image upload, N pages | e.g. `[image:6]` for a quiz transcript |
| `[ai-graded:binary]` | Yes/no free-text, AI graded | 20 word min; 2 grading bands |
| `[ai-graded:short]` | Short free-text, AI graded | 50 word min; 3 grading bands |
| `[ai-graded:medium]` | Medium free-text, AI graded | 100 word min; 4 grading bands |
| `[ai-graded:long]` | Long free-text, AI graded | 150 word min; 5 grading bands |

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
# EEC1: Lab 1 Prelab

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
  "assignment_id": "EEC1_Lab1_Prelab",
  "course_code": "EEC1",
  "assignment_title": "Lab 1 Prelab",
  "ai_grading_config": { "model": "claude-haiku-4-5-20251001", "temperature": 0.1, "max_tokens": 1024 },
  "rubrics": {
    "p1s0": {
      "subsection_id": "p1s0",
      "max_points": 75,
      "grading_type": "ai",
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

`grading_type` values:

| Value | Meaning |
|---|---|
| `"ai"` | AI-graded text response |
| `"human"` | TA reviews text response |
| `"human_image"` | TA reviews uploaded image |
| `"ai_image_completion"` | Auto-award if `images_submitted > 0` |

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
npm run deploy    # deploy to GitHub Pages (SSH remote required)
```

**Tech stack:** React 18 · TypeScript · Vite · Tailwind CSS · KaTeX · jsPDF · JSZip · Lucide

---

## Troubleshooting

| Issue | Solution |
|---|---|
| Import Markdown fails | Check heading levels (`#`, `##`, `###`) and tag format (`[N pts] [type]`). Both flat and subsection formats are supported — see Markdown Format above |
| LaTeX not rendering | Refresh page; KaTeX loads from CDN |
| PDF generation slow | Large images slow down PDF generation — reduce image count or size |
| Lost work | Export JSON backup regularly; localStorage is cleared with browser cache |
| Deploy returns 403 | SSH remote required — run `git remote set-url origin git@github.com:BridgeSuite/GradeBridge-Assignment-Maker.git` |

---

## Links

- **Live App:** [bridgesuite.github.io/GradeBridge-Assignment-Maker](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)
- **Student App (production):** [bridgesuite.github.io/GradeBridge-Student-Submission](https://bridgesuite.github.io/GradeBridge-Student-Submission/)
- **Student App (beta):** [aknoesen.github.io/GradeBridge-Student-Submission-Beta](https://aknoesen.github.io/GradeBridge-Student-Submission-Beta/)
- **Issues:** [GitHub Issues](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues)

---

MIT License · Provided free by **[BridgeSuite](https://github.com/BridgeSuite)**
