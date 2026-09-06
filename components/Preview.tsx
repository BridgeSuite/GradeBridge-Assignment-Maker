
import React from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { storageService } from '../services/storageService';
import { exportService, isRescaleDeclined } from '../services/exportService';
import { Layout, Card, Button } from './Common';
import { Download, ArrowLeft, Edit2, Users, FileText } from 'lucide-react';
import { SubmissionType } from '../types';
import { FormattedText } from './FormattedText';

const Preview: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const assignment = id ? storageService.get(id) : undefined;

  const handleExport = async () => {
    if (!assignment) return;
    try {
      await exportService.downloadZIP(assignment);
    } catch (error) {
      // Declining the rescale is a decision, not a failure. Say nothing.
      if (isRescaleDeclined(error)) return;
      console.error(error);
      alert(error instanceof Error ? error.message : 'Failed to export the assignment package.');
    }
  };

  // Each download is its own button and its own click. Chrome delivers one
  // programmatic download per user gesture and silently drops the rest — see
  // the note beside `saveOne` in exportService.ts — so nothing here ever
  // triggers two.
  const handleStudentZip = async () => {
    if (!assignment) return;
    try {
      const { filename, names } = await exportService.downloadStudentZip(assignment);
      // Named, because the whole point is that the instructor knows which file
      // to post. Saying what is inside it is also the only cheap check that the
      // map travelled with the sheet.
      alert(
        `Downloaded ${filename}\n\nPost this file. It contains:\n` +
        names.map(n => `  ${n}`).join('\n') +
        `\n\nIt holds no grading material. Everything else stays with you.`
      );
    } catch (error) {
      if (isRescaleDeclined(error)) return;
      console.error(error);
      alert(error instanceof Error ? error.message : 'Failed to build the student ZIP.');
    }
  };

  const handleStudentPdf = async () => {
    if (!assignment) return;
    try {
      const { filename } = await exportService.downloadStudentPdf(assignment);
      alert(`Downloaded ${filename}\n\nThe same PDF is inside the student ZIP — this copy is so students can read and print it without unzipping anything.`);
    } catch (error) {
      if (isRescaleDeclined(error)) return;
      console.error(error);
      alert(error instanceof Error ? error.message : 'Failed to build the student PDF.');
    }
  };

  if (!assignment) {
    return (
      <Layout>
        <div className="text-center py-20">
          <h2 className="text-xl font-bold mb-4">Assignment Not Found</h2>
          <Link to="/"><Button>Return Home</Button></Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout 
      title={`${assignment.courseCode}: ${assignment.title}`}
      action={
        <div className="flex gap-2">
           <Link to="/">
              <Button variant="secondary"><ArrowLeft className="w-4 h-4 mr-2"/>Back</Button>
           </Link>
           <Link to={`/edit/${assignment.id}`}>
              <Button variant="secondary"><Edit2 className="w-4 h-4 mr-2"/>Edit</Button>
           </Link>
           {/* The two student downloads lead, and the instructor archive is
               secondary — the asymmetry is total: posting the instructor
               archive publishes the rubric to the class. */}
           <Button onClick={handleStudentZip}>
             <Users className="w-4 h-4 mr-2" /> Give to students
           </Button>
           <Button variant="secondary" onClick={handleStudentPdf}>
             <FileText className="w-4 h-4 mr-2" /> Student PDF
           </Button>
           <Button variant="secondary" onClick={handleExport}>
             <Download className="w-4 h-4 mr-2" /> Instructor export
           </Button>
        </div>
      }
    >
      <div className="max-w-4xl mx-auto space-y-6">
         <Card className="prose max-w-none">
            <div className="flex justify-between items-end border-b pb-4 mb-6">
               <div>
                  <h2 className="text-3xl font-serif font-bold text-academic-900 m-0">{assignment.title}</h2>
                  <p className="text-academic-600 m-0 font-medium">{assignment.courseCode}</p>
               </div>
               <div className="text-right text-sm text-academic-500">
                  <p className="m-0">Set due date in Canvas</p>
               </div>
            </div>
            
            {assignment.preamble && (
               <div className="bg-academic-50 p-4 rounded-md border-l-4 border-academic-400 italic mb-8">
                  <FormattedText text={assignment.preamble} />
               </div>
            )}

            <div className="space-y-8">
               {assignment.problems.map((problem, i) => (
                  <div key={problem.id} className="border border-academic-200 rounded-lg overflow-hidden">
                     <div className="bg-academic-100 px-6 py-3 border-b border-academic-200 font-bold text-lg flex justify-between">
                        <span>Problem {i + 1}: {problem.name}</span>
                     </div>
                     <div className="p-6 bg-white">
                        {problem.description && (
                            <div className="mb-4 text-academic-700">
                                <FormattedText text={problem.description} />
                            </div>
                        )}
                        
                        <div className="space-y-6 pl-4">
                           {problem.subsections.map((sub, j) => (
                              <div key={sub.id}>
                                 <div className="flex justify-between items-baseline mb-2">
                                    <h4 className="text-md font-bold text-academic-800">
                                       ({String.fromCharCode(97 + j)}) {sub.name}
                                    </h4>
                                    <span className="text-sm font-bold text-blue-700">[{sub.points} pts]</span>
                                 </div>
                                 {sub.description && (
                                     <div className="text-academic-600 text-sm mb-2">
                                         <FormattedText text={sub.description} />
                                     </div>
                                 )}
                                 <div className="inline-flex items-center gap-2 px-2 py-1 bg-gray-100 text-xs font-mono border rounded text-gray-500">
                                    <span>Submission: {sub.submissionType}</span>
                                    {sub.submissionType === SubmissionType.IMAGE && sub.maxImages && (
                                        <span className="border-l pl-2 border-gray-300 font-semibold text-academic-700">Max {sub.maxImages} Pages</span>
                                    )}
                                 </div>
                              </div>
                           ))}
                        </div>
                     </div>
                  </div>
               ))}
            </div>
         </Card>
      </div>
    </Layout>
  );
};

export default Preview;
