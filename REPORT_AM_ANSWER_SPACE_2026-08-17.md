# Authored answer space

**GradeBridge Assignment Maker · 17 August 2026**

The handwritten QR template used to decide how much room an answer got, and shrink the question to
make it fit. Now the author decides, the question prints at full size, and the page count is what
gives.

| | |
|---|---|
| **Work orders** | `WORKORDER_AM_ANSWER_SPACE_2026-08-17.md`, `WORKORDER_AM_DROP_ANSWER_INSTRUCTION_2026-08-17.md` |
| **Commit** | `ef30eb2` → `main` (14 files, +691 −350) |
| **Tests** | 127 + 64 + 3 pass; `tsc --noEmit` clean |
| **Deploy** | Published to `gh-pages` — https://bridgesuite.github.io/GradeBridge-Assignment-Maker/ |

*Scope: handwritten QR template only. Electronic exports are untouched. Companion document:
`COMPLETION_AM_ANSWER_SPACE_2026-08-17.md` (the work-order-by-work-order completion record).*

---

## The defect: writing space won, and text flexed

Space was derived — half a page or a full page, split between two parts by their point values. The
printed question was whatever was left. When a page got tight, a page-level `squeeze` scaled every
prose block down and the renderer scaled the rendered text into whatever box survived.

Two symptoms, one cause. A problem stem printed noticeably **smaller** than the sub-part questions
under it — it is the longest block, so it shrank most, and an eight-line cap finished the job. And
the space bore no relation to the answer: a three-point list got a blank page while a table got a
third of one.

> **The author states how many lines an answer needs. The generator reserves exactly that, draws
> exactly that, and the map crops exactly that.**

---

## What inverted

```
  BEFORE — space fixed, text flexes          AFTER — text fixed, space authored
  ┌────────────────────────────┐             ┌────────────────────────────┐
  │ ▂▂▂▂▂▂▂▂▂▂▂▂▂▂             │             │ ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ │
  │ ▂▂▂▂▂▂▂▂▂▂                 │             │ ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ │
  │   stem, squeezed           │             │ ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄            │
  │ ───────────────────────    │             │   stem, 9 pt, full size    │
  │                            │             │ ━━━━━━━━━━━━━━━━━━━━━━━━━━ │
  │      45 pts → 65%          │             │ │ ─────────────────────  │ │
  │                            │             │ │ ─────────────────────  │ │
  │ ───────────────────────    │             │ │ ─────────────────────  │ │
  │      5 pts → 35%           │             │ │ ────────── lines=14 ─  │ │
  │                            │             │ ━━━━━━━━━━━━━━━━━━━━━━━━━━ │
  └────────────────────────────┘             │ ▄▄▄▄ next part: won't fit  │
   1 page, always                            └────────────────────────────┘
                                              page 1
                                             ┌────────────────────────────┐
   The page is a fixed container             │ ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ │
   and the question text is the              │ ━━━━━━━━━━━━━━━━━━━━━━━━━━ │
   thing that gives.                         │ │ ─────────────────────  │ │
                                             │ │ ─────────────────────  │ │
                                             │ │ ─────────────────────  │ │
                                             │ │ ─────────────────────  │ │
                                             │ │ ────────── lines=20 ─  │ │
                                             │ ━━━━━━━━━━━━━━━━━━━━━━━━━━ │
                                             └────────────────────────────┘
                                              page 2, unshrunk
```

The same two parts under both models. Before, one page is a fixed container and the question text is
the thing that gives. After, the question and the authored box are both fixed and the part that no
longer fits starts a page — paper is cheap, unreadable text is not.

---

## The field

```markdown
### (c) Find the series groups [25 pts] [handwritten]
Find every group of two or more elements in series.

> template: lines=14
```

- `lines=N` reserves N writing lines. N is a positive integer.
- `sketch` still combines and is order-free: `> template: lines=20, sketch` reserves 20 lines' height
  as a plain, unruled drawing box. `> template: sketch` alone is still valid.
