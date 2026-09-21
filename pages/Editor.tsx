
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Assignment, AssignmentKind, InputMode, Problem, Subsection, SubmissionType } from '../types';
import { storageService } from '../services/storageService';
import { exportService, isRescaleDeclined } from '../services/exportService';
import {
  MODE_LABEL,
  assignmentKindProblem,
  convertSubsectionToMode,
  defaultTypeForMode,
  isAiHandwritten,
  strandedSubsectionLabels,
  typeAllowedInMode
} from '../services/inputModeService';
import { DEFAULT_ANSWER_LINES, answerLinesFor } from '../services/templateLayout';
import { derivePageFormatId } from '../services/qrPayload';
import { describeImportGaps, isAuthoringBackup, readAuthoringBackup } from '../services/authoringBackup';
import { assignmentKindDefaultedNotice } from '../services/importNotices';
import { apportionPoints } from '../services/pointsService';
import { Layout, Card, Button, Input, TextArea, TextAreaWithPreview, InputWithPreview } from '../components/Common';
import { Trash2, Plus, Save, ChevronDown, ChevronUp, GripVertical, Upload, FileDown, Lock, PenLine, Keyboard, QrCode } from 'lucide-react';

const AI_GRADED_TYPES = new Set([
  SubmissionType.AI_GRADED_BINARY,
  SubmissionType.AI_GRADED_SHORT,
  SubmissionType.AI_GRADED_MEDIUM,
  SubmissionType.AI_GRADED_LONG,
]);

const AI_WORD_RANGES: Partial<Record<SubmissionType, { range: string; min: number }>> = {
  [SubmissionType.AI_GRADED_BINARY]: { range: '20–40 words',   min: 20  },
  [SubmissionType.AI_GRADED_SHORT]:  { range: '50–100 words',  min: 50  },
  [SubmissionType.AI_GRADED_MEDIUM]: { range: '100–150 words', min: 100 },
  [SubmissionType.AI_GRADED_LONG]:   { range: '150–250 words', min: 150 },
};

// Same arithmetic the export uses — imported, not copied, so what the editor
// shows and what lands in the rubric cannot drift apart.
const normalizePoints = (assignment: Assignment): Assignment => {
  const allSubs = assignment.problems.flatMap(p => p.subsections);
  const scaled = apportionPoints(allSubs.map(s => s.points), assignment.targetPoints || 100);
  let idx = 0;
  return {
    ...assignment,
    problems: assignment.problems.map(p => ({
      ...p,
      subsections: p.subsections.map(s => ({ ...s, points: scaled[idx++] }))
    }))
  };
};

// New sub-parts take the medium the assignment's input mode allows.
const emptySubsection = (inputMode: InputMode = 'electronic'): Subsection => (
  defaultTypeForMode(inputMode) === SubmissionType.HANDWRITTEN
    ? {
        id: uuidv4(),
        name: '',
        description: '',
        points: 0,
        submissionType: SubmissionType.HANDWRITTEN,
        handwrittenGradingMode: 'ai',
        aiGradingPrompt: ''
      }
    : {
        id: uuidv4(),
        name: '',
        description: '',
        points: 0,
        submissionType: SubmissionType.TEXT,
        maxImages: 1,
        aiGradingPrompt: ''
      }
);

const emptyProblem = (inputMode: InputMode = 'electronic'): Problem => ({
  id: uuidv4(),
  name: '',
  description: '',
  subsections: [emptySubsection(inputMode)]
});

