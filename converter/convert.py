#!/usr/bin/env python3
"""
GradeBridge Assignment Markdown Converter
Converts a .md assignment file to assignment_spec.json for the GradeBridge Assignment Maker.

Usage:
    python convert.py your_assignment.md

Output:
    your_assignment_spec.json
"""

import sys
import json
import re
import uuid
from pathlib import Path

# Print UTF-8 summaries safely on a legacy Windows (cp1252) console, so the
# checkmark and other non-ASCII characters do not raise UnicodeEncodeError.
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass


# --- Submission type mapping ---
TYPE_MAP = {
    'text':                'Text',
    'image':               'Image',
    'text+image':          'Text and Image',
    'ai-graded:binary':    'AI Graded: Binary',
    'ai-graded:short':     'AI Graded: Short',
    'ai-graded:medium':    'AI Graded: Medium',
    'ai-graded:long':      'AI Graded: Long',
    'ai-graded:formative': 'AI Formative',
    'handwritten':         'Handwritten',
}

MIN_WORDS_MAP = {
    'ai-graded:binary': 20,
    'ai-graded:short':  50,
    'ai-graded:medium': 100,
    'ai-graded:long':   150,
}
# Formative has no enforced word minimum — deliberately absent from MIN_WORDS_MAP.

AI_GRADED_TYPES = set(TYPE_MAP[k] for k in TYPE_MAP if k.startswith('ai-graded:'))

DEFAULT_AI_CONFIG = {
    "model": "claude-haiku-4-5-20251001",
    "temperature": 0.1,
    "maxTokens": 512
}


def parse_subsection_header(line):
    """
    Parse a subsection header line.
    Expected format: ### (a) Subsection Name [10 pts] [type] or [image:N] or
    [ai-graded:size] or [handwritten] / [handwritten:human]
    Returns dict with keys: name, points, submissionType, maxImages,
    handwrittenGradingMode, raw_type — or None if line doesn't match.
    """
    pattern = r'^###\s+\([a-z]+\)\s+(.+?)\s+\[(\d+)\s+pts?\]\s+\[([^\]]+)\]\s*$'
    m = re.match(pattern, line.strip(), re.IGNORECASE)
    if not m:
        return None

    name = m.group(1).strip()
    points = int(m.group(2))
    type_tag = m.group(3).strip().lower()

    # Handle image:N, text+image:N and handwritten:human
    max_images = 1
    handwritten_grading_mode = None
    base_type = type_tag
    if type_tag == 'handwritten:human':
        base_type = 'handwritten'
        handwritten_grading_mode = 'human'
    elif type_tag.startswith('image:'):
        parts = type_tag.split(':', 1)
        base_type = 'image'
        try:
            max_images = int(parts[1])
        except ValueError:
            max_images = 1
    elif type_tag.startswith('text+image:'):
        parts = type_tag.split(':', 1)
        base_type = 'text+image'
        try:
            max_images = int(parts[1])
        except ValueError:
            max_images = 1
    # ai-graded:* tags are kept as-is for TYPE_MAP lookup
    # bare `handwritten` leaves the mode unset — it is read as 'ai' downstream

    submission_type = TYPE_MAP.get(base_type, 'Text')
    min_words = MIN_WORDS_MAP.get(base_type)

    return {
        'name': name,
        'points': points,
        'submissionType': submission_type,
        'maxImages': max_images,
        'handwrittenGradingMode': handwritten_grading_mode,
        'raw_type': base_type,
        'minWords': min_words,
    }


def parse_problem_header(line):
    """
    Parse a problem header line.
    Expected format: ## Problem N: Problem Name
    Returns dict with keys: name  or None if line doesn't match.
    """
    pattern = r'^##\s+Problem\s+\d+:\s+(.+)$'
    m = re.match(pattern, line.strip(), re.IGNORECASE)
    if not m:
        return None
    return {'name': m.group(1).strip()}


