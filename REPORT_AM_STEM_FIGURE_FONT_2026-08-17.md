# The shrinking stem

**GradeBridge Assignment Maker · 17 August 2026**

A problem stem printed smaller than the sub-parts beneath it. The fixed-9-pt change was supposed to
have ended that, and for a stem of plain prose it had. Every ENG17 stem carries a circuit, and that
was the case it missed.

| | |
|---|---|
| **Work order** | `WORKORDER_AM_STEM_FIGURE_FONT_2026-08-17.md` |
| **Head at report** | `d66c3c4` · **fixed in** `6f33920` → `main` |
| **Tests** | 127 + 68 + 3 pass; `tsc --noEmit` clean |
| **Deploy** | Published to `gh-pages` — https://bridgesuite.github.io/GradeBridge-Assignment-Maker/ |

*Scope: the handwritten QR template's drawing path only. Paint-only — no layout arithmetic changed.
Companion: `REPORT_AM_ANSWER_SPACE_2026-08-17.md`, which carries this as one section of the wider
answer-space story.*

---

## The symptom

In the ENG17 HW1 export, Problem 1's stem — *"For the bridge circuit provided (text problem 1.11): a
20 V source and six resistors…"* — printed visibly smaller than the 1(a) description directly beneath
it. Same on Problem 2, Problem 3, and every problem in the set.

The tell was that it was **every** problem, and that the sub-part descriptions were always fine. A
font bug that hit one block type and spared the other was not going to be a font setting; both are
drawn at the same `DESC_FONT_PT`. Something was scaling the stem after the fact.

## The root cause

The stem and its figure were rendered into **one** canvas, and a canvas has **one** scale factor.

```
  the stem, as authored              what the drawing path did
  ─────────────────────              ─────────────────────────
  "For the bridge circuit    ┐
   provided (text problem    │       drawAuthoredText(whole stem)
   1.11): a 20 V source…"    │              │
                             ├──────────────┤   ONE canvas: toHtml() inlines
  ```svg                     │              │   the figure with the prose
    <svg …bridge circuit…>   │              ▼
  ```                        ┘       ┌──────────────────────┐
                                     │ prose (2 lines)      │  natural height
  reserved box:                      │                      │  EXCEEDS the box
    proseLines × DESC_LINE_MM        │ figure, as drawn     │       │
  + FIGURE_LINES (12) × DESC_LINE_MM │                      │       ▼
  ≈ 2 + 51 mm                        └──────────────────────┘  scale = box/natural
                                                                    < 1
                                     applied to the WHOLE canvas
                                          │                │
                                    figure shrinks    prose shrinks
                                     (intended)        (the bug)
```

Step by step, in the code as it stood at `d66c3c4`:

1. `drawRegionPrompt` drew the stem with a single
   `drawAuthoredText(doc, b.text, box, { fontPt: DESC_FONT_PT })`, where `b.text` is the whole
   `problemDescription` — **prose and the ```` ```svg ```` block together**.
2. `renderTextToCanvas` set `host.innerHTML = toHtml(text, …)`, and `toHtml` inlines the figure
   alongside the prose. One canvas now held both.
3. The reserved height was `(proseLines + FIGURE_LINES) × DESC_LINE_MM`, with `FIGURE_LINES = 12`
   (≈ 51 mm) standing in for the drawing.
4. A bridge circuit renders **taller** than 51 mm. The canvas's natural height exceeded its box, so
   `drawAuthoredText`'s backstop fired: `scale = maxHeightMm / naturalHeightMm`, less than 1.
5. That scale multiplies the **entire** canvas. The figure came down a little — which is what it is
   for — and the 9 pt prose came down with it.

A sub-part description is text alone. Nothing shares its canvas, so `scale` is always 1 and it prints
at 9 pt. Stem small, description not small: the asymmetry was the fingerprint.

## Why the earlier fix did not cover this

The answer-space change removed the two things that had been shrinking stems — the page-level
`squeeze`, and the `DESC_MAX_LINES = 8` cap that crushed a long stem into eight lines and then scaled
it into them. It also gave stem, prompt and description the same reservation per line and the same
font size, and a test asserts exactly that.

That test passes, and the claim it makes is true — **for a figure-free stem**. The shared canvas
defeats it the moment a drawing is in the block, because the scale is no longer a function of the
text at all.

## The fix

Split the block. `drawAuthoredBlock` runs `splitFigures` first and stacks the pieces in authored
order, each rasterised into **its own** box:

- **Prose runs** get a box the height of their own reservation. Their scale is therefore always 1, and
  the words cannot be shrunk by anything drawn near them.
- **Each figure** gets the `FIGURE_LINES` block the layout already reserved for it, and only the
  drawing is scaled into that. Scaling stays uniform, so nothing is distorted.

> **A figure may scale to its box. Question text may not.**

Growing `FIGURE_LINES` would not have fixed this and was not the fix. Even a perfectly sized
reservation would scale the prose the moment a drawing ran a millimetre over — the coupling is the
defect, not the number.

**Scope.** The same split now runs for the preamble and the sub-part descriptions as well as the
stem. Figures belong in the stem by spec, but the single-canvas hazard is structural rather than
stem-specific, and one path is easier to reason about than two. A block with no figure in it takes the
original single-raster path, untouched.

## `layout_id` does not move

Reservation arithmetic is unchanged — only *which rasters* the reserved space is divided between. The
map is identical, so a given assignment hashes to the same `layout_id` it did before.

Verified: `38AE82C0` on the `EEC130B_Handwritten_HW3.md` fixture, either side of the change. **No
regeneration churn beyond the visual**, and nothing beyond what the earlier answer-space change
already required.

## How it is held down

Two new checks, on top of the 196 that were already green:

- **A stem with a figure produces two rasters, not one.** The suite generates a stem carrying an inline
  SVG and asserts there are two ink entries — `problem text N` and `figure in problem text N` — that
  the prose starts at the top of the stem block and stops before the figure, and that the prose's box
  never includes any of the figure's allotment. If anyone recombines them, this is the check that goes
  red.
- **A figure-free stem is still one raster,** with no figure block emitted at all.

**What no test here can settle.** Node has no DOM, so the tests exercise the geometry and the split,
not the rasteriser itself. The acceptance item that needs eyes is the printed one: regenerate the
ENG17 HW1 export and look at Problem 1's stem against its 1(a) description.

## One residual, stated rather than hidden

`drawAuthoredText` still scales a block down when it overruns **its own** reservation. That backstop is
why a pathological paragraph cannot overflow into the writing area beneath it, and it now applies to a
stem exactly as it always has to a sub-part description — which is what "the stem prints at the same
size as the descriptions" means in practice. The character-count estimate is deliberately generous
(`CHAR_ADVANCE_EM` = 0.55 em, wider than Helvetica actually measures) to keep it off the routine path.

Read strictly, *"text may not scale"* would mean removing that backstop, so an over-long paragraph
overflows and the ink self-test refuses to emit the template at all. That is a defensible choice — a
refused template is a loud failure rather than a quiet small-print one — but it turns an author's long
paragraph into a blocked export, so it should be a decision rather than a side effect. Say the word
and it becomes a hard failure.

---

*`6f33920` · BridgeSuite/GradeBridge-Assignment-Maker · pushed to main, published to gh-pages*
