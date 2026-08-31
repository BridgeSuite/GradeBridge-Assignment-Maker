// =====================================================
// GradeBridge Encoding Service — Assignment Maker
// =====================================================
// AES-256-GCM symmetric encryption using the Web Crypto API.
//
// PURPOSE
//   Encodes assignment_spec.json before it is distributed to students,
//   so the file cannot be casually read or edited in a text editor.
//   The same key is present in the Student Submission app (decodes on
//   load) and in the Docker autograder (decodes submission.json).
//
// FORMAT
//   gb1:<base64( iv[12 bytes] | ciphertext | gcm-tag[16 bytes] )>
//   The "gb1:" prefix makes encoded files easy to detect for backward
//   compatibility.  GCM authentication means any modification of the
//   ciphertext bytes causes decryption to fail — tamper-evident.
//
// KEY MANAGEMENT
//   The 256-bit key below is shared across:
//     • This file (Assignment Maker — encodes assignment_spec.json)
//     • GradeBridge-Student-Submission/cryptoService.ts (decodes spec, encodes submission)
//     • CCAssignmentMaker/crypto_utils.py (Docker — decodes submission)
//
//   To rotate the key: generate a new 64-char hex string, update all
//   three locations, redeploy both web apps and rebuild the Docker image.
//   Old encoded files will no longer load after rotation.
//
// SECURITY LEVEL — read this before adding a field to the spec
//   **This is tamper resistance, not confidentiality.** The key is embedded in
//   the JavaScript bundle (minified, not plain text) and duplicated by design
//   across three codebases, so a student who reverse-engineers the bundle can
//   read anything the spec carries. It stops casual editing of an assignment
//   file, which is what it was built for.
//
//   Therefore: **`assignment_spec.json` must never carry material whose
//   disclosure matters** — no grading prompt, no grader note, no answer key, no
//   reference solution, no grading-resource setting. This is enforced by
//   construction: `buildAssignmentSpec()` in `services/exportService.ts` builds
//   the spec from an explicit whitelist of the fields the Student Submission
//   app reads, and a test decrypts a real export and asserts none of that
//   material is in it.
//
//   The rule exists because it was broken. On 2026-08-31 a decrypt of a real
//   ENG17 HW1 export — done in about a minute with this app's own exported
//   `decryptJson` and nothing a student does not already have — found all 17
//   grading prompts in the student's copy, `REFERENCE:` lines and worked
//   answers included. The encryption was adequate for the payload it was
//   written for; reference solutions were added to that payload later and this
//   note was never revisited.
//
//   Rotating the key is a separate question, deliberately not coupled to this:
//   once grading material is out of the spec, deterrent-grade encoding is
//   adequate for what remains.
// =====================================================

const KEY_HEX = '4a7f3c2e9b1d8f5a0e6c4b3d9f2a7e1b5d8c3f9a2e7b4d0c6f8a3e1b5d9c2f4e';
const ENCODING_PREFIX = 'gb1:';

const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

const getCryptoKey = (): Promise<CryptoKey> => {
  const keyBytes = hexToBytes(KEY_HEX);
  // .slice() returns a typed ArrayBuffer (not ArrayBufferLike) as required by importKey
  const keyBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  return crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

const uint8ToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const base64ToUint8 = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), c => c.charCodeAt(0));

// -------------------------------------------------------
// isEncoded — detect a GradeBridge-encoded file
// -------------------------------------------------------
export const isEncoded = (s: string): boolean =>
  s.trimStart().startsWith(ENCODING_PREFIX);

// -------------------------------------------------------
// encryptJson — object → "gb1:<base64>" string
// -------------------------------------------------------
export const encryptJson = async (obj: unknown): Promise<string> => {
  const key = await getCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  // Layout: iv (12 bytes) | ciphertext+tag (n+16 bytes)
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), 12);

  return ENCODING_PREFIX + uint8ToBase64(combined);
};

// -------------------------------------------------------
// decryptJson — "gb1:<base64>" string → object
// Throws if the prefix is missing OR if authentication fails
// (i.e. the file was tampered with after encoding).
// -------------------------------------------------------
export const decryptJson = async (encoded: string): Promise<unknown> => {
  const trimmed = encoded.trim();
  if (!trimmed.startsWith(ENCODING_PREFIX)) {
    throw new Error('Not a GradeBridge encoded file (missing gb1: prefix)');
  }

  const key = await getCryptoKey();
  const combined = base64ToUint8(trimmed.slice(ENCODING_PREFIX.length));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  let decrypted: ArrayBuffer;
  try {
    decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
  } catch {
    throw new Error('Decryption failed — file may be corrupted or tampered with');
  }

  return JSON.parse(new TextDecoder().decode(decrypted));
};

