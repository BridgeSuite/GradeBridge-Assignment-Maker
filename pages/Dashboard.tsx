
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Assignment } from '../types';
import { storageService } from '../services/storageService';
import { exportService, isRescaleDeclined } from '../services/exportService';
import { Layout, Card, Button, HOME_SCREEN_NAME } from '../components/Common';
import { useRescaleChoice } from '../components/RescaleChoice';
import { useChoice } from '../components/ChoicePanel';
import { askDelete, askImportCollision } from '../services/questions';
import { HelpLink, useOpenHelp } from '../components/HelpGuide';
import { Plus, FileText, Download, Trash2, Edit2, Eye, Upload, Copy, Sparkles, FileCode, Printer, FolderOpen } from 'lucide-react';
import { createExampleAssignment, EXAMPLE_LOADED_MESSAGE } from '../exampleAssignment';
import { parseMdToAssignment } from '../services/mdParserService';
import { adoptAssignmentKind, adoptSheet, stripRetiredFields } from '../services/importNotices';
import { assignmentKindProblem } from '../services/inputModeService';
import { pointsAreMarked, pointsGridProblems } from '../services/pointsService';
import { altTextNotice, collectFigures, resolveImagePaths } from '../services/figureImport';
import { figureRefusalMessage, setAsideNotice, unusedImages, unusedImagesNotice } from '../services/importMessages';
import { ChosenFile, ImportRefusal, chosenFromDrop, chosenFromFile, gatherImport } from '../services/mdImport';
import { hasFigureRef, referencedFigureIds } from '../services/figureRefs';
import { degradeRetiredTypes } from '../services/retiredTypes';
import { isEncoded, decryptJson } from '../services/cryptoService';

// What an instructor reads on the import controls. The folder is the primary
// route: it is what an author has, and it is the one thing the Open dialog
// could not otherwise hand over in one action
// (WORKORDER_AM_FIGURES_AND_FOLDER_IMPORT_2026-09-27 §4).
export const IMPORT_FOLDER_TITLE =
  'Choose the folder that holds your assignment .md and its images. Everything in it comes in together.';
export const IMPORT_FILES_TITLE =
  'Choose a .md together with its images, or a zip holding both.';
export const IMPORT_HINT =
  'Write figures as ordinary markdown, ![what the drawing shows](figs/drawing.png), then import the '
  + 'folder that holds the .md and its images, or drag the folder onto this page.';
// The main way in (WORKORDER_AM_ONE_ROUTE_IN_2026-09-27). Lead with the task:
// a colleague arriving with an assignment they wrote needs one thing to press,
// and needs to be told, before trying, that dragging the folder works.
export const BRING_IN_LABEL = 'Bring in an assignment';
export const ROUTE_IN_LINE =
  'Written an assignment already? Press Bring in an assignment, or drag its folder anywhere onto this page.';
export const DROP_ZONE_HEADLINE = "Drop your assignment's folder here";
export const FOLDER_LINE = "The folder should hold the assignment's .md file and the images it uses.";
export const CHOOSE_FOLDER_LABEL = 'Choose the folder';
export const OTHER_WAYS_LABEL = 'Other ways in:';
export const QUARTER_HEADING = 'For the whole quarter';
export const QUARTER_LINE = 'The one printable answer page that every generic-sheet assignment uses.';
export const DROP_HEADLINE = 'Drop to import';
export const DROP_DETAIL = 'The folder that holds your assignment .md and its images, a .md with its images, or a zip.';

