# Using the Assignment Maker

This is the whole guide. It opens from the **Help** button on every page, and it
works with the network off.

---

## Getting started

There are three ways to begin, and all three end up in the same place: an
assignment in this app, which you then export.

**Start from scratch.** *New Assignment* on the dashboard. Type the course code
and title, answer the two questions in *Two things to choose first* below, and
add your problems.

**Import a file you already have.** *Import Markdown* takes a `.md` written in
this app's format. *Import JSON* takes a file this app exported earlier — use
the one whose name ends `_authoring_backup.json`, which is the complete copy.

**Have Claude Code write the file.** Give it your lab manual or problem sheet and
ask for an assignment `.md`; then import that. This is usually the quickest way
to get a long assignment in, and you edit it here afterwards like any other.

Whichever way you start, you can change anything afterwards. Nothing is decided
by how the assignment arrived.

---

## Two things to choose first

These decide what your students receive, so set them before you write questions.
Changing them later can convert or remove things.

**Conventional or reader.**

- **Conventional** is a graded assignment. A teaching assistant grades every
  submission.
- **Reader** is a practice assignment. Students submit handwritten work and get
  an AI reading of it back, which tells them how their writing was read. It is
  not graded and never enters the course record.

**Handwritten or electronic.**

- **Handwritten**: students write on paper and photograph the pages. The paper
  is either a sheet this app prints with your questions on it, or the generic
  answer page (see *The generic answer page* below).
- **Electronic**: students type their answers and upload images.

An assignment is exactly one of each, never a mixture.
**A reader assignment must be handwritten** — there is nothing to read back unless
students write on paper —
so *Reader* is unavailable until you choose *Handwritten*.

---

## The generic answer page

**Handwritten assignments only.** An electronic assignment is not affected. If
a file asks for the generic answer page on an electronic assignment, the setting
is dropped when the file is imported and the app tells you so; an export of an
electronic assignment that still carries it is refused.

**What it is.** One answer page, called `GBGEN1`, the same for every assignment
and every course. It has the four corner squares and the code the submission app
reads, one large ruled box, and a line at the top where the student writes the
problem, the part and the page number. It says nothing about which assignment it
belongs to.

**What changes.** Normally this app prints your questions with a box under each
part. With the generic answer page, you post your own assignment PDF, in your
own format, and students write every answer on the generic page. When they
photograph a page, the submission app asks which problem and part it answers.

**To use it**, set *How students answer* to *Handwritten*, then under
*What students write on* choose *Generic answer page*. You can switch back until
you finalize.

**Where the pages come from.** *Generic answer page* on the Assignment Dashboard
downloads the page as one PDF, not tied to any assignment. Printed copies are
available for pickup at the ECE front desk during regular office hours, so you do
not need to carry a pack to class. You can also give students the PDF itself:
they print as many pages as they need, or write on it on a tablet and print
nothing.

**What the export contains.** The file you give students holds one file, the one
they open in the submission app. It marks the assignment `sheet: "generic"`,
lists the problems and parts so the app can offer the right choices, and carries
the generic page's map. It carries **no question text**: students read the
questions from your PDF, and there is no sheet for them to print. The
`instructor` folder is the same as always, and the grading rubric keeps every
part with its points and its grading prompt.

**Reader assignments work too.** A reader assignment on the generic answer page
is worth 0 points and nothing grades it, exactly as on the printed sheet.

**Two things you must supply, for every assignment.** The app no longer
typesets your questions, but it still collects what grading needs, and these two
are not optional:

- **The worked solution**: what a correct answer contains, and where the
  reasoning sits.
- **The rubric, or the grading guidance for each part**: what a grader looks
  for, what a good answer must contain, and the mistakes worth naming.

Put them in each part's grading prompt and grader note here. They may follow the
posting of the assignment, but not by much. A grader without your rubric invents
one, and nothing will warn you that it happened.

---

## Who decides the grades

**A person decides every grade. Nothing in this system awards a mark on its own.**

For a written or handwritten answer, the grading side produces a transcript of
what the student wrote, and a suggested score.
**The suggested score is shown to the teaching assistant only if they choose to see it.**
They can grade from the
transcript alone.

For an uploaded image, nothing is produced automatically at all. A person looks
at it.

If you are asked whether this tool grades automatically, the answer is no.

---

## Figures

A figure is a drawing or photograph inside a problem. You can leave figures as
they are, or turn them into files you can swap.

