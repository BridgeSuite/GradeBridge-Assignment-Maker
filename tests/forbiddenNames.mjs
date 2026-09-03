// =====================================================
// Names that must never appear in this repository
// =====================================================
// Required by the name-guard work order of 2026-09-03, issued because this
// repository is going public.
//
// THE RULE
//
//   No personal name of any living individual may appear anywhere in this
//   repository: not in a file, not in a comment, not in a test source, not in
//   a .gitignore, and not in a path.
//
//   Not students, and not colleagues either. Nobody consents to having their
//   name published in a code repository by working on it, and being asked
//   afterwards by the person who runs the project is not a free choice.
//
//   The one exception is the repository owner's own git identity, which the
//   host attaches to every commit and which is his to publish. It is
//   deliberately absent from the list below.
//
// THIS LIST IS WHAT IS FORBIDDEN, NOT WHAT IS PERMITTED.
//
//   Adding a name here is NOT how you permit a name. There is no allow list and
//   there is no exception mechanism. If the guard fires, the fix is to remove
//   the name from the file, never to remove it from this list. The next person
//   to hit this will be tempted, which is why it is written down.
//
// WHY HASHES AND NOT NAMES
//
//   The rule above forbids a personal name in a test source. A plaintext list
//   would put every name on it into a public repository, under a heading
//   announcing that these are people associated with the project, and would
//   leave this repository worse than it is today: it currently contains none.
//   So the list stores a hash of each name and the scanner hashes what it finds.
//
//   This is obfuscation, not secrecy, and it is worth being plain about that: a
//   short common given name would not survive someone determined with a
//   dictionary. It is sized for the threat that actually exists, which is an
//   accidental commit plus casual reading and search indexing of a public repo.
//   Against that it works, and the alternative publishes the names outright.
//
// HOW TO ADD A NAME
//
//   node -e "import('./tests/forbiddenNames.mjs').then(m => console.log(m.hashName('<the name>')))"
//
//   Add the printed hash below, with no comment saying whose it is. Add each
//   form separately: the guard matches whole tokens, so "sam" does not cover
//   "samuel" and a surname does not cover a given name.

import { createHash } from 'node:crypto';

/**
 * Normalise then hash. Lowercased, accents folded, and everything that is not a
 * letter dropped, so `Jean-Luc`, `jean luc` and `JeanLuc` all hash alike.
 * Truncated to 16 hex characters: 64 bits is far past collision range for a
 * list this size, and a short string keeps the list readable as a list.
 */
export const hashName = (name) => {
  const normalised = String(name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (!normalised) return '';
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
};

/** One entry per forbidden name. No comments, no ordering that carries meaning. */
export const FORBIDDEN_NAME_HASHES = new Set([
  '2f8a0c01f668bca7',
  '386a85d8c88778b0',
  '710c3906ca8b54f8',
  'd9a31550033ee07d',
  'fc053e14afa732e2',
  'fc52fabe94c0e037',
  'fdc97875a4c7d086',
]);

// =====================================================
// Course codes that must not name a test fixture
// =====================================================
// Added 2026-09-03 by the landing-page work order. Same class of problem as the
// names above, same file, same reason for hashing.
//
// Five fixtures were named for real courses. Five agents over three weeks each
// needed a realistic input, reached for the course it was working on, and named
// the file after it. No rule said not to and nothing would have caught it, which
// is why this exists: the rule and the guard, not just the five files.
//
// The content was measured and is NOT the real assignments. These are invented
// problems that were wearing a real course's name. The name was the defect.
//
// TWO THINGS THIS PROTECTS
//   A student who finds this repository must not be able to mistake a fixture
//   for their own assignment, and a colleague's course must not appear to be
//   published here.
//
// SCOPE: fixtures only. Real course codes appear legitimately elsewhere in this
// repository, including in checks that read the real course files by name and
// would break if renamed. See the completion note; widening this is a separate
// decision, not a silent one.

/**
 * Course codes carry digits, so they cannot use `hashName`, which strips
 * everything that is not a letter, which would collapse two codes sharing a
 * letter stem onto the same hash. This keeps letters and digits.
 */
export const hashCourseCode = (code) => {
  const normalised = String(code).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalised) return '';
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
};

/** One entry per forbidden course code. No comments, no meaningful ordering. */
export const FORBIDDEN_COURSE_HASHES = new Set([
  '54c3568400778b4e',
  'be958fb09e1ffd1d',
  'd27dcfa053aa6656',
]);
