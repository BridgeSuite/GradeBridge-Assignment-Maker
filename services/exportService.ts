
import { Assignment, SubmissionType } from '../types';
import jsPDF from 'jspdf';
import JSZip from 'jszip';
import FileSaver from 'file-saver';

// =====================================================
// FORMAT CONVERSION: Assignment Maker → Student Submission
// =====================================================
// The Student Submission app expects a different JSON format.
// This function converts our internal format to their expected format.

interface StudentSubmissionSubsection {
  subsection_statement: string;
  points: number;
  submission_elements: string[];
  max_images_allowed?: number;
}

interface StudentSubmissionProblem {
  problem_statement: string;
  points: number;
  subsections: StudentSubmissionSubsection[];
}

interface StudentSubmissionAssignment {
  assignment_title: string;
  course_code: string;
  preamble?: string;
  total_points: number;
  problems: StudentSubmissionProblem[];
}

const convertSubmissionType = (type: SubmissionType): string[] => {
  switch (type) {
    case SubmissionType.TEXT:
      return ['Answer as text'];
    case SubmissionType.IMAGE:
      return ['Answer as image'];
    case SubmissionType.AI_REFLECTIVE:
      return ['AI Reflective'];
    case SubmissionType.CODE:
      return ['Answer as text']; // Code submissions render as text
    case SubmissionType.FILE_UPLOAD:
      return ['Answer as image']; // File uploads treated as images
    default:
      return ['Answer as text'];
  }
};

const convertToStudentSubmissionFormat = (assignment: Assignment): StudentSubmissionAssignment => {
  const problems: StudentSubmissionProblem[] = assignment.problems.map(prob => {
    const subsections: StudentSubmissionSubsection[] = prob.subsections.map(sub => {
      // Combine name and description for subsection_statement
      let statement = '';
      if (sub.name && sub.description) {
        statement = `${sub.name}\n\n${sub.description}`;
      } else if (sub.name) {
        statement = sub.name;
      } else if (sub.description) {
        statement = sub.description;
      }

      return {
        subsection_statement: statement,
        points: sub.points,
        submission_elements: convertSubmissionType(sub.submissionType),
        max_images_allowed: sub.maxImages || 1
      };
    });

    // Calculate problem points as sum of subsection points
    const problemPoints = subsections.reduce((sum, sub) => sum + sub.points, 0);

    // Combine name and description for problem_statement
    let problemStatement = '';
    if (prob.name && prob.description) {
      problemStatement = `${prob.name}\n\n${prob.description}`;
    } else if (prob.name) {
      problemStatement = prob.name;
    } else if (prob.description) {
      problemStatement = prob.description;
    }

    return {
      problem_statement: problemStatement,
      points: problemPoints,
      subsections
    };
  });

  // Calculate total points
  const totalPoints = problems.reduce((sum, prob) => sum + prob.points, 0);

  return {
    assignment_title: assignment.title,
    course_code: assignment.courseCode,
    preamble: assignment.preamble || undefined,
    total_points: totalPoints,
    problems
  };
};

// Helper to add text with automatic page wrapping
const addWrappedText = (doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight: number, margin: number): number => {
  const lines = doc.splitTextToSize(text, maxWidth);
  const pageHeight = doc.internal.pageSize.height;
  
  let currentY = y;
  lines.forEach((line: string) => {
    if (currentY > pageHeight - 20) {
      doc.addPage();
      
      // Header on wrapped pages - consistent position
      doc.setFont("times", "normal");
      doc.setFontSize(10);
      doc.text("Student Name: ______________________________   Student ID: __________________", margin, 15);
      
      currentY = 30;
    }
    doc.text(line, x, currentY);
    currentY += lineHeight;
  });
  return currentY;
};

