
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Assignment } from '../types';
import { storageService } from '../services/storageService';
import { exportService, isRescaleDeclined } from '../services/exportService';
import { Layout, Card, Button, HOME_SCREEN_NAME } from '../components/Common';
import { useRescaleChoice } from '../components/RescaleChoice';
import { HelpLink, useOpenHelp } from '../components/HelpGuide';
import { Plus, FileText, Download, Trash2, Edit2, Eye, Upload, Copy, Sparkles, FileCode, Printer } from 'lucide-react';
import { createExampleAssignment, EXAMPLE_LOADED_MESSAGE } from '../exampleAssignment';
import { parseMdToAssignment } from '../services/mdParserService';
import { adoptAssignmentKind, adoptSheet, stripRetiredFields } from '../services/importNotices';
import { assignmentKindProblem } from '../services/inputModeService';
import { pointsAreMarked } from '../services/pointsService';
import { collectFigures, unreferencedNotice } from '../services/figureImport';
import { hasFigureRef, referencedFigureIds } from '../services/figureRefs';
import JSZip from 'jszip';
import { degradeRetiredTypes } from '../services/retiredTypes';
import { isEncoded, decryptJson } from '../services/cryptoService';

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

  /**
   * ONE download. The instructor archive, with the student package inside it.
   *
   * The message names the ONE file to attach, because that is the whole of the
   * instructor's remaining job: open the archive, attach that file to Canvas,
   * keep the rest. Naming two files would be asking them to assemble something.
   */
  // The rescale question is asked here, in the page, before anything runs
  // (components/RescaleChoice.tsx). No browser dialog is on this path.
  const { withRescaleChoice, panel: rescalePanel } = useRescaleChoice();
  const openHelp = useOpenHelp();
  const handleExport = (assignment: Assignment) =>
    withRescaleChoice(assignment, rescale => runExport(assignment, rescale));

  const runExport = async (assignment: Assignment, rescale: boolean | undefined) => {
    try {
      const { filename, studentZipName, studentNames } = await exportService.downloadZIP(assignment, rescale);
      alert(
        `Downloaded ${filename}\n\n` +
        `Attach ${studentZipName} from inside it. That one file holds:\n` +
        studentNames.map(n => `  ${n}`).join('\n') +
        (assignment.inputMode === 'handwritten' && assignment.sheet === 'generic'
          ? `\n\nThis assignment uses the generic answer page. Post your own question PDF ` +
            `separately, and make sure students have the generic answer page ` +
            `("Generic answer page" on this dashboard).`
          : '') +
        `\n\nPost nothing else: everything under instructor/ contains answers.`
      );
    } catch (error) {
      // Declining the rescale is a decision, not a failure. Say nothing.
      if (isRescaleDeclined(error)) return;
      console.error(error);
      alert(error instanceof Error ? error.message : 'Failed to export the assignment package.');
    }
  };

  /**
   * The generic answer page, on its own: one PDF, the same for every
   * assignment and every course, so a department can print a stack without
   * authoring anything.
   */
  const handleGenericAnswerPage = async () => {
    try {
      const page = await exportService.downloadGenericAnswerPage();
      alert(
        `Downloaded ${page.pdfFilename}\n\n` +
        `The generic answer page: one page, the same for every assignment that uses it. ` +
        `Print as many as you like, on US Letter at 100%.\n\nLayout id: ${page.layoutId}`
      );
    } catch (error) {
      console.error(error);
      alert(error instanceof Error ? error.message : 'Failed to build the generic answer page.');
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

        // A file written before 2026-09-21 can still carry a course public key.
        // It is dropped rather than kept, and said rather than dropped quietly:
        // an instructor looking at a key in their own backup file has no other
        // way to learn it stopped meaning anything. See `importNotices.ts`.
        // Same rule as the .md route, and the authoring backup comes through
        // here too. Checked after the retired-field strip and the kind
        // migration below would be too late, so it is checked on what the file
        // actually says: a file that never had a kind is migrated to
        // conventional, which is valid in either mode and cannot trip this.
        const importedProblem = assignmentKindProblem(importedAssignment);
        if (importedProblem) throw new Error(importedProblem);

        const asRecord = importedAssignment as unknown as Record<string, unknown>;
        const legacy = [
          ...stripRetiredFields(asRecord),
          // A file written before 2026-09-21 has no kind. It becomes
          // conventional and says so — a value chosen on the author's behalf
          // is announced, where a dead field being dropped is not.
          ...adoptAssignmentKind(asRecord),
          // `sheet: generic` on an electronic assignment is reported and dropped.
          ...adoptSheet(asRecord),
        ];

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
        const notices = [...retired, ...legacy];
        alert(notices.length
          ? ['Assignment imported.', '', ...notices].join('\n')
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

  /**
   * Import a `.md`, and the `figures/` it refers to when it refers to any.
   *
   * THREE WAYS IN, ONE PATH THROUGH. The input takes a single `.md`, a zip
   * holding the `.md` and `figures/`, or a multi-selection of both. Whichever
   * arrives, it is reduced to one markdown text plus a list of candidate files
   * before anything is parsed, so there is one import to reason about rather
   * than three.
   *
   * A `.md` with no figure blocks needs nothing else and imports alone, exactly
   * as it always has.
   */
  const handleMdFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files || []);
    if (!chosen.length) return;
    void (async () => {
      try {
        const candidates: Array<{ path: string; bytes: Uint8Array }> = [];
        let content: string | null = null;

        for (const f of chosen) {
          const name = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);
          if (/\.zip$/i.test(name)) {
            const zip = await JSZip.loadAsync(await f.arrayBuffer());
            for (const entry of Object.values(zip.files)) {
              if (entry.dir) continue;
              if (/\.md$/i.test(entry.name)) {
                if (content !== null) throw new Error(
                  'That zip holds more than one .md file. It should hold exactly one assignment.');
                content = await entry.async('string');
              } else {
                candidates.push({ path: entry.name, bytes: await entry.async('uint8array') });
              }
            }
          } else if (/\.md$/i.test(name)) {
            if (content !== null) throw new Error('Choose one .md file at a time.');
            content = await f.text();
          } else {
            candidates.push({ path: name, bytes: new Uint8Array(await f.arrayBuffer()) });
          }
        }

        if (content === null) throw new Error('No .md file was selected.');
        // Retired type tags degrade to Text rather than failing the import; the
        // warning names the sub-part so the instructor can re-pick its type.
        const warnings: string[] = [];
        const assignment = parseMdToAssignment(content, warnings);

        // The figures the file refers to, matched to the files that came with
        // it. Refused rather than guessed: a block with no file, two files for
        // one id, or a file that fails a guard all stop the import, and every
        // problem is listed at once so the folder is fixed in one pass.
        if (hasFigureRef(assignment.problems.map(p => p.description || '').join('\n'))) {
          const { figures, problems, unreferenced } = await collectFigures(assignment, candidates);
          if (problems.length) {
            alert(['This file was not imported.', '',
              `It refers to ${referencedFigureIds(assignment).length} figure(s), and:`, '',
              ...problems.map(p => `  \u2022 ${p}`), '',
              'Choose the .md together with its figures/ folder, or a zip holding both.',
            ].join('\n'));
            if (mdFileInputRef.current) mdFileInputRef.current.value = '';
            return;
          }
          assignment.figures = figures;
          if (unreferenced.length) warnings.push(unreferencedNotice(unreferenced));
        }

        // A reader assignment must be handwritten. Refused rather than
        // corrected: the file says two things that cannot both be true, and
        // picking one for the author is how a choice they made on purpose
        // disappears. The message names the line to change.
        const kindProblem = assignmentKindProblem(assignment);
        if (kindProblem) {
          alert(`This file was not imported.\n\n${kindProblem}\n\n`
            + 'In the file: **Kind:** reader needs **Input:** handwritten above it. '
            + 'An assignment with no **Input:** line is electronic.');
          if (mdFileInputRef.current) mdFileInputRef.current.value = '';
          return;
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
          }
          // If cancel: keep new UUID → saves as new copy
        }

        storageService.save(assignment);
        if (warnings.length) alert(warnings.join('\n'));
        navigate(`/edit/${assignment.id}`);
      } catch (error) {
        console.error(error);
        alert(error instanceof Error && error.message
          ? `Failed to import: ${error.message}`
          : 'Failed to parse markdown file. Please check the file format matches the GradeBridge assignment spec.');
      }
      if (mdFileInputRef.current) mdFileInputRef.current.value = '';
    })();
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
      title={HOME_SCREEN_NAME}
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
            accept=".md,.zip,.svg,.png,.jpg,.jpeg" multiple
            ref={mdFileInputRef}
            className="hidden"
            onChange={handleMdFileUpload}
          />
          <Button variant="secondary" onClick={handleLoadExample}>
            <Sparkles className="w-4 h-4 mr-2" />
            Load Example
          </Button>
          <Button variant="secondary" onClick={handleGenericAnswerPage}
            title="The one answer page every generic-sheet assignment uses. Not tied to any assignment.">
            <Printer className="w-4 h-4 mr-2" />
            Generic answer page
          </Button>
          <span className="self-center">
            <HelpLink section="generic" onOpen={openHelp} label="Help: the generic answer page" />
          </span>
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
                  {pointsAreMarked(assignment)
                    ? <span>Total Points: {assignment.problems.reduce((acc, p) => acc + p.subsections.reduce((sAcc, s) => sAcc + s.points, 0), 0)}</span>
                    : <span>Reader: not marked</span>}
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
                  onClick={() => handleExport(assignment)}
                  title="One download: the file to post, plus your grading material — never give the whole archive to students"
                >
                  <Download className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Export</span>
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
      {rescalePanel}
    </Layout>
  );
};

export default Dashboard;
