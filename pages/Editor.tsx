
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Assignment, Problem, Subsection, SubmissionType } from '../types';
import { storageService } from '../services/storageService';
import { Layout, Card, Button, Input, TextArea, TextAreaWithPreview, InputWithPreview, Select } from '../components/Common';
import { Trash2, Plus, Save, ChevronDown, ChevronUp, GripVertical, Upload } from 'lucide-react';

const emptySubsection = (): Subsection => ({
  id: uuidv4(),
  name: '',
  description: '',
  points: 0,
  submissionType: SubmissionType.TEXT,
  maxImages: 1
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
    dueDate: '',
    dueTime: '23:59',
    preamble: '',
    problems: [emptyProblem()],
    createdAt: Date.now(),
    updatedAt: Date.now()
  });

  useEffect(() => {
    if (id) {
      const loaded = storageService.get(id);
      if (loaded) {
        // Ensure new fields exist on loaded data
        const sanitized = {
          ...loaded,
          problems: loaded.problems.map(p => ({
            ...p,
            subsections: p.subsections.map(s => ({
              ...s,
              maxImages: s.maxImages || 1
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
    if (!assignment.courseCode || !assignment.title || !assignment.dueDate) {
      alert("Please fill in Course Code, Title, and Due Date.");
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
          problems: loadedAssignment.problems.map(p => ({
            ...p,
            id: uuidv4(),
            subsections: p.subsections.map(s => ({
              ...s,
              id: uuidv4()
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

  // Move Problem logic
  const moveProblem = (index: number, direction: 'up' | 'down') => {
      if ((direction === 'up' && index === 0) || (direction === 'down' && index === assignment.problems.length - 1)) return;
      const newProblems = [...assignment.problems];
      const swapIndex = direction === 'up' ? index - 1 : index + 1;
      [newProblems[index], newProblems[swapIndex]] = [newProblems[swapIndex], newProblems[index]];
      setAssignment({ ...assignment, problems: newProblems });
  };

  return (
    <Layout
      title={isEdit ? "Edit Assignment" : "Create Assignment"}
      action={
        <div className="flex gap-2">
          <input
            type="file"
            accept=".json"
            ref={fileInputRef}
            className="hidden"
            onChange={handleFileUpload}
          />
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
            <Input 
              label="Due Date" 
              type="date" 
              value={assignment.dueDate} 
              onChange={e => setAssignment({...assignment, dueDate: e.target.value})} 
            />
            <Input 
              label="Due Time" 
              type="time" 
              value={assignment.dueTime} 
              onChange={e => setAssignment({...assignment, dueTime: e.target.value})} 
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
                       <InputWithPreview
                          placeholder="Problem Description (Optional, LaTeX supported)"
                          value={problem.description}
                          onChange={e => updateProblem(pIndex, { description: e.target.value })}
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
                   <div key={sub.id} className="flex flex-col md:flex-row gap-4 items-start md:items-center bg-academic-50/50 p-3 rounded border border-dashed border-academic-200 ml-8 relative">
                      <div className="absolute -left-8 top-3 font-mono font-bold text-academic-500">{String.fromCharCode(97 + sIndex)}.</div>
                      
                      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 w-full">
                         <div className="md:col-span-3">
                           <InputWithPreview
                              placeholder="Subsection Name"
                              value={sub.name}
                              onChange={e => updateSubsection(pIndex, sIndex, { name: e.target.value })}
                              className="text-sm"
                           />
                         </div>
                         <div className="md:col-span-4">
                           <InputWithPreview
                              placeholder="Description (LaTeX supported)"
                              value={sub.description}
                              onChange={e => updateSubsection(pIndex, sIndex, { description: e.target.value })}
                              className="text-sm"
                           />
                         </div>
                         <div className="md:col-span-1">
                           <Input 
                              type="number"
                              placeholder="Pts"
                              value={sub.points}
                              onChange={e => updateSubsection(pIndex, sIndex, { points: parseInt(e.target.value) || 0 })}
                              className="text-sm"
                              title="Points"
                           />
                         </div>
                         <div className={`${sub.submissionType === SubmissionType.IMAGE ? 'md:col-span-2' : 'md:col-span-4'}`}>
                            <Select
                              value={sub.submissionType}
                              onChange={e => updateSubsection(pIndex, sIndex, { submissionType: e.target.value as SubmissionType })}
                              className="text-sm"
                            >
                               {Object.values(SubmissionType).map(type => (
                                 <option key={type} value={type}>{type}</option>
                               ))}
                            </Select>
                         </div>
                         {sub.submissionType === SubmissionType.IMAGE && (
                             <div className="md:col-span-2">
                                <Input
                                  type="number"
                                  min={1}
                                  value={sub.maxImages || 1}
                                  onChange={e => updateSubsection(pIndex, sIndex, { maxImages: parseInt(e.target.value) || 1 })}
                                  className="text-sm"
                                  placeholder="Pages"
                                  title="Number of image pages allowed (creates separate pages in PDF)"
                                  label="Max Pages"
                                />
                             </div>
                         )}
                      </div>

                      <button 
                        onClick={() => removeSubsection(pIndex, sIndex)}
                        className="text-academic-400 hover:text-red-500 transition-colors p-1"
                      >
                         <Trash2 className="w-4 h-4" />
                      </button>
                   </div>
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
