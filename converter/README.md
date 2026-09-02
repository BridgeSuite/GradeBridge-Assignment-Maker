# converter/ — the Python reference implementation

`convert.py` turns a GradeBridge assignment `.md` file into `assignment_spec.json`:

```bash
python converter/convert.py path/to/EEC1_Lab7_InLab.md
# → path/to/EEC1_Lab7_InLab_spec.json
```

It takes a file path and runs from any directory, so course `.md` files can stay
where they live (e.g. `../CCAssignmentMaker/EEC1/Lab7/`). Standard library only —
no dependencies, no virtualenv.

It is the **local alternative** to the Dashboard's *Import Markdown* button, and
the **reference implementation** that `services/mdParserService.ts` is a browser
port of.

## Keep the two in lockstep

`convert.py` and `services/mdParserService.ts` parse the same format and must agree.
Any change to the markdown vocabulary — a new type tag, a new metadata line, a new
suffix — belongs in **both**, plus the tag table in `../ASSIGNMENT_MD_SPEC.md`, which
is the format's authoritative description and what CC sessions generate from.
*(The path here used to point at `../../CCAssignmentMaker/ASSIGNMENT_MD_SPEC.md`,
which does not exist. Corrected 2026-09-02.)*

### What the two agree on, checked 2026-09-02

**Description normalisation is identical in both**, which matters to any workflow that
generates `.md` and diffs it against what the Maker exports. Both build a description by
splitting the figure blocks out first, keeping them verbatim, filtering the prose between
them line by line, trimming each surviving run, and joining the runs with a blank line —
`build_description` in `convert.py` and `buildDescription` in `mdParserService.ts`, the
same expression on both sides. The consequences are the same in both:

- a blank line **inside** a description is dropped, and the surviving lines are joined
  with single newlines;
- a line starting with `>` is removed from a sub-part description (it is a grading block);
- a line starting with `#` is removed from a **problem** description and kept literally in
  a **sub-part** description.

All three are documented in `../ASSIGNMENT_MD_SPEC.md` §4. Nothing about them changed on
2026-09-02; the spec caught up with the code, and the code was not touched.

They live in the same repo (since 2026-08-11) precisely so that a change to one is
an obvious prompt to change the other. Before this they were in separate folders and
only one was version-controlled.

## Coverage

The TS port is covered by `npm test`. `convert.py` has no automated tests; when you
change it, run it against a real assignment and diff the resulting `_spec.json`
against what *Import Markdown* produces for the same file.
