/**
 * pointsService.ts — scaling sub-part points to an assignment total.
 *
 * One implementation, imported by both the editor's live display and the export
 * path. They used to hold separate copies of the same arithmetic, which is a
 * standing invitation for the number on screen to disagree with the number in
 * the exported rubric.
 *
 * ## The bug this replaced
 *
 * The old version rounded every part, then dumped the entire rounding remainder
 * onto whichever part happened to be largest:
 *
 *     scaled[maxIdx] += diff;   // diff = target - sum(scaled)
 *
 * With few parts that is invisible. With many small ones it is not: a 47-part
 * assignment totalling 200 rounds up to 110, so `diff` is −10, and the largest
 * scaled part is only 4 — leaving it worth **−6**. That reached the exported
 * grading rubric and the student spec; the QR template's self-test was simply
 * the first thing that ever checked and refused to emit.
 *
 * Even when it stayed positive it distorted: in a 27-part assignment a 20-point
 * part came out worth 7, the same as a 14-point one, because it was the largest
 * and absorbed a −3.
 *
 * ## What it does instead
 *
 * Largest-remainder apportionment — the standard method for splitting a fixed
 * total into whole units (since 2026-09-27 the unit is a quarter point; see
 * "POINTS ARE QUARTER STEPS" below). Floor every exact share, then hand out the leftover
 * units one at a time to the parts with the largest fractional remainders. The
 * total lands exactly on target, the error is spread a single point at a time
 * rather than concentrated, and nothing can go negative.
 *
 * One extra rule on top: **a part the author gave points to never scales to
 * zero.** A 1-point part in a 400-point assignment would otherwise round to
 * nothing, and a graded region worth zero is not a thing.
 *
 * ## A reader assignment has no points (2026-09-23)
 *
 * A reader assignment is practice: the student gets a reading back, no grade is
 * set, nothing enters the course record. Points on it are meaningless, so every
 * export writes them as 0, prints none, and never asks about a rescale. The kind
 * is read from the assignment itself, never inferred from the points — an
 * all-zero conventional assignment is still refused by the template self-test.
 */

import type { Assignment } from '../types';

/**
 * True when the assignment's points mean something: every kind except reader.
 * An assignment that predates `assignmentKind` is conventional, as everywhere.
 */
export const pointsAreMarked = (assignment: Pick<Assignment, 'assignmentKind'>): boolean =>
  assignment.assignmentKind !== 'reader';

// =====================================================
// POINTS ARE QUARTER STEPS (2026-09-27)
// =====================================================
// A points value is a non-negative multiple of 0.25: 1, 0.5, 2.5, 7.75.
//
// Before this it was whole numbers only, and the field said nothing about it:
// typing `0.5` stored 0, and EEC130A HW1 (four problems at 2.5, totalling 10)
// could not be represented at all. Quarter steps cover every scheme a course
// has asked for: half marks, 2.5 a problem, a 7.5-point set.
//
// WHY QUARTERS AND NOT "ANY DECIMAL". A quarter is a dyadic fraction, so every
// value on this grid, and every sum of them below 2^50, is represented EXACTLY
// in binary floating point. `0.25 + 0.5` is 0.75 with no residue, where
// `0.1 + 0.2` is 0.30000000000000004. Restricting the grid is what guarantees
// that no total, rubric, sheet or export can print a value like that: the grid
// is the precision guarantee, not a rounding step applied afterwards. Anything
// off the grid is REFUSED where it enters (the field, an imported .md, an
// imported JSON), never rounded silently.

/** The smallest points increment. Every points value is a multiple of it. */
export const POINT_STEP = 0.25;

/** Steps per point. Arithmetic that must be exact is done in these units. */
const STEPS_PER_POINT = 4;

/** What is accepted, in words, for every refusal message. */
export const POINTS_ACCEPTED =
  'Points must be zero or more, in steps of 0.25 (for example 1, 0.5, 2.5 or 0.75).';

/** True for a finite, non-negative multiple of POINT_STEP. */
export const isValidPoints = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 && Number.isInteger(n * STEPS_PER_POINT);

/**
 * Parse what an author typed into a points field. Returns the number when it
 * is on the grid, or null when it is not; the caller then shows the field in
 * error and stores NOTHING. It never rounds: `0.3` is refused, not made 0.25.
 * An empty field reads as 0, which is what a new part starts at.
 */
export const parsePoints = (text: string): number | null => {
  const t = text.trim();
  if (t === '') return 0;
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return isValidPoints(n) ? n : null;
};

/**
 * One line per part whose points are off the grid, or [] when all are on it.
 * For imports: a file carrying `0.3` or `-2` is refused with the part named,
 * rather than loaded with a value the field could never have produced.
 */
export const pointsGridProblems = (assignment: Pick<Assignment, 'problems'>): string[] =>
  (assignment.problems || []).flatMap((p, i) => (p.subsections || [])
    .filter(s => !isValidPoints(s.points))
    .map(s => `Problem ${i + 1}${p.name ? ` (${p.name})` : ''}, part "${s.name || '(unnamed)'}" `
      + `has ${JSON.stringify(s.points)} points. ${POINTS_ACCEPTED}`));

/** Sum of points, exact on the grid: summed in whole steps, so no residue can form. */
export const sumPoints = (points: number[]): number =>
  points.reduce((a, b) => a + Math.round((Number.isFinite(b) ? b : 0) * STEPS_PER_POINT), 0) / STEPS_PER_POINT;

