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
    'handwritten':         'Handwritten',
}

# Type tags this converter once wrote and no longer authors. They import as the
# type named here, and the sub-part is listed in the summary, so a .md written
# against an older spec still converts instead of failing. Keep in lockstep
# with services/retiredTypes.ts.
RETIRED_TYPE_TAGS = {
    'ai-graded:formative': 'Text',
}

RETIRED_TAG_WARNINGS = []

MIN_WORDS_MAP = {
    'ai-graded:binary': 20,
    'ai-graded:short':  50,
    'ai-graded:medium': 100,
    'ai-graded:long':   150,
}

AI_GRADED_TYPES = set(TYPE_MAP[k] for k in TYPE_MAP if k.startswith('ai-graded:'))

# --- Figures -------------------------------------------------------------
# Port of services/figureBlocks.ts — keep the two in lockstep. A figure sits in
# the problem stem, above the first sub-part, in one of two forms:
#
#     ```svg
#     <svg viewBox="0 0 400 200" ...>...</svg>
#     ```
#
#     ![alt text](data:image/png;base64,...)
#
# It must be lifted out of the text before anything else looks at it. The
# per-line filters below throw away blank lines and lines starting with `#` or
# `>` — all of which are legitimate inside an SVG (a CSS id selector in a
# `<style>`, a wrapped attribute) — and on the JS side the `$...$` math splitter
# would shred a drawing whose path data happens to hold a dollar sign.

FIGURE_FENCE_OPEN_RE = re.compile(r'^[ \t]*```[ \t]*svg[ \t]*$')
FIGURE_FENCE_CLOSE_RE = re.compile(r'^[ \t]*```[ \t]*$')
FIGURE_IMAGE_RE = re.compile(r'^[ \t]*!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)[ \t]*$')


def split_figures(lines):
    """
    Split a list of body lines into ('text', [lines]) and ('figure', [lines])
    units, in order. An unterminated fence is still lifted, to the end.
    """
    units = []
    buf = []
    i = 0
    while i < len(lines):
        line = lines[i]

        if FIGURE_IMAGE_RE.match(line):
            if buf:
                units.append(('text', buf))
                buf = []
            units.append(('figure', [line]))
            i += 1
            continue

        if FIGURE_FENCE_OPEN_RE.match(line):
            end = i + 1
            while end < len(lines) and not FIGURE_FENCE_CLOSE_RE.match(lines[end]):
                end += 1
            closed = end < len(lines)
            if buf:
                units.append(('text', buf))
                buf = []
            units.append(('figure', lines[i:end + 1] if closed else lines[i:end]))
            i = end + 1 if closed else end
            continue

        buf.append(line)
        i += 1

    if buf:
        units.append(('text', buf))
    return units


def build_description(body, keep_line):
    """
    Body lines -> a description, with figure blocks kept verbatim and separated
    from their neighbours by a blank line — the form Export .md writes, so an
    exported file re-imports to exactly itself.
    """
    parts = []
    for kind, lines in split_figures(body):
        if kind == 'figure':
            parts.append('\n'.join(lines))
            continue
        kept = '\n'.join(l for l in lines if keep_line(l)).strip()
        if kept:
            parts.append(kept)
    return '\n\n'.join(parts)


def lines_without_figures(body):
    """Body lines with any figure block removed, for the blockquote scanners."""
    out = []
    for kind, lines in split_figures(body):
        if kind == 'text':
            out.extend(lines)
    return out


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

    if base_type in RETIRED_TYPE_TAGS:
        RETIRED_TAG_WARNINGS.append(
            f'"{name}" was authored as [{base_type}], which has been retired. '
            f'It is now a plain {RETIRED_TYPE_TAGS[base_type]} part — '
            'review its points and rubric before exporting.'
        )

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


# Line counts the retired `space=` spellings import as. Mirrors
# LEGACY_SPACE_LINES in services/templateLayout.ts — change them together.
DEFAULT_ANSWER_LINES = 6
FULL_PAGE_LINES = 24
LEGACY_SPACE_LINES = {
    'short': 4, 'medium': 6, 'tall': 10,
    'half': DEFAULT_ANSWER_LINES, 'full': FULL_PAGE_LINES, 'xtall': FULL_PAGE_LINES,
}