**Extract figures** (in the header) turns each drawing in your assignment into a
separate file and leaves a reference in its place. Nothing your students see
changes. After that, each figure appears as a card inside its own problem, with a
small picture of it.

**To change a drawing**, press **Replace image** on that card and choose a file.
The title and description stay as they were, so nothing else about the question
changes. If you exported the assignment as a `.md`, the drawings are in a
`figures` folder beside it — replacing a file there works too, and you then
import the `.md` and the folder together.

**Two rules for an image:**

- **Black, white and grey only.** No colour.
- **Large enough to print clearly.** A small image looks fine on screen and
  prints blurry.

If you choose a colour image, the app tells you and offers
**Convert to greyscale**. Press it and the converted picture appears on the card so you can
see what you got; press **Cancel** and nothing changes. The app never converts
anything without being asked.

**Title and description.** Every figure has both, on its card. The description is
used when the drawing cannot be shown — write what a student would see if they
were looking at it. It matters more than it sounds: it is what a grader reads
when the drawing itself is not in front of them.

---

## Finalize and Reopen

**Finalize** when the assignment is ready to give out. It records exactly what
your students will receive.

After that, **anything students see is locked**: the questions, the figures, the
preamble, the points, the answer space, and whether this is conventional or
reader. If you change one of those and try to export, the app stops you and says
what changed.

**You can still edit grading prompts, grader notes and rubrics.** Students never
see those, so the lock does not cover them.

**Reopen** unlocks the assignment. It asks you to confirm, and it keeps a record
of the version you are replacing.

**Do not reopen an assignment your students already have.** They may be holding
printed pages. If you change the questions, their paper no longer matches; if you
change how much room an answer gets, they have to print it all again.

---

## What you get when you export

**Export ZIP** is the one to use. Inside it:

- **One file to give students.** Its name ends `_FOR_STUDENTS.zip`, and it sits
  on its own at the top of the archive. Attach that one file to your course page.
  It holds the sheet they print and the file they open in the submission app.
- **An `instructor` folder.** Everything in it is yours: your original `.md`, a
  complete backup, the grader document, the grading rubric, and the figures.

**The grading rubric is private.** It carries your rubrics and any answers in
them, and it goes into the autograder setup. **It never goes to students.**

**Export .md** gives you the authored source, for editing or for keeping. If your
assignment uses figure files, you get a small zip holding the `.md` and its
`figures` folder together, because one is no use without the other.

---

## What not to do

- **Do not give students anything from the `instructor` folder.** Four of the
  files in it contain answers.
- **Do not edit an exported file by hand.** Change it here and export again.
- **Do not print "fit to page".** Print at 100%. The corner marks have to be the
  right size for the pages to be read back.
- **Do not reopen a finalized assignment once students have it**, unless you are
  prepared to reissue it.
- **Do not use a colour or low-resolution image** and assume it will be fine. The
  app will stop you, but it is quicker to start with the right file.

---

## Writing mathematics

Type mathematics between dollar signs and it is typeset for you. `$x^2$` gives a
squared x. Two dollar signs, `$$...$$`, put the expression on its own line,
centred.

Common things:

| You type | You get |
|---|---|
| `$x^2$` | x squared |
| `$x_1$` | x subscript 1 |
| `$\frac{a}{b}$` | a over b |
| `$\sqrt{x}$` | square root of x |
| `$\alpha$, `$\beta$`, `$\Omega$` | Greek letters |
| `$\pm$` | plus-or-minus |
| `$\times$` | multiplication sign |
| `$\approx$` | approximately equal |
| `$10^{-3}$` | ten to the minus three |
| `$V_{\text{out}}$` | V with "out" as a subscript |

A preview appears under any box where you type mathematics, so you can see what
it will look like before you export.

If a dollar sign is meant to be a dollar sign, write `\$`.

---

## If something goes wrong

**The app stops an export and tells you why.** Read the message — it names what
is wrong and what to do. Nothing is written when an export stops.

**A figure is refused.** The message says whether it has colour in it or is too
small. Colour can be converted on the spot; a small image has to be replaced with
a larger one.

**An import tells you something was dropped.** Older files can carry settings
this app no longer has. The import keeps everything else and tells you what went.

**Your work is stored in this browser.** Export regularly. The
`_authoring_backup.json` file in the `instructor` folder is the one that restores
everything.