def parse_metadata(lines):
    """
    Parse the title line and metadata fields from the top of the file.
    Returns dict with courseCode, title, preamble, inputMode, pageFormatId,
    aiFeedback.
    Due date is intentionally ignored — managed in Canvas.
    """
    meta = {
        'courseCode': '',
        'title': '',
        'preamble': '',
        # **Input:** is optional — files without it are electronic.
        'inputMode': 'electronic',
        # **Template ID:** is optional too — absent means the QR template
        # generator derives one from the course code and title.
        'pageFormatId': None,
        # **AI Feedback:** absent means off, so files written before the flag
        # existed stay valid and feedback-off.
        'aiFeedback': False
    }

    for line in lines:
        line = line.strip()

        # Title line: # CourseCode: Title
        m = re.match(r'^#\s+([^:]+):\s+(.+)$', line)
        if m:
            meta['courseCode'] = m.group(1).strip()
            meta['title'] = m.group(2).strip()
            continue

        # Preamble: **Preamble:** text
        m = re.match(r'^\*\*Preamble:\*\*\s+(.+)$', line)
        if m:
            meta['preamble'] = m.group(1).strip()
            continue

        # Input mode: **Input:** handwritten
        m = re.match(r'^\*\*Input:\*\*\s+(.+)$', line, re.IGNORECASE)
        if m:
            meta['inputMode'] = 'handwritten' if m.group(1).strip().lower() == 'handwritten' else 'electronic'
            continue

        # Page-format template id: **Template ID:** HW3
        m = re.match(r'^\*\*Template ID:\*\*\s+(.+)$', line, re.IGNORECASE)
        if m:
            cleaned = re.sub(r'[^A-Z0-9]', '', m.group(1).strip().upper())[:12]
            if cleaned:
                meta['pageFormatId'] = cleaned
            continue

        # AI feedback: **AI Feedback:** on
        # Anything other than a clear "on" reads as off — this gates a
        # student-facing feature, so an ambiguous value must not switch it on.
        m = re.match(r'^\*\*AI Feedback:\*\*\s+(.+)$', line, re.IGNORECASE)
        if m:
            meta['aiFeedback'] = bool(re.match(r'^(on|yes|true|enabled?)$', m.group(1).strip(), re.IGNORECASE))
            continue

    return meta


def parse_template_options(lines):
    """
    Parse '> template: space=full, sketch' — the printed-template settings for a
    handwritten sub-part. Absent means the part shares a page with one other,
    which is the default.

    short/medium/tall/xtall were the pre-correction scale, from before writing
    space became "at most two parts per page". Still read, so files written
    against the old scale import without losing the author's intent that one
    part wanted a lot of room.
    """
    raw = extract_blockquote_value('template', lines)
    if not raw:
        return {}
    out = {}
    for token in [t.strip().lower() for t in raw.split(',') if t.strip()]:
        m = re.match(r'^space\s*=\s*(half|full|short|medium|tall|xtall)$', token)
        if m:
            out['answerSpace'] = 'full' if m.group(1) in ('full', 'xtall') else 'half'
            continue
        if token in ('sketch', 'drawing'):
            out['isDrawing'] = True
    return out


def extract_blockquote_value(key, lines):
    """
    Finds a blockquote starting with '> key:' in lines and returns the full value
    (concatenating continuation lines that start with '>').
    Returns empty string if not found.
    """
    key_lower = key.lower()
    collecting = False
    parts = []

    for line in lines:
        stripped = line.strip()
        if not collecting:
            pattern = rf'^>\s+{re.escape(key_lower)}:\s*(.*)$'
            m = re.match(pattern, stripped, re.IGNORECASE)
            if m:
                collecting = True
                first = m.group(1).strip()
                if first:
                    parts.append(first)
        else:
            if stripped.startswith('>'):
                continuation = stripped[1:].strip()
                if continuation:
                    parts.append(continuation)
            else:
                break

    return ' '.join(parts)


def normalize_points(problems):
    """
    Scale all subsection point values so they sum to exactly 100.
    Returns (was_normalized: bool, original_total: int).
    Modifies problems in-place.
    """
    all_subs = [sub for p in problems for sub in p['subsections']]
    total = sum(sub['points'] for sub in all_subs)

    if total == 0 or total == 100:
        return False, total

    scaled = [round(sub['points'] * 100 / total) for sub in all_subs]

    # Fix rounding error — add/subtract from the largest-point subsection
    diff = 100 - sum(scaled)
    if diff != 0:
        max_idx = scaled.index(max(scaled))
        scaled[max_idx] += diff

    for sub, new_pts in zip(all_subs, scaled):
        sub['points'] = new_pts

    return True, total