def parse_template_options(lines):
    """
    Parse '> template: lines=20, sketch' — the printed-template settings for a
    handwritten sub-part. 'lines=N' is the writing space the author wants
    reserved; absent means DEFAULT_ANSWER_LINES, and is left unset here so a
    file that never carried the directive round-trips byte-for-byte.

    The retired space=half|full|short|medium|tall|xtall scale still imports,
    mapped to a line count, so nothing written against it loses the author's
    intent that a part wanted a lot of room. Export only ever writes 'lines=N'.
    An explicit 'lines=' wins over a 'space=' in the same directive.
    """
    raw = extract_blockquote_value('template', lines)
    if not raw:
        return {}
    out = {}
    legacy_lines = None
    for token in [t.strip().lower() for t in raw.split(',') if t.strip()]:
        m = re.match(r'^lines\s*=\s*(\d+)$', token)
        if m:
            n = int(m.group(1))
            if n > 0:
                out['answerLines'] = n
            continue
        m = re.match(r'^space\s*=\s*(half|full|short|medium|tall|xtall)$', token)
        if m:
            legacy_lines = LEGACY_SPACE_LINES[m.group(1)]
            continue
        if token in ('sketch', 'drawing'):
            out['isDrawing'] = True
    if 'answerLines' not in out and legacy_lines is not None:
        out['answerLines'] = legacy_lines
    return out


def extract_blockquote_value(key, body):
    """
    Finds a blockquote starting with '> key:' in lines and returns the full value
    (concatenating continuation lines that start with '>').
    Returns empty string if not found.
    """
    # A '>' at the start of a line inside a figure is XML, not a blockquote.
    lines = lines_without_figures(body)
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


def normalize_points(problems, target=None):
    """
    Scale all subsection point values so they sum to `target`.

    THE FILE'S OWN TOTAL IS THE TARGET. `target=None` means "whatever this file
    already sums to", which makes the conversion an identity rather than a
    silent transformation. This mirrors `parseMdToAssignment` in
    `services/mdParserService.ts`, which sets `targetPoints` from the same sum —
    the two are kept in lockstep, and before 2026-09-01 both defaulted to 100
    and quietly halved a 200-point assignment.

    Pass an explicit `target` to rescale on purpose.

    Returns (was_normalized: bool, original_total: int).
    Modifies problems in-place.
    """
    all_subs = [sub for p in problems for sub in p['subsections']]
    total = sum(sub['points'] for sub in all_subs)

    if target is None:
        target = total

    if total == 0 or total == target:
        return False, total

    scaled = [round(sub['points'] * target / total) for sub in all_subs]

    # Fix rounding error — add/subtract from the largest-point subsection
    diff = target - sum(scaled)
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

    # Inside a figure block nothing is a header — an SVG's own text content is
    # not markdown, and a line of it that happened to look like one would cut
    # the drawing in half.
    in_figure = False

    for line in lines:
        stripped = line.strip()

        if in_figure:
            if FIGURE_FENCE_CLOSE_RE.match(line):
                in_figure = False
            current_body.append(line)
            continue

        if FIGURE_FENCE_OPEN_RE.match(line):
            in_figure = True
            current_body.append(line)
            continue

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
                description = build_description(
                    body,
                    lambda l: bool(l.strip())
                    and not l.strip().startswith('#')
                    and not re.match(r'^\*\*(Due|Preamble):', l.strip())
                )
                current_problem = {
                    'id': str(uuid.uuid4()),
                    'name': prob['name'],
                    'description': description,
                    'subsections': []
                }

        elif sec_type == 'subsection':
            if current_problem is None:
                continue
            sub_meta = parse_subsection_header(header)
            if not sub_meta:
                continue

            description = build_description(
                body,
                lambda l: bool(l.strip()) and not l.strip().startswith('>')
            )

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
            if sub_meta['raw_type'] in RETIRED_TYPE_TAGS:
                # No longer AI graded, so the prompt would go quietly: the
                # editor stops showing it and the next export stops writing it.
                # Keep the words in the grader note, which every type shows.
                if subsection['aiGradingPrompt'] and not subsection.get('graderNote'):
                    subsection['graderNote'] = subsection['aiGradingPrompt']
                subsection['aiGradingPrompt'] = ''

            current_problem['subsections'].append(subsection)

    if current_problem is not None:
        problems.append(current_problem)

    # Adopt the file's own total as the target — see normalize_points().
    was_normalized, original_total = normalize_points(problems)
    authored_total = sum(sub['points'] for p in problems for sub in p['subsections'])

    now_ms = int(__import__('time').time() * 1000)

    assignment = {
        'id': str(uuid.uuid4()),
        'courseCode': meta['courseCode'],
        'title': meta['title'],
        'inputMode': meta['inputMode'],
        'aiFeedback': meta['aiFeedback'],
        'preamble': meta['preamble'],
        'problems': problems,
        # The intended total, carried explicitly so a later export in the
        # Assignment Maker does not fall back to its 100 default.
        **({'targetPoints': authored_total} if authored_total > 0 else {}),
        # Only present when the .md pinned one; otherwise the QR template
        # generator derives it from the course code and title.
        **({'pageFormatId': meta['pageFormatId']} if meta.get('pageFormatId') else {}),
        'createdAt': now_ms,
        'updatedAt': now_ms
    }

    if was_normalized:
        assignment['_normalization_note'] = f'Points scaled from {original_total} to {authored_total}'

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
    for w in RETIRED_TAG_WARNINGS:
        print(f"  ⚠ {w}")
    if RETIRED_TAG_WARNINGS:
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
