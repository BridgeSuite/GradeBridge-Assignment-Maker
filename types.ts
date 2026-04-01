
export enum SubmissionType {
  TEXT = 'Text',
  IMAGE = 'Image',
  AI_GRADED_BINARY = 'AI Graded: Binary',
  AI_GRADED_SHORT = 'AI Graded: Short',
  AI_GRADED_MEDIUM = 'AI Graded: Medium',
  AI_GRADED_LONG = 'AI Graded: Long',
  MATLAB_GRADER = 'MatlabGrader',
  CODE = 'Code',
  FILE_UPLOAD = 'File Upload'
}

export interface AiGradingConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface Subsection {
  id: string;
  name: string;
  description: string;
  points: number;
  submissionType: SubmissionType;
  maxImages?: number; // Specific for Image submission types
  config?: string; // For extra data like prompts or IDs
  aiGradingPrompt?: string;
  minWords?: number; // Minimum word count — derived from ai-graded category on import
}

export interface Problem {
  id: string;
  name: string;
  description: string;
  subsections: Subsection[];
}

export interface Assignment {
  id: string;
  courseCode: string;
  title: string;
  dueDate?: string; // ISO Date string — optional, managed in Canvas
  dueTime?: string; // HH:MM — optional, managed in Canvas
  preamble: string;
  problems: Problem[];
  aiGradingConfig: AiGradingConfig;
  createdAt: number;
  updatedAt: number;
}

export type AssignmentDraft = Omit<Assignment, 'id' | 'createdAt' | 'updatedAt'>;
