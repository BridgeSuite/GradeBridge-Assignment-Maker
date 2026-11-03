# GradeBridge Assignment Maker: the app as built

**Version 1, 20 October 2026.** One document for the whole app, written from the code
rather than from the earlier specifications, because several of those describe flows the
app no longer has.

**Read from the repository, never from a copy.** A stale copy of a specification has
already cost this project a session's work: ENG17 kept one of `ASSIGNMENT_MD_SPEC.md`, it
fell two thirds behind, and a session reasoned from it and reported the conclusion as fact.

**Status of the tree this describes:** branch `main`, commit `2294a3d` of 20 October 2026, and
the tree is clean apart from `converter/__pycache__/`, which should be ignored. The three
changes section 12 used to describe as uncommitted are in `8ad4611`, `8d6f5bb` and `2294a3d`,
all pushed.

---

## 0. What this replaces

| Document | What it was for | Standing now |
|---|---|---|
| `ASSIGNMENT_MD_SPEC.md` | The `.md` input format and the export contract | **Current and authoritative for the format.** This document does not restate the grammar; it points at it |
| `specs-internal/HANDWRITTEN_REGIONS_SPEC_v4_2026-10-17.md` | Regions, student marking, grading pipeline | **Partly superseded.** §5 describes students dragging rectangles in a `RegionMarker`; the ruling of 7 October 2026 replaced that with the student labelling whole pages. §6 describes a grading pipeline that `ROUTE_ASSIGNMENTS_P3P2_2026-10-19.md` has replaced. Its geometry and schema sections still hold |
| `specs-internal/HANDWRITTEN_REGIONS_SPEC_v*` earlier | Earlier versions of the same | Superseded by v4, and by this document where they disagree |
| `README.md` | Orientation and operating notes | Current, and not duplicated here |
| `docs/INSTRUCTOR_GUIDE.md` | The instructor-facing view | Current |
| `docs/session/COMPLETION_AM_*.md` | One record per change, with the reasoning | Historical record. Cited here where a decision rests on one |

**The rule that governs all of them, from `ASSIGNMENT_MD_SPEC.md`'s own header and kept
here: if the code and a document disagree, the code wins and the document is the bug.**

## 1. Terms

| Term | Meaning |
|---|---|
| **Assignment** | One homework or reader set, authored in this app. The unit everything else is per |
| **Problem** | A numbered question. Holds sub-parts |
| **Sub-part** | One answerable piece of a problem, with its own points and submission type. The unit the rubric and the crops are per |
| **Input mode** | `electronic` or `handwritten`. How students answer |
| **Sheet** | Handwritten only. Absent means the app prints the questions and one answer box per sub-part. `generic` means the instructor posts their own question PDF and every student writes on the one generic answer page |
| **Generic answer page** | `GBGEN1`, layout `5F0B10BC`. One printed page used by every generic-sheet assignment in every course, with four registration marks, a QR code and one writing box |
| **Layout id** | Eight hex characters hashed over the region geometry. Printed in the QR and written into the layout map. If a region moves, it moves |
| **Region map** | The CSV sidecar naming every answer region's rectangle as page fractions. What the cropping side reads |
| **Finalize stamp** | The date, the layout id and a content fingerprint, recorded when an instructor issues an assignment |
| **Export** | The one download: `{stem}_INSTRUCTOR_ONLY.zip`, holding the student package and the grading material |

## 2. What the app is

A client-side React and TypeScript application, built with Vite, served as static files.
**There is no server and no network call in the authoring path**: an assignment is
authored, stored and exported entirely in the instructor's browser, with files arriving
and leaving by the browser's own file pickers and downloads. State lives in
`services/storageService.ts`.

Two pages: a dashboard listing assignments with the import, export and generic-answer-page
actions, and an editor for one assignment.

## 3. The data model

`types.ts` is the contract and carries the reasoning for each field. The shape:

`Assignment` holds `courseCode`, `title`, `preamble`, `problems`, `assignmentKind`
(`conventional` or `reader`, exactly one per assignment), optional `inputMode`, optional
`sheet`, optional `figures`, optional `targetPoints` (an imported assignment takes its own
authored total; only a new, empty one defaults to 100, section 8), optional `aiFeedback`,
optional `pageFormatId`, and the finalize stamps.

`Problem` holds `name`, `description` and `subsections`.

