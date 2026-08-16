
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Assignment, InputMode, Problem, Subsection, SubmissionType, AiGradingConfig } from '../types';
import { storageService } from '../services/storageService';
import { exportService } from '../services/exportService';
import {
  validateCoursePublicKey,
  normalizeCoursePublicKey,
  CoursePublicKeyValidation
} from '../services/cryptoService';
import {
  MODE_LABEL,
  convertSubsectionToMode,
  defaultTypeForMode,
  isAiHandwritten,
  strandedSubsectionLabels,
  typeAllowedInMode
} from '../services/inputModeService';
import { answerSpaceFor } from '../services/templateLayout';
import { derivePageFormatId } from '../services/qrPayload';
import { Layout, Card, Button, Input, TextArea, TextAreaWithPreview, InputWithPreview } from '../components/Common';
import { Trash2, Plus, Save, ChevronDown, ChevronUp, GripVertical, Upload, FileDown, Lock, ShieldCheck, CheckCircle2, AlertTriangle, XCircle, PenLine, Keyboard, QrCode } from 'lucide-react';

const DEFAULT_AI_GRADING_CONFIG: AiGradingConfig = { model: 'claude-haiku-4-5-20251001', temperature: 0.1, maxTokens: 512 };

const AI_GRADED_TYPES = new Set([
  SubmissionType.AI_GRADED_BINARY,
  SubmissionType.AI_GRADED_SHORT,
  SubmissionType.AI_GRADED_MEDIUM,
  SubmissionType.AI_GRADED_LONG,
  SubmissionType.AI_FORMATIVE,
]);

const AI_WORD_RANGES: Partial<Record<SubmissionType, { range: string; min: number }>> = {
  [SubmissionType.AI_GRADED_BINARY]: { range: '20–40 words',   min: 20  },
  [SubmissionType.AI_GRADED_SHORT]:  { range: '50–100 words',  min: 50  },
  [SubmissionType.AI_GRADED_MEDIUM]: { range: '100–150 words', min: 100 },
  [SubmissionType.AI_GRADED_LONG]:   { range: '150–250 words', min: 150 },
};

