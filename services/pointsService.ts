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
 * total into whole numbers. Floor every exact share, then hand out the leftover
 * units one at a time to the parts with the largest fractional remainders. The
 * total lands exactly on target, the error is spread a single point at a time
 * rather than concentrated, and nothing can go negative.
 *
 * One extra rule on top: **a part the author gave points to never scales to
 * zero.** A 1-point part in a 400-point assignment would otherwise round to
 * nothing, and a graded region worth zero is not a thing.
 */

/**
 * Scale `points` so they sum to `target`, in whole numbers.
 *
 * Returns a new array. Unchanged when the points already sum to the target,
 * when the total is zero, or when the target is not a positive number.
 * Idempotent: apportioning an already-apportioned list is a no-op.
 */
export const apportionPoints = (points: number[], target: number): number[] => {
  const total = points.reduce((a, b) => a + b, 0);
  if (!points.length || total <= 0 || !Number.isFinite(target) || target <= 0 || total === target) {
    return [...points];
  }

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
    // Nothing left to reclaim: there are more graded parts than points to go
    // round. The caller's self-test surfaces that; silently zeroing parts would
    // be worse than a total that misses by a few.
    if (!reclaimed) break;
  }

  return out;
};

/** True when these points cannot be apportioned to the target without a part hitting zero. */
export const tooManyPartsForTarget = (points: number[], target: number): boolean =>
  points.filter(p => p > 0).length > target;
