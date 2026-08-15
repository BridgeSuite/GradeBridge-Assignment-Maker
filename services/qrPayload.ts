/**
 * qrPayload.ts — the page-format QR payload and the layout_id hash.
 *
 * Spec: `GradeBridge_Page_Format_v1.md` 2.1 (grammar), 2.2 (hash), 2.3 (caps).
 * Both this app and the Submission app must compute layout_id identically; the
 * consumer recomputes it over the map it loaded and refuses to crop on mismatch.
 * That hash is the only thing standing between a stale map and a page that
 * registers perfectly, crops the wrong rectangles, and raises no error anywhere.
 *
 * Naming caution: `GB1` here is the page-format tag. It is unrelated to the
 * `gb1:` / `gb2:` submission-JSON encryption prefixes.
 */

import { QR_PAYLOAD_MAX_CHARS, fmt4 } from './pageFormat';

/** QR alphanumeric charset (spec 2.1): digits, A–Z, space, and $ % * + - . / : */
export const QR_ALNUM_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export const FORMAT_TAG = 'GB1';

/**
 * Decision 2, RESOLVED in the work order: homework uses a class-wide master
 * template with no student-specific QR. The app groups a student's pages by the
 * authenticated session, so the token is not needed for grouping. It still has
 * to satisfy the 2.1 grammar (`[A-Z0-9]{6,10}`) so the payload parses into six
 * fields, so it is a fixed placeholder, identical on every homework master.
 * Nothing student-specific ever enters the QR.
 */
export const MASTER_TOKEN = 'HWMSTR';

export const PAYLOAD_RE =
  /^GB1-[A-Z0-9]{1,12}-[A-Z0-9]{6,10}-[0-9]{1,3}-[0-9]{1,3}-[0-9A-F]{8}$/;

export interface QrFields {
  assignmentId: string;
  token: string;
  k: number;
  n: number;
  layoutId: string;
}

export const buildPayload = (f: QrFields): string =>
  `${FORMAT_TAG}-${f.assignmentId}-${f.token}-${f.k}-${f.n}-${f.layoutId}`;

/** Split on `-` into exactly six fields — safe because `-` is excluded from every field. */
export const parsePayload = (payload: string): QrFields | null => {
  if (!PAYLOAD_RE.test(payload)) return null;
  const [, assignmentId, token, k, n, layoutId] = payload.split('-');
  return { assignmentId, token, k: Number(k), n: Number(n), layoutId };
};

/** Every reason a payload is not emittable. Empty means it is compliant. */
export const payloadViolations = (payload: string): string[] => {
  const bad: string[] = [];
  if (payload.length > QR_PAYLOAD_MAX_CHARS) {
    bad.push(`payload is ${payload.length} characters, over the ${QR_PAYLOAD_MAX_CHARS} hard cap`);
  }
  if (!PAYLOAD_RE.test(payload)) bad.push(`payload does not match the spec 2.1 grammar: "${payload}"`);
  const offending = [...payload].filter(c => !QR_ALNUM_CHARSET.includes(c));
  if (offending.length) {
    bad.push(`payload has characters outside the QR alphanumeric charset: ${JSON.stringify([...new Set(offending)].join(''))}`);
  }
  return bad;
};

// ---- assignment_id -------------------------------------------------------

/**
 * The QR's field 2 must be `[A-Z0-9]{1,12}` and unique across the course, but the
 * assignment_id used elsewhere in this app (`EEC1_Lab_4_In-Lab`) is longer than
 * that and carries characters the alphanumeric charset excludes. So derive one:
 * an uppercase alphanumeric stem plus four hex characters of a hash of the full
 * identity, which keeps it stable across regenerations and collision-resistant
 * between two assignments whose stems happen to collide.
 *
 * An instructor can override it (`Assignment.pageFormatId`) — the derived value
 * is only a default.
 */
export const derivePageFormatId = async (courseCode: string, title: string): Promise<string> => {
  const stem = `${courseCode}${title}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const suffix = (await sha256Hex(`${courseCode}|${title}`)).slice(0, 4).toUpperCase();
  return `${stem || 'HW'}${suffix}`.slice(0, 12);
};

export const isValidPageFormatId = (id: string): boolean => /^[A-Z0-9]{1,12}$/.test(id);

// ---- layout_id -----------------------------------------------------------

/** One row of the stored map, as the hash sees it. */
export interface HashableRegion {
  regionId: string;
  partId: string;
  pageK: number;
  x0: number; y0: number; x1: number; y1: number;
}

/**
 * Spec 2.2, verbatim: sort rows by region_id; for each row join region_id,
 * part_id, page_k and the four coordinates each formatted to exactly four
 * decimal places, with `|` separators; join rows with `\n`.
 *
 * Exported so the Submission app can be checked against the identical string.
 */
export const canonicalMapSerialization = (rows: HashableRegion[]): string =>
  [...rows]
    .sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0))
    .map(r => [r.regionId, r.partId, String(r.pageK), fmt4(r.x0), fmt4(r.y0), fmt4(r.x1), fmt4(r.y1)].join('|'))
    .join('\n');

const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
};

/** SHA-256 of the canonical serialization, first eight hex characters, uppercased. */
export const computeLayoutId = async (rows: HashableRegion[]): Promise<string> =>
  (await sha256Hex(canonicalMapSerialization(rows))).slice(0, 8).toUpperCase();