const generatePDFContent = (doc: jsPDF, assignment: Assignment, isTemplate: boolean) => {
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);
  
  // --- COVER PAGE ---
  
  // Student Name/ID Fields - At the very top of the first page
  doc.setFont("times", "normal");
  doc.setFontSize(10);
  doc.text("Student Name: ______________________________   Student ID: __________________", margin, 15);
  
  let y = 30;

  doc.setFont("times", "bold");
  doc.setFontSize(18);
  doc.text(`${assignment.courseCode}: ${assignment.title}`, margin, y);
  y += 10;

  doc.setFont("times", "normal");
  doc.setFontSize(12);
  doc.text(`Due: ${assignment.dueDate} at ${assignment.dueTime}`, margin, y);
  y += 20;

  // Preamble
  if (assignment.preamble) {
    doc.setFont("times", "italic");
    doc.setFontSize(11);
    y = addWrappedText(doc, assignment.preamble, margin, y, contentWidth, 6, margin);
    y += 10;
  }

  // --- PROBLEM PAGES ---
  // Each problem and subsection starts on a new page.
  // For Image types, we might generate multiple pages.

  assignment.problems.forEach((prob, pIndex) => {
    
    prob.subsections.forEach((sub, sIndex) => {
      
      // Determine how many pages this subsection gets
      const pageCount = sub.submissionType === SubmissionType.IMAGE 
        ? (sub.maxImages || 1) 
        : 1;

      for (let i = 0; i < pageCount; i++) {
        doc.addPage(); // STRICT PAGE BREAK FOR EVERY ITEM
        
        // Name and ID fields on every page - consistent position
        doc.setFont("times", "normal");
        doc.setFontSize(10);
        doc.text("Student Name: ______________________________   Student ID: __________________", margin, 15);
        
        y = 30;

        // Header: Problem info (Repeated on every page for clarity)
        doc.setFont("times", "bold");
        doc.setFontSize(14);
        doc.text(`Problem ${pIndex + 1}: ${prob.name}`, margin, y);
        y += 7;

        // Problem description (only on first page of the subsection, or repeated? 
        // Usually helpful to see it, but let's keep it compact if it's long. 
        // We will show it on the first page of the first subsection of the problem, 
        // OR just show it on every page to be safe for the student context).
        if (prob.description && y < 50) {
             doc.setFont("times", "normal");
             doc.setFontSize(10);
             doc.setTextColor(100);
             // Just show first line to save space if it's a repeat page
             const descText = (prob.description.length > 100) ? prob.description.substring(0, 100) + "..." : prob.description;
             doc.text(descText, margin, y);
             doc.setTextColor(0);
             y += 8;
        }

        // Subsection Info
        doc.setFont("times", "bold");
        doc.setFontSize(12);
        const subLabel = String.fromCharCode(97 + sIndex); // a, b, c...
        
        let title = `(${subLabel}) [${sub.points} pts] ${sub.name}`;
        if (pageCount > 1) {
            title += ` (Page ${i + 1} of ${pageCount})`;
        }
        
        doc.text(title, margin + 5, y);
        y += 6;

        if (sub.description) {
            doc.setFont("times", "normal");
            doc.setFontSize(11);
            y = addWrappedText(doc, sub.description, margin + 5, y, contentWidth - 5, 5, margin);
            y += 5;
        }

        // Submission Type Indicator
        doc.setFont("courier", "normal");
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(`[Submission: ${sub.submissionType}]`, margin + 5, y);
        doc.setTextColor(0);
        y += 5;

        // Answer Region
        if (isTemplate) {
            // Draw box taking up rest of page minus bottom margin
            const bottomMargin = 20;
            const boxHeight = pageHeight - y - bottomMargin;
            
            if (boxHeight > 20) {
                doc.setDrawColor(200);
                doc.rect(margin + 5, y, contentWidth - 5, boxHeight);
                
                doc.setFontSize(8);
                doc.setTextColor(150);
                const regionText = sub.submissionType === SubmissionType.IMAGE 
                    ? `Attach Image ${i + 1} Here` 
                    : "Gradescope Answer Region";
                doc.text(regionText, margin + 7, y + 5);
                doc.setTextColor(0);
                doc.setDrawColor(0);
            }
        }
      }
    });
  });
};

const createPDF = (assignment: Assignment, type: 'student' | 'template'): Blob => {
  const doc = new jsPDF();
  generatePDFContent(doc, assignment, type === 'template');
  return doc.output('blob');
};

