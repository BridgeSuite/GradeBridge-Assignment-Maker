#!/usr/bin/env python3
"""Student-data commit guard (rule S6: no student data in any repository).

Written 31 October 2026 after a Gradescope export of EEC 1 Lab 8 was
committed and pushed on 10 September 2026 with nothing to stop it.
See workorders/WORKORDER_COMMIT_GUARD_STUDENT_DATA_2026-10-31.md.

Modes
  --staged                  check what is staged (called by pre-commit)
  --pre-push <remote>       check every commit about to be pushed; reads the
                            pre-push lines from stdin (called by pre-push)
  --scan-tree [--ref REF]   check every file in a tree (default HEAD) and
                            print counts per file and rule

Rules
  G1  email address on an added line (allowlist: email entries)
  G2  standalone nine-digit number on an added line (student and
      Gradescope submission IDs); a line containing "guard: allow" passes
  G3  Gradescope export layout in an added path
  G4  Canvas download file name, including the _LATE_ form
  G5  .csv/.tsv/.xlsx whose header row has a person-field column
  G6  added scan or image file (.pdf .png .jpg .jpeg .tif .tiff .heic)

The matched value is never printed. Messages give the file, the line (or
cell) and the rule. File paths are printed with every run of six or more
digits and every email-shaped string masked, and G3/G4 paths are cut or
masked further, because in those layouts the path itself carries the data.

Exit status: 0 clean, 1 refused, 2 the guard could not run (the hooks treat
any non-zero status as a refusal: fail closed).
"""

import fnmatch
import io
import os
import re
import subprocess
import sys
import zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
ALLOWLIST_PATH = os.path.join(HERE, "student_data_allowlist.txt")
RULES = ("G1", "G2", "G3", "G4", "G5", "G6")
RULE_TEXT = {
    "G1": "email address",
    "G2": "nine-digit student or submission ID",
    "G3": "Gradescope export layout",
    "G4": "Canvas download file name",
    "G5": "roster-shaped spreadsheet (person-field column)",
    "G6": "scan or image file",
}

# --------------------------------------------------------------------------
# Patterns
# --------------------------------------------------------------------------
EMAIL_RE = re.compile(
    r"(?<![A-Za-z0-9._%+-])"
    r"([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.([A-Za-z]{2,}))"
    r"(?![A-Za-z0-9-])"
)
# A retina asset name such as logo@2x.png has the shape of an address.
NOT_EMAIL_TLDS = {"png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp", "tif", "tiff"}

# Nine digits not inside a longer digit run or a word, and not the fraction
# of a decimal (0.123...). A trailing ".0" still counts: it is how a
# spreadsheet stores an ID it took for a number. Other decimals (...9.5) pass.
NINE_RE = re.compile(r"(?<![0-9A-Za-z.])[0-9]{9}(?![0-9A-Za-z])(?!\.0*[1-9])")
ALLOW_MARK_RE = re.compile(r"guard:\s*allow", re.IGNORECASE)

G3_EXPORT_RE = re.compile(r"assignment_[0-9]+_export", re.IGNORECASE)
G3_SUBMISSION_RE = re.compile(r"^submission_[0-9]+$", re.IGNORECASE)
G3_METADATA = "submission_metadata.yml"

# Canvas: <name>_<user id>_<file id>_<original name>, or with _LATE_ after
# the name. The file id is long; requiring six or more digits keeps
# date-stamped names such as exam_2026_10_31_draft.md out.
G4_RE = re.compile(r"^[A-Za-z][A-Za-z-]*(?:_LATE)?_[0-9]+_[0-9]{6,}_.+", re.IGNORECASE)

