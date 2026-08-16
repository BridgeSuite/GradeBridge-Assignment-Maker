/**
 * mdParserService.ts
 * Browser-side port of converter/convert.py (same repo — keep the two in lockstep)
 * Parses a GradeBridge assignment .md file into an Assignment object.
 */

import { v4 as uuidv4 } from 'uuid';
import { AnswerSpace, Assignment, InputMode, Problem, Subsection, SubmissionType, AiGradingConfig } from '../types';

const DEFAULT_AI_CONFIG: AiGradingConfig = {
  model: 'claude-haiku-4-5-20251001',
  temperature: 0.1,
  maxTokens: 512,
};

const TYPE_MAP: Record<string, SubmissionType> = {
  'text':                 SubmissionType.TEXT,
  'image':                SubmissionType.IMAGE,
  'text+image':           SubmissionType.TEXT_AND_IMAGE,
  'ai-graded:binary':     SubmissionType.AI_GRADED_BINARY,
  'ai-graded:short':      SubmissionType.AI_GRADED_SHORT,
  'ai-graded:medium':     SubmissionType.AI_GRADED_MEDIUM,
  'ai-graded:long':       SubmissionType.AI_GRADED_LONG,
  'ai-graded:formative':  SubmissionType.AI_FORMATIVE,
  'handwritten':          SubmissionType.HANDWRITTEN,
};

const MIN_WORDS_MAP: Partial<Record<SubmissionType, number>> = {
  [SubmissionType.AI_GRADED_BINARY]: 20,
  [SubmissionType.AI_GRADED_SHORT]:  50,
  [SubmissionType.AI_GRADED_MEDIUM]: 100,
  [SubmissionType.AI_GRADED_LONG]:   150,
};

interface SubsectionMeta {
  name: string;
  points: number;
  submissionType: SubmissionType;
  maxImages: number;
  handwrittenGradingMode?: 'ai' | 'human';
  rawType: string;
}

interface ProblemHeaderMeta {
  name: string;
  points?: number;
  submissionType?: SubmissionType;
  maxImages: number;
  handwrittenGradingMode?: 'ai' | 'human';
}

function parseTypeTag(typeTag: string): {
  submissionType: SubmissionType;
  maxImages: number;
  handwrittenGradingMode?: 'ai' | 'human';
} {
  let maxImages = 1;
  let handwrittenGradingMode: 'ai' | 'human' | undefined;
  let baseType = typeTag.trim().toLowerCase();
  if (baseType.startsWith('image:')) {
    maxImages = parseInt(baseType.split(':')[1]) || 1;
    baseType = 'image';
  } else if (baseType.startsWith('text+image:')) {
    maxImages = parseInt(baseType.split(':')[1]) || 1;
    baseType = 'text+image';
  } else if (baseType === 'handwritten:human') {
    handwrittenGradingMode = 'human';
    baseType = 'handwritten';
  }
  // Bare `handwritten` leaves the mode undefined — it is read as 'ai' downstream.
  return { submissionType: TYPE_MAP[baseType] ?? SubmissionType.TEXT, maxImages, handwrittenGradingMode };
}

