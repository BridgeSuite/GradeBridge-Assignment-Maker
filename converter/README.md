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
suffix — belongs in **both**, plus the tag table in
`../../CCAssignmentMaker/ASSIGNMENT_MD_SPEC.md` that CC sessions generate from.

They live in the same repo (since 2026-08-11) precisely so that a change to one is
an obvious prompt to change the other. Before this they were in separate folders and
only one was version-controlled.

## Coverage

The TS port is covered by `npm test`. `convert.py` has no automated tests; when you
change it, run it against a real assignment and diff the resulting `_spec.json`
against what *Import Markdown* produces for the same file.