`Subsection` holds `name`, `description`, `points`, `submissionType`, and, for handwritten
parts, `answerLines` (writing lines reserved on the printed template) and `isDrawing`.
Grader-facing fields are `aiGradingPrompt`, `graderNote` and `handwrittenGradingMode`.

**The deliberate absences matter as much as the fields, and each is recorded in `types.ts`
with the date and the reason:**

- **No due date.** Removed 31 August 2026. Due dates are set in Canvas and do not travel
  through this pipeline.
- **No grading resource settings.** No model, temperature or token budget. The app
  describes the work; the grading system decides how to grade it.
- **No submission address.** Removed 22 September 2026.
- **`imageGradingMode` has one value, `'human'`.** The `'auto'` mode awarded full marks for
  any upload with nobody looking, and was removed on 22 September 2026. A person decides
  every grade, and no grading type may award marks on its own.
- **No per-problem assignment kind**, no partly-one-partly-the-other, no runtime condition
  that changes it.

An absent field with a default is announced on import rather than applied silently
(`services/importNotices.ts`), because this repository has twice paid for a field that
went missing quietly: `answerLines`, which repaginates the sheet and moves the layout id,
and `targetPoints`, which halves every point one export cycle after the import that lost
it.

## 4. Input

**The `.md` format** is specified in `ASSIGNMENT_MD_SPEC.md` and parsed by
`services/mdParserService.ts`, which is a browser port of `converter/convert.py` and is
kept in lockstep with it. The format covers metadata, problems, sub-parts, type tags, math
notation, grading instructions as blockquotes, figures and points.

**Import routes:** a single `.md` file, or a folder holding the `.md` with a `figs/`
directory beside it, which is how figures arrive as files rather than data URIs.

**Import notices** (`services/importNotices.ts`, `services/importMessages.ts`) report every
defaulted or discarded field rather than applying it silently.

**Retired submission types** (`services/retiredTypes.ts`) are types the app no longer
authors, with what an assignment carrying one is treated as.

## 5. The two handwritten paths

This is the division that most affects everything downstream.

**The app-printed sheet** (sheet absent). The app prints the instructor's questions in the
GradeBridge format and draws one bordered, ruled answer box per sub-part. Each box's
rectangle goes into the region map, so the cropping side knows which rectangle is which
part. `part_source` is `layout`: the printed page says which part an answer belongs to.

**The generic answer page** (`sheet: 'generic'`). The instructor posts their own question
PDF, and every student writes on one shared page, the same in every course and every
assignment. The printed page therefore does not say which part an answer belongs to;
**the student says so in the Submission app**, and `part_source` is `student`.

The generic page is entirely constant and versioned, in `services/genericAnswerPage.ts`:
template id `GBGEN1`, layout id `5F0B10BC`, one region `gen` with part id `generic`, a
writing box from 12.0 to 203.9 mm across and 57.0 to 257.0 mm down on US Letter, 25 writing
bands of 8.0 mm, and a two-page PDF. The box closes at 257.0 mm rather than the 262.0 first
drawn because the bottom registration-mark keep-out begins at 257.4 mm and the self-test
refuses anything printed into it.

**Changing any number in that file is a new page version, `GBGEN2`, never an edit to this
one**, because the page is printed in bulk and posted to students, and a later change puts
two versions in circulation. The code recomputes the layout id from the map and refuses to
emit the page if the two disagree.

## 6. Geometry, identity and the self-test

`services/pageFormat.ts` holds the canonical frame, transcribed from
`GradeBridge2026/QR Format Page/GradeBridge_Page_Format_v1.md`: page size, registration
corner keep-outs, region padding, and the millimetre and fraction conversions.

`services/templateLayout.ts` turns an assignment into a region map: how many pages the
template needs, where each part's writing area sits, and the sidecar rows. Pure geometry
and pure data, with no jsPDF, no DOM and no text measurement, so the map is identical in a
browser and in a test.

`services/qrPayload.ts` builds the QR payload and computes the layout id as a hash over the
map's content. `services/qrEncoder.ts` pins the symbol: alphanumeric mode, a fixed version,
level H, passed explicitly at the call rather than auto-selected, so the two failures the
format's own check 6 exists to catch cannot occur.

`services/templateGenerator.ts` emits the two artifacts: `{assignment_id}_qr_template.pdf`,
with four corner marks, the pinned QR, one bordered ruled box per part and a header line on
every page; and `layout_{assignment_id}.csv`, the sidecar map whose content hash is in
every page's QR. Rendering is in-browser jsPDF rather than xelatex, which is a resolved
decision recorded in that file.