function parseSubsectionHeader(line: string): SubsectionMeta | null {
  const m = line.trim().match(/^###\s+\([a-z]+\)\s+(.+?)\s+\[(\d+)\s+pts?\]\s+\[([^\]]+)\]\s*$/i);
  if (!m) return null;
  const { submissionType, maxImages, handwrittenGradingMode } = parseTypeTag(m[3]);
  return {
    name: m[1].trim(),
    points: parseInt(m[2]),
    submissionType,
    maxImages,
    handwrittenGradingMode,
    rawType: m[3].trim().toLowerCase(),
  };
}

function parseProblemHeader(line: string): ProblemHeaderMeta | null {
  // Flat format: ## Problem N: Title [N pts] [type]
  const flatM = line.trim().match(/^##\s+Problem\s+\d+:\s+(.+?)\s+\[(\d+)\s+pts?\]\s+\[([^\]]+)\]\s*$/i);
  if (flatM) {
    const { submissionType, maxImages, handwrittenGradingMode } = parseTypeTag(flatM[3]);
    return { name: flatM[1].trim(), points: parseInt(flatM[2]), submissionType, maxImages, handwrittenGradingMode };
  }
  // Standard format: ## Problem N: Title
  const m = line.trim().match(/^##\s+Problem\s+\d+:\s+(.+)$/i);
  return m ? { name: m[1].trim(), maxImages: 1 } : null;
}

function parseMetadata(lines: string[]): Pick<Assignment, 'courseCode' | 'title' | 'preamble' | 'inputMode'>
    & { pageFormatId?: string } {
  // **Input:** is optional — files without it are electronic, which keeps every
  // pre-handwritten .md byte-identical on round trip. **Template ID:** is the
  // same: absent means "derive it from the course code and title".
  const meta: Pick<Assignment, 'courseCode' | 'title' | 'preamble' | 'inputMode'> & { pageFormatId?: string } =
    { courseCode: '', title: '', preamble: '', inputMode: 'electronic' as InputMode };
  for (const line of lines) {
    const l = line.trim();
    let m = l.match(/^#\s+([^:]+):\s+(.+)$/);
    if (m) { meta.courseCode = m[1].trim(); meta.title = m[2].trim(); continue; }
    // **Due:** lines intentionally ignored — due dates are managed in Canvas
    m = l.match(/^\*\*Preamble:\*\*\s+(.+)$/);
    if (m) { meta.preamble = m[1].trim(); continue; }
    m = l.match(/^\*\*Input:\*\*\s+(.+)$/i);
    if (m) { meta.inputMode = m[1].trim().toLowerCase() === 'handwritten' ? 'handwritten' : 'electronic'; continue; }
    m = l.match(/^\*\*Template ID:\*\*\s+(.+)$/i);
    if (m) {
      const id = m[1].trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
      if (id) meta.pageFormatId = id;
      continue;
    }
  }
  return meta;
}

/**
 * `> template: space=full, sketch` — the printed-template settings for a
 * handwritten sub-part. Absent means the part shares a page with one other,
 * which is the default.
 */
function parseTemplateOptions(body: string[]): { answerSpace?: AnswerSpace; isDrawing?: boolean } {
  const raw = extractBlockquoteValue('template', body);
  if (!raw) return {};
  const out: { answerSpace?: AnswerSpace; isDrawing?: boolean } = {};
  for (const token of raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)) {
    const space = token.match(/^space\s*=\s*(half|full|short|medium|tall|xtall)$/);
    if (space) {
      // short/medium/tall/xtall were the pre-correction scale, from before
      // writing space became "at most two parts per page". Still read, so files
      // written against the old scale import without losing the author's intent
      // that one part wanted a lot of room.
      out.answerSpace = (space[1] === 'full' || space[1] === 'xtall') ? 'full' : 'half';
      continue;
    }
    if (token === 'sketch' || token === 'drawing') out.isDrawing = true;
  }
  return out;
}

function extractBlockquoteValue(key: string, lines: string[]): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startPattern = new RegExp(`^>\\s+${escapedKey}:\\s*(.*)$`, 'i');
  let collecting = false;
  const parts: string[] = [];

  for (const line of lines) {
    const stripped = line.trim();
    if (!collecting) {
      const m = stripped.match(startPattern);
      if (m) {
        collecting = true;
        if (m[1].trim()) parts.push(m[1].trim());
      }
    } else {
      if (stripped.startsWith('>')) {
        const cont = stripped.slice(1).trim();
        if (cont) parts.push(cont);
      } else {
        break;
      }
    }
  }
  return parts.join(' ');
}

export function parseMdToAssignment(content: string): Assignment {
  const lines = content.split('\n');
  const meta = parseMetadata(lines);

  // Split file into labelled sections
  type SecType = 'preamble' | 'problem' | 'subsection';
  const sections: Array<{ type: SecType; header: string; body: string[] }> = [];
  let curType: SecType = 'preamble';
  let curHeader = '';
  let curBody: string[] = [];

  for (const line of lines) {
    const s = line.trim();
    if (/^##\s+Problem\s+\d+:/i.test(s)) {
      sections.push({ type: curType, header: curHeader, body: curBody });
      curType = 'problem'; curHeader = s; curBody = [];
    } else if (/^###\s+\([a-z]+\)/i.test(s)) {
      sections.push({ type: curType, header: curHeader, body: curBody });
      curType = 'subsection'; curHeader = s; curBody = [];
    } else {
      curBody.push(line);
    }
  }
  sections.push({ type: curType, header: curHeader, body: curBody });

  const problems: Problem[] = [];
  let currentProblem: Problem | null = null;

  for (const { type, header, body } of sections) {
    if (type === 'problem') {
      if (currentProblem) problems.push(currentProblem);
      const prob = parseProblemHeader(header);
      if (prob) {
        const descLines = body.filter(l =>
          l.trim() && !l.trim().startsWith('#') && !/^\*\*(Due|Preamble):/.test(l.trim())
        );
        currentProblem = { id: uuidv4(), name: prob.name, description: descLines.join('\n').trim(), subsections: [] };

        if (prob.points !== undefined && prob.submissionType !== undefined) {
          // Flat format — auto-promote body into a single (a) subsection
          const description = body
            .filter(l => l.trim() && !l.trim().startsWith('>') && !l.trim().startsWith('#') && !/^\*\*(Due|Preamble):/.test(l.trim()))
            .join('\n').trim();
          const aiGradingPrompt = extractBlockquoteValue('grading_prompt', body);
          const graderNote = extractBlockquoteValue('grader_note', body);
          const minWords = MIN_WORDS_MAP[prob.submissionType];
          const isHandwritten = prob.submissionType === SubmissionType.HANDWRITTEN;
          currentProblem.description = '';
          currentProblem.subsections.push({
            id: uuidv4(),
            name: prob.name,
            description,
            points: prob.points,
            submissionType: prob.submissionType,
            // Handwritten pages are an assignment-level pool — no per-part image count.
            ...(isHandwritten
              ? { handwrittenGradingMode: prob.handwrittenGradingMode ?? 'ai', ...parseTemplateOptions(body) }
              : { maxImages: prob.maxImages }),
            aiGradingPrompt,
            ...(graderNote && { graderNote }),
            config: '',
            ...(minWords !== undefined && { minWords }),
          });
        }
      }
    } else if (type === 'subsection') {
      if (!currentProblem) continue;
      const subMeta = parseSubsectionHeader(header);
      if (!subMeta) continue;

      const description = body.filter(l => l.trim() && !l.trim().startsWith('>')).join('\n').trim();
      const aiGradingPrompt = extractBlockquoteValue('grading_prompt', body);
      const graderNote = extractBlockquoteValue('grader_note', body);

      const submissionType = subMeta.submissionType;
      const minWords = MIN_WORDS_MAP[submissionType];
      const isHandwritten = submissionType === SubmissionType.HANDWRITTEN;

      const subsection: Subsection = {
        id: uuidv4(),
        name: subMeta.name,
        description,
        points: subMeta.points,
        submissionType,
        // Handwritten pages are an assignment-level pool — no per-part image count.
        ...(isHandwritten
          ? { handwrittenGradingMode: subMeta.handwrittenGradingMode ?? 'ai', ...parseTemplateOptions(body) }
          : { maxImages: subMeta.maxImages }),
        aiGradingPrompt,
        ...(graderNote && { graderNote }),
        config: '',
        ...(minWords !== undefined && { minWords }),
      };
      currentProblem.subsections.push(subsection);
    }
  }
  if (currentProblem) problems.push(currentProblem);

  const now = Date.now();
  return {
    id: uuidv4(),
    courseCode: meta.courseCode,
    title: meta.title,
    inputMode: meta.inputMode,
    ...(meta.pageFormatId ? { pageFormatId: meta.pageFormatId } : {}),
    preamble: meta.preamble,
    problems,
    aiGradingConfig: DEFAULT_AI_CONFIG,
    createdAt: now,
    updatedAt: now,
  };
}