const generateHTML = (assignment: Assignment): string => {
  return `
<!DOCTYPE html>
<html>
<head>
<title>${assignment.courseCode} - ${assignment.title}</title>
<script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
<script>
  window.MathJax = {
    tex: {
      inlineMath: [['$', '$'], ['\\(', '\\)']],
      displayMath: [['$$', '$$'], ['\\[', '\\]']]
    }
  };
</script>
<style>
body { font-family: 'Georgia', serif; max-width: 800px; margin: 40px auto; line-height: 1.6; padding: 0 20px; color: #333; }
h1 { border-bottom: 1px solid #eee; padding-bottom: 10px; }
.metadata { color: #666; font-style: italic; margin-bottom: 30px; }
.problem { margin-top: 40px; border: 1px solid #eee; padding: 20px; border-radius: 4px; }
.subsection { margin-left: 20px; margin-top: 20px; }
.submission-type { font-family: monospace; background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
.points { font-weight: bold; color: #0056b3; }
</style>
</head>
<body>
  <h1>${assignment.courseCode}: ${assignment.title}</h1>
  <div class="metadata">Due: ${assignment.dueDate} at ${assignment.dueTime}</div>
  <p>${assignment.preamble}</p>

  ${assignment.problems.map((p, i) => `
    <div class="problem">
      <h3>Problem ${i + 1}: ${p.name}</h3>
      <p>${p.description}</p>
      ${p.subsections.map((s, j) => `
        <div class="subsection">
          <h4>(${String.fromCharCode(97 + j)}) ${s.name} <span class="points">[${s.points} pts]</span></h4>
          <p>${s.description}</p>
          <div class="submission-type">
            Submission: ${s.submissionType}
            ${s.submissionType === 'Image' && s.maxImages ? `(Max ${s.maxImages} pages)` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `).join('')}
</body>
</html>
  `;
};

// =====================================================
// LaTeX EXPORT
// =====================================================
// Generates a compilable .tex file that instructors can edit

// Escape special LaTeX characters (but preserve math delimiters)
const escapeLatex = (text: string): string => {
  if (!text) return '';

  // First, protect math content by replacing $ delimiters temporarily
  const mathBlocks: string[] = [];
  let protected_text = text.replace(/\$\$[\s\S]*?\$\$/g, (match) => {
    mathBlocks.push(match);
    return `<<MATH_BLOCK_${mathBlocks.length - 1}>>`;
  });
  protected_text = protected_text.replace(/\$[^$]+\$/g, (match) => {
    mathBlocks.push(match);
    return `<<MATH_BLOCK_${mathBlocks.length - 1}>>`;
  });

  // Escape LaTeX special characters (outside math)
  protected_text = protected_text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');

  // Restore math blocks
  mathBlocks.forEach((block, idx) => {
    protected_text = protected_text.replace(`<<MATH_BLOCK_${idx}>>`, block);
  });

  return protected_text;
};

const generateLaTeX = (assignment: Assignment): string => {
  // Calculate total points
  const totalPoints = assignment.problems.reduce((sum, prob) =>
    sum + prob.subsections.reduce((s, sub) => s + sub.points, 0), 0
  );

  // Build the LaTeX document
  let latex = `% ============================================================
% ${assignment.courseCode}: ${assignment.title}
% Generated by GradeBridge Assignment Maker
% https://bridgesuite.github.io/GradeBridge-Assignment-Maker/
% ============================================================
% This is an editable LaTeX file. Compile with pdflatex.
% ============================================================

\\documentclass[11pt,letterpaper]{article}

% ---- Packages ----
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb,amsthm}
\\usepackage{geometry}
\\usepackage{fancyhdr}
\\usepackage{enumitem}
\\usepackage{graphicx}
\\usepackage{xcolor}
\\usepackage{hyperref}

% ---- Page Setup ----
\\geometry{margin=1in}
\\pagestyle{fancy}
\\fancyhf{}
\\lhead{${escapeLatex(assignment.courseCode)}}
\\rhead{${escapeLatex(assignment.title)}}
\\cfoot{\\thepage}

