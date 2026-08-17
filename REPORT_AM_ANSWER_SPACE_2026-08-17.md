# Authored answer space

**GradeBridge Assignment Maker · 17 August 2026**

The handwritten QR template used to decide how much room an answer got, and shrink the question to
make it fit. Now the author decides, the question prints at full size, and the page count is what
gives.

| | |
|---|---|
| **Work orders** | `ANSWER_SPACE` and `DROP_ANSWER_INSTRUCTION`, then `NO_PRINTED_BOX` and `STEM_FIGURE_FONT` as same-day follow-ups (all `WORKORDER_AM_*_2026-08-17.md`) |
| **Commits** | `ef30eb2`, then the no-printed-box and stem/figure follow-ups → `main` |
| **Tests** | 127 + 68 + 3 pass; `tsc --noEmit` clean |
| **Deploy** | Published to `gh-pages` — https://bridgesuite.github.io/GradeBridge-Assignment-Maker/ |

*Scope: handwritten QR template only. Electronic exports are untouched. Companion document:
`COMPLETION_AM_ANSWER_SPACE_2026-08-17.md` (the work-order-by-work-order completion record).*

---

## The defect: writing space won, and text flexed

Space was derived — half a page or a full page, split between two parts by their point values. The
printed question was whatever was left. When a page got tight, a page-level `squeeze` scaled every
prose block down and the renderer scaled the rendered text into whatever space survived.

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
  │      45 pts → 65%          │             │   ──────────────────────   │
  │                            │             │   ──────────────────────   │
  │ ───────────────────────    │             │   ──────────────────────   │
  │      5 pts → 35%           │             │   ───────────── lines=14   │
  │                            │             │                            │
  └────────────────────────────┘             │ ▄▄▄▄ next part: won't fit  │
   1 page, always                            └────────────────────────────┘
                                              page 1
                                             ┌────────────────────────────┐
   The page is a fixed container             │ ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ │
   and the question text is the              │ ━━━━━━━━━━━━━━━━━━━━━━━━━━ │
   thing that gives.                         │   ──────────────────────   │
                                             │   ──────────────────────   │
                                             │   ──────────────────────   │
                                             │   ──────────────────────   │
                                             │   ───────────── lines=20   │
                                             │                            │
                                             └────────────────────────────┘
                                              page 2, unshrunk
```

The same two parts under both models. Before, one page is a fixed container and the question text is
the thing that gives. After, the question and the authored writing lines are both fixed, and the part
that no longer fits starts a page — paper is cheap, unreadable text is not.

---

## The field

```markdown
### (c) Find the series groups [25 pts] [handwritten]
Find every group of two or more elements in series.

> template: lines=14
```

- `lines=N` reserves N writing lines. N is a positive integer.
- `sketch` still combines and is order-free: `> template: lines=20, sketch` reserves 20 lines' height
  as reserved, unruled space to draw in. `> template: sketch` alone is still valid.
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

The authored line count is what is reserved, what is ruled, and what `layout_{id}.csv` crops — so
there is no drift between the space the student writes in and the space the grader sees.

```
   1(c). Find the series groups              [25 pts]   ← prompt row: the authored name alone
   ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
   ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄                ← question text: fixed 9 pt, never scaled
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   ← the rule: where the region starts
 ┬
 │   ────────────────────────────────────────────
 │   ────────────────────────────────────────────     the N ruled lines are the
 │   ────────────────────────────────────────────     writing area, and they sit
 │   ────────────────────────────────────────────     inside the rectangle the
 │   ────────────────────────────────────────────     map crops — no frame,
 ┴   ────────────────────────────────────────────     nothing is boxed
   N × 8.0 mm       a sketch part gets the rule, then reserved blank space
```

Nothing is drawn twice, and nothing is framed. The identity that matters — reserved, ruled, cropped —
never depended on a border: the crop comes from the declared rectangle alone, and every rule falls
inside it.

---

## Pagination: pack, then break

Replacing the old four rules. Nothing derives from points, and nothing is squeezed to avoid a break.

| | |
|---|---|
| **open** | **A problem opens a new page** — carrying its heading and shared setup text. |
| **pack** | **Its parts pack down the page at their authored sizes** — however many fit is however many the page carries; no two-per-page cap. |
| **break** | **A part that does not fit what is left starts a new page** — prompt, question text and writing lines move together, at full size. |
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

## Follow-up: nothing is boxed

The first build drew a faint bounding rectangle around each writing area, and flagged that
page-format §4.1 says plainly *"there is no printed answer box."* Andre ruled to honour the spec, and
the rectangle is gone.

Two reasons, and the second is the one that would have bitten. The spec's own reason is that
**nothing detects** a box — a region is located solely by registering the page and applying the
declared rectangle, never by looking for an edge. And the ENG17 questions already tell students to
**box their final answer** — "box the three currents", "box the final value" — so a printed frame
around the whole writing area put two different boxes on one sheet. The student's final-answer box is
now the only box on the page, which was the intent all along.

What stayed: the rule under the prompt, and the N ruled writing lines. What changed with it: the
page-1 instruction now reads *"write on the ruled lines"* rather than *"write only inside the ruled
areas"*, so the sheet never spends the words "box" or "area" on something else.

**`layout_id` did not move.** The map is the region rectangles; the frame was drawn ink, not a map
entry. Removing it is paint-only — the same assignment hashes to the same `layout_id` it did before
(verified: `38AE82C0` on the EEC130B HW3 fixture, either side of the change).

---

## Follow-up: a stem's prose never shares a raster with its figure

Even with the fixed 9 pt and the eight-line cap gone, every ENG17 stem still printed smaller than its
own sub-parts. The reason was one line of drawing code, not the sizing model.

The stem and its figure went into **one** scale-to-fit canvas: `drawAuthoredText` handed the whole
stem — prose *and* the ```` ```svg ```` block — to a single rasteriser, and the reserved height was
`proseLines + FIGURE_LINES`. A bridge circuit renders taller than its 12-line (~51 mm) allotment, so
the canvas overran its box, the backstop scale kicked in, and it scaled **everything** — the drawing a
little, and the 9 pt prose along with it. Sub-part descriptions have no figure to share a canvas with,
so they stayed at 9 pt. That asymmetry was the whole symptom, and it hit every ENG17 problem because
every ENG17 stem carries a circuit.

