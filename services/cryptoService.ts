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
// SECURITY LEVEL
//   The key is embedded in the JavaScript bundle (minified, not plain
//   text).  A determined student who reverse-engineers the bundle could
//   find it, but for academic-integrity purposes this is a strong deterrent:
//   students cannot simply open the file and edit it.
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