const normalizePoints = (assignment: Assignment): Assignment => {
  const target = assignment.targetPoints || 100;
  const allSubs = assignment.problems.flatMap(p => p.subsections);
  const total = allSubs.reduce((sum, s) => sum + s.points, 0);
  if (total === 0 || total === target) return assignment;
  const scaled = allSubs.map(s => Math.round(s.points * target / total));
  const diff = target - scaled.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    const maxIdx = scaled.reduce((maxI, v, i, arr) => v > arr[maxI] ? i : maxI, 0);
    scaled[maxIdx] += diff;
  }
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
    preamble: '',
    problems: [emptyProblem()],
    aiGradingConfig: DEFAULT_AI_GRADING_CONFIG,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  // Assignments saved before handwritten support have no inputMode — they are electronic.
  const inputMode: InputMode = assignment.inputMode ?? 'electronic';

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

  // Course public key is edited as raw text and only committed to the assignment once it validates.
  const [keyInput, setKeyInput] = useState('');
  const [keyStatus, setKeyStatus] = useState<CoursePublicKeyValidation | null>(null);
  const keyCheckSeq = useRef(0);

  useEffect(() => {
    if (id) {
      const loaded = storageService.get(id);
      if (loaded) {
        // Ensure new fields exist on loaded data; strip deprecated fields
        const { dueDate: _d, dueTime: _t, ...loadedWithoutDate } = loaded as any;
        const sanitized = {
          ...loadedWithoutDate,
          inputMode: loaded.inputMode || 'electronic',
          aiGradingConfig: loaded.aiGradingConfig || DEFAULT_AI_GRADING_CONFIG,
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
        setKeyInput(loaded.coursePublicKey || '');
        if (loaded.coursePublicKey) checkCourseKey(loaded.coursePublicKey);
      } else {
        navigate('/');
      }
    }
  }, [id, navigate]);

  // Write the key onto the assignment, or drop the field entirely when there is no key.
  const setCourseKeyOnAssignment = (pem: string | null) => {
    setAssignment(prev => {
      if (pem === null) {
        if (prev.coursePublicKey === undefined) return prev;
        const { coursePublicKey: _dropped, ...rest } = prev;
        return rest as Assignment;
      }
      return { ...prev, coursePublicKey: pem };
    });
  };

  // Validate the pasted key and keep the assignment in sync. Only a valid key is ever stored.
  const checkCourseKey = async (value: string) => {
    const seq = ++keyCheckSeq.current;
    const pem = normalizeCoursePublicKey(value);

    if (!pem) {
      setKeyStatus(null);
      setCourseKeyOnAssignment(null);
      return;
    }

    const result = await validateCoursePublicKey(pem);
    if (seq !== keyCheckSeq.current) return; // a newer paste superseded this check

    setKeyStatus(result);
    setCourseKeyOnAssignment(result.ok ? pem : null);
  };

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
      console.error(err);
      alert(err instanceof Error ? err.message : 'Failed to build the QR template.');
    }
  };

  const handleSave = async () => {
    if (!assignment.courseCode || !assignment.title) {
      alert("Please fill in Course Code and Title.");
      return;
    }

    // Re-validate on save so an unblurred paste can never slip through.
    const pem = normalizeCoursePublicKey(keyInput);
    let toSave = assignment;

    if (pem) {
      const result = await validateCoursePublicKey(pem);
      keyCheckSeq.current++;
      setKeyStatus(result);
      if (!result.ok) {
        setCourseKeyOnAssignment(null);
        alert(`The course public key is not valid, so the assignment was not saved.\n\n${result.error}\n\nClear the field to keep the standard (gb1) encoding.`);
        return;
      }
      toSave = { ...assignment, coursePublicKey: pem };
    } else {
      const { coursePublicKey: _dropped, ...rest } = assignment;
      toSave = rest as Assignment;
    }

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
        const loadedAssignment = JSON.parse(json) as Assignment;

        // Basic validation
        if (!loadedAssignment.title || !Array.isArray(loadedAssignment.problems)) {
          throw new Error("Invalid assignment format.");
        }

        // Generate new IDs for everything
        const newAssignment = {
          ...loadedAssignment,
          id: uuidv4(),
          title: loadedAssignment.title + ' (Template)',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          aiGradingConfig: loadedAssignment.aiGradingConfig || DEFAULT_AI_GRADING_CONFIG,
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

        setAssignment(newAssignment);
        setKeyInput(newAssignment.coursePublicKey || '');
        checkCourseKey(newAssignment.coursePublicKey || '');
        alert("Template loaded! You can now edit and save it as a new assignment.");
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
          <Button variant="secondary" onClick={() => exportService.downloadMd(assignment)}>
            <FileDown className="w-4 h-4 mr-2" />
            Export .md
          </Button>
          <Button variant="secondary" onClick={() => {
            exportService.downloadGraderDoc(assignment).catch(err => {
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
                  </div>
                )}
              </div>
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

            {/* Course public key — optional; enables gb2 hardened submissions */}
            <div className="md:col-span-2">
              <div className="rounded border border-academic-200 bg-academic-50/60 p-4 space-y-2">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-academic-600 shrink-0" />
                  <span className="text-sm font-medium text-academic-800">
                    Course public key (enables hardened gb2 submissions)
                  </span>
                  <span className="text-xs text-academic-500">· optional</span>
                </div>
                <p className="text-xs text-academic-500 leading-relaxed">
                  Paste the <strong>public</strong> key issued for this course — SPKI PEM, starting with
                  {' '}<code className="font-mono">-----BEGIN PUBLIC KEY-----</code>. It ships inside the assignment and is
                  safe to distribute: with it, students' submissions can only be opened by the autograder's private key.
                  Leave this empty to keep the current encoding. Your institution generates and holds the keypair —
                  <strong> never paste a private key</strong>.
                </p>
                <textarea
                  rows={5}
                  spellCheck={false}
                  value={keyInput}
                  onChange={e => setKeyInput(e.target.value)}
                  onBlur={e => checkCourseKey(e.target.value)}
                  placeholder={'-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkq...\n-----END PUBLIC KEY-----'}
                  className="w-full font-mono text-xs bg-white text-academic-900 rounded-md border border-academic-300 shadow-sm py-2 px-3 resize-y focus:outline-none focus:border-academic-500 focus:ring-1 focus:ring-academic-500"
                />
                {!keyInput.trim() ? (
                  <div className="flex items-start gap-1.5 text-xs text-academic-500">
                    <span>No key set — submissions use the standard (gb1) encoding.</span>
                  </div>
                ) : keyStatus?.ok && keyStatus.warning ? (
                  <div className="flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
                    <span>Valid RSA public key ({keyStatus.bits}-bit). {keyStatus.warning}</span>
                  </div>
                ) : keyStatus?.ok ? (
                  <div className="flex items-start gap-1.5 text-xs text-green-700">
                    <CheckCircle2 className="w-3.5 h-3.5 mt-px shrink-0" />
                    <span>Valid RSA public key ({keyStatus.bits}-bit) — exported specs will carry it.</span>
                  </div>
                ) : keyStatus ? (
                  <div className="flex items-start gap-1.5 text-xs text-red-600">
                    <XCircle className="w-3.5 h-3.5 mt-px shrink-0" />
                    <span>{keyStatus.error}</span>
                  </div>
                ) : (
                  <div className="text-xs text-academic-500">Click outside the box to check the key.</div>
                )}
              </div>
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

                         {/* Printed-template controls: how much room this part gets on the
                             QR template, and whether it is a sketch. Both only affect the
                             printed sheet and the layout map. */}
                         <span className="text-xs text-academic-300 mx-1">|</span>
                         <span className="text-xs text-academic-500 font-medium uppercase tracking-wide">Template page:</span>
                         {([
                           { label: 'Half page', value: 'half' as const,
                             title: 'Shares a page with one other part. Two parts per page is the cap.' },
                           { label: 'Full page', value: 'full' as const,
                             title: 'This part gets a page to itself.' },
                         ]).map(({ label, value, title }) => (
                           <button
                             key={value}
                             type="button"
                             disabled={!!sub.isDrawing}
                             onClick={() => updateSubsection(pIndex, sIndex, { answerSpace: value })}
                             title={sub.isDrawing ? 'Sketches always take a full page' : title}
                             className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                               answerSpaceFor(sub) === value
                                 ? 'bg-academic-700 text-white border-academic-700'
                                 : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                             } ${sub.isDrawing ? 'opacity-60 cursor-not-allowed' : ''}`}
                           >
                             {label}
                           </button>
                         ))}
                         <button
                           type="button"
                           onClick={() => updateSubsection(pIndex, sIndex, { isDrawing: !sub.isDrawing })}
                           className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                             sub.isDrawing
                               ? 'bg-academic-700 text-white border-academic-700'
                               : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                           }`}
                           title="Sketch part. Takes a full page and is flagged is_drawing in the layout map."
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
                           { label: 'Formative', type: SubmissionType.AI_FORMATIVE,     defaultPts: 25 },
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
                       {sub.submissionType === SubmissionType.AI_FORMATIVE && (
                         <div className="text-xs text-purple-600 font-medium">
                           Formative feedback (advisory) — student sees per-element status (Addressed / Partial / Missing) plus a section summary; no numeric score is surfaced.
                         </div>
                       )}
                       <TextArea
                         label="AI Grading Rubric (private — not shown to students)"
                         rows={4}
                         placeholder={
                           sub.submissionType === SubmissionType.AI_FORMATIVE
                             ? 'Formative grading prompt: required elements, status thresholds (Addressed/Partial/Missing), Human Review flags, and section summary instructions.'
                             : isAiHandwritten(sub)
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
