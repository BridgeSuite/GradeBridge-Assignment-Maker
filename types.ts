
export enum SubmissionType {
  TEXT = 'Text',
  IMAGE = 'Image',
  TEXT_AND_IMAGE = 'Text and Image',
  AI_GRADED_BINARY = 'AI Graded: Binary',
  AI_GRADED_SHORT = 'AI Graded: Short',
  AI_GRADED_MEDIUM = 'AI Graded: Medium',
  AI_GRADED_LONG = 'AI Graded: Long',
  AI_FORMATIVE = 'AI Formative',
  HANDWRITTEN = 'Handwritten',
  MATLAB_GRADER = 'MatlabGrader',
  CODE = 'Code',
  FILE_UPLOAD = 'File Upload'
}

export interface AiGradingConfig {
  model: string;
  temperature: number;
  maxTokens: number;
}

/** How much writing room a handwritten part gets on the printed template. */
export type AnswerSpace = 'short' | 'medium' | 'tall' | 'xtall';

export interface Subsection {
  id: string;
  name: string;
  description: string;
  points: number;
  submissionType: SubmissionType;
  answerSpace?: AnswerSpace; // Handwritten only: template writing-area height. Unset = derived from points.
  isDrawing?: boolean;       // Handwritten only: sketch part. Sets is_drawing in the layout map.
  maxImages?: number; // Specific for Image submission types
  imageGradingMode?: 'human' | 'auto'; // Image only: 'human' = TA reviews; 'auto' = autograder checks images_submitted > 0
  handwrittenGradingMode?: 'ai' | 'human'; // Handwritten only: 'ai' = OCR+grade; 'human' = TA grades from crops
  config?: string; // For extra data like prompts or IDs
  aiGradingPrompt?: string;
  graderNote?: string; // Human grader reference: expected answer or what to look for (not shown to students)
  minWords?: number; // Minimum word count — derived from ai-graded category on import
}

export interface Problem {
  id: string;
  name: string;
  description: string;
  subsections: Subsection[];
}

export type InputMode = 'electronic' | 'handwritten';

export interface Assignment {
  id: string;
  courseCode: string;
  title: string;
  inputMode?: InputMode; // How students answer. Absent (older assignments) means 'electronic'.
  pageFormatId?: string; // QR field 2, [A-Z0-9]{1,12}. Unset = derived from courseCode + title.
  dueDate?: string; // ISO Date string — optional, managed in Canvas
  dueTime?: string; // HH:MM — optional, managed in Canvas
  preamble: string;
  problems: Problem[];
  aiGradingConfig: AiGradingConfig;
  targetPoints?: number; // Target total for point scaling (default 100)
  coursePublicKey?: string; // SPKI PEM (public only). Present → students produce hardened gb2 submissions; absent → gb1.
  createdAt: number;
  updatedAt: number;
}

export type AssignmentDraft = Omit<Assignment, 'id' | 'createdAt' | 'updatedAt'>;