% ---- Custom Commands ----
\\newcommand{\\pts}[1]{\\textbf{[#1 pts]}}
\\newcommand{\\submissiontype}[1]{\\textcolor{gray}{\\texttt{[#1]}}}

% ============================================================
\\begin{document}

% ---- Title Section ----
\\begin{center}
{\\LARGE\\bfseries ${escapeLatex(assignment.courseCode)}: ${escapeLatex(assignment.title)}}\\\\[0.5em]
{\\large Due: ${escapeLatex(assignment.dueDate)} at ${escapeLatex(assignment.dueTime)}}\\\\[0.3em]
{\\large Total Points: ${totalPoints}}
\\end{center}

\\vspace{1em}

% ---- Student Information ----
\\noindent\\textbf{Student Name:} \\underline{\\hspace{6cm}} \\hfill \\textbf{Student ID:} \\underline{\\hspace{4cm}}

\\vspace{1.5em}

`;

  // Preamble
  if (assignment.preamble) {
    latex += `% ---- Preamble / Instructions ----
\\noindent\\textit{${escapeLatex(assignment.preamble)}}

\\vspace{1.5em}
\\hrule
\\vspace{1.5em}

`;
  }

  // Problems
  assignment.problems.forEach((prob, pIndex) => {
    const problemPoints = prob.subsections.reduce((s, sub) => s + sub.points, 0);

    latex += `% ============================================================
% Problem ${pIndex + 1}
% ============================================================
\\section*{Problem ${pIndex + 1}: ${escapeLatex(prob.name)} \\hfill \\normalsize{(${problemPoints} points)}}

`;

    if (prob.description) {
      latex += `${escapeLatex(prob.description)}

`;
    }

    // Subsections
    prob.subsections.forEach((sub, sIndex) => {
      const subLabel = String.fromCharCode(97 + sIndex); // a, b, c...

      latex += `\\subsection*{(${subLabel}) ${escapeLatex(sub.name)} \\pts{${sub.points}}}

`;

      if (sub.description) {
        latex += `${escapeLatex(sub.description)}

`;
      }

      // Submission type indicator
      let submissionNote: string = sub.submissionType;
      if (sub.submissionType === SubmissionType.IMAGE && sub.maxImages) {
        submissionNote = `${sub.submissionType} (max ${sub.maxImages} image${sub.maxImages > 1 ? 's' : ''})`;
      }
      latex += `\\submissiontype{Submission: ${submissionNote}}

`;

      // Add answer space
      latex += `\\vspace{2em}
% Answer space for part (${subLabel})
\\noindent\\dotfill

\\vspace{3cm}

`;
    });

    latex += `\\newpage

`;
  });

  // End document
  latex += `\\end{document}
`;

  return latex;
};

const generateGradingRubric = (assignment: Assignment): object => {
  const rubrics: Record<string, object> = {};

  assignment.problems.forEach((prob, pIndex) => {
    prob.subsections.forEach((sub, sIndex) => {
      const subsectionId = `p${pIndex}s${sIndex}`;
      const isAi = sub.submissionType === SubmissionType.AI_REFLECTIVE;
      const isTrueFalse = sub.submissionType === SubmissionType.TRUE_FALSE;
      const isImage = sub.submissionType === SubmissionType.IMAGE;
      const subsectionLetter = String.fromCharCode(97 + sIndex);

      rubrics[subsectionId] = {
        subsection_id: subsectionId,
        problem_number: pIndex + 1,
        problem_name: prob.name,
        subsection_letter: subsectionLetter,
        subsection_name: sub.name,
        display_name: `Problem ${pIndex + 1}(${subsectionLetter}): ${sub.name}`,
        max_points: sub.points,
        grading_type: isAi ? 'ai' : isTrueFalse ? 'true_false' : isImage ? 'human_image' : 'human',
        grading_prompt: isAi ? (sub.aiGradingPrompt || '') : '',
        ...(isAi && { min_words: sub.minWords ?? 250 }),
        ...(isTrueFalse && { correct_answer: sub.config || 'true' }),
        ...(isImage && { max_images: sub.maxImages ?? 1 })
      };
    });
  });

  const assignmentId = `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}`;

  return {
    assignment_id: assignmentId,
    course_code: assignment.courseCode,
    assignment_title: assignment.title,
    ai_grading_config: {
      model: assignment.aiGradingConfig?.model || 'claude-haiku-4-5-20251001',
      temperature: assignment.aiGradingConfig?.temperature ?? 0.1,
      max_tokens: assignment.aiGradingConfig?.maxTokens || 1024
    },
    rubrics
  };
};

export const exportService = {
  downloadZIP: async (assignment: Assignment) => {
    const zip = new JSZip();

    // 1. Spec JSON - full assignment including grading prompts so it can be reloaded as a template
    zip.file('assignment_spec.json', JSON.stringify(assignment, null, 2));

    // 2. Student PDF
    const studentPdf = createPDF(assignment, 'student');
    zip.file('assignment.pdf', studentPdf);

    // 3. Template PDF
    const templatePdf = createPDF(assignment, 'template');
    zip.file('template.pdf', templatePdf);

    // 4. HTML
    const html = generateHTML(assignment);
    zip.file('assignment.html', html);

    // 5. LaTeX (editable source file for instructors)
    const latex = generateLaTeX(assignment);
    zip.file('assignment.tex', latex);

    // 6. Grading Rubric JSON (private — for autograder only)
    const rubric = generateGradingRubric(assignment);
    const rubricFilename = `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}_grading_rubric.json`;
    zip.file(rubricFilename, JSON.stringify(rubric, null, 2));

    const content = await zip.generateAsync({ type: 'blob' });

    // Handle file-saver import differences (default export vs named export property)
    const save = (FileSaver as any).saveAs || FileSaver;
    save(content, `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}_Export.zip`);
  }
};
