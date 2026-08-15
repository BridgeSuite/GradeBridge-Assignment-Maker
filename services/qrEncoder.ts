/**
 * qrEncoder.ts — the pinned QR symbol.
 *
 * Spec 2.3 adopts alphanumeric mode, version pinned to 4, level H. The spec was
 * written against LaTeX's `qrcode` package, which selects mode automatically and
 * offers no way to force it, which is why 8.7 check 6 exists at all. This app
 * renders in the browser with `qrcode-generator`, where both are explicit
 * arguments — `qrcode(4, 'H')` and `addData(payload, 'Alphanumeric')` — so the
 * mode cannot silently fall back to byte and cost a third of the module size.
 *
 * The self-test still decodes the rendered symbol and asserts what came back
 * (see tests/templateSelfTest), because "we asked for it" and "it is in there"
 * are different claims.
 */

import qrcode from 'qrcode-generator';
import { QR_ECC, QR_MODULES, QR_VERSION } from './pageFormat';

export interface QrMatrix {
  /** 33 for version 4. */
  moduleCount: number;
  /** `dark[row][col]`. Excludes the quiet zone. */
  dark: boolean[][];
  version: number;
  mode: 'alphanumeric';
  ecc: string;
}

/**
 * Build the module matrix for a payload. Throws rather than emitting a symbol
 * that is not what the format promises — a wrong module count means the pinned
 * version did not take, and every downstream px/module figure is wrong.
 */
export const encodeQr = (payload: string): QrMatrix => {
  const qr = qrcode(QR_VERSION, QR_ECC as 'H');
  // Explicit mode. Never let the library choose.
  qr.addData(payload, 'Alphanumeric');
  qr.make();

  const moduleCount = qr.getModuleCount();
  if (moduleCount !== QR_MODULES) {
    throw new Error(
      `QR version pinning failed: got ${moduleCount} modules, expected ${QR_MODULES} for version ${QR_VERSION}.`
    );
  }

  const dark: boolean[][] = [];
  for (let row = 0; row < moduleCount; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < moduleCount; col++) line.push(qr.isDark(row, col));
    dark.push(line);
  }

  return { moduleCount, dark, version: QR_VERSION, mode: 'alphanumeric', ecc: QR_ECC };
};
