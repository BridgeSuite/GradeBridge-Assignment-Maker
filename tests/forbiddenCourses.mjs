// =====================================================
// Course codes that must not name a test fixture
// =====================================================
// Split out of `tests/forbiddenNames.mjs` on 2026-09-03 by the local-traces
// work order, which requires that file to be BYTE-IDENTICAL to the Student
// Submission repository's copy so the two cannot drift apart on the same rule.
// This guard has no counterpart there — that repository has no assignment
// fixtures — so keeping it in the shared file would have made byte-identity
// impossible. Deleting it was the other way to get there, and it is not an
// option: it is a guard, added the same day, and it is still needed.
//
// Everything below is the block as it stood, moved and not rewritten. Its own
// hash function is the reason it cannot simply join the name list: see the
// comment on `hashCourseCode`.
//
// Added 2026-09-03 by the landing-page work order. Same class of problem as the
// forbidden names in `tests/forbiddenNames.mjs`, and hashed for the same reason.
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

import { createHash } from 'node:crypto';

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
