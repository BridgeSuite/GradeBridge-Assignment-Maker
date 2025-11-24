# GradeBridge Assignment Maker

Create professional, structured assignments with LaTeX support and Gradescope integration - entirely in your browser.

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

**[Live Demo](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)** | **[Student Submission App](https://bridgesuite.github.io/GradeBridge-Student-Submission/)**

---

## The Problem

**Traditional workflow:** 3+ hours fighting with Word formatting, equation editors, and inconsistent student submissions.

**GradeBridge workflow:** 15 minutes to create professional assignments that auto-generate perfectly formatted student PDFs.

**The two-app workflow:**
1. **Assignment Maker** (this app) - Instructors create structured assignments
2. **[Student Submission](https://github.com/BridgeSuite/GradeBridge-Student-Submission)** - Students complete work and generate grading-ready PDFs

---

## Key Features

- **100% Browser-Based** - No server, no account, no data transmission. Everything stays on your computer.
- **Structured Assignments** - Problems with subsections, points, and multiple submission types
- **LaTeX Math Support** - Live preview with built-in cheatsheet (fractions, integrals, Greek letters, matrices)
- **Multiple Submission Types** - Text, image uploads, and AI reflective documentation
- **Rich Export Options** - JSON, PDF, HTML, and **editable LaTeX** source files
- **Load Example** - One-click sample assignment to explore features instantly

---

## Quick Start

### Try It Now
1. Go to the [Live Demo](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)
2. Click **"Load Example"** to see a sample assignment
3. Click **"LaTeX Help"** in the header for math notation reference

### Create an Assignment
1. Click **"New Assignment"**
2. Enter course code, title, and instructions
3. Add problems with subsections
4. Configure submission types (text/image/AI reflective)
5. Export JSON → share with students
6. Export PDF → upload to Gradescope as template

### Local Development
```bash
git clone https://github.com/BridgeSuite/GradeBridge-Assignment-Maker.git
cd GradeBridge-Assignment-Maker
npm install
npm run dev
```

---

## Export Formats

The ZIP export includes **five files**, each useful for different workflows:

| File | Format | Purpose |
|------|--------|---------|
| `assignment_spec.json` | JSON | For [Student Submission app](https://bridgesuite.github.io/GradeBridge-Student-Submission/) |
| `assignment.pdf` | PDF | Student-facing assignment document |
| `template.pdf` | PDF | Gradescope template with answer regions |
| `assignment.html` | HTML | Web-viewable with MathJax rendering |
| `assignment.tex` | **LaTeX** | **Editable source for customization** |

### Standalone Value for Conventional Gradescope Workflows

**You don't need the Student Submission app to benefit from Assignment Maker.** The auxiliary exports are valuable on their own:

- **`template.pdf`** - Upload directly to Gradescope as your assignment template
- **`assignment.pdf`** - Distribute to students as the assignment handout
- **`assignment.tex`** - Edit in your LaTeX editor (Overleaf, TeXShop, etc.) for full customization before finalizing

This makes Assignment Maker a **rapid prototyping tool** for creating traditional Gradescope assignments - even if students submit handwritten work or use their own PDF workflow.

### LaTeX Export Details

The `.tex` file is a complete, compilable document:

```latex
\documentclass[11pt,letterpaper]{article}
\usepackage{amsmath,amssymb,amsthm}  % Full math support
\usepackage{fancyhdr}                 % Professional headers
\usepackage{geometry}                 % 1-inch margins
...
\section*{Problem 1: Derivatives \hfill (10 points)}
Find the derivative of $f(x) = x^2 + 3x$.
```

- Compile with `pdflatex` - no additional setup needed
- Math notation preserved exactly as entered
- Professional academic formatting out of the box
- Customize fonts, spacing, or add your institution's branding

---

## Assignment JSON Format

Exported assignments use this structure (compatible with Student Submission app):

```json
{
  "id": "unique-id",
  "courseCode": "ECE416",
  "title": "Mini-Project 1",
  "dueDate": "2024-12-01",
  "dueTime": "23:59",
  "preamble": "Complete all problems showing your work...",
  "problems": [
    {
      "id": "prob-1",
      "name": "State-Space Analysis",
      "description": "Analyze the following system using state-space methods.",
      "subsections": [
        {
          "id": "prob-1-a",
          "name": "Derive Representation",
          "description": "Derive the state-space representation",
          "points": 10,
          "submissionType": "Text",
          "maxImages": 0
        },
        {
          "id": "prob-1-b",
          "name": "Step Response",
          "description": "Plot the step response",
          "points": 10,
          "submissionType": "Image",
          "maxImages": 2
        }
      ]
    }
  ],
  "createdAt": 1700000000000,
  "updatedAt": 1700000000000
}
```

**Submission Types:** `Text`, `Image`, `AI Reflective`

---

## Data & Privacy

- All data stored in browser localStorage
- No server communication, no analytics, no account required
- Data persists across browser restarts
- **Always export JSON backups** - data is lost if you clear browser cache

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Assignment won't load | Verify JSON was exported from Assignment Maker |
| LaTeX not rendering | Refresh page; KaTeX loads from CDN |
| PDF generation slow | Reduce image count/size; large PDFs take 10-20s |
| Lost work | Always export JSON backups regularly |

---

## Development

### Tech Stack
React 18 + TypeScript + Vite + Tailwind CSS + KaTeX + jsPDF + JSZip

### Project Structure
```
├── components/     # React components
├── pages/          # Page-level components
├── services/       # PDF/export logic
├── types/          # TypeScript interfaces
└── App.tsx         # Main app
```

### Build & Deploy
```bash
npm run build      # Production build
npm run deploy     # Deploy to GitHub Pages
```

---

## Browser Support

Chrome 90+, Firefox 88+, Safari 14+, Edge 90+

---

## Contributing

1. Fork the repository
2. Create feature branch
3. Make changes with clear commits
4. Submit pull request

---

## License

MIT License - Free for personal and commercial use.

---

## Links

- **Live App**: [bridgesuite.github.io/GradeBridge-Assignment-Maker](https://bridgesuite.github.io/GradeBridge-Assignment-Maker/)
- **Student App**: [bridgesuite.github.io/GradeBridge-Student-Submission](https://bridgesuite.github.io/GradeBridge-Student-Submission/)
- **Issues**: [GitHub Issues](https://github.com/BridgeSuite/GradeBridge-Assignment-Maker/issues)

---

Built with React, TypeScript, [KaTeX](https://katex.org/), [jsPDF](https://github.com/parallax/jsPDF), [JSZip](https://stuk.github.io/jszip/), and [Lucide](https://lucide.dev/).

Provided free by **[BridgeSuite](https://github.com/BridgeSuite)**.