def parse_md(filepath):
    """
    Main parser. Returns a fully-formed assignment dict matching the
    GradeBridge Assignment Maker JSON schema.
    """
    text = Path(filepath).read_text(encoding='utf-8')
    lines = text.splitlines()

    meta = parse_metadata(lines)

    # Split into logical blocks
    sections = []  # list of (type, header_line, body_lines)
    current_type = 'preamble'
    current_header = ''
    current_body = []

    for line in lines:
        stripped = line.strip()

        if re.match(r'^##\s+Problem\s+\d+:', stripped, re.IGNORECASE):
            sections.append((current_type, current_header, current_body))
            current_type = 'problem'
            current_header = stripped
            current_body = []
        elif re.match(r'^###\s+\([a-z]+\)', stripped, re.IGNORECASE):
            sections.append((current_type, current_header, current_body))
            current_type = 'subsection'
            current_header = stripped
            current_body = []
        else:
            current_body.append(line)

    sections.append((current_type, current_header, current_body))

    # Process sections
    problems = []
    current_problem = None

    for sec_type, header, body in sections:
        if sec_type == 'problem':
            if current_problem is not None:
                problems.append(current_problem)
            prob = parse_problem_header(header)
            if prob:
                desc_lines = [
                    l for l in body
                    if l.strip()
                    and not l.strip().startswith('#')
                    and not re.match(r'^\*\*(Due|Preamble):', l.strip())
                ]
                current_problem = {
                    'id': str(uuid.uuid4()),
                    'name': prob['name'],
                    'description': '\n'.join(desc_lines).strip(),
                    'subsections': []
                }

        elif sec_type == 'subsection':
            if current_problem is None:
                continue
            sub_meta = parse_subsection_header(header)
            if not sub_meta:
                continue

            desc_lines = [
                l for l in body
                if l.strip()
                and not l.strip().startswith('>')
            ]
            description = '\n'.join(desc_lines).strip()

            ai_grading_prompt = extract_blockquote_value('grading_prompt', body)
            grader_note = extract_blockquote_value('grader_note', body)

            subsection = {
                'id': str(uuid.uuid4()),
                'name': sub_meta['name'],
                'description': description,
                'points': sub_meta['points'],
                'submissionType': sub_meta['submissionType'],
            }
            if sub_meta['submissionType'] == 'Handwritten':
                # Pages are an assignment-level pool — no per-part image count.
                subsection['handwrittenGradingMode'] = sub_meta['handwrittenGradingMode'] or 'ai'
                subsection.update(parse_template_options(body))
            else:
                subsection['maxImages'] = sub_meta['maxImages']
            subsection['aiGradingPrompt'] = ai_grading_prompt
            subsection['config'] = ''
            if grader_note:
                subsection['graderNote'] = grader_note
            if sub_meta['minWords'] is not None:
                subsection['minWords'] = sub_meta['minWords']

            current_problem['subsections'].append(subsection)

    if current_problem is not None:
        problems.append(current_problem)

    # Normalize points to sum to 100
    was_normalized, original_total = normalize_points(problems)

    now_ms = int(__import__('time').time() * 1000)

    assignment = {
        'id': str(uuid.uuid4()),
        'courseCode': meta['courseCode'],
        'title': meta['title'],
        'inputMode': meta['inputMode'],
        'aiFeedback': meta['aiFeedback'],
        'preamble': meta['preamble'],
        'problems': problems,
        # Only present when the .md pinned one; otherwise the QR template
        # generator derives it from the course code and title.
        **({'pageFormatId': meta['pageFormatId']} if meta.get('pageFormatId') else {}),
        'aiGradingConfig': DEFAULT_AI_CONFIG,
        'createdAt': now_ms,
        'updatedAt': now_ms
    }

    if was_normalized:
        assignment['_normalization_note'] = f'Points scaled from {original_total} to 100'

    return assignment


def print_summary(assignment):
    total_points = sum(
        sub['points']
        for p in assignment['problems']
        for sub in p['subsections']
    )
    note = assignment.get('_normalization_note', '')
    print(f"\n  Course:     {assignment['courseCode']}")
    print(f"  Title:      {assignment['title']}")
    print(f"  Input:      {assignment.get('inputMode', 'electronic')}")
    print(f"  Problems:   {len(assignment['problems'])}")
    print(f"  Total pts:  {total_points}{' ← ' + note if note else ''}")
    print()
    for i, prob in enumerate(assignment['problems']):
        print(f"  Problem {i+1}: {prob['name']}")
        for sub in prob['subsections']:
            flag = ''
            is_ai_handwritten = (sub['submissionType'] == 'Handwritten'
                                 and sub.get('handwrittenGradingMode', 'ai') != 'human')
            if sub['submissionType'] in AI_GRADED_TYPES or is_ai_handwritten:
                has_prompt = bool(sub.get('aiGradingPrompt'))
                flag = ' [AI graded]' + ('' if has_prompt else ' ⚠ no grading_prompt!')
            elif bool(sub.get('graderNote')):
                flag = ' [grader note ✓]'
            else:
                flag = ' [⚠ no grader_note]'
            label = sub['submissionType']
            if sub['submissionType'] == 'Handwritten':
                label += f" / {sub.get('handwrittenGradingMode', 'ai')}"
            print(f"    - {sub['name']} ({sub['points']} pts, {label}){flag}")
    print()


def main():
    if len(sys.argv) < 2:
        print("Usage: python convert.py <assignment.md>")
        sys.exit(1)

    md_path = Path(sys.argv[1])
    if not md_path.exists():
        print(f"Error: file not found: {md_path}")
        sys.exit(1)

    print(f"\nParsing: {md_path.name}")

    assignment = parse_md(md_path)

    # Strip internal note before writing JSON
    norm_note = assignment.pop('_normalization_note', None)

    out_path = md_path.with_name(md_path.stem + '_spec.json')
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(assignment, f, indent=2)

    if norm_note:
        assignment['_normalization_note'] = norm_note  # restore for print_summary

    print(f"Output:  {out_path.name}")
    print_summary(assignment)
    print(f"Done. Load {out_path.name} into Assignment Maker using 'Import Markdown'.")


if __name__ == '__main__':
    main()
