/**
 * pageFormat.ts — the canonical frame of the GradeBridge page format, v1.
 *
 * Transcribed from `GradeBridge2026/QR Format Page/GradeBridge_Page_Format_v1.md`
 * Appendix A. **That spec is binding and this file is a copy, not a source.**
 * Nothing here may be "tuned": the Submission app registers a photographed page
 * against these exact numbers, so a change on this side silently mis-crops every
 * answer on the other. Change the spec first.
 *
 * Coordinate system (spec 4.2): US Letter, origin TOP-LEFT, x rightward,
 * y DOWNWARD. A smaller y is higher on the page. Stored rectangles are page
 * fractions 0..1 to four decimal places.
 *
 * Naming caution (work order): the page-format QR tag `GB1` has nothing to do
 * with the submission-JSON encryption prefixes `gb1:` / `gb2:`. Same letters,
 * different namespaces.
 */

// ---- Page ----------------------------------------------------------------
export const PAGE_W_MM = 215.9;   // US Letter
export const PAGE_H_MM = 279.4;
export const CANONICAL_DPI = 300; // [OPEN] spec 11 #14
export const CANONICAL_W_PX = 2550;
export const CANONICAL_H_PX = 3300;
export const PX_PER_MM = 11.8110;

// ---- Registration marks (spec 3.1) ---------------------------------------
export const MARK_SIZE_MM = 5.0;
export const MARK_CLEAR_MM = 12.0; // clear to both nearest page edges

/** Mark centres, mm, in NW, NE, SW, SE order. */
export const MARK_CENTRES_MM: ReadonlyArray<readonly [number, number]> = [
  [14.5, 14.5], [201.4, 14.5], [14.5, 264.9], [201.4, 264.9],
];

/** Top-left corner of each 5 mm square, mm — what a renderer actually needs. */
export const MARK_ORIGINS_MM: ReadonlyArray<readonly [number, number]> =
  MARK_CENTRES_MM.map(([cx, cy]) => [cx - MARK_SIZE_MM / 2, cy - MARK_SIZE_MM / 2] as const);

// ---- QR (spec 2.3) -------------------------------------------------------
export const QR_SIZE_MM = 24.0;            // [OPEN] up from the reference 18.0
export const QR_MODE = 'alphanumeric';     // [OPEN] enforced by the 2.1 grammar
export const QR_VERSION = 4;               // [OPEN] pinned, never auto
export const QR_ECC = 'H';
export const QR_MODULES = 33;              // version 4
export const QR_MODULE_MM = 0.7273;
export const QR_QUIET_MODULES = 4;         // [OPEN]
export const QR_QUIET_MM = 2.9091;
/** Symbol rectangle, mm: x0, y0, x1, y1. Anchored 22 mm from the right edge, 9 mm from the top. */
export const QR_RECT_MM = { x0: 169.9, y0: 9.0, x1: 193.9, y1: 33.0 } as const;
/** Symbol + quiet zone + slack. No printed content, no answer region. */
export const QR_KEEPOUT_MM = { x0: 166.0, y0: 5.0, x1: 198.0, y1: 37.0 } as const;
export const QR_PAYLOAD_MAX_CHARS = 44;    // [OPEN] hard fail, never emit longer

// ---- Identity band (spec 4.5) --------------------------------------------
/**
 * The top 25 mm. The consumer masks exactly three fixtures here — the QR, the one
 * header text line, the two top marks — then scans for ink. Anything else printed
 * in this band withholds EVERY crop on the page from the model. The QR itself
 * straddles the lower edge by 8 mm (it runs to y = 33), which is expected.
 */
export const IDENTITY_BAND_MM = 25.0;
export const HEADER_TEXT_ANCHOR_MM = { x: 20.0, y: 10.0 } as const;

// ---- Regions (spec 3.3, 4.4) ---------------------------------------------
export const REGION_PAD_MM = 3.0;   // [OPEN] baked into the stored rectangle, never re-applied
export const REGION_X_MIN_MM = 12.0;
export const REGION_X_MAX_MM = 203.9;
export const REGION_Y_MIN_MM = 25.0;
export const REGION_Y_MAX_MM = 262.0;

