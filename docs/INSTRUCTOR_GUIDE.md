# Using the Assignment Maker

This is the whole guide. It opens from the **Help** button on every page, and it
works with the network off.

---

## Getting started

There are three ways to begin, and all three end up in the same place: an
assignment in this app, which you then export.

**Start from scratch.** *New Assignment* on the dashboard. Type the course code
and title, answer the two questions in *Getting started* below, and add your
problems.

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

- **Handwritten**: students print the sheet, write on it, and photograph the
  pages.
- **Electronic**: students type their answers and upload images.

An assignment is exactly one of each, never a mixture. **A reader assignment must
be handwritten** — there is nothing to read back unless students write on paper —
so *Reader* is unavailable until you choose *Handwritten*.

---

## Who decides the grades

**A person decides every grade. Nothing in this system awards a mark on its own.**

For a written or handwritten answer, the grading side produces a transcript of
what the student wrote, and a suggested score. **The suggested score is shown to
the teaching assistant only if they choose to see it.** They can grade from the
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

If you choose a colour image, the app tells you and offers **Convert to
greyscale**. Press it and the converted picture appears on the card so you can
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