`services/templateSelfTest.ts` implements the format's section 8.7 checks, and **a template
failing any check is not emitted**: the generator throws.

## 7. The finalize lock

`services/finalize.ts`. Finalizing stamps the date, the layout id and a 16-hex-character
fingerprint over the student-facing content. After that, an export that would change
either stamp is refused until the assignment is explicitly reopened. Grader material,
prompts, notes and rubrics, stays editable throughout, because none of it is student-facing.

Two stamps rather than one, for a reason worth keeping: the layout id catches changes that
move answer regions, which make the printed sheet and the scanner disagree about where a
student's answers are. The fingerprint catches changes that move nothing and still change
what a student sees, the clearest case being a figure replaced after students have printed
their sheets.

Every stamp is appended to `finalizeHistory` and never overwritten. The lock does not
prevent a change after issue; it makes the change visible.

**It is a guard against accident, not a security control.** An instructor who deletes the
finalized line from the `.md` has turned it off on purpose, and that is acceptable.

## 8. Points

**The instructor sets the points. The app does not change an authored point value without
being asked** (ruling, Andre Knoesen, 2 November 2026). Everything in this section exists to
make that true, and this section was three sentences long until that date, which is how a
lane came to propose rescaling an instructor's marks to reach a total nobody had set.

Terms used here. The **authored total** is the sum of the point values the instructor wrote
on the parts. The **target** is `assignment.targetPoints`, the total the export is asked to
produce. A **rescale** is the act of changing authored values so they sum to the target.

