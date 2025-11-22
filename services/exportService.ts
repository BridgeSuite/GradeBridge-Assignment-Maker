
import { Assignment, Problem, Subsection, SubmissionType } from '../types';
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

export const exportService = {
  downloadZIP: async (assignment: Assignment) => {
    const zip = new JSZip();

    // 1. Spec JSON - Convert to Student Submission format
    const studentSubmissionFormat = convertToStudentSubmissionFormat(assignment);
    zip.file('assignment_spec.json', JSON.stringify(studentSubmissionFormat, null, 2));

    // Also include the original Assignment Maker format for backup/editing
    zip.file('assignment_maker_backup.json', JSON.stringify(assignment, null, 2));
    
    // 2. Student PDF
    const studentPdf = createPDF(assignment, 'student');
    zip.file('assignment.pdf', studentPdf);
    
    // 3. Template PDF
    const templatePdf = createPDF(assignment, 'template');
    zip.file('template.pdf', templatePdf);
    
    // 4. HTML
    const html = generateHTML(assignment);
    zip.file('assignment.html', html);
    
    const content = await zip.generateAsync({ type: 'blob' });
    
    // Handle file-saver import differences (default export vs named export property)
    const save = (FileSaver as any).saveAs || FileSaver;
    save(content, `${assignment.courseCode}_${assignment.title.replace(/\s+/g, '_')}_Export.zip`);
  }
};
