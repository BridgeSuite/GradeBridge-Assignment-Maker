
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Assignment } from '../types';
import { storageService } from '../services/storageService';
import { exportService, isRescaleDeclined } from '../services/exportService';
import { Layout, Card, Button } from '../components/Common';
import { Plus, FileText, Download, Trash2, Edit2, Eye, Upload, Copy, Sparkles, FileCode, Users } from 'lucide-react';
import { createExampleAssignment, EXAMPLE_LOADED_MESSAGE } from '../exampleAssignment';
import { parseMdToAssignment, courseKeyWarning } from '../services/mdParserService';
import { degradeRetiredTypes } from '../services/retiredTypes';
import { isEncoded, decryptJson, validateCoursePublicKey } from '../services/cryptoService';

const Dashboard: React.FC = () => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mdFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAssignments();
  }, []);

  const handleLoadExample = () => {
    const example = createExampleAssignment();
    storageService.save(example);
    loadAssignments();
    setStatusMessage(EXAMPLE_LOADED_MESSAGE);
    setTimeout(() => setStatusMessage(''), 5000);
  };

  const loadAssignments = () => {
    setAssignments(storageService.getAll());
  };

  const handleDelete = (e: React.MouseEvent, id: string, title: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (window.confirm(`Are you sure you want to delete "${title}"? This cannot be undone.`)) {
      storageService.delete(id);
      loadAssignments();
    }
  };

  const handleExport = async (assignment: Assignment) => {
    try {
      await exportService.downloadZIP(assignment);
    } catch (error) {
      // Declining the rescale is a decision, not a failure. Say nothing.
      if (isRescaleDeclined(error)) return;
      console.error(error);
      alert(error instanceof Error ? error.message : 'Failed to export the assignment package.');
    }
  };

  /**
   * The archive the instructor posts. Its own button and its own click: Chrome
   * delivers one programmatic download per user gesture and drops the rest in
   * silence (see `saveOne` in exportService.ts), so no handler here triggers
   * two. The loose student PDF lives on the assignment's own page, beside the
   * room to explain it; a student holding the ZIP already has that PDF.
   */
  const handleStudentZip = async (assignment: Assignment) => {
    try {
      const { filename, names } = await exportService.downloadStudentZip(assignment);
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

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const raw = (e.target?.result as string).trim();
        // Support both encoded (gb1:…) and plain JSON (backward compatibility)
        const importedAssignment = isEncoded(raw)
          ? (await decryptJson(raw)) as Assignment
          : JSON.parse(raw) as Assignment;

        // Basic validation
        if (!importedAssignment.id || !importedAssignment.title || !Array.isArray(importedAssignment.problems)) {
          throw new Error("Invalid assignment format. Missing required fields.");
        }

        // Ensure ID is string and trimmed
        importedAssignment.id = String(importedAssignment.id).trim();

        // A project saved before a submission type was retired still opens —
        // the part degrades to Text and the instructor is told which one.
        const retired = degradeRetiredTypes(importedAssignment);

        // Ensure timestamps exist
        const now = Date.now();
        if (typeof importedAssignment.createdAt !== 'number') {
          importedAssignment.createdAt = now;
        }
        if (typeof importedAssignment.updatedAt !== 'number') {
          importedAssignment.updatedAt = now;
        }

        const existing = storageService.get(importedAssignment.id);
        if (existing) {
          const shouldOverwrite = window.confirm(
            `Assignment "${importedAssignment.title}" already exists.\n\nClick OK to OVERWRITE the existing assignment.\nClick Cancel to create a NEW COPY.`
          );

          if (!shouldOverwrite) {
            importedAssignment.id = uuidv4();
            importedAssignment.title = `${importedAssignment.title} (Copy)`;
          }
        }

        storageService.save(importedAssignment);
        loadAssignments();
        alert(retired.length
          ? ['Assignment imported.', '', ...retired].join('\n')
          : "Assignment imported successfully!");
      } catch (error) {
        console.error(error);
        alert("Failed to import assignment. Please ensure the file is a valid assignment JSON.");
      }

      // Reset input so the same file can be selected again if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleMdImportClick = () => {
    mdFileInputRef.current?.click();
  };

  const handleMdFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        // Retired type tags degrade to Text rather than failing the import; the
        // warning names the sub-part so the instructor can re-pick its type.
        const warnings: string[] = [];
        const assignment = parseMdToAssignment(content, warnings);

        // THE FULL KEY CHECK, WHICH THE PARSER CANNOT DO.
        //
        // `parseMdToAssignment` is synchronous and screens the ```pem block
        // structurally (`looksLikeCoursePublicKey`). `validateCoursePublicKey`
        // round-trips through WebCrypto and is therefore async, so it runs
        // here, on the same existing check the export and the editor already
        // use — a key that is armoured correctly but is not an importable RSA
        // key is caught here rather than at export time.
        //
        // It drops the key and says so. It never refuses the file: the editor
        // is where a bad key gets replaced.
        if (assignment.coursePublicKey) {
          const check = await validateCoursePublicKey(assignment.coursePublicKey);
          if (!check.ok) {
            delete assignment.coursePublicKey;
            warnings.push(courseKeyWarning(check.error || 'the browser could not import it.'));
          } else if (check.warning) {
            warnings.push(check.warning);
          }
        }

        // Check for existing assignment with same courseCode + title
        const existing = storageService.getAll().find(
          a => a.courseCode === assignment.courseCode && a.title === assignment.title
        );

        if (existing) {
          const shouldOverwrite = window.confirm(
            `"${assignment.courseCode}: ${assignment.title}" already exists.\n\nClick OK to OVERWRITE the existing assignment.\nClick Cancel to save as a NEW COPY.`
          );
          if (shouldOverwrite) {
            assignment.id = existing.id;
            assignment.createdAt = existing.createdAt;
            // The .md now carries the course public key (2026-09-05), so the
            // file wins where it has one. This fallback stays for the two cases
            // it still covers: a .md written before the block existed, and one
            // whose block was rejected above — in both, an overwrite would
            // otherwise drop the key and quietly downgrade students to gb1.
            if (!assignment.coursePublicKey && existing.coursePublicKey) {
              assignment.coursePublicKey = existing.coursePublicKey;
            }
          }
          // If cancel: keep new UUID → saves as new copy
        }

        storageService.save(assignment);
        if (warnings.length) alert(warnings.join('\n'));
        navigate(`/edit/${assignment.id}`);
      } catch (error) {
        console.error(error);
        alert('Failed to parse markdown file. Please check the file format matches the GradeBridge assignment spec.');
      }
      if (mdFileInputRef.current) mdFileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleDuplicate = (e: React.MouseEvent, assignment: Assignment) => {
    e.preventDefault();
    e.stopPropagation();

    // Create a deep copy with new ID and modified title
    const duplicated: Assignment = {
      ...assignment,
      id: uuidv4(),
      title: `${assignment.title} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      // Deep copy problems and subsections
      problems: assignment.problems.map(p => ({
        ...p,
        id: uuidv4(),
        subsections: p.subsections.map(s => ({
          ...s,
          id: uuidv4()
        }))
      }))
    };

    storageService.save(duplicated);
    navigate(`/edit/${duplicated.id}`);
  };

  return (
    <Layout 
      title="Assignment Dashboard" 
      action={
        <div className="flex gap-2">
          <input
            type="file"
            accept=".json"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileUpload}
          />
          <input
            type="file"
            accept=".md"
            ref={mdFileInputRef}
            className="hidden"
            onChange={handleMdFileUpload}
          />
          <Button variant="secondary" onClick={handleLoadExample}>
            <Sparkles className="w-4 h-4 mr-2" />
            Load Example
          </Button>
          <Button variant="secondary" onClick={handleImportClick}>
            <Upload className="w-4 h-4 mr-2" />
            Import JSON
          </Button>
          <Button variant="secondary" onClick={handleMdImportClick}>
            <FileCode className="w-4 h-4 mr-2" />
            Import Markdown
          </Button>
          <Link to="/create">
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Assignment
            </Button>
          </Link>
        </div>
      }
    >
      {assignments.length === 0 ? (
        <Card className="text-center py-16">
          <div className="mx-auto w-16 h-16 bg-academic-100 rounded-full flex items-center justify-center mb-4 text-academic-600">
            <FileText className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-medium text-academic-900">No assignments yet</h3>
          <p className="mt-2 text-academic-500 max-w-sm mx-auto">
            Create your first assignment to get started, or try our example to explore the features.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link to="/create">
              <Button>Create Assignment</Button>
            </Link>
            <Button variant="secondary" onClick={handleMdImportClick}>
              <FileCode className="w-4 h-4 mr-2" />
              Import Markdown
            </Button>
            <Button variant="secondary" onClick={handleImportClick}>Import JSON</Button>
          </div>

          {/* Example Assignment CTA */}
          <div className="mt-8 pt-8 border-t border-academic-100">
            <p className="text-sm text-academic-500 mb-3">New here? Try an example first:</p>
            <button
              onClick={handleLoadExample}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white rounded-lg shadow-lg transition-all font-medium"
            >
              <Sparkles className="w-5 h-5" />
              Load Example Assignment
            </button>
            <p className="text-xs text-academic-400 mt-2 max-w-xs mx-auto">
              Explore a real lab report assignment with multiple question types
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {[...assignments].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((assignment) => (
            <Card key={assignment.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-md transition-shadow">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-academic-100 text-academic-800">
                    {assignment.courseCode}
                  </span>
                  <h3 className="text-lg font-bold text-academic-900">{assignment.title}</h3>
                </div>
                <div className="text-sm text-academic-500 flex flex-wrap gap-x-4">
                  <span>{assignment.problems.length} Problems</span>
                  <span>•</span>
                  <span>Total Points: {assignment.problems.reduce((acc, p) => acc + p.subsections.reduce((sAcc, s) => sAcc + s.points, 0), 0)}</span>
                  <span>•</span>
                  <span>Updated {new Date(assignment.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 border-t sm:border-t-0 pt-4 sm:pt-0 border-academic-100">
                <Link to={`/view/${assignment.id}`}>
                    <Button variant="ghost" title="View">
                        <Eye className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">View</span>
                    </Button>
                </Link>
                <Link to={`/edit/${assignment.id}`}>
                  <Button variant="secondary" title="Edit">
                    <Edit2 className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">Edit</span>
                  </Button>
                </Link>
                <Button
                  variant="secondary"
                  onClick={(e) => handleDuplicate(e, assignment)}
                  title="Duplicate - Create a copy to edit"
                >
                  <Copy className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Copy</span>
                </Button>
                <Button
                  onClick={() => handleStudentZip(assignment)}
                  title="The file to post — student files only, no grading material"
                >
                  <Users className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Students</span>
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleExport(assignment)}
                  title="Everything, including the answer key — never give this to students"
                >
                  <Download className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Instructor</span>
                </Button>
                <Button 
                  variant="danger" 
                  type="button"
                  onClick={(e) => handleDelete(e, assignment.id, assignment.title)} 
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Layout>
  );
};

export default Dashboard;