**The target follows the file, not a constant.** An assignment imported from a `.md` takes
its own authored total as its target (`services/mdParserService.ts`, "THE FILE'S OWN TOTAL
IS THE TARGET"). Authored total equals target, so the export is an identity and nothing is
rescaled. Only a new, empty assignment created in the Editor has nothing to infer from, and
that one starts at `DEFAULT_TARGET_POINTS`, 100, which the author can change in the Target
box. Before 1 September 2026 an import left the target undefined and the 100 default
applied, which silently halved ENG 17 HW1, HW2 and HW3 three times, twice in the hands of
operators who already knew about it.

**No export can rescale without a decision.** Every download entry point goes through
`normalizePointsConfirmed` in `services/exportService.ts`, which takes the instructor's
answer as `approved`:

- `true` rescales and exports.
- `false` raises `RescaleDeclinedError`: nothing is written, and call sites stay quiet
  because a decision is not a failure.
- `undefined` means nobody was asked, and raises `RescaleDecisionNeededError`: nothing is
  written and the message says so. It should never reach an instructor. It exists so that a
  caller added later, which forgets to ask, stops visibly instead of changing marks.

**The question is asked in the page, never by a browser dialog** (`components/
RescaleChoice.tsx`). A browser that has begun suppressing dialogs still has `confirm`, and
it returns `false` without drawing anything, so the export looked to every layer like a
refusal the instructor had made, and the instructor saw nothing at all.

**A rescale that cannot land exactly on its target is refused, not approximated.** When
more parts carry points than there are quarter steps in the target, `planRescale` returns
its reason and the export stops.

**How a rescale works when one is asked for.** Largest-remainder apportionment, in whole
quarter steps: floor every exact share, then hand the leftover steps out one at a time to
the parts with the largest remainders. The total lands exactly on target and the error is
spread rather than concentrated. One extra rule: a part the author gave points to never
scales to zero. The method before 27 September 2026 could produce negative values, and in a
27-part assignment made a 20-point part worth the same as a 14-point one.

**Values sit on a quarter grid**, a non-negative multiple of 0.25. A quarter is a dyadic
fraction, so the arithmetic is exact in binary floating point. A value off the grid is
refused at import and never rounded to fit: `0.3` is a refusal, not a `0.25`.

**A reader assignment has no points.** Every export writes 0, prints none, and never asks
about a rescale. The kind is read from the assignment, never inferred from the points.

One implementation, `services/pointsService.ts`, used by both the editor's live display and
the export, so the two cannot disagree.

## 9. Output: the export

One download, `{stem}_INSTRUCTOR_ONLY.zip`. Verified against a real export of
EEC130A Homework 3, a generic-sheet handwritten assignment:

```
00_INSTRUCTOR_ONLY_DO_NOT_DISTRIBUTE.txt
{stem}_FOR_STUDENTS.zip          attach this to Canvas
  {stem}_OPEN_IN_APP.json          the student loads this into the Submission app
instructor/
  {stem}_grading_rubric.json       the rubrics, for the grading side
  {stem}_grader_document.html      the answer key and rubrics, for the instructor and TAs
  {stem}_authoring_backup.json     the complete assignment, rubrics included
  {stem}.md                        the authored source, rubrics included
  assignment.html, assignment.tex  see section 11
```

**The names are the control.** `INSTRUCTOR_ONLY` and `FOR_STUDENTS` say who a file is for,
where the earlier word `Export` named the operation and said nothing. The student package
is one file, deliberately: for a while the two student files sat loose at the root, which
meant an instructor building a Canvas assignment had to select two files out of an archive,
and removing that assembly is the point of the work.

**The notice is generated from the actual entry list, never hand-maintained**, and a test
asserts every name in it is really in the ZIP. A notice that drifts out of step with the
folder is worse than none, because it will be believed.

**What the rubric carries, per sub-part**, confirmed from a real export: `subsection_id`,
`region_id`, `part_id`, `problem_number`, `problem_name`, `subsection_letter`,
`subsection_name`, `display_name`, `problem_statement`, `subsection_statement`,
`max_points`, `answer_modality`, `grading_type`, `grading_prompt`, `grading_criteria`. At
the top: `assignment_id`, `course_code`, `assignment_title`, `assignment_kind`,
`input_mode`, `sheet`.

On a generic-sheet assignment the rubric's `region_id` names no region in any map: there is
one generic region and it holds whichever part the student assigned to that page.

`instructor/template.pdf`, the boxed sheet for setting up a Gradescope outline, **is
emitted only for electronic assignments**. `ASSIGNMENT_MD_SPEC.md` line 655 records the
reason it is suppressed on the handwritten path: the printed sheet is already the answer
surface, and a second boxed PDF only invites printing the wrong one. Section 13 explains
why that reason has now expired.

## 10. What the app deliberately does not do

- It does not grade, and holds no grading resource settings.
- It does not set due dates.
- It does not tell students where to submit.
- It does not keep a course-wide figure library: figures are per assignment and copied,
  never shared, so that a change made for one assignment cannot silently change another's
  printed sheet.
- It does not put the answer key in the student package. `assignment_spec.json` once
  carried grading prompts to the student's browser; `STUDENT_SPEC_FIELDS` is now a
  whitelist and tests assert what stays out.
- It makes no network call while authoring.

## 11. Code map

| Area | Files |
|---|---|
| Data model | `types.ts` |
| Pages | `pages/Dashboard.tsx`, `pages/Editor.tsx` |
| Import | `mdParserService.ts`, `mdImport.ts`, `importNotices.ts`, `importMessages.ts`, `retiredTypes.ts` |
| Export | `exportService.ts`, `authoringBackup.ts`, `gradingCriteria.ts`, `questions.ts` |
| Geometry and identity | `pageFormat.ts`, `templateLayout.ts`, `templateGenerator.ts`, `templateSelfTest.ts`, `qrPayload.ts`, `qrEncoder.ts` |
| Generic page | `genericAnswerPage.ts` |
| Figures | `figureBlocks.ts`, `figureConvert.ts`, `figureExtract.ts`, `figureGuards.ts`, `figureImport.ts`, `figureRefs.ts`, `figureText.ts` |
| Math | `mathRender.ts`, `mathDelimiters.ts`, `katexFonts.ts` |
| Workflow | `finalize.ts`, `pointsService.ts`, `inputModeService.ts`, `storageService.ts`, `cryptoService.ts` |

Four of these are shared verbatim with `GradeBridge-Student-Submission` and must not drift:
`figureBlocks.ts`, `mathDelimiters.ts`, and the math and figure contracts they carry.

**Known dead weight:** `instructor/assignment.html` and `instructor/assignment.tex` are
still written on the generic path and nothing reads them. Recorded as an open item in
`claude/Importer_1A_Amendment_2026-09-25.md`.

## 12. Recent commits, 20 October 2026

**Corrected the same day.** This section first said three files were uncommitted in the
working tree. By the time it was written two of them had already been committed, by a
concurrent session, and the third was committed shortly after. More than one session works
in this repository, so a reading of the working tree goes stale quickly.

Three commits since `6fc6c3e`, all pushed:

- **`8ad4611`**, the printed sentence on the generic answer page. "One part per page."
  becomes "Start each problem on a new page.", following the ruling of 12 October 2026,
  so the sheet stops contradicting the submission instructions. The line
  stays one line, at 9 pt rather than 10 pt so it fits, because a second line would push
  the box down and move `5F0B10BC`. **The layout id is unchanged, so sheets printed before
  and after this change are interchangeable** and nothing in the pipeline breaks. With the
  matching test change.
- **`8d6f5bb`**, pinning the CI runner image to `ubuntu-24.04` rather than `ubuntu-latest`,
  which starts meaning Ubuntu 26 on 19 October 2026.
- **`2294a3d`**, three test suites that assumed a printed sheet. `templateTests.mjs`,
  `figure-extract-tests.mjs` and `figure-swap-e2e-tests.mjs` asserted a region count, a layout
  id, or an inlined figure for the live ENG17 homework, which has since moved to the generic
  answer page where none of those exist. **They failed on any machine holding the course folder
  and skipped on CI, which has neither the folder nor the failure**, so a green CI run said
  nothing about the red gate in front of whoever was pushing. Each check now reads the file's own
  `**Sheet:**` declaration and asserts what is true of that kind of assignment: that
  `generateTemplate` refuses it, that its rubric still carries one entry per part, that the
  student spec does not move when figures are extracted, and, on the figure swap, that a
  generic-sheet student receives no question text at all and therefore no drawing. The
  printed-sheet expectations stay exact for any homework still on one.

**Deployed 20 October 2026**, the first build since 27 September. `predeploy` runs
`scripts/check-ci-green.mjs`, so the gate confirmed CI was green before it built.

**The posted answer page was already correct, which is worth recording because this document
said otherwise.** The copy students print,
`generic_answer_template_page_FINAL_TWO_SIDES_2026-10-12.pdf`, was generated on 12 October from
a local build carrying the change, and at 200 dpi it is pixel-identical on both sides to the page
today's deployed app exports. Its QR decodes to `GB1-GBGEN1-HWMSTR-1-1-5F0B10BC`, so the layout
is unchanged and a sheet printed earlier still registers. No reprint was needed.

**Local `main` now tracks `origin/main`.** The missing upstream, left from the history rewrite of
27 September 2026 which also left the `backup-before-rewrite-2026-09-27` branch, was set when the
two answer-page commits were pushed.

## 13. Gaps against the assignment route of 19 October 2026

`ROUTE_ASSIGNMENTS_P3P2_2026-10-19.md` step 1 and work item W2 require three things this
app does not produce. They are the same arithmetic three times, so one generator should
emit all three and they cannot then disagree.

1. **Withdrawn 1 November 2026** (Ruling 42, Andre Knoesen, 1 November 2026): was "a page allotment per sub-part, set by the
   instructor". Every part has two pages, always; the instructor does not set it and the
   export carries no `allotment` field. Nothing to build.
   There is no field for it: `answerLines` is a count of writing lines on the app-printed
   sheet and is a different quantity for a different purpose, and it does not apply on the
   generic path at all.
2. **A published slot layout** under the assignment identifier, which both the Submission
   app and the relay read. W2's done-when names both readers.
3. **A blank answer-page template PDF**, of exactly 1 + 2 x (number of parts) pages, which Gradescope
   aligns every submission to. This is the file whose absence blocks the route, and it is
   not the generic answer page: students write on the generic page, while Gradescope aligns
   to the assembled answer pages, which have different geometry.
4. **A Gradescope setup sheet** a person can work from alone, which is also the right home
   for the Canvas assignment settings the route needs and nothing currently states: File
   Upload, an allowed extension of `zip`, and resubmission open until the deadline.

**The suppression of `template.pdf` on the handwritten path (section 9) was right and is
now wrong.** It was argued on the ground that a second boxed PDF had no reader. Under this
route it has one: Gradescope. When the answer-page template is added, correct that line in
`ASSIGNMENT_MD_SPEC.md` rather than quietly reversing it, and decide whether the new file
takes the same name or a different one so nobody confuses it with the electronic template.

## 14. Method

Every statement above was read from the code or from a real export in the working tree on
20 October 2026, not from the earlier specifications, because two of those describe flows
the app no longer has. Where a claim rests on a document rather than on code, the document
is named. Nothing here was verified by running the app.