const Editor: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [assignment, setAssignment] = useState<Assignment>({
    id: uuidv4(),
    courseCode: '',
    title: '',
    inputMode: 'electronic',
    // Pre-filled so the object is always a valid `Assignment`, but NOT treated
    // as answered: `kindAnswered` below is what gates the save, and neither pill
    // shows as chosen until the author picks one.
    assignmentKind: 'conventional',
    aiFeedback: false,
    preamble: '',
    problems: [emptyProblem()],
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  // Assignments saved before handwritten support have no inputMode — they are electronic.
  const inputMode: InputMode = assignment.inputMode ?? 'electronic';

  /**
   * A brand-new assignment has not been asked the AI-feedback question yet, so
   * the control is highlighted until the author answers. Anything loaded or
   * imported already carries a value (absent reads as off), so it shows as a
   * plain toggle.
   */
  const [aiFeedbackAnswered, setAiFeedbackAnswered] = useState(isEdit);
  const aiFeedbackUnanswered = !aiFeedbackAnswered;

  /**
   * The assignment kind is a choice at creation, and a new assignment cannot be
   * saved without one.
   *
   * The state is pre-filled with `'conventional'` so the object is always a
   * valid `Assignment`, but that value is NOT shown as chosen and does not count
   * as an answer. A pre-selected radio that must be clicked anyway reads as
   * already answered, which is how a default becomes a decision nobody made —
   * and the whole reason this field is required is that there are now two kinds
   * of assignment and the pipeline has to be told which one this is.
   *
   * Anything loaded or imported has been answered, either by the file or by the
   * migration default, which announces itself.
   */
  const [kindAnswered, setKindAnswered] = useState(isEdit);
  const assignmentKind: AssignmentKind = assignment.assignmentKind ?? 'conventional';

  const chooseKind = (kind: AssignmentKind) => {
    setKindAnswered(true);
    setAssignment(prev => ({ ...prev, assignmentKind: kind }));
  };

  // What the QR would carry if the author leaves the Template ID blank.
  const [qrIdPreview, setQrIdPreview] = useState('');
  useEffect(() => {
    let live = true;
    if (inputMode !== 'handwritten' || (!assignment.courseCode && !assignment.title)) {
      setQrIdPreview('');
      return;
    }
    derivePageFormatId(assignment.courseCode, assignment.title)
      .then(id => { if (live) setQrIdPreview(id); })
      .catch(() => { if (live) setQrIdPreview(''); });
    return () => { live = false; };
  }, [inputMode, assignment.courseCode, assignment.title]);

  useEffect(() => {
    if (id) {
      const loaded = storageService.get(id);
      if (loaded) {
        // Ensure new fields exist on loaded data; strip deprecated fields
        // Fields dropped on load because they are no longer part of
        // `Assignment`: `dueDate` / `dueTime` (set in Canvas, never travelled
        // through this pipeline) and `aiGradingConfig` (a grader configuration
        // nothing read). An assignment saved before 2026-08-31 still carries
        // them; drop them silently — it is not the author's mistake and there is
        // nothing for them to do about it.
        const { dueDate: _d, dueTime: _t, aiGradingConfig: _ai, ...loadedWithoutDate } = loaded as any;
        // An assignment saved before 2026-09-21 has no kind. It becomes
        // conventional — every assignment authored before the field existed is
        // — and unlike the drops above this one is ANNOUNCED, because it is a
        // value being chosen on the author's behalf rather than a dead field
        // being discarded. See `services/importNotices.ts`.
        const kindWasAbsent = loaded.assignmentKind !== 'conventional'
          && loaded.assignmentKind !== 'reader';
        const sanitized = {
          ...loadedWithoutDate,
          inputMode: loaded.inputMode || 'electronic',
          assignmentKind: (kindWasAbsent ? 'conventional' : loaded.assignmentKind) as AssignmentKind,
          aiFeedback: !!loaded.aiFeedback,
          problems: loaded.problems.map(p => ({
            ...p,
            subsections: p.subsections.map(s => ({
              ...s,
              // Handwritten carries no per-part page count — pages are an assignment-level pool.
              ...(s.submissionType === SubmissionType.HANDWRITTEN
                ? { handwrittenGradingMode: s.handwrittenGradingMode || 'ai' }
                : { maxImages: s.maxImages || 1 }),
              aiGradingPrompt: s.aiGradingPrompt || '',
              graderNote: s.graderNote || ''
            }))
          }))
        };
        setAssignment(sanitized);
        if (kindWasAbsent) alert(assignmentKindDefaultedNotice());
      } else {
        navigate('/');
      }
    }
  }, [id, navigate]);

  /**
   * Emit the printable page-format template and its sidecar map. The generator
   * runs the spec 8.7 self-test and refuses to produce a non-compliant template,
   * so a failure here is surfaced verbatim rather than swallowed — a template
   * that registers but crops the wrong rectangles is worse than no template.
   */
  const handleDownloadQrTemplate = async () => {
    try {
      const result = await exportService.downloadQrTemplate(assignment);
      const warnings = result.selfTest.warnings;
      alert(
        `QR template ready — ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}, ` +
        `${result.rows.length} answer region${result.rows.length === 1 ? '' : 's'}.\n\n` +
        `Template id in the QR: ${result.assignmentId}\nLayout id: ${result.layoutId}\n\n` +
        `Downloaded ${result.zipFilename}, containing:\n` +
        `  ${result.pdfFilename}   — print this\n  ${result.csvFilename}   — the Submission app reads this\n\n` +
        `Keep the two together. Regenerating after any edit changes the layout id, ` +
        `and a template will not crop against a map it does not match.` +
        (warnings.length ? `\n\nNotes:\n${warnings.map(w => `  • ${w}`).join('\n')}` : '')
      );
    } catch (err) {
      // Declining the rescale is a decision, not a failure. Say nothing.
      if (isRescaleDeclined(err)) return;
      console.error(err);
      alert(err instanceof Error ? err.message : 'Failed to build the QR template.');
    }
  };

  const handleSave = async () => {
    if (!assignment.courseCode || !assignment.title) {
      alert("Please fill in Course Code and Title.");
      return;
    }

    // An assignment has exactly one kind and it is not guessable from anything
    // else in the file, so the question is asked once and answered before
    // anything is stored. Refusing here costs a click; a wrong kind stored
    // silently is discovered downstream, by someone who cannot tell it was
    // never chosen.
    if (!kindAnswered) {
      alert('Choose whether this is a conventional or a reader assignment before saving.\n\n'
        + 'Every assignment is one or the other, and it cannot be worked out from anything else '
        + 'in the file, so there is no sensible default to fall back on.');
      return;
    }

    // The pairing rule, on the same function every other entry point calls.
    // Reachable in the editor only by a route that set one of the two without
    // going through its control; the controls themselves make it unpickable.
    const kindConflict = assignmentKindProblem(assignment);
    if (kindConflict) {
      alert(`This assignment was not saved.\n\n${kindConflict}`);
      return;
    }

    const toSave = assignment;

    setAssignment(toSave);
    storageService.save(toSave);
    navigate('/');
  };

  const handleDeleteAssignment = () => {
    if (window.confirm(`Are you sure you want to delete the assignment "${assignment.title}"? This cannot be undone.`)) {
      storageService.delete(assignment.id);
      navigate('/');
    }
  };

  const updateProblem = (index: number, updates: Partial<Problem>) => {
    const newProblems = [...assignment.problems];
    newProblems[index] = { ...newProblems[index], ...updates };
    setAssignment({ ...assignment, problems: newProblems });
  };

  const addProblem = () => {
    setAssignment({ ...assignment, problems: [...assignment.problems, emptyProblem(inputMode)] });
  };

  const changeInputMode = (mode: InputMode) => {
    if (inputMode === mode) return;

    // A reader assignment must be handwritten, so switching one to electronic is
    // REFUSED rather than resolved. The tempting alternative — quietly flipping
    // the kind to conventional so the pair becomes legal — is exactly the silent
    // default this codebase keeps getting caught by: the author chose reader on
    // purpose, and they would find out it had been undone when the assignment
    // came back ungraded. Refusing costs them one extra click and tells them
    // which two settings are in conflict.
    const conflict = assignmentKindProblem({ inputMode: mode, assignmentKind });
    if (conflict) {
      alert(`This assignment cannot be switched to ${MODE_LABEL[mode]}.\n\n${conflict}`);
      return;
    }

    const stranded = strandedSubsectionLabels(assignment.problems, mode);

    if (stranded.length > 0) {
      const target = mode === 'handwritten' ? 'Handwritten' : 'Electronic text';
      const ok = window.confirm(
        `Switching this assignment to "${MODE_LABEL[mode]}" will convert ${stranded.length} sub-part${stranded.length === 1 ? '' : 's'} to ${target}:\n\n` +
        `${stranded.join('\n')}\n\n` +
        `Names, descriptions, points, rubrics and grader notes are kept. Image page counts and the previous grading mode are dropped.\n\n` +
        `OK to convert, Cancel to stay in "${MODE_LABEL[inputMode]}".`
      );
      if (!ok) return;
    }

    setAssignment({
      ...assignment,
      inputMode: mode,
      problems: assignment.problems.map(p => ({
        ...p,
        subsections: p.subsections.map(s =>
          typeAllowedInMode(s.submissionType, mode) ? s : convertSubsectionToMode(s, mode)
        )
      }))
    });
  };

  const removeProblem = (index: number) => {
    const newProblems = assignment.problems.filter((_, i) => i !== index);
    setAssignment({ ...assignment, problems: newProblems });
  };

  const updateSubsection = (pIndex: number, sIndex: number, updates: Partial<Subsection>) => {
    const newProblems = [...assignment.problems];
    newProblems[pIndex].subsections[sIndex] = { ...newProblems[pIndex].subsections[sIndex], ...updates };
    setAssignment({ ...assignment, problems: newProblems });
  };

  const addSubsection = (pIndex: number) => {
    const newProblems = [...assignment.problems];
    newProblems[pIndex].subsections.push(emptySubsection(inputMode));
    setAssignment({ ...assignment, problems: newProblems });
  };

  const removeSubsection = (pIndex: number, sIndex: number) => {
    const newProblems = [...assignment.problems];
    newProblems[pIndex].subsections = newProblems[pIndex].subsections.filter((_, i) => i !== sIndex);
    setAssignment({ ...assignment, problems: newProblems });
  };

  const handleLoadTemplate = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const parsed = JSON.parse(json);

        // Two shapes arrive here. An AUTHORING BACKUP is the complete assignment
        // and restores everything; anything else is a student spec or an older
        // export and is lossy. The file says which it is rather than being
        // guessed at from its shape — a text-only assignment carries no grading
        // prompts either, so shape cannot tell them apart.
        const restoring = isAuthoringBackup(parsed);
        const loadedAssignment = (restoring ? readAuthoringBackup(parsed) : parsed) as Assignment;

        // Basic validation
        if (!loadedAssignment.title || !Array.isArray(loadedAssignment.problems)) {
          throw new Error("Invalid assignment format.");
        }

        // Fields no longer part of `Assignment`, dropped silently — no warning:
        // they are not the author's mistake, there is nothing for them to do
        // about it, and nothing reads them.
        const { aiGradingConfig: _staleGraderConfig, dueDate: _d, dueTime: _t, ...loadedClean } =
          loadedAssignment as Assignment & { aiGradingConfig?: unknown; dueDate?: string; dueTime?: string };

        // A restore keeps its own title; a template copy is marked as one. Both
        // get fresh ids, so importing never silently overwrites an assignment
        // that is still in local storage — the instructor saves deliberately.
        const newAssignment = {
          ...loadedClean,
          id: uuidv4(),
          title: restoring ? loadedAssignment.title : loadedAssignment.title + ' (Template)',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          aiFeedback: !!loadedAssignment.aiFeedback,
          problems: loadedAssignment.problems.map(p => ({
            ...p,
            id: uuidv4(),
            subsections: p.subsections.map(s => ({
              ...s,
              id: uuidv4(),
              aiGradingPrompt: s.aiGradingPrompt || '',
              graderNote: s.graderNote || ''
            }))
          }))
        };

        const importedConflict = assignmentKindProblem(newAssignment);
        if (importedConflict) {
          alert(`This file was not loaded.\n\n${importedConflict}`);
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        setAssignment(newAssignment);
        setAiFeedbackAnswered(true); // the file carries a value; show it as a plain toggle
        setKindAnswered(true);

        if (restoring) {
          alert("Restored from authoring backup. Everything came back \u2014 grading prompts, grader notes, answer-space settings and the point target.");
        } else {
          // Name what is missing, at the one moment the instructor can act on
          // it. Silent loss of an instructor's rubrics is the same failure shape
          // as the answer key: correct behaviour, no signal, discovered late.
          const gaps = describeImportGaps(loadedAssignment);
          alert(gaps.length === 0
            ? "Assignment loaded as a new template. You can now edit and save it."
            : "Assignment loaded as a new template \u2014 but this file is not a complete backup.\n\n"
              + "It does not carry:\n"
              + gaps.map(g => `  \u2022 ${g}`).join('\n')
              + "\n\nFor a complete restore use instructor/{course}_{title}_authoring_backup.json from "
              + "the export ZIP. Import Markdown also carries the grading prompts and answer-space settings.");
        }
      } catch (error) {
        console.error(error);
        alert("Failed to load template. Please ensure the file is a valid assignment JSON.");
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleRescale = () => {
    setAssignment(normalizePoints(assignment));
  };

  const handleSetTarget = (value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n > 0) {
      setAssignment({ ...assignment, targetPoints: n });
    }
  };

  // Move Problem logic
  const moveProblem = (index: number, direction: 'up' | 'down') => {
      if ((direction === 'up' && index === 0) || (direction === 'down' && index === assignment.problems.length - 1)) return;
      const newProblems = [...assignment.problems];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      [newProblems[index], newProblems[swapIndex]] = [newProblems[swapIndex], newProblems[index]];
      setAssignment({ ...assignment, problems: newProblems });
  };

  const totalPoints = assignment.problems.flatMap(p => p.subsections).reduce((sum, s) => sum + s.points, 0);
  const targetPoints = assignment.targetPoints || 100;
  const pointsAtTarget = totalPoints === targetPoints;

  return (
    <Layout
      title={isEdit ? "Edit Assignment" : "Create Assignment"}
      action={
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="file"
            accept=".json"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileUpload}
          />
          {/* Total points badge + rescale control */}
          <span className={`text-xs font-bold px-2 py-1 rounded-full border ${
            pointsAtTarget
              ? 'bg-green-50 text-green-700 border-green-300'
              : 'bg-amber-50 text-amber-700 border-amber-300'
          }`}>
            {totalPoints} pts total
          </span>
          <div className="flex items-center gap-1">
            <span className="text-xs text-academic-500">Target:</span>
            <input
              type="number"
              min={1}
              value={targetPoints}
              onChange={e => handleSetTarget(e.target.value)}
              className="w-16 text-xs border border-academic-300 rounded px-1 py-0.5 text-center"
            />
            <span className="text-xs text-academic-500">pts</span>
          </div>
          {!pointsAtTarget && (
            <Button variant="secondary" onClick={handleRescale} className="text-xs">
              Rescale
            </Button>
          )}
          {!isEdit && (
            <Button variant="secondary" onClick={handleLoadTemplate}>
              <Upload className="w-4 h-4 mr-2" />
              Load Template
            </Button>
          )}
          {isEdit && (
            <Button variant="danger" onClick={handleDeleteAssignment} className="mr-2">
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          )}
          <Button variant="secondary" onClick={() => {
            try {
              exportService.downloadMd(assignment);
            } catch (err) {
              if (isRescaleDeclined(err)) return;
              console.error(err);
              alert(err instanceof Error ? err.message : 'Failed to export the markdown.');
            }
          }}>
            <FileDown className="w-4 h-4 mr-2" />
            Export .md
          </Button>
          <Button variant="secondary" onClick={() => {
            exportService.downloadGraderDoc(assignment).catch(err => {
              if (isRescaleDeclined(err)) return;
              console.error(err);
              alert('Failed to build the grader document.');
            });
          }}>
            <Lock className="w-4 h-4 mr-2" />
            Grader Doc
          </Button>
          {inputMode === 'handwritten' && (
            <Button variant="secondary" onClick={handleDownloadQrTemplate}>
              <QrCode className="w-4 h-4 mr-2" />
              QR Template
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/')}>Cancel</Button>
          <Button onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            Save Assignment
          </Button>
        </div>
      }
    >
      <div className="space-y-8">
        {/* Metadata Section */}
        <Card>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Input mode — governs which mediums the questions below may use */}
            <div className="md:col-span-2">
              <div className={`rounded border p-4 space-y-2 ${
                inputMode === 'handwritten'
                  ? 'border-indigo-300 bg-indigo-50/70'
                  : 'border-academic-200 bg-academic-50/60'
              }`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium text-academic-800">How students answer</span>
                  <div className="flex items-center gap-2">
                    {([
                      { mode: 'electronic'  as const, label: 'Electronic text and images', Icon: Keyboard },
                      { mode: 'handwritten' as const, label: 'Handwritten',                Icon: PenLine  },
                    ]).map(({ mode, label, Icon }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => changeInputMode(mode)}
                        className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-colors ${
                          inputMode === mode
                            ? 'bg-academic-700 text-white border-academic-700'
                            : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-academic-500 leading-relaxed">
                  {inputMode === 'handwritten'
                    ? 'Handwritten assignment — students write their work on paper and upload photographs of the pages, then mark the region that answers each part. Every sub-part is Handwritten; text and image mediums are not offered.'
                    : 'Electronic assignment — students type answers and upload images. Sub-parts can be Electronic text, Image, Text + Image, or AI graded.'}
                  {' '}Set this before adding questions; changing it later converts any sub-part the new mode cannot express.
                </p>
                {inputMode === 'handwritten' && (
                  <div className="mt-3 pt-3 border-t border-academic-200">
                    <label className="block text-xs font-medium text-academic-700 mb-1">
                      Template ID <span className="font-normal text-academic-500">— goes in the printed QR code</span>
                    </label>
                    <input
                      value={assignment.pageFormatId ?? ''}
                      placeholder={qrIdPreview ? `${qrIdPreview} (derived)` : 'derived from course code + title'}
                      onChange={e => setAssignment({
                        ...assignment,
                        pageFormatId: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || undefined,
                      })}
                      className="w-56 text-sm border border-academic-300 rounded px-2 py-1 font-mono uppercase focus:outline-none focus:border-academic-500"
                    />
                    <p className="text-xs text-academic-500 mt-1 leading-relaxed">
                      Up to 12 characters, A–Z and 0–9. Must be unique across the course — the Submission app uses it
                      to find this assignment's layout map. Leave blank to derive one automatically.
                    </p>

                    {/* Where students hand the work in. A value, never a
                        constant: the standing text on page 1 names no
                        institution and no deployment, so this is the one place
                        an address can come from. Blank prints nothing at all —
                        see Assignment.submissionAddress. */}
                    <label className="block text-xs font-medium text-academic-700 mt-4 mb-1">
                      Submission address <span className="font-normal text-academic-500">— printed on page 1</span>
                    </label>
                    <input
                      value={assignment.submissionAddress ?? ''}
                      placeholder="e.g. submit.example.edu/eng17"
                      onChange={e => setAssignment({
                        ...assignment,
                        submissionAddress: e.target.value.replace(/\s+/g, ' ').trimStart() || undefined,
                      })}
                      className="w-full max-w-md text-sm border border-academic-300 rounded px-2 py-1 focus:outline-none focus:border-academic-500"
                    />
                    <p className="text-xs text-academic-500 mt-1 leading-relaxed">
                      Where students go to photograph and upload their pages. Students type this from paper, so keep it
                      short and leave off <code className="font-mono">https://</code>.
                      {' '}
                      {(assignment.submissionAddress || '').trim()
                        ? 'Page 1 will tell students how to submit.'
                        : <span className="text-amber-700">
                            Leave it blank and page 1 says nothing about submitting — no placeholder and no gap.
                            Blank is right if you collect the pages some other way.
                          </span>}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* THE ASSIGNMENT KIND. Two values, no third, and no blank once set.

                Placed here, immediately under how students answer and above
                everything else, because it is a property of the whole
                assignment rather than of any question in it — and because §4.5
                of the work order asks for it to be visible without hunting.

                Neither pill is filled until the author picks one: the state
                underneath is pre-filled with 'conventional' so the object is
                always valid, but a pre-selected radio reads as already
                answered, and the save refuses until it really is.

                NOTE FOR REVIEW: the sentence under the pills says what the
                field DOES, not what the two kinds mean, because the work order
                that introduced them does not define them and inventing a
                definition here would put words in the pipeline's mouth on a
                screen instructors read. Replace it with the real distinction
                when there is one to state. */}
            <div className={`md:col-span-2 rounded-lg border p-4 ${
              !kindAnswered ? 'border-amber-300 bg-amber-50' : 'border-academic-200 bg-academic-50'
            }`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-academic-800">
                    What kind of assignment is this?
                  </p>
                  {!kindAnswered && (
                    <p className="text-xs text-amber-700 mt-0.5 font-medium">
                      Choose one — it cannot be saved until you do.
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {([
                    { label: 'Conventional', value: 'conventional' as AssignmentKind },
                    { label: 'Reader',       value: 'reader'       as AssignmentKind },
                  ]).map(({ label, value }) => {
                    // Unavailable rather than absent: an option that vanishes
                    // teaches nothing, and the instructor who wants it needs to
                    // know it exists and what makes it reachable.
                    const blocked = !!assignmentKindProblem({ inputMode, assignmentKind: value });
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={blocked}
                        title={blocked ? 'Only a handwritten assignment can be a reader assignment.' : undefined}
                        onClick={() => chooseKind(value)}
                        className={`text-xs px-4 py-1.5 rounded-full border font-medium transition-colors ${
                          blocked
                            ? 'bg-academic-100 text-academic-400 border-academic-200 cursor-not-allowed'
                            : kindAnswered && assignmentKind === value
                              ? 'bg-academic-700 text-white border-academic-700'
                              : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              {inputMode !== 'handwritten' && (
                <p className="text-xs text-academic-600 mt-2 leading-relaxed">
                  <strong>Reader is unavailable on an electronic assignment.</strong> The reader works by
                  reading photographed pages, so there is nothing for it to read unless students write on
                  paper. Set <em>How students answer</em> to Handwritten to make it available.
                </p>
              )}
              <p className="text-xs text-academic-500 mt-2 leading-relaxed">
                Whole-assignment, not per problem: there is one kind and every question in this
                assignment has it. You can change it while authoring. It travels with the assignment
                and is named in the export's <code className="font-mono">00_INSTRUCTOR_ONLY</code> notice,
                and it is deliberately not part of the file students load.
              </p>
            </div>

            {/* The one per-assignment AI-feedback flag. Asked as a question so a
                new assignment gets a conscious answer rather than a silent
                default, and left visible so an imported value can be seen and
                changed. Gates student-facing feedback only — never grading. */}
            <div className={`md:col-span-2 rounded-lg border p-4 ${
              aiFeedbackUnanswered ? 'border-amber-300 bg-amber-50' : 'border-academic-200 bg-academic-50'
            }`}>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-medium text-academic-800">
                    Allow students to request AI feedback on any problem in this assignment?
                  </p>
                  {aiFeedbackUnanswered && (
                    <p className="text-xs text-amber-700 mt-0.5 font-medium">Choose one — it defaults to No.</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {([
                    { label: 'No',  value: false },
                    { label: 'Yes', value: true  },
                  ]).map(({ label, value }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => { setAiFeedbackAnswered(true); setAssignment({ ...assignment, aiFeedback: value }); }}
                      className={`text-xs px-4 py-1.5 rounded-full border font-medium transition-colors ${
                        !aiFeedbackUnanswered && !!assignment.aiFeedback === value
                          ? 'bg-academic-700 text-white border-academic-700'
                          : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-academic-500 mt-2 leading-relaxed">
                Whole-assignment, not per problem. Students may request one gradeless, pointer-only pass per
                problem; it never returns a score and a human still posts every grade. This setting does not
                change grading, which follows the sub-part types. The feedback itself is generated in
                Gradescope, not here.
              </p>
            </div>

            <Input
              label="Course Code"
              placeholder="e.g. CS101" 
              value={assignment.courseCode} 
              onChange={e => setAssignment({...assignment, courseCode: e.target.value})} 
            />
            <Input 
              label="Assignment Title" 
              placeholder="e.g. Homework 1: Intro" 
              value={assignment.title} 
              onChange={e => setAssignment({...assignment, title: e.target.value})} 
            />
            <div className="md:col-span-2">
              <TextAreaWithPreview
                label="Preamble / Instructions (LaTeX supported with $...$)"
                rows={3}
                placeholder="Enter general instructions for the assignment here..."
                value={assignment.preamble}
                onChange={e => setAssignment({...assignment, preamble: e.target.value})}
              />
            </div>

          </div>
        </Card>

        {/* Problems Section */}
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-academic-800 font-serif">Problems</h3>
            <Button onClick={addProblem} variant="secondary">
              <Plus className="w-4 h-4 mr-2" />
              Add Problem
            </Button>
          </div>

          {assignment.problems.map((problem, pIndex) => (
            <div key={problem.id} className="bg-white border border-academic-300 rounded-lg overflow-hidden shadow-sm">
              {/* Problem Header */}
              <div className="bg-academic-50 p-4 border-b border-academic-200 flex justify-between items-start gap-4">
                 <div className="flex flex-col gap-2 pt-1 text-academic-400">
                   <button onClick={() => moveProblem(pIndex, 'up')} disabled={pIndex === 0} className="hover:text-academic-700 disabled:opacity-30"><ChevronUp className="w-5 h-5" /></button>
                   <button onClick={() => moveProblem(pIndex, 'down')} disabled={pIndex === assignment.problems.length - 1} className="hover:text-academic-700 disabled:opacity-30"><ChevronDown className="w-5 h-5" /></button>
                 </div>
                 <div className="flex items-center justify-center w-12 shrink-0">
                   <span className="text-lg font-bold text-academic-700 font-serif">{pIndex + 1}</span>
                 </div>
                 <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4">
                    <div className="md:col-span-4">
                       <InputWithPreview
                          placeholder="Problem Name (e.g. Binary Search)"
                          value={problem.name}
                          onChange={e => updateProblem(pIndex, { name: e.target.value })}
                          className="font-bold"
                       />
                    </div>
                    <div className="md:col-span-8">
                       <TextAreaWithPreview
                          placeholder="Problem Description (Optional, LaTeX supported)"
                          value={problem.description}
                          onChange={e => updateProblem(pIndex, { description: e.target.value })}
                          rows={2}
                       />
                    </div>
                 </div>
                 <Button variant="ghost" onClick={() => removeProblem(pIndex)} className="text-red-500 hover:bg-red-50 hover:text-red-700">
                    <Trash2 className="w-5 h-5" />
                 </Button>
              </div>

              {/* Subsections */}
              <div className="p-4 space-y-4 bg-white">
                {problem.subsections.map((sub, sIndex) => (
                   <React.Fragment key={sub.id}>
                   <div className="flex flex-col md:flex-row gap-4 items-start md:items-center bg-academic-50/50 p-3 rounded border border-dashed border-academic-200 ml-8 relative">
                      <div className="absolute -left-8 top-3 font-mono font-bold text-academic-500">{pIndex + 1}{String.fromCharCode(97 + sIndex)}.</div>

                      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 w-full">
                         <div className="md:col-span-4">
                           <InputWithPreview
                              placeholder="Subsection Name"
                              value={sub.name}
                              onChange={e => updateSubsection(pIndex, sIndex, { name: e.target.value })}
                              className="text-sm"
                           />
                         </div>
                         <div className="md:col-span-6">
                           <TextAreaWithPreview
                              placeholder="Description (LaTeX supported)"
                              value={sub.description}
                              onChange={e => updateSubsection(pIndex, sIndex, { description: e.target.value })}
                              className="text-sm"
                              rows={2}
                           />
                         </div>
                         <div className="md:col-span-2">
                           <Input
                              type="number"
                              placeholder="Pts"
                              value={sub.points}
                              onChange={e => updateSubsection(pIndex, sIndex, { points: parseInt(e.target.value) || 0 })}
                              className="text-sm"
                              title="Points"
                           />
                         </div>
                      </div>

                      <button
                        onClick={() => removeSubsection(pIndex, sIndex)}
                        className="text-academic-400 hover:text-red-500 transition-colors p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                   </div>
                   {/* Type + Grading Selector */}
                   <div className="ml-8 mt-1 flex flex-wrap items-center gap-2">
                     {/* Medium — gated by the assignment's input mode */}
                     <span className="text-xs text-academic-500 font-medium uppercase tracking-wide">Type:</span>
                     {([
                       { label: 'Electronic text', type: SubmissionType.TEXT           },
                       { label: 'Image',           type: SubmissionType.IMAGE          },
                       { label: 'Text + Image',    type: SubmissionType.TEXT_AND_IMAGE },
                       { label: 'Handwritten',     type: SubmissionType.HANDWRITTEN    },
                     ]).filter(({ type }) => typeAllowedInMode(type, inputMode)).map(({ label, type }) => (
                       <button
                         key={type}
                         type="button"
                         onClick={() => updateSubsection(pIndex, sIndex,
                           type === SubmissionType.HANDWRITTEN
                             ? { submissionType: SubmissionType.HANDWRITTEN, handwrittenGradingMode: sub.handwrittenGradingMode ?? 'ai' }
                             : { submissionType: type, imageGradingMode: 'human' }
                         )}
                         className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                           // Text is the fallback pill: active only when no other medium claims the type
                           (type === SubmissionType.TEXT
                             ? sub.submissionType !== SubmissionType.IMAGE
                               && sub.submissionType !== SubmissionType.TEXT_AND_IMAGE
                               && sub.submissionType !== SubmissionType.HANDWRITTEN
                             : sub.submissionType === type)
                             ? 'bg-academic-700 text-white border-academic-700'
                             : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                         }`}
                       >
                         {label}
                       </button>
                     ))}

                     <span className="text-xs text-academic-300 mx-1">|</span>
                     <span className="text-xs text-academic-500 font-medium uppercase tracking-wide">Grading:</span>

                     {sub.submissionType === SubmissionType.HANDWRITTEN ? (
                       /* Handwritten branch — AI (OCR + grade) or Human (TA grades the crop). No page count. */
                       <>
                         {([
                           { label: 'AI',    mode: 'ai'    as const },
                           { label: 'Human', mode: 'human' as const },
                         ]).map(({ label, mode }) => (
                           <button
                             key={mode}
                             type="button"
                             onClick={() => updateSubsection(pIndex, sIndex, { handwrittenGradingMode: mode })}
                             className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                               (sub.handwrittenGradingMode ?? 'ai') === mode
                                 ? 'bg-academic-700 text-white border-academic-700'
                                 : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                             }`}
                           >
                             {label}
                           </button>
                         ))}

                         {/* Printed-template controls: how much writing room this part gets
                             on the QR template, and whether it is a sketch. Both only affect
                             the printed sheet and the layout map. */}
                         <span className="text-xs text-academic-300 mx-1">|</span>
                         <div className="flex items-center gap-1.5">
                           <span className="text-xs text-academic-500 font-medium uppercase tracking-wide">Answer lines:</span>
                           <input
                             type="number"
                             min={1}
                             value={answerLinesFor(sub)}
                             onChange={e => updateSubsection(pIndex, sIndex, {
                               answerLines: Math.max(1, parseInt(e.target.value, 10) || DEFAULT_ANSWER_LINES),
                             })}
                             title={`Writing lines reserved for this answer on the printed sheet, drawn at exactly this size. ${DEFAULT_ANSWER_LINES} if you never set it; a part that no longer fits its page simply starts a new one.`}
                             className="w-14 text-xs border border-academic-300 rounded px-2 py-1 focus:outline-none focus:border-academic-500"
                           />
                         </div>
                         <button
                           type="button"
                           onClick={() => updateSubsection(pIndex, sIndex, { isDrawing: !sub.isDrawing })}
                           className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                             sub.isDrawing
                               ? 'bg-academic-700 text-white border-academic-700'
                               : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                           }`}
                           title="Sketch part. The reserved space is drawn as a plain box with no rules, and flagged is_drawing in the layout map."
                         >
                           Sketch
                         </button>
                       </>
                     ) : sub.submissionType === SubmissionType.IMAGE ? (
                       /* Image branch */
                       <>
                         <div className="flex items-center gap-1.5">
                           <span className="text-xs text-academic-500">pages:</span>
                           <input
                             type="number"
                             min={1}
                             value={sub.maxImages || 1}
                             onChange={e => updateSubsection(pIndex, sIndex, { maxImages: parseInt(e.target.value) || 1 })}
                             className="w-14 text-xs border border-academic-300 rounded px-2 py-1 focus:outline-none focus:border-academic-500"
                             title="Number of image pages allowed"
                           />
                         </div>
                         {([
                           { label: 'Human Inspection', mode: 'human' as const },
                           { label: 'AI Inspection',    mode: 'auto'  as const },
                         ]).map(({ label, mode }) => (
                           <button
                             key={mode}
                             type="button"
                             onClick={() => updateSubsection(pIndex, sIndex, { imageGradingMode: mode })}
                             className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                               (sub.imageGradingMode ?? 'human') === mode
                                 ? 'bg-academic-700 text-white border-academic-700'
                                 : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                             }`}
                           >
                             {label}
                           </button>
                         ))}
                       </>
                     ) : sub.submissionType === SubmissionType.TEXT_AND_IMAGE ? (
                       /* Text + Image branch — human grading only */
                       <>
                         <div className="flex items-center gap-1.5">
                           <span className="text-xs text-academic-500">image pages:</span>
                           <input
                             type="number"
                             min={1}
                             value={sub.maxImages || 1}
                             onChange={e => updateSubsection(pIndex, sIndex, { maxImages: parseInt(e.target.value) || 1 })}
                             className="w-14 text-xs border border-academic-300 rounded px-2 py-1 focus:outline-none focus:border-academic-500"
                             title="Number of image pages allowed"
                           />
                         </div>
                         <span className="text-xs px-3 py-1 rounded-full border font-medium bg-academic-700 text-white border-academic-700">
                           Human
                         </span>
                       </>
                     ) : (
                       /* Text branch */
                       <>
                         <button
                           type="button"
                           onClick={() => updateSubsection(pIndex, sIndex, { submissionType: SubmissionType.TEXT })}
                           className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                             sub.submissionType === SubmissionType.TEXT
                               ? 'bg-academic-700 text-white border-academic-700'
                               : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                           }`}
                         >
                           Human
                         </button>
                         <span className="text-xs text-academic-300">|</span>
                         <span className="text-xs text-purple-500 font-medium uppercase tracking-wide">AI:</span>
                         {([
                           { label: 'Binary',    type: SubmissionType.AI_GRADED_BINARY, defaultPts: 3  },
                           { label: 'Short',     type: SubmissionType.AI_GRADED_SHORT,  defaultPts: 8  },
                           { label: 'Medium',    type: SubmissionType.AI_GRADED_MEDIUM, defaultPts: 15 },
                           { label: 'Long',      type: SubmissionType.AI_GRADED_LONG,   defaultPts: 25 },
                         ] as { label: string; type: SubmissionType; defaultPts: number }[]).map(({ label, type, defaultPts }) => (
                           <button
                             key={type}
                             type="button"
                             onClick={() => updateSubsection(pIndex, sIndex, {
                               submissionType: type,
                               points: sub.points > 0 ? sub.points : defaultPts,
                               minWords: AI_WORD_RANGES[type]?.min,
                             })}
                             className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                               sub.submissionType === type
                                 ? 'bg-purple-700 text-white border-purple-700'
                                 : 'bg-white text-purple-600 border-purple-300 hover:border-purple-500 hover:text-purple-800'
                             }`}
                           >
                             {label}
                           </button>
                         ))}
                       </>
                     )}
                   </div>
                   {(AI_GRADED_TYPES.has(sub.submissionType) || isAiHandwritten(sub)) && (
                     <div className="ml-8 mt-1 px-3 space-y-3">
                       {isAiHandwritten(sub) && (
                         <div className="text-xs text-purple-600 font-medium">
                           The student's marked region is cropped and transcribed, then graded against this rubric.
                         </div>
                       )}
                       {AI_WORD_RANGES[sub.submissionType] && (
                         <div className="text-xs text-purple-600 font-medium">
                           Suggested length: {AI_WORD_RANGES[sub.submissionType]?.range} · suggested minimum: {AI_WORD_RANGES[sub.submissionType]?.min} words (guidance only — not enforced)
                         </div>
                       )}
                       <TextArea
                         label="AI Grading Rubric (private — not shown to students)"
                         rows={4}
                         placeholder={
                           isAiHandwritten(sub)
                             ? 'Required elements: (1) ...; (2) ... Award full marks for ... Award partial credit for ... Award no credit for ... State the expected working and result — the grader sees only the transcription.'
                             : 'Describe how to grade this question. Use the correct number of bands for the category (Binary: 2, Short: 3, Medium: 4, Long: 5).'
                         }
                         value={sub.aiGradingPrompt || ''}
                         onChange={e => updateSubsection(pIndex, sIndex, { aiGradingPrompt: e.target.value })}
                         className="text-sm"
                       />
                     </div>
                   )}
                   {/* Grader note — shown for all subsection types */}
                   <div className="ml-8 mt-1 mb-2 px-3">
                     <div className="rounded border border-amber-200 bg-amber-50 p-3 space-y-1.5">
                       <div className="flex items-center gap-1.5">
                         <Lock className="w-3 h-3 text-amber-600 shrink-0" />
                         <span className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                           {sub.submissionType === SubmissionType.IMAGE
                             ? 'Grader note — what to look for in the submission'
                             : sub.submissionType === SubmissionType.TEXT_AND_IMAGE
                             ? 'Grader note — expected text answer + what to look for in the image'
                             : (AI_GRADED_TYPES.has(sub.submissionType) || isAiHandwritten(sub))
                             ? 'Supplementary TA note (optional — AI rubric above is primary)'
                             : sub.submissionType === SubmissionType.HANDWRITTEN
                             ? 'Grader note — expected answer / worked solution (TA grades the marked region)'
                             : 'Grader note — expected answer / worked solution'}
                         </span>
                         <span className="text-xs text-amber-500 ml-1">· not shown to students</span>
                       </div>
                       <TextArea
                         rows={3}
                         placeholder={
                           sub.submissionType === SubmissionType.IMAGE
                             ? 'List what the grader should verify: topology, labels, settings visible, etc. State full / partial / no credit thresholds.'
                             : (AI_GRADED_TYPES.has(sub.submissionType) || isAiHandwritten(sub))
                             ? 'Optional: add model answer or edge-case guidance for TAs reviewing AI-flagged submissions.'
                             : 'State the expected answer with key formula and numerical result. State what earns full / partial / no credit.'
                         }
                         value={sub.graderNote || ''}
                         onChange={e => updateSubsection(pIndex, sIndex, { graderNote: e.target.value })}
                         className="text-sm bg-white border-amber-200 focus:border-amber-400"
                       />
                     </div>
                   </div>
                   </React.Fragment>
                ))}
                <div className="ml-8">
                   <Button variant="ghost" onClick={() => addSubsection(pIndex)} className="text-xs">
                      <Plus className="w-3 h-3 mr-1" /> Add Subsection
                   </Button>
                </div>
              </div>
            </div>
          ))}

          <div className="flex justify-center pt-4">
            <Button onClick={addProblem} variant="secondary" className="w-full md:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Add New Problem
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Editor;