- **Absent means 6 lines** (`DEFAULT_ANSWER_LINES`) and stores nothing on the sub-part, so a file that
  never carried the directive still round-trips byte-for-byte.

### Back-compat is import-only

The retired spellings still parse, each mapped to a line count. Export only ever writes `lines=N` — a
one-way migration, so a file only gains the clearer spelling.

| Retired | Imports as | Retired | Imports as |
|---|---|---|---|
| ~~`space=short`~~ | 4 lines | ~~`space=tall`~~ | 10 lines |
| ~~`space=medium`~~ | 6 lines | ~~`space=full`~~ | 24 lines |
| ~~`space=half`~~ | 6 lines | ~~`space=xtall`~~ | 24 lines |

An explicit `lines=` wins over a `space=` in the same directive. In the editor, the Half page / Full
page pills are gone, replaced by an **Answer lines** number input; the Sketch pill is unchanged.

---

## One rectangle, end to end

The authored line count is what is reserved, what is drawn, and what `layout_{id}.csv` crops — so
there is no drift between the space the student writes in and the space the grader sees.

```
   1(c). Find the series groups              [25 pts]   ← prompt row: the authored name alone
   ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
   ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄                ← question text: fixed 9 pt, never scaled
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   ← the rule = the box's top edge
 ┬ ┃                                                ┃
 │ ┃ ──────────────────────────────────────────     ┃
 │ ┃ ──────────────────────────────────────────     ┃
 │ ┃ ──────────────────────────────────────────     ┃  → reserved
 │ ┃ ──────────────────────────────────────────     ┃  → = drawn
 │ ┃ ──────────────────────────────────────────     ┃  → = cropped
 │ ┃ ──────────────────────────────────────────     ┃
 ┴ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
   N × 8.0 mm            a sketch part gets the same box with no rules inside it
```

The rule that spec 4.1 requires is the top edge of the box, so nothing is drawn twice and the printed
rectangle is the row in the layout map.

---

## Pagination: pack, then break

Replacing the old four rules. Nothing derives from points, and nothing is squeezed to avoid a break.

| | |
|---|---|
| **open** | **A problem opens a new page** — carrying its heading and shared setup text. |
| **pack** | **Its parts pack down the page at their authored sizes** — however many fit is however many the page carries; no two-per-page cap. |
| **break** | **A part that does not fit what is left starts a new page** — prompt, question text and answer box move together, at full size. |
| **x2** | **A part bigger than a page continues** — same `part_id`, `region_id` suffixed `x2`, heading marked `(continued)`. Group crops by `part_id` and grade the part once, unchanged. |

> **A problem with a single sub-part no longer gets an automatic second page.** That rule existed
> because a lone question is usually the long one; the author now says so with `lines=N`. Sheets get
> shorter for short answers and longer for long ones — a 12-part problem at the default now packs 3
> to a page where it packed 2.

---

## The injected sentence is gone

Every sub-part prompt row used to have a fixed sentence appended — "Write your answer below this
line.", or its sketch and continuation variants. Across three homeworks that is 117 repetitions of a
sentence the instructor could not control, landing **ahead** of the authored question.

The row is now the authored sub-part name alone. The `1(c).` label and the `[25 pts]` label are drawn
separately and are unchanged, and the name still goes through the KaTeX path, so `$…$` in a name
still renders. A part with an empty name draws no prompt row at all, which makes the authored
description the first thing the student reads after the label. Continuations read as continuations
from their `(continued)` heading.

The optional per-assignment override string was **not** added. The stated preference was to drop the
sentence, and a configurable literal that defaults to empty buys a round-trip surface and a spec
section for a feature nobody asked to use.

---

## Two things to act on

| | |
|---|---|
| **regenerate** | **Every regenerated template's `layout_id` changes.** Intended — the sizing model is what changed, so no old id was preserved. Regenerate anything already exported, including the ENG17 HW1 export. Nothing is in student hands. |
| **print one** | **Judge `WRITING_LINE_MM` on paper.** 8.0 mm and a 6-line default are first cuts and the only part of this no test can settle. Both live in `services/templateLayout.ts`; `WRITING_LINE_MM` is the one to turn if sheets come out cramped or loose. |