The fix is to decouple, not to grow the allotment — even a perfectly sized reservation would scale the
prose the moment a drawing ran a millimetre over. `drawAuthoredBlock` splits the stem with
`splitFigures` and stacks the pieces in authored order, each in its own box: prose gets a box the
height of its own reservation, so its scale is always 1; each figure gets the `FIGURE_LINES` block the
layout already reserved for it, and only the drawing is scaled into that.

> **A figure may scale to its box. Question text may not.**

The same split now runs for the preamble and sub-part descriptions, so no authored block anywhere can
have its words scaled by a drawing beside them. A figure-free block takes the original single-raster
path untouched.

**`layout_id` did not move.** Reservation arithmetic is unchanged — only which rasters the reserved
space is divided between. Verified: `38AE82C0` on the EEC130B HW3 fixture, either side of the change.

One residual, stated rather than hidden: `drawAuthoredText` still scales a block down if it genuinely
overruns its own reservation. That backstop is why a pathological paragraph cannot overflow into the
writing area below it, and it now applies to a stem exactly as it always has to a sub-part
description — which is what "the stem prints at the same size as the descriptions" means. The
character-count estimate is deliberately generous (`CHAR_ADVANCE_EM` = 0.55 em) to keep it off the
routine path.

---

## What moved

| File | Change |
|---|---|
| `types.ts` | `AnswerSpace` → `AnswerLines`; `answerSpace` → `answerLines`. |
| `services/templateLayout.ts` | New: `WRITING_LINE_MM`, `DEFAULT_ANSWER_LINES`, `FULL_PAGE_LINES`, `LEGACY_SPACE_LINES`, `answerLinesFor`. Removed: `DESC_MAX_LINES`, `MAX_REGIONS_PER_PAGE`, `MIN_SHARE`, `MIN_REGION_MM`, `splitByPoints`, `paginate`, the squeeze loop. `buildLayout` rewritten as one pack-then-break walk that also does continuations. |
| `services/templateGenerator.ts` | Prompt tail dropped; `drawWritingArea` added — a rule and N ruled lines, no frame; print instruction reworded to "write on the ruled lines"; `drawAuthoredBlock` added — prose and figures rasterised separately. |
| `services/templateSelfTest.ts` | The clamp warning now reports unfittable question text, not a squeezed writing area. |
| `services/mdParserService.ts`, `converter/convert.py` | `lines=N` parsed, legacy `space=` mapped, explicit wins. Kept in lockstep and now tested against each other. |
| `services/exportService.ts` | Writes `lines=N`, never `space=`. |
| `pages/Editor.tsx` | Half / Full page pills → an Answer lines number input. |
| `ASSIGNMENT_MD_SPEC.md` | §7 directive, §10 region row, sizing paragraph and layout rules; "Last synced" bumped. |

### One judgement call worth naming

The estimator's average character advance widened from 0.5 em to 0.55 em (`CHAR_ADVANCE_EM`).
Reservation is still counted from characters and never measured — the map is hashed into every page's
QR, so it must be identical in a browser and in a test — but with nothing scaled down to fit any more,
an under-reservation would print question text over the writing area beneath it. Word wrap loses part of
a line at every break, so the advance is deliberately wider than Helvetica measures. Over-reserving
costs a little paper, which is the cheap direction.

---

## How it is held down

127 + 68 + 3 checks pass, type-check clean. New or rewritten:

- The authored line count is what is reserved, ruled and cropped — the **inked** rules are checked to
  fall inside the declared rectangle, not intent against intent.
- Points influence nothing; parts pack past the old two-per-page cap; a part that will not fit breaks
  unshrunk.
- A 40-line answer continues onto an `x2` region with no line lost across the break.
- Long prose is reserved in full and never clamped. The one remaining clamp — prose that cannot fit a
  page even alone — is reachable only by a pathological description and is reported to the author.
- The stem is reserved at the same line height as a sub-part description.
- A text region carries exactly N rules at the writing pitch; a sketch region carries none.
- **A stem with a figure produces two rasters, not one:** the prose starts at the top of the stem
  block and stops before the figure, and its box never includes any of the figure's allotment. A
  figure-free stem is still a single raster.
- **No region is framed:** the PDF's `re` operators are scanned for a rectangle matching any declared
  region, and the page-1 instruction is read back out and asserted to say "ruled lines" — with the
  word "box" printed nowhere on the sheet.
- The PDF's own text operators are searched for all three retired instruction sentences.
- **Parser parity is no longer on trust:** the real `converter/convert.py` is run in a temp directory
  against `mdParserService.ts` over `tests/fixtures/ENG17_AnswerSpaceFixture.md`, covering `lines=N`,
  absent, `lines` + `sketch` and legacy `space=full`. Skips if no Python is on PATH.

---

*BridgeSuite/GradeBridge-Assignment-Maker · `ef30eb2` and the no-printed-box and stem/figure follow-ups · pushed to main, published to gh-pages*
