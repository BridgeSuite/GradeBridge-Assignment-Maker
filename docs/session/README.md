# Session documents

The working notes a Claude Code session writes and reads: work orders, handoffs,
completion records and reports.

> **Rule (Andre, 2026-08-17): every Assignment Maker session document goes HERE,
> in `docs/session/`, never at the repo root.** Any new `WORKORDER_*`, `HANDOFF_*`,
> `COMPLETION_*`, `CORRECTION_*` or `REPORT_*` for this app is written to this
> folder. The repo root holds only the tracked contracts (`ASSIGNMENT_MD_SPEC.md`,
> `README.md`) and code.

**They are deliberately not tracked.** `.gitignore` covers `WORKORDER_*.md`,
`HANDOFF_*.md`, `COMPLETION_*.md`, `CORRECTION_*.md` and `REPORT_*.md` at any
depth, so in a fresh clone this folder holds only this file. They describe
changes rather than contracts, and they date fast — the contracts they point at
are tracked and live at the repo root:

| Tracked | What it is |
|---|---|
| `ASSIGNMENT_MD_SPEC.md` | The `.md` format the Maker imports and exports, and what every surface does with it |
| `README.md` | The app itself |
| `../../CLAUDE.md` (project root) | Cross-app context, the JSON formats, and the recent-changes log |
| `tests/README.md` | What the suite covers and why each check exists |

If a fact in a session document matters beyond the session that wrote it, it
belongs in one of those instead.
