
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Assignment, Problem, Subsection, SubmissionType, AiGradingConfig } from '../types';
import { storageService } from '../services/storageService';
import { exportService } from '../services/exportService';
import { Layout, Card, Button, Input, TextArea, TextAreaWithPreview, InputWithPreview } from '../components/Common';
import { Trash2, Plus, Save, ChevronDown, ChevronUp, GripVertical, Upload, FileDown, Lock } from 'lucide-react';

const DEFAULT_AI_GRADING_CONFIG: AiGradingConfig = { model: 'claude-haiku-4-5-20251001', temperature: 0.1, maxTokens: 512 };

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

const emptySubsection = (): Subsection => ({
  id: uuidv4(),
  name: '',
  description: '',
  points: 0,
  submissionType: SubmissionType.TEXT,
  maxImages: 1,
  aiGradingPrompt: ''
});

const emptyProblem = (): Problem => ({
  id: uuidv4(),
  name: '',
  description: '',
  subsections: [emptySubsection()]
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
    preamble: '',
    problems: [emptyProblem()],
    aiGradingConfig: DEFAULT_AI_GRADING_CONFIG,
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  useEffect(() => {
    if (id) {
      const loaded = storageService.get(id);
      if (loaded) {
        // Ensure new fields exist on loaded data; strip deprecated fields
        const { dueDate: _d, dueTime: _t, ...loadedWithoutDate } = loaded as any;
        const sanitized = {
          ...loadedWithoutDate,
          aiGradingConfig: loaded.aiGradingConfig || DEFAULT_AI_GRADING_CONFIG,
          problems: loaded.problems.map(p => ({
            ...p,
            subsections: p.subsections.map(s => ({
              ...s,
              maxImages: s.maxImages || 1,
              aiGradingPrompt: s.aiGradingPrompt || '',
              graderNote: s.graderNote || ''
            }))
          }))
        };
        setAssignment(sanitized);
      } else {
        navigate('/');
      }
    }
  }, [id, navigate]);

  const handleSave = () => {
    if (!assignment.courseCode || !assignment.title) {
      alert("Please fill in Course Code and Title.");
      return;
    }
    storageService.save(assignment);
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
    setAssignment({ ...assignment, problems: [...assignment.problems, emptyProblem()] });
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
    newProblems[pIndex].subsections.push(emptySubsection());
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
          <Button variant="secondary" onClick={() => exportService.downloadGraderDoc(assignment)}>
            <Lock className="w-4 h-4 mr-2" />
            Grader Doc
          </Button>
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
                     {/* Medium: Text or Image */}
                     <span className="text-xs text-academic-500 font-medium uppercase tracking-wide">Type:</span>
                     {([
                       { label: 'Text',  type: SubmissionType.TEXT  },
                       { label: 'Image', type: SubmissionType.IMAGE },
                     ] as { label: string; type: SubmissionType }[]).map(({ label, type }) => (
                       <button
                         key={type}
                         type="button"
                         onClick={() => updateSubsection(pIndex, sIndex, { submissionType: type })}
                         className={`text-xs px-3 py-1 rounded-full border font-medium transition-colors ${
                           (type === SubmissionType.IMAGE
                             ? sub.submissionType === SubmissionType.IMAGE
                             : sub.submissionType !== SubmissionType.IMAGE)
                             ? 'bg-academic-700 text-white border-academic-700'
                             : 'bg-white text-academic-600 border-academic-300 hover:border-academic-500 hover:text-academic-800'
                         }`}
                       >
                         {label}
                       </button>
                     ))}

                     <span className="text-xs text-academic-300 mx-1">|</span>
                     <span className="text-xs text-academic-500 font-medium uppercase tracking-wide">Grading:</span>

                     {sub.submissionType === SubmissionType.IMAGE ? (
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
                           { label: 'Binary', type: SubmissionType.AI_GRADED_BINARY, defaultPts: 3  },
                           { label: 'Short',  type: SubmissionType.AI_GRADED_SHORT,  defaultPts: 8  },
                           { label: 'Medium', type: SubmissionType.AI_GRADED_MEDIUM, defaultPts: 15 },
                           { label: 'Long',   type: SubmissionType.AI_GRADED_LONG,   defaultPts: 25 },
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
                   {AI_GRADED_TYPES.has(sub.submissionType) && (
                     <div className="ml-8 mt-1 px-3 space-y-3">
                       <div className="text-xs text-purple-600 font-medium">
                         Suggested length: {AI_WORD_RANGES[sub.submissionType]?.range} · suggested minimum: {AI_WORD_RANGES[sub.submissionType]?.min} words (guidance only — not enforced)
                       </div>
                       <TextArea
                         label="AI Grading Rubric (private — not shown to students)"
                         rows={4}
                         placeholder="Describe how to grade this question. Use the correct number of bands for the category (Binary: 2, Short: 3, Medium: 4, Long: 5)."
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
                             : AI_GRADED_TYPES.has(sub.submissionType)
                             ? 'Supplementary TA note (optional — AI rubric above is primary)'
                             : 'Grader note — expected answer / worked solution'}
                         </span>
                         <span className="text-xs text-amber-500 ml-1">· not shown to students</span>
                       </div>
                       <TextArea
                         rows={3}
                         placeholder={
                           sub.submissionType === SubmissionType.IMAGE
                             ? 'List what the grader should verify: topology, labels, settings visible, etc. State full / partial / no credit thresholds.'
                             : AI_GRADED_TYPES.has(sub.submissionType)
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