SPREADSHEET_EXT = (".csv", ".tsv", ".xlsx")
SCAN_EXT = (".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".heic")

PERSON_COLUMNS = {
    "name", "full name", "first name", "last name", "preferred name",
    "student", "student name", "students",
    "email", "email address", "e mail", "student email",
    "sid", "student id", "student number", "student no",
    "sis user id", "sis login id", "login", "login id", "user id",
    "username", "kerberos id", "kerberos",
}


# A column also counts when any of its words is one of these, which catches
# the forms of the Lab 8 incident itself: "Members", "Team Members",
# "Official Members", "Submitters on File", "Emails (semicolon-separated)".
# "name" alone is not here: "file name" and "problem name" are not people.
PERSON_WORDS = {
    "email", "emails", "e-mail", "member", "members", "submitter", "submitters",
    "student", "students", "sid", "sids", "login", "sis", "roster", "kerberos",
    "person", "people",
}


def normalise_column(text):
    t = text.strip().strip('"').strip("'").strip().lower()
    t = re.sub(r"\(.*?\)", " ", t)          # drop "(semicolon-separated)" and the like
    t = re.sub(r"[\s_\-./#:]+", " ", t)
    return t.strip()


def is_person_column(text):
    t = normalise_column(text)
    return t in PERSON_COLUMNS or bool(set(t.split()) & PERSON_WORDS)


# --------------------------------------------------------------------------
# Allowlist
# --------------------------------------------------------------------------
class GuardError(Exception):
    """The guard cannot run safely. The message never carries file content."""


class Allowlist:
    def __init__(self, path):
        self.emails = []
        self.paths = []  # (set of rules, glob)
        self.commits = []  # (set of rules, commit hash or prefix of 7 or more)
        if not os.path.exists(path):
            raise GuardError("allowlist %s is missing" % os.path.basename(path))
        with open(path, encoding="utf-8") as fh:
            for n, raw in enumerate(fh, 1):
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                body, sep, reason = line.partition("#")
                if not sep or not reason.strip():
                    raise GuardError("allowlist line %d has no '# reason'" % n)
                parts = body.split()
                if len(parts) == 2 and parts[0] == "email":
                    self.emails.append(parts[1].lower())
                elif len(parts) == 3 and parts[0] == "path":
                    rules = parts[1].upper()
                    rs = set(RULES) if rules == "*" else set(rules.split(","))
                    if not rs <= set(RULES):
                        raise GuardError("allowlist line %d names an unknown rule" % n)
                    self.paths.append((rs, parts[2]))
                elif len(parts) == 3 and parts[0] == "commit":
                    # A historical commit, by hash: its own findings under the
                    # named rules are allowed at pre-push. No '*': rules are
                    # named one by one.
                    rs = set(parts[1].upper().split(","))
                    if not rs <= set(RULES):
                        raise GuardError("allowlist line %d names an unknown rule" % n)
                    if not re.fullmatch(r"[0-9a-f]{7,40}", parts[2].lower()):
                        raise GuardError("allowlist line %d: a commit is 7 to 40 hex digits" % n)
                    self.commits.append((rs, parts[2].lower()))
                else:
                    raise GuardError(
                        "allowlist line %d is not 'email <address>', "
                        "'path <rules> <glob>' or 'commit <rules> <hash>'" % n)

    def email_ok(self, addr):
        a = addr.lower()
        return any(fnmatch.fnmatchcase(a, p) for p in self.emails)

    def path_ok(self, rule, path):
        return any(rule in rs and fnmatch.fnmatchcase(path, g) for rs, g in self.paths)

    def commit_ok(self, rule, commit):
        c = (commit or "").lower()
        return bool(c) and any(rule in rs and c.startswith(h) for rs, h in self.commits)


# --------------------------------------------------------------------------
# Safe printing of paths
# --------------------------------------------------------------------------
def mask_path(path, rule=None):
    p = path
    if rule == "G3":
        parts = p.split("/")
        for i, part in enumerate(parts):
            if (G3_EXPORT_RE.search(part) or G3_SUBMISSION_RE.match(part)
                    or part.lower() == G3_METADATA):
                p = "/".join(parts[: i + 1]) + ("/..." if i + 1 < len(parts) else "")
                break
    elif rule == "G4":
        head, _, base = p.rpartition("/")
        ext = os.path.splitext(base)[1]
        p = (head + "/" if head else "") + "<canvas-named file>" + ext
    p = EMAIL_RE.sub("<email>", p)
    p = re.sub(r"[0-9]{6,}", "<digits>", p)
    return p


# --------------------------------------------------------------------------
# Git helpers
# --------------------------------------------------------------------------
def git(*args, stdin=None):
    cmd = ["git", "-c", "core.quotePath=false"] + list(args)
    r = subprocess.run(cmd, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if r.returncode != 0:
        raise GuardError("git %s failed (status %d)" % (args[0], r.returncode))
    return r.stdout


def unquote_path(s):
    """Undo git's C-style quoting of a path."""
    if not (len(s) >= 2 and s[0] == '"' and s[-1] == '"'):
        return s
    s = s[1:-1]
    out = bytearray()
    i = 0
    esc = {"n": 10, "t": 9, '"': 34, "\\": 92, "a": 7, "b": 8, "f": 12, "r": 13, "v": 11}
    while i < len(s):
        c = s[i]
        if c == "\\" and i + 1 < len(s):
            nxt = s[i + 1]
            if nxt in esc:
                out.append(esc[nxt]); i += 2; continue
            if nxt in "01234567" and i + 4 <= len(s):
                out.append(int(s[i + 1:i + 4], 8)); i += 4; continue
        out.extend(c.encode("utf-8")); i += 1
    return out.decode("utf-8", "replace")


def parse_patch(data):
    """Yield (path, line_number, text) for every added line of a patch.

    Handles ordinary diffs and combined (--cc) diffs of merges; in a combined
    diff a line counts as added only when it is new against every parent.
    """
    path = None
    nparents = 1
    lineno = 0
    in_hunk = False
    for raw in data.split(b"\n"):
        line = raw.decode("utf-8", "replace").rstrip("\r")
        if line.startswith("diff --git ") or line.startswith("diff --cc ") or line.startswith("diff --combined "):
            path = None
            in_hunk = False
            nparents = 1 if line.startswith("diff --git ") else 2
            continue
        if not in_hunk and line.startswith("+++ "):
            target = line[4:]
            if target == "/dev/null":
                path = None
            else:
                target = unquote_path(target)
                path = target[2:] if target.startswith("b/") else target
            continue
        if line.startswith("@@"):
            m = re.match(r"^(@+) .*?\+([0-9]+)(?:,[0-9]+)? \1", line)
            if m:
                nparents = len(m.group(1)) - 1
                lineno = int(m.group(2))
                in_hunk = True
            continue
        if not in_hunk or path is None:
            continue
        if line.startswith("\\"):
            continue
        prefix, text = line[:nparents], line[nparents:]
        if len(prefix) < nparents:
            continue
        if "-" in prefix:
            continue  # a removed line: not in the result
        if prefix == "+" * nparents:
            yield path, lineno, text
        lineno += 1


# --------------------------------------------------------------------------
# Rule checks
# --------------------------------------------------------------------------
class Findings:
    def __init__(self, allow, apply_path_allow=True):
        self.allow = allow
        self.apply_path_allow = apply_path_allow
        self.items = []  # (rule, path, where)
        self.commit = None  # the commit being checked at pre-push, else None

    def add(self, rule, path, where):
        if self.apply_path_allow and self.allow.path_ok(rule, path):
            return
        if self.allow.commit_ok(rule, self.commit):
            return
        self.items.append((rule, path, where))


def check_line(f, path, where, text):
    for m in EMAIL_RE.finditer(text):
        addr, tld = m.group(1), m.group(2).lower()
        if tld in NOT_EMAIL_TLDS:
            continue
        if f.allow.email_ok(addr):
            continue
        f.add("G1", path, where)
        break
    if not ALLOW_MARK_RE.search(text) and NINE_RE.search(text):
        f.add("G2", path, where)


def check_path(f, path):
    parts = path.split("/")
    base = parts[-1]
    if (G3_EXPORT_RE.search(path) or any(G3_SUBMISSION_RE.match(p) for p in parts[:-1])
            or base.lower() == G3_METADATA):
        f.add("G3", path, "path")
    if G4_RE.match(base):
        f.add("G4", path, "path")
    if base.lower().endswith(SCAN_EXT):
        f.add("G6", path, "path")


def xlsx_rows(blob):
    """Yield (sheet_name, cell_ref, row_index, text) for every cell; raise on damage."""
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.iter(ns + "si"):
                shared.append("".join(t.text or "" for t in si.iter(ns + "t")))
        sheets = sorted(n for n in z.namelist()
                        if n.startswith("xl/worksheets/") and n.endswith(".xml"))
        for name in sheets:
            root = ET.fromstring(z.read(name))
            short = os.path.splitext(os.path.basename(name))[0]
            for ri, row in enumerate(root.iter(ns + "row")):
                for c in row.iter(ns + "c"):
                    t = c.get("t")
                    ref = c.get("r", "?")
                    if t == "s":
                        v = c.find(ns + "v")
                        text = shared[int(v.text)] if v is not None and v.text else ""
                    elif t == "inlineStr":
                        text = "".join(x.text or "" for x in c.iter(ns + "t"))
                    else:
                        v = c.find(ns + "v")
                        text = v.text if v is not None and v.text else ""
                    yield short, ref, ri, text


def check_spreadsheet(f, path, blob):
    low = path.lower()
    if low.endswith(".xlsx"):
        try:
            cells = list(xlsx_rows(blob))
        except Exception:
            f.add("G5", path, "unreadable spreadsheet")
            return
        headers = {}
        for sheet, ref, ri, text in cells:
            if ri == 0:
                headers.setdefault(sheet, []).append((ref, text))
            # A numeric ID in a cell may be stored with a trailing ".0".
            t = re.sub(r"^([0-9]{9})\.0+$", r"\1", text.strip())
            check_line(f, path, "cell %s!%s" % (sheet, ref), t)
        for sheet, cols in headers.items():
            for ref, text in cols:
                if is_person_column(text):
                    f.add("G5", path, "header cell %s!%s" % (sheet, ref))
                    break
        return
    text = blob.decode("utf-8-sig", "replace")
    first = ""
    for ln in text.splitlines():
        if ln.strip():
            first = ln
            break
    if not first:
        return
    sep = "\t" if low.endswith(".tsv") else ","
    if sep == "," and first.count(";") > first.count(","):
        sep = ";"
    for col in first.split(sep):
        if is_person_column(col):
            f.add("G5", path, "header row")
            break


def is_binary(blob):
    return b"\0" in blob[:8000]


# --------------------------------------------------------------------------
# Modes
# --------------------------------------------------------------------------
def check_changes(f, added_paths, patch, read_blob):
    """added_paths: paths added, copied, renamed in or modified.
    patch: unified diff bytes. read_blob(path) -> bytes."""
    for path in added_paths:
        check_path(f, path)
        if path.lower().endswith(SPREADSHEET_EXT):
            check_spreadsheet(f, path, read_blob(path))
    for path, lineno, text in parse_patch(patch):
        if path.lower().endswith(".xlsx"):
            continue
        check_line(f, path, "line %d" % lineno, text)


def name_status(data):
    """Parse `--name-status -z` output into a list of (status, path)."""
    items = data.split(b"\0")
    out = []
    i = 0
    while i < len(items):
        st = items[i].decode("utf-8", "replace")
        if not st:
            i += 1
            continue
        if st[0] in "RC":
            out.append((st[0], items[i + 2].decode("utf-8", "replace")))
            i += 3
        else:
            out.append((st[0], items[i + 1].decode("utf-8", "replace")))
            i += 2
    return out


DIFF_OPTS = ["-M", "--no-color", "--no-ext-diff", "--no-textconv", "-U0"]


def run_staged(f):
    ns = name_status(git("diff", "--cached", "--name-status", "-z", "-M"))
    paths = [p for s, p in ns if s in "ACRM"]
    patch = git("diff", "--cached", *DIFF_OPTS)
    check_changes(f, paths, patch, lambda p: git("cat-file", "blob", ":" + p))


def commit_parents(c):
    line = git("rev-list", "--parents", "-n", "1", c).decode().split()
    return line[1:]


def run_commit(f, c):
    parents = commit_parents(c)
    blob = lambda p: git("cat-file", "blob", "%s:%s" % (c, p))
    if len(parents) <= 1:
        ns = name_status(git("diff-tree", "-r", "--root", "--no-commit-id",
                             "--name-status", "-z", "-M", c))
        paths = [p for s, p in ns if s in "ACRM"]
        patch = git("diff-tree", "-r", "--root", "--no-commit-id", "-p", *DIFF_OPTS, c)
    else:
        # A merge: a path counts as added only when it is new against every
        # parent; its content is checked through the combined diff.
        sets = []
        for p in parents:
            ns = name_status(git("diff-tree", "-r", "--name-status", "-z",
                                 "--diff-filter=AM", p, c))
            sets.append({path for _, path in ns})
        paths = sorted(set.intersection(*sets)) if sets else []
        patch = git("diff-tree", "-r", "--no-commit-id", "--cc", "--no-color",
                    "--no-ext-diff", "--no-textconv", "-U0", c)
    before = len(f.items)
    f.commit = c
    try:
        check_changes(f, paths, patch, blob)
    finally:
        f.commit = None
    return len(f.items) - before


ZERO = re.compile(r"^0+$")


def run_pre_push(f, remote, stdin_text):
    commits = []
    seen = set()
    for line in stdin_text.splitlines():
        parts = line.split()
        if len(parts) != 4:
            continue
        local_ref, local_sha, remote_ref, remote_sha = parts
        if ZERO.match(local_sha):
            continue  # a branch deletion
        args = ["rev-list", "--reverse", "--topo-order", local_sha, "--not",
                "--remotes=%s" % remote]
        if not ZERO.match(remote_sha):
            r = subprocess.run(["git", "cat-file", "-e", remote_sha + "^{commit}"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if r.returncode == 0:
                args.append(remote_sha)
        for c in git(*args).decode().split():
            if c not in seen:
                seen.add(c)
                commits.append(c)
    per_commit = {}
    for c in commits:
        n = run_commit(f, c)
        if n:
            per_commit[c] = n
    return commits, per_commit


def run_scan_tree(allow, ref):
    listing = git("ls-tree", "-r", "-z", "--full-tree", ref)
    entries = []
    for item in listing.split(b"\0"):
        if not item:
            continue
        meta, _, path = item.partition(b"\t")
        mode, typ, sha = meta.decode().split()
        if typ == "blob":
            entries.append((sha, path.decode("utf-8", "replace")))
    counts = {}  # (path, rule) -> n
    allowed = {}  # rule -> n
    batch = subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE,
                             stdout=subprocess.PIPE)
    try:
        for sha, path in entries:
            batch.stdin.write((sha + "\n").encode())
            batch.stdin.flush()
            header = batch.stdout.readline().split()
            size = int(header[2])
            blob = batch.stdout.read(size)
            batch.stdout.read(1)
            # Count everything, then split out what the path allowlist covers.
            f = Findings(allow, apply_path_allow=False)
            check_path(f, path)
            if path.lower().endswith(SPREADSHEET_EXT):
                check_spreadsheet(f, path, blob)
            if not path.lower().endswith(".xlsx") and not is_binary(blob):
                for n, ln in enumerate(blob.decode("utf-8", "replace").splitlines(), 1):
                    check_line(f, path, "line %d" % n, ln)
            for rule, p, where in f.items:
                if allow.path_ok(rule, p):
                    allowed[rule] = allowed.get(rule, 0) + 1
                else:
                    counts[(p, rule)] = counts.get((p, rule), 0) + 1
    finally:
        batch.stdin.close()
        batch.wait()
    return len(entries), counts, allowed


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------
def report_refusals(f, stage):
    for rule, path, where in f.items:
        print("REFUSED %s: %s %s: %s" % (rule, mask_path(path, rule), where, RULE_TEXT[rule]),
              file=sys.stderr)
    print("", file=sys.stderr)
    print("%s refused by the student-data guard (rule S6): %d finding(s)."
          % (stage, len(f.items)), file=sys.stderr)
    print("Values are never printed. If a finding is not student data, add a",
          file=sys.stderr)
    print("reviewed entry with its reason to .githooks/student_data_allowlist.txt,",
          file=sys.stderr)
    print("or mark a line 'guard: allow' (G2 only).", file=sys.stderr)


def main(argv):
    if "--scan-tree" in argv:
        ref = "HEAD"
        if "--ref" in argv:
            ref = argv[argv.index("--ref") + 1]
        allow = Allowlist(ALLOWLIST_PATH)
        nfiles, counts, allowed = run_scan_tree(allow, ref)
        print("scan-tree %s: %d files checked" % (mask_path(ref), nfiles))
        totals = {r: 0 for r in RULES}
        files = {r: set() for r in RULES}
        for (p, rule), n in sorted(counts.items()):
            print("  %s  %s  %d" % (rule, mask_path(p, rule), n))
            totals[rule] += n
            files[rule].add(p)
        print("totals (hits / files):  " + "  ".join(
            "%s %d/%d" % (r, totals[r], len(files[r])) for r in RULES))
        print("allowlisted hits:       " + "  ".join(
            "%s %d" % (r, allowed.get(r, 0)) for r in RULES))
        return 1 if counts else 0

    allow = Allowlist(ALLOWLIST_PATH)
    f = Findings(allow)
    if "--staged" in argv:
        run_staged(f)
        if f.items:
            report_refusals(f, "Commit")
            return 1
        return 0
    if "--pre-push" in argv:
        remote = argv[argv.index("--pre-push") + 1]
        commits, per_commit = run_pre_push(f, remote, sys.stdin.read())
        if f.items:
            for c, n in per_commit.items():
                print("commit %s: %d finding(s)" % (c[:10], n), file=sys.stderr)
            report_refusals(f, "Push")
            return 1
        print("student-data guard: %d commit(s) checked, clean." % len(commits), file=sys.stderr)
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except GuardError as e:
        print("student-data guard could not run: %s" % e, file=sys.stderr)
        sys.exit(2)
    except Exception as e:  # fail closed, and never echo content
        print("student-data guard failed (%s); refusing to be safe." % type(e).__name__,
              file=sys.stderr)
        sys.exit(2)