export const RESIDUAL_MAX_MM = 1.0; // [OPEN] consumer-side, recorded for completeness

/** Corner keep-outs: 7.0 to 22.0 mm from each edge, all four corners (spec 4.4). */
export const CORNER_KEEPOUTS_MM: ReadonlyArray<{ x0: number; y0: number; x1: number; y1: number }> = [
  { x0: 7.0, y0: 7.0, x1: 22.0, y1: 22.0 },
  { x0: PAGE_W_MM - 22.0, y0: 7.0, x1: PAGE_W_MM - 7.0, y1: 22.0 },
  { x0: 7.0, y0: PAGE_H_MM - 22.0, x1: 22.0, y1: PAGE_H_MM - 7.0 },
  { x0: PAGE_W_MM - 22.0, y0: PAGE_H_MM - 22.0, x1: PAGE_W_MM - 7.0, y1: PAGE_H_MM - 7.0 },
];

// ---- Fractions -----------------------------------------------------------

export interface RectMm { x0: number; y0: number; x1: number; y1: number }
export interface RectFr { x0: number; y0: number; x1: number; y1: number }

/** Page fractions, rounded to the four decimal places the stored map uses. */
export const mmRectToFraction = (r: RectMm): RectFr => ({
  x0: round4(r.x0 / PAGE_W_MM),
  y0: round4(r.y0 / PAGE_H_MM),
  x1: round4(r.x1 / PAGE_W_MM),
  y1: round4(r.y1 / PAGE_H_MM),
});

export const fractionRectToMm = (r: RectFr): RectMm => ({
  x0: r.x0 * PAGE_W_MM, y0: r.y0 * PAGE_H_MM,
  x1: r.x1 * PAGE_W_MM, y1: r.y1 * PAGE_H_MM,
});

export const round4 = (n: number): number => Math.round(n * 10000) / 10000;
/** The map's on-disk form: exactly four decimal places, and what the hash sees. */
export const fmt4 = (n: number): string => n.toFixed(4);

const overlaps = (a: RectMm, b: { x0: number; y0: number; x1: number; y1: number }): boolean =>
  a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

export const rectsOverlap = (a: RectMm, b: RectMm): boolean => overlaps(a, b);

/**
 * Every safe-area rule in spec 4.4, applied to one declared rectangle in mm.
 * Returns the reasons it fails, empty when it is legal. The generator asserts
 * these rather than assuming them (spec 8.5).
 */
export const safeAreaViolations = (r: RectMm): string[] => {
  const bad: string[] = [];
  if (r.x0 < REGION_X_MIN_MM) bad.push(`x0 ${fmt4(r.x0)} mm is left of the ${REGION_X_MIN_MM} mm minimum`);
  if (r.x1 > REGION_X_MAX_MM) bad.push(`x1 ${fmt4(r.x1)} mm is right of the ${REGION_X_MAX_MM} mm maximum`);
  if (r.y0 < REGION_Y_MIN_MM) bad.push(`y0 ${fmt4(r.y0)} mm is inside the ${IDENTITY_BAND_MM} mm identity band`);
  if (r.y1 > REGION_Y_MAX_MM) bad.push(`y1 ${fmt4(r.y1)} mm is below the ${REGION_Y_MAX_MM} mm bottom limit`);
  if (r.x1 <= r.x0 || r.y1 <= r.y0) bad.push('rectangle is empty or inverted');
  if (overlaps(r, QR_KEEPOUT_MM)) bad.push('rectangle enters the QR keep-out (x 166–198, y 5–37 mm)');
  CORNER_KEEPOUTS_MM.forEach((k, i) => {
    if (overlaps(r, k)) bad.push(`rectangle enters registration corner keep-out ${['NW', 'NE', 'SW', 'SE'][i]}`);
  });
  return bad;
};