---

## One deliberate deviation

The page-format spec's §4.1 says, emphatically, *"there is no printed answer box."* Its stated reason
is that **nothing detects** a box — a region is found by registering the page and applying the
declared rectangle, never by looking for an edge.

That reason still holds here: the box is drawn *from* the declared rectangle, never read back from
it, and no consumer behaviour depends on it. The work order asks for it explicitly, and it is what
makes the authored line count visible to the student and the sheet's own "write only inside the ruled
areas" instruction true. Raised here rather than silently — if the format's authors object, the box is
one `doc.rect` call to drop, and the ruled lines stand on their own.

---

## What moved

| File | Change |
|---|---|
| `types.ts` | `AnswerSpace` → `AnswerLines`; `answerSpace` → `answerLines`. |
| `services/templateLayout.ts` | New: `WRITING_LINE_MM`, `DEFAULT_ANSWER_LINES`, `FULL_PAGE_LINES`, `LEGACY_SPACE_LINES`, `answerLinesFor`. Removed: `DESC_MAX_LINES`, `MAX_REGIONS_PER_PAGE`, `MIN_SHARE`, `MIN_REGION_MM`, `splitByPoints`, `paginate`, the squeeze loop. `buildLayout` rewritten as one pack-then-break walk that also does continuations. |
| `services/templateGenerator.ts` | Prompt tail dropped; `drawAnswerBox` added; the rule became the box's top edge. |
| `services/templateSelfTest.ts` | The clamp warning now reports unfittable question text, not a squeezed writing area. |
| `services/mdParserService.ts`, `converter/convert.py` | `lines=N` parsed, legacy `space=` mapped, explicit wins. Kept in lockstep and now tested against each other. |
| `services/exportService.ts` | Writes `lines=N`, never `space=`. |
| `pages/Editor.tsx` | Half / Full page pills → an Answer lines number input. |
| `ASSIGNMENT_MD_SPEC.md` | §7 directive, §10 region row, sizing paragraph and layout rules; "Last synced" bumped. |

### One judgement call worth naming

The estimator's average character advance widened from 0.5 em to 0.55 em (`CHAR_ADVANCE_EM`).
Reservation is still counted from characters and never measured — the map is hashed into every page's
QR, so it must be identical in a browser and in a test — but with nothing scaled down to fit any more,
an under-reservation would print question text over the answer box beneath it. Word wrap loses part of
a line at every break, so the advance is deliberately wider than Helvetica measures. Over-reserving
costs a little paper, which is the cheap direction.

---

## How it is held down

127 + 64 + 3 checks pass, type-check clean. New or rewritten:

- The authored line count is what is reserved, drawn and cropped — the **inked** box is compared to the
  declared rectangle edge by edge, not intent to intent.
- Points influence nothing; parts pack past the old two-per-page cap; a part that will not fit breaks
  unshrunk.
- A 40-line answer continues onto an `x2` region with no line lost across the break.
- Long prose is reserved in full and never clamped. The one remaining clamp — prose that cannot fit a
  page even alone — is reachable only by a pathological description and is reported to the author.
- The stem is reserved at the same line height as a sub-part description.
- A text box carries exactly N rules at the writing pitch; a sketch box carries none.
- The PDF's own text operators are searched for all three retired instruction sentences.
- **Parser parity is no longer on trust:** the real `converter/convert.py` is run in a temp directory
  against `mdParserService.ts` over `tests/fixtures/ENG17_AnswerSpaceFixture.md`, covering `lines=N`,
  absent, `lines` + `sketch` and legacy `space=full`. Skips if no Python is on PATH.

---

*`ef30eb2` · BridgeSuite/GradeBridge-Assignment-Maker · pushed to main, published to gh-pages*