// =====================================================
// COURSE PUBLIC KEY (gb2) — validation only
// =====================================================
// The instructor pastes a course *public* key (SPKI PEM) into an
// assignment.  It travels inside assignment_spec.json as
// `coursePublicKey`; the Student Submission app reads it and switches
// from gb1 (shared key) to gb2 (RSA-OAEP wrapped AES-256-GCM).
//
// This app never generates a keypair and never handles a private key —
// the institution/autograder owns key generation.  Everything below is
// validation of a pasted string; the gb1 helpers above are unchanged.
// =====================================================

const SPKI_BEGIN = '-----BEGIN PUBLIC KEY-----';
const SPKI_END = '-----END PUBLIC KEY-----';

export interface CoursePublicKeyValidation {
  ok: boolean;
  bits?: number;
  error?: string;
  warning?: string; // set when the key imports but the size is outside the 2048/4096 contract
}

// Trim surrounding whitespace and normalise line endings; the PEM body itself is left untouched.
export const normalizeCoursePublicKey = (pem: string): string =>
  (pem || '').replace(/\r\n/g, '\n').trim();

// Cheap structural check used at export time — full validation is validateCoursePublicKey().
export const looksLikeCoursePublicKey = (pem: unknown): boolean => {
  if (typeof pem !== 'string') return false;
  const text = normalizeCoursePublicKey(pem);
  if (!text || /PRIVATE KEY/i.test(text)) return false;
  return text.startsWith(SPKI_BEGIN) && text.includes(SPKI_END);
};

// -------------------------------------------------------
// validateCoursePublicKey — is this a usable RSA-OAEP public key?
// Async because it round-trips through WebCrypto importKey.
// -------------------------------------------------------
export const validateCoursePublicKey = async (pem: string): Promise<CoursePublicKeyValidation> => {
  const text = normalizeCoursePublicKey(pem);

  if (!text) {
    return { ok: false, error: 'No key pasted. Leave this empty to keep the standard (gb1) encoding.' };
  }
  if (/PRIVATE KEY/i.test(text)) {
    return { ok: false, error: 'That looks like a private key; paste the public key only.' };
  }
  if (text.includes('-----BEGIN RSA PUBLIC KEY-----')) {
    return {
      ok: false,
      error: 'That is a PKCS#1 key ("BEGIN RSA PUBLIC KEY"). Paste the SPKI form, which starts with "-----BEGIN PUBLIC KEY-----".'
    };
  }
  if (!text.startsWith(SPKI_BEGIN) || !text.includes(SPKI_END)) {
    return {
      ok: false,
      error: 'Not an SPKI public key. It must start with "-----BEGIN PUBLIC KEY-----" and end with "-----END PUBLIC KEY-----".'
    };
  }

  const body = text.slice(SPKI_BEGIN.length, text.indexOf(SPKI_END)).replace(/\s+/g, '');
  let der: Uint8Array;
  try {
    der = base64ToUint8(body);
  } catch {
    return { ok: false, error: 'The key body is not valid base64 — the paste may be truncated or corrupted.' };
  }
  if (der.byteLength === 0) {
    return { ok: false, error: 'The key body is empty — nothing between the BEGIN and END lines.' };
  }

  let key: CryptoKey;
  try {
    const derBuffer = der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer;
    key = await crypto.subtle.importKey(
      'spki',
      derBuffer,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt']
    );
  } catch {
    return {
      ok: false,
      error: 'Not a usable RSA public key — the browser could not import it. Check that the whole key was pasted, including both BEGIN and END lines.'
    };
  }

  const bits = (key.algorithm as RsaHashedKeyAlgorithm).modulusLength;
  if (bits !== 2048 && bits !== 4096) {
    return {
      ok: true,
      bits,
      warning: `This key is ${bits}-bit. The course key contract expects 2048 or 4096 — confirm with whoever issued it before using it.`
    };
  }

  return { ok: true, bits };
};
