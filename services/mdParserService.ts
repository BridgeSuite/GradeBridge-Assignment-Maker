/**
 * mdParserService.ts
 * Browser-side port of CCAssignmentMaker/convert.py
 * Parses a GradeBridge assignment .md file into an Assignment object.
 */

import { v4 as uuidv4 } from 'uuid';
import { Assignment, Problem, Subsection, SubmissionType, AiGradingConfig } from '../types';

const DEFAULT_AI_CONFIG: AiGradingConfig = {
  model: 'claude-haiku-4-5-20251001',
  temperature: 0.1,
  maxTokens: 512,
};

const TYPE_MAP: Record<string, SubmissionType> = {
  'text':          SubmissionType.TEXT,
  'image':         SubmissionType.IMAGE,
  'ai-reflective': SubmissionType.AI_REFLECTIVE,
  'true-false':    SubmissionType.TRUE_FALSE,
};

interface SubsectionMeta {
  name: string;
  points: number;
  submissionType: SubmissionType;
  maxImages: number;
  rawType: string;
}

function parseSubsectionHeader(line: string): SubsectionMeta | null {
  const m = line.trim().match(/^###\s+\([a-z]+\)\s+(.+?)\s+\[(\d+)\s+pts?\]\s+\[([^\]]+)\]\s*$/i);
  if (!m) return null;

  const name = m[1].trim();
  const points = parseInt(m[2]);
  const typeTag = m[3].trim().toLowerCase();

  let maxImages = 1;
  let baseType = typeTag;
  if (typeTag.startsWith('image:')) {
    baseType = 'image';
    maxImages = parseInt(typeTag.split(':')[1]) || 1;
  }

  return { name, points, submissionType: TYPE_MAP[baseType] ?? SubmissionType.TEXT, maxImages, rawType: baseType };
}

function parseProblemHeader(line: string): { name: string } | null {
  const m = line.trim().match(/^##\s+Problem\s+\d+:\s+(.+)$/i);
  return m ? { name: m[1].trim() } : null;
}

function parseMetadata(lines: string[]): Pick<Assignment, 'courseCode' | 'title' | 'preamble'> {
  const meta = { courseCode: '', title: '', preamble: '' };
  for (const line of lines) {
    const l = line.trim();
    let m = l.match(/^#\s+([^:]+):\s+(.+)$/);
    if (m) { meta.courseCode = m[1].trim(); meta.title = m[2].trim(); continue; }
    // **Due:** lines are intentionally ignored — due dates are managed in Canvas
    m = l.match(/^\*\*Preamble:\*\*\s+(.+)$/);
    if (m) { meta.preamble = m[1].trim(); continue; }
  }
  return meta;
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
      }
    } else if (type === 'subsection') {
      if (!currentProblem) continue;
      const subMeta = parseSubsectionHeader(header);
      if (!subMeta) continue;

      const description = body.filter(l => l.trim() && !l.trim().startsWith('>')).join('\n').trim();
      const aiGradingPrompt = extractBlockquoteValue('grading_prompt', body);
      const correctAnswer = extractBlockquoteValue('correct_answer', body);

      // A grading_prompt always means AI Reflective at 100 pts
      const submissionType = aiGradingPrompt ? SubmissionType.AI_REFLECTIVE : subMeta.submissionType;
      const points = aiGradingPrompt ? 100 : subMeta.points;

      const subsection: Subsection = {
        id: uuidv4(),
        name: subMeta.name,
        description,
        points,
        submissionType,
        maxImages: subMeta.maxImages,
        aiGradingPrompt,
        config: subMeta.rawType === 'true-false' ? correctAnswer : '',
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
    preamble: meta.preamble,
    problems,
    aiGradingConfig: DEFAULT_AI_CONFIG,
    createdAt: now,
    updatedAt: now,
  };
}