/**
 * Scale `points` so they sum to `target`, in steps of POINT_STEP.
 *
 * The arithmetic is done in whole steps (quarters) and converted back only at
 * the end, so every result is exactly on the grid. When the exact scaled share
 * of every part is already on the grid (4/2/4 to a total of 10 gives 1/0.5/1)
 * the relative weighting is preserved exactly. Otherwise largest-remainder
 * apportionment spreads the rounding a quarter at a time.
 *
 * Returns a new array. Unchanged when the points already sum to the target,
 * when the total is zero, or when the target is not a positive grid value.
 * Idempotent: apportioning an already-apportioned list is a no-op.
 *
 * It can MISS the target: when there are more graded parts than quarter steps
 * in the target, no part may be zeroed, so the total overshoots. Anything that
 * changes marks goes through `planRescale`, which refuses in that case rather
 * than landing somewhere else.
 */
export const apportionPoints = (points: number[], target: number): number[] => {
  if (!points.length || !isValidPoints(target) || target <= 0) return [...points];
  const units = points.map(p => Math.round(p * STEPS_PER_POINT));
  const targetUnits = Math.round(target * STEPS_PER_POINT);
  const total = units.reduce((a, b) => a + b, 0);
  if (total <= 0 || total === targetUnits) return [...points];
  return apportionUnits(units, targetUnits).map(u => u / STEPS_PER_POINT);
};

/** Largest-remainder apportionment of whole units. */
const apportionUnits = (points: number[], target: number): number[] => {
  const total = points.reduce((a, b) => a + b, 0);
  const exact = points.map(p => (p * target) / total);
  const out = exact.map(v => Math.max(0, Math.floor(v)));

  // A part worth something stays worth something.
  points.forEach((p, i) => { if (p > 0 && out[i] === 0) out[i] = 1; });

  // Largest fractional remainder first; ties to the bigger part, then to the
  // earlier one, so the result is deterministic — it is hashed into the QR.
  const byRemainder = exact
    .map((_, i) => i)
    .sort((a, b) => (exact[b] % 1) - (exact[a] % 1) || exact[b] - exact[a] || a - b);

  let diff = target - out.reduce((a, b) => a + b, 0);

  // Hand out the leftover units, one at a time, in remainder order.
  for (let k = 0; diff > 0; k++) { out[byRemainder[k % byRemainder.length]] += 1; diff--; }

  // Or reclaim them — smallest remainder first, never taking a part below 1.
  // Only reachable when the "never zero" floor pushed the sum over target.
  while (diff < 0) {
    let reclaimed = false;
    for (let k = byRemainder.length - 1; k >= 0 && diff < 0; k--) {
      const i = byRemainder[k];
      const floorAt = points[i] > 0 ? 1 : 0;
      if (out[i] > floorAt) { out[i] -= 1; diff++; reclaimed = true; }
    }
    // Nothing left to reclaim: more graded parts than units to go round.
    // `planRescale` refuses this case; silently zeroing parts would be worse.
    if (!reclaimed) break;
  }

  return out;
};

/** The outcome of a rescale, decided BEFORE anything changes. */
export type RescalePlan =
  | { ok: true; before: number[]; after: number[]; total: number; exact: boolean }
  | { ok: false; reason: string };

/**
 * What a rescale to `target` would do, or why it will not.
 *
 * A rescale either lands EXACTLY on its target or does not happen. It used to
 * land wherever the rounding left it (asked for 10, twelve parts each floored
 * to 1 gave 12) and said nothing (2026-09-27). `exact` is false when some part
 * could not keep its precise share and was rounded to the nearest quarter; the
 * caller shows that before anyone agrees to it.
 */
export const planRescale = (points: number[], target: number): RescalePlan => {
  if (!isValidPoints(target) || target <= 0) {
    return { ok: false, reason: `A target of ${target} is not a total that can be set. ${POINTS_ACCEPTED}` };
  }
  const offGrid = points.filter(p => !isValidPoints(p));
  if (offGrid.length) {
    return { ok: false, reason: `Some parts carry points off the 0.25 grid (${offGrid.join(', ')}). ${POINTS_ACCEPTED}` };
  }
  const total = sumPoints(points);
  if (total <= 0) return { ok: false, reason: 'Every part is worth 0, so there is nothing to scale.' };
  const graded = points.filter(p => p > 0).length;
  if (graded * POINT_STEP > target) {
    return { ok: false, reason: `${graded} parts carry points, and a total of ${target} cannot give each `
      + `of them at least ${POINT_STEP} without scaling a part to 0. Nothing was changed. `
      + `Choose a target of at least ${graded * POINT_STEP}.` };
  }
  const after = apportionPoints(points, target);
  const landed = sumPoints(after);
  if (landed !== target) {
    return { ok: false, reason: `Rescaling to ${target} would total ${landed}, not ${target}. Nothing was changed.` };
  }
  const exact = points.every((p, i) => after[i] * total === p * target);
  return { ok: true, before: [...points], after, total: landed, exact };
};

/** True when these points cannot be apportioned to the target without a part hitting zero. */
export const tooManyPartsForTarget = (points: number[], target: number): boolean =>
  points.filter(p => p > 0).length * POINT_STEP > target;