const Dashboard: React.FC<{ view?: 'list' | 'import' }> = ({ view = 'list' }) => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mdFileInputRef = useRef<HTMLInputElement>(null);
  const mdFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAssignments();
  }, []);

  const handleLoadExample = async () => {
    const example = createExampleAssignment();
    // Every write here reports a failure in the page and stops (storageService.ts).
    const saved = storageService.save(example, 'was NOT added');
    if (!saved.ok) { await tell(saved.notice); return; }
    loadAssignments();
    setStatusMessage(EXAMPLE_LOADED_MESSAGE);
    setTimeout(() => setStatusMessage(''), 5000);
  };

  const loadAssignments = () => {
    setAssignments(storageService.getAll());
  };

  const handleDelete = async (e: React.MouseEvent, id: string, title: string) => {
    e.preventDefault();
    e.stopPropagation();
    // Destructive, so it fails CLOSED: only a pressed Delete deletes.
    if (await askDelete(ask, title)) {
      const removed = storageService.delete(id);
      if (!removed.ok) { await tell(removed.notice); return; }
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
  // Every other question on this page, asked in the page as well. No browser
  // dialog is used anywhere in the app (services/questions.ts).
  const { ask, tell, panel: choicePanel } = useChoice();
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
        `The PDF holds it twice, so it prints single or double sided; both sides are the same page. ` +
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

        // Points off the 0.25 grid are refused, part by part, rather than
        // loaded as a value the points field could never have produced.
        const offGrid = pointsGridProblems(importedAssignment);
        if (offGrid.length) {
          alert(['This file was not imported.', '', ...offGrid.map(p => `  • ${p}`)].join('\n'));
          return;
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
          // Constructive, so an unanswered question fails VISIBLY: nothing is
          // imported, and the instructor is told so. It used to be a
          // `window.confirm` whose suppressed `false` silently saved a copy.
          const { choice, notice } = await askImportCollision(ask, importedAssignment.title);
          if (notice) {
            await tell(notice);
            if (fileInputRef.current) fileInputRef.current.value = '';
            return;
          }
          if (choice === 'copy') {
            importedAssignment.id = uuidv4();
            importedAssignment.title = `${importedAssignment.title} (Copy)`;
          }
        }

        const stored = storageService.save(importedAssignment, 'was NOT imported');
        if (!stored.ok) { await tell(stored.notice); return; }
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

  const handleMdFolderClick = () => {
    mdFolderInputRef.current?.click();
  };

  const resetImportInputs = () => {
    if (mdFileInputRef.current) mdFileInputRef.current.value = '';
    if (mdFolderInputRef.current) mdFolderInputRef.current.value = '';
  };

  const handleMdFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files || []).map(f => chosenFromFile(f));
    if (chosen.length) void importChosen(chosen);
  };

  // WORKORDER_AM_FIGURES_AND_FOLDER_IMPORT_2026-09-27 \u00a74: dragging the folder
  // onto the page is the other gesture an author reaches for unprompted.
  const [dragging, setDragging] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    if (!dragging) setDragging(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    e.preventDefault();
    setDragging(false);
    const items = e.dataTransfer.items;
    void (async () => {
      try {
        const chosen = await chosenFromDrop(items);
        if (chosen.length) await importChosen(chosen);
      } catch (error) {
        console.error(error);
        alert(`Failed to import: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  };

  /**
   * Import a `.md`, and the figures it refers to when it refers to any.
   *
   * FOUR WAYS IN, ONE PATH THROUGH. A chosen folder, a dropped folder, several
   * files chosen by hand, or a zip. Whichever arrives, `gatherImport` reduces it
   * to one markdown text, its path, and the files that came with it before
   * anything is parsed, so there is one import to reason about.
   *
   * A `.md` with no figures needs nothing else and imports alone, exactly as it
   * always has.
   */
  const importChosen = async (chosen: ChosenFile[]) => {
    {
      try {
        const { content, mdPath, candidates, setAside } = await gatherImport(chosen);
        // Retired type tags degrade to Text rather than failing the import; the
        // warning names the sub-part so the instructor can re-pick its type.
        const warnings: string[] = [];
        let assignment = parseMdToAssignment(content, warnings);

        // The figures the file refers to, in either form, matched to the files
        // that came with it. Refused rather than guessed: a figure with no file,
        // a name that fits two files, or a file that fails a guard all stop the
        // import, and every problem is listed at once so the folder is fixed in
        // one pass. Nothing is stored, and nothing is ever drawn as a
        // placeholder in place of a missing drawing.
        const figureProblems: string[] = [];
        let figureCount = 0;
        let blockIds: string[] = [];
        if (hasFigureRef(assignment.problems.map(p => p.description || '').join('\n'))) {
          const { figures, problems } = await collectFigures(assignment, candidates);
          blockIds = referencedFigureIds(assignment);
          figureCount += blockIds.length;
          figureProblems.push(...problems);
          assignment.figures = figures;
        }
        const images = await resolveImagePaths(assignment, candidates, mdPath);
        figureCount += images.resolved;
        figureProblems.push(...images.problems);
        if (figureProblems.length) {
          alert(figureRefusalMessage(figureCount, figureProblems));
          resetImportInputs();
          return;
        }
        assignment = images.assignment;
        // Images that came with the .md and that nothing used, by either form.
        // Named, not refused: spare drawings are normal (importMessages.ts).
        const unused = unusedImages(candidates.map(c => c.path), images.usedPaths, blockIds);
        if (unused.length) warnings.push(unusedImagesNotice(unused));
        if (images.usedPaths.length) warnings.push(altTextNotice(images.resolved));
        if (setAside.length) warnings.push(setAsideNotice(mdPath, setAside));

        // A reader assignment must be handwritten. Refused rather than
        // corrected: the file says two things that cannot both be true, and
        // picking one for the author is how a choice they made on purpose
        // disappears. The message names the line to change.
        const kindProblem = assignmentKindProblem(assignment);
        if (kindProblem) {
          alert(`This file was not imported.\n\n${kindProblem}\n\n`
            + 'In the file: **Kind:** reader needs **Input:** handwritten above it. '
            + 'An assignment with no **Input:** line is electronic.');
          resetImportInputs();
          return;
        }

        // Check for existing assignment with same courseCode + title
        const existing = storageService.getAll().find(
          a => a.courseCode === assignment.courseCode && a.title === assignment.title
        );

        if (existing) {
          // Constructive, so an unanswered question fails VISIBLY: nothing is
          // imported, and the instructor is told so. This is the question an
          // instructor meets on every re-import of a .md they are authoring,
          // which is exactly when a browser starts suppressing dialogs.
          const { choice, notice } = await askImportCollision(ask, `${assignment.courseCode}: ${assignment.title}`);
          if (notice) {
            await tell(notice);
            resetImportInputs();
            return;
          }
          if (choice === 'overwrite') {
            assignment.id = existing.id;
            assignment.createdAt = existing.createdAt;
          }
          // 'copy': keep the new UUID, which saves a separate copy.
        }

        const stored = storageService.save(assignment, 'was NOT imported');
        if (!stored.ok) { await tell(stored.notice); resetImportInputs(); return; }
        if (warnings.length) alert(warnings.join('\n'));
        navigate(`/edit/${assignment.id}`);
      } catch (error) {
        console.error(error);
        alert(error instanceof ImportRefusal ? error.message
          : error instanceof Error && error.message
          ? `Failed to import: ${error.message}`
          : 'Failed to parse markdown file. Please check the file format matches the GradeBridge assignment spec.');
      }
      resetImportInputs();
    }
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

    const stored = storageService.save(duplicated, 'was NOT copied');
    if (!stored.ok) { void tell(stored.notice); return; }
    navigate(`/edit/${duplicated.id}`);
  };

  // The three hidden inputs every import route opens. Rendered on both views,
  // so each button opens exactly the picker it always did.
  const hiddenInputs = (
    <>
      <input type="file" accept=".json" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
      <input type="file" accept=".md,.zip,.svg,.png,.jpg,.jpeg" multiple ref={mdFileInputRef}
        className="hidden" onChange={handleMdFileUpload} />
      <input type="file" {...{ webkitdirectory: '', directory: '' }} ref={mdFolderInputRef}
        className="hidden" onChange={handleMdFileUpload} />
    </>
  );

  const dropOverlay = dragging && (
    <div className="fixed inset-0 z-50 bg-academic-900/60 flex items-center justify-center pointer-events-none px-4">
      <div className="bg-white rounded-lg shadow-xl px-8 py-6 text-center max-w-md">
        <p className="text-lg font-medium text-academic-900">{DROP_HEADLINE}</p>
        <p className="mt-2 text-sm text-academic-600">{DROP_DETAIL}</p>
      </div>
    </div>
  );

  // The routes that are not the main way in. Kept, each doing exactly what it
  // did, and demoted so they stop competing with the two actions that lead.
  // On the import page only the variant that is itself a way to bring an
  // assignment in is offered; a JSON restore and the example belong to the
  // dashboard, whose list shows what they did.
  const otherWaysIn = (onImportPage: boolean) => (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" data-other-ways-in>
      <span className="text-academic-500">{OTHER_WAYS_LABEL}</span>
      <button type="button" onClick={handleMdImportClick} title={IMPORT_FILES_TITLE}
        className="group inline text-left text-academic-700 hover:text-academic-900">
        <FileCode className="inline w-4 h-4 mr-1.5 align-text-bottom" /><span className="underline underline-offset-2">Import Markdown</span>
        {' '}<span className="text-academic-500">(a .md with its images, or a zip)</span>
      </button>
      {!onImportPage && <>
      <button type="button" onClick={handleImportClick}
        className="group inline text-left text-academic-700 hover:text-academic-900">
        <Upload className="inline w-4 h-4 mr-1.5 align-text-bottom" /><span className="underline underline-offset-2">Import JSON</span>
        {' '}<span className="text-academic-500">(a backup this app exported)</span>
      </button>
      <button type="button" onClick={handleLoadExample}
        className="group inline text-left text-academic-700 hover:text-academic-900">
        <Sparkles className="inline w-4 h-4 mr-1.5 align-text-bottom" /><span className="underline underline-offset-2">Load Example</span>
      </button>
      </>}
    </div>
  );

  // ---- THE PAGE FOR ONE THING: bringing an assignment in -------------------
  if (view === 'import') {
    return (
      <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {dropOverlay}
        {hiddenInputs}
        <Layout title={BRING_IN_LABEL}>
          <Card className="p-0">
            <div data-drop-zone
              className="m-4 sm:m-6 rounded-xl border-2 border-dashed border-academic-300 bg-academic-50/60
                         px-4 py-12 sm:py-16 text-center">
              <FolderOpen className="mx-auto w-12 h-12 text-academic-500" />
              <h2 className="mt-4 text-xl font-semibold text-academic-900">{DROP_ZONE_HEADLINE}</h2>
              <p className="mt-2 text-academic-600 max-w-md mx-auto">{FOLDER_LINE}</p>
              <div className="mt-6">
                <Button onClick={handleMdFolderClick} title={IMPORT_FOLDER_TITLE}>
                  <FolderOpen className="w-4 h-4 mr-2" />
                  {CHOOSE_FOLDER_LABEL}
                </Button>
              </div>
              <p className="mt-6 text-xs text-academic-500 max-w-md mx-auto">{IMPORT_HINT}</p>
            </div>
          </Card>
          <div className="mt-6">{otherWaysIn(true)}</div>
          {rescalePanel}
          {choicePanel}
        </Layout>
      </div>
    );
  }

  // ---- THE DASHBOARD ------------------------------------------------------
  // Two actions lead: bring in an assignment you have, or start one you have
  // not written. Everything else is a variant, an export, or belongs to the
  // whole quarter (WORKORDER_AM_ONE_ROUTE_IN_2026-09-27).
  return (
    <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
    {dropOverlay}
    {hiddenInputs}
    <Layout
      title={HOME_SCREEN_NAME}
      action={
        <div className="flex flex-wrap gap-2">
          <Link to="/import" data-bring-in>
            <Button>
              <FolderOpen className="w-4 h-4 mr-2" />
              {BRING_IN_LABEL}
            </Button>
          </Link>
          <Link to="/create">
            <Button variant="secondary">
              <Plus className="w-4 h-4 mr-2" />
              New Assignment
            </Button>
          </Link>
        </div>
      }
    >
      <div className="mb-6 space-y-3">
        <p className="text-academic-700" data-route-in-line>{ROUTE_IN_LINE}</p>
        {otherWaysIn(false)}
      </div>
      {assignments.length === 0 ? (
        <Card className="text-center py-16">
          <div className="mx-auto w-16 h-16 bg-academic-100 rounded-full flex items-center justify-center mb-4 text-academic-600">
            <FileText className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-medium text-academic-900">No assignments yet</h3>
          <p className="mt-2 text-academic-500 max-w-sm mx-auto">
            Bring in one you have written, or start a new one here.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Link to="/import">
              <Button>
                <FolderOpen className="w-4 h-4 mr-2" />
                {BRING_IN_LABEL}
              </Button>
            </Link>
            <Link to="/create">
              <Button variant="secondary">
                <Plus className="w-4 h-4 mr-2" />
                New Assignment
              </Button>
            </Link>
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

      {/* NOT AN IMPORT. The generic answer page belongs to the whole quarter,
          not to any one assignment, so it sits apart from the ways in. */}
      <section className="mt-10 pt-6 border-t border-academic-200" data-quarter>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-academic-500">{QUARTER_HEADING}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={handleGenericAnswerPage}
            title="The one answer page every generic-sheet assignment uses. Not tied to any assignment.">
            <Printer className="w-4 h-4 mr-2" />
            Generic answer page
          </Button>
          <HelpLink section="generic" onOpen={openHelp} label="Help: the generic answer page" />
          <span className="text-sm text-academic-500">{QUARTER_LINE}</span>
        </div>
      </section>
      {rescalePanel}
      {choicePanel}
    </Layout>
    </div>
  );
};

export default Dashboard;
