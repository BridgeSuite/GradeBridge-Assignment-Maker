/**
 * mdParserService.ts
 * Browser-side port of converter/convert.py (same repo — keep the two in lockstep)
 * Parses a GradeBridge assignment .md file into an Assignment object.
 */

import { v4 as uuidv4 } from 'uuid';
import { Assignment, InputMode, Problem, Subsection, SubmissionType, AiGradingConfig } from '../types';
import { LEGACY_SPACE_LINES } from './templateLayout';
import { FIGURE_FENCE_CLOSE_RE, FIGURE_FENCE_OPEN_RE, splitFigures } from './figureBlocks';
import { RETIRED_TYPE_TAGS, keepPromptAsGraderNote, retiredTypeWarning } from './retiredTypes';

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
  rawType?: string;
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
    return { name: flatM[1].trim(), points: parseInt(flatM[2]), submissionType, maxImages,
             handwrittenGradingMode, rawType: flatM[3].trim().toLowerCase() };
  }
  // Standard format: ## Problem N: Title
  const m = line.trim().match(/^##\s+Problem\s+\d+:\s+(.+)$/i);
  return m ? { name: m[1].trim(), maxImages: 1 } : null;
}

function parseMetadata(lines: string[]): Pick<Assignment, 'courseCode' | 'title' | 'preamble' | 'inputMode'>
    & { pageFormatId?: string; aiFeedback: boolean } {
  // Every optional line here defaults to the value a file written before it
  // existed would have had, so older .md files round-trip byte-for-byte:
  // **Input:** absent → electronic, **Template ID:** absent → derived,
  // **AI Feedback:** absent → off.
  const meta: Pick<Assignment, 'courseCode' | 'title' | 'preamble' | 'inputMode'>
      & { pageFormatId?: string; aiFeedback: boolean } =
    { courseCode: '', title: '', preamble: '', inputMode: 'electronic' as InputMode, aiFeedback: false };
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
    // Anything other than a clear "on" reads as off — this gates a student-facing
    // feature, so an ambiguous value should not switch it on.
    m = l.match(/^\*\*AI Feedback:\*\*\s+(.+)$/i);
    if (m) { meta.aiFeedback = /^(on|yes|true|enabled?)$/i.test(m[1].trim()); continue; }
  }
  return meta;
}

/**
 * `> template: lines=20, sketch` — the printed-template settings for a
 * handwritten sub-part. `lines=N` is the writing space the author wants
 * reserved; absent means DEFAULT_ANSWER_LINES, and is left unset here so a file
 * that never carried the directive round-trips byte-for-byte.
 *
 * The retired `space=half|full|short|medium|tall|xtall` scale still imports,
 * mapped to a line count, so nothing written against it loses the author's
 * intent that a part wanted a lot of room. Export only ever writes `lines=N`.
 * An explicit `lines=` wins over a `space=` in the same directive.
 */
function parseTemplateOptions(body: string[]): { answerLines?: number; isDrawing?: boolean } {
  const raw = extractBlockquoteValue('template', body);
  if (!raw) return {};
  const out: { answerLines?: number; isDrawing?: boolean } = {};
  let legacyLines: number | undefined;
  for (const token of raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)) {
    const lines = token.match(/^lines\s*=\s*(\d+)$/);
    if (lines) {
      const n = parseInt(lines[1], 10);
      if (n > 0) out.answerLines = n;
      continue;
    }
    const space = token.match(/^space\s*=\s*(half|full|short|medium|tall|xtall)$/);
    if (space) { legacyLines = LEGACY_SPACE_LINES[space[1]]; continue; }
    if (token === 'sketch' || token === 'drawing') out.isDrawing = true;
  }
  if (out.answerLines === undefined && legacyLines !== undefined) out.answerLines = legacyLines;
  return out;
}

/**
 * Body lines → a description, with figure blocks lifted out whole.
 *
 * The per-line filters below throw away blank lines, and lines that start with
 * `#` or `>` — every one of which is legitimate inside an SVG document (a CSS
 * id selector in a `<style>`, a wrapped attribute). So the figure comes out
 * first and goes back in verbatim; only the prose between figures is filtered.
 *
 * A figure is separated from its neighbours by a blank line, which is the form
 * Export .md writes — so an exported file re-imports to exactly itself.
 */
