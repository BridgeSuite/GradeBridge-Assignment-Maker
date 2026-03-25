
export enum SubmissionType {
  TEXT = 'Text',
  IMAGE = 'Image',
  AI_REFLECTIVE = 'AI Reflective',
  TRUE_FALSE = 'True/False',
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
  minWords?: number; // Minimum word count for AI Reflective subsections (default 250)
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
