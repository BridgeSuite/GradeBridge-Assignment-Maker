
import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { Assignment } from '../types';
import { storageService } from '../services/storageService';
import { exportService } from '../services/exportService';
import { Layout, Card, Button } from '../components/Common';
import { Plus, FileText, Download, Trash2, Edit2, Eye, Upload, Copy, Sparkles } from 'lucide-react';
import { createExampleAssignment, EXAMPLE_LOADED_MESSAGE } from '../exampleAssignment';

const Dashboard: React.FC = () => {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [statusMessage, setStatusMessage] = useState('');
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleExport = (assignment: Assignment) => {
    exportService.downloadZIP(assignment);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const importedAssignment = JSON.parse(json) as Assignment;

        // Basic validation
        if (!importedAssignment.id || !importedAssignment.title || !Array.isArray(importedAssignment.problems)) {
          throw new Error("Invalid assignment format. Missing required fields.");
        }

        // Ensure ID is string and trimmed
        importedAssignment.id = String(importedAssignment.id).trim();

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
        alert("Assignment imported successfully!");
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
          <Button variant="secondary" onClick={handleLoadExample}>
            <Sparkles className="w-4 h-4 mr-2" />
            Load Example
          </Button>
          <Button variant="secondary" onClick={handleImportClick}>
            <Upload className="w-4 h-4 mr-2" />
            Import JSON
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
                  <span>Due: {new Date(assignment.dueDate).toLocaleDateString()} at {assignment.dueTime}</span>
                  <span>•</span>
                  <span>{assignment.problems.length} Problems</span>
                  <span>•</span>
                  <span>Total Points: {assignment.problems.reduce((acc, p) => acc + p.subsections.reduce((sAcc, s) => sAcc + s.points, 0), 0)}</span>
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
                <Button variant="secondary" onClick={() => handleExport(assignment)} title="Export ZIP">
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
    </Layout>
  );
};

export default Dashboard;