function buildDescription(body: string[], keepLine: (line: string) => boolean): string {
  const parts: string[] = [];
  for (const seg of splitFigures(body.join('\n'))) {
    if (seg.kind === 'figure') { parts.push(seg.source); continue; }
    const kept = seg.value.split('\n').filter(keepLine).join('\n').trim();
    if (kept) parts.push(kept);
  }
  return parts.join('\n\n');
}

function extractBlockquoteValue(key: string, body: string[]): string {
  // A `>` at the start of a line inside a figure is XML, not a blockquote.
  const lines = splitFigures(body.join('\n'))
    .filter(seg => seg.kind === 'text')
    .flatMap(seg => (seg as { value: string }).value.split('\n'));
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

function isRetiredTag(rawType: string | undefined): boolean {
  return !!rawType && rawType in RETIRED_TYPE_TAGS;
}

/**
 * A retired type tag is not in TYPE_MAP any more, so `parseTypeTag` already
 * falls back to Text (see `retiredTypes.ts` for the list and the reasoning).
 * All this adds is the sentence the instructor needs to see: which sub-part
 * changed, and to what.
 */
function noteRetiredTag(rawType: string | undefined, label: string, warnings?: string[]): void {
  if (!isRetiredTag(rawType) || !warnings) return;
  warnings.push(retiredTypeWarning(label, `[${rawType}]`, RETIRED_TYPE_TAGS[rawType!]));
}

/**
 * Parse a GradeBridge assignment `.md` into an Assignment.
 *
 * `warnings`, if given, collects one line per thing that had to be changed to
 * load the file — currently only a retired type tag degrading to Text (see
 * `retiredTypes.ts`). The caller surfaces them to the instructor; nothing here
 * throws over one, because losing the assignment is worse than losing a type.
 */
export function parseMdToAssignment(content: string, warnings?: string[]): Assignment {
  const lines = content.split('\n');
  const meta = parseMetadata(lines);

  // Split file into labelled sections
  type SecType = 'preamble' | 'problem' | 'subsection';
  const sections: Array<{ type: SecType; header: string; body: string[] }> = [];
  let curType: SecType = 'preamble';
  let curHeader = '';
  let curBody: string[] = [];

  // Inside a figure block nothing is a header — an SVG's own text content is not
  // markdown, and a line of it that happened to look like one would cut the
  // drawing in half.
  let inFigure = false;

  for (const line of lines) {
    const s = line.trim();
    if (inFigure) {
      if (FIGURE_FENCE_CLOSE_RE.test(line)) inFigure = false;
      curBody.push(line);
      continue;
    }
    if (FIGURE_FENCE_OPEN_RE.test(line)) {
      inFigure = true;
      curBody.push(line);
      continue;
    }
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
        const description0 = buildDescription(body, l =>
          !!l.trim() && !l.trim().startsWith('#') && !/^\*\*(Due|Preamble):/.test(l.trim())
        );
        currentProblem = { id: uuidv4(), name: prob.name, description: description0, subsections: [] };

        if (prob.points !== undefined && prob.submissionType !== undefined) {
          noteRetiredTag(prob.rawType, prob.name, warnings);
          // Flat format — auto-promote body into a single (a) subsection
          const description = buildDescription(body, l =>
            !!l.trim() && !l.trim().startsWith('>') && !l.trim().startsWith('#') && !/^\*\*(Due|Preamble):/.test(l.trim())
          );
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
          if (isRetiredTag(prob.rawType)) {
            keepPromptAsGraderNote(currentProblem.subsections[currentProblem.subsections.length - 1]);
          }
        }
      }
    } else if (type === 'subsection') {
      if (!currentProblem) continue;
      const subMeta = parseSubsectionHeader(header);
      if (!subMeta) continue;

      const description = buildDescription(body, l => !!l.trim() && !l.trim().startsWith('>'));
      const aiGradingPrompt = extractBlockquoteValue('grading_prompt', body);
      const graderNote = extractBlockquoteValue('grader_note', body);

      noteRetiredTag(subMeta.rawType, `${currentProblem.name} — ${subMeta.name}`, warnings);

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
      if (isRetiredTag(subMeta.rawType)) keepPromptAsGraderNote(subsection);
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
    aiFeedback: meta.aiFeedback,
    preamble: meta.preamble,
    problems,
    aiGradingConfig: DEFAULT_AI_CONFIG,
    createdAt: now,
    updatedAt: now,
  };
}
