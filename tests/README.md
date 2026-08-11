# coursePublicKey (gb2) tests

`npm test` runs `run-tests.mjs`. Plain Node (>= 18), no test framework: it
transpiles the source with the esbuild that ships inside Vite and runs it
against the same WebCrypto the browser uses. 30 checks:

- **`validateCoursePublicKey()`** — the fixture key reports 2048-bit; 2048 and
  4096 pass clean; an off-contract 3072-bit key warns but is not hard-blocked;
  and every rejection path returns a message that says what is actually wrong
  (private key, PKCS#1, missing END line, empty body, non-key base64, garbage).
- **`buildAssignmentSpec()`** — with no key the serialized spec is byte-for-byte
  what it was before gb2 existed; with a key it carries the exact PEM and
  nothing else changes; an unusable key or a private key aborts the export
  rather than shipping a spec students cannot submit against.
- **Cross-app** — a spec built here is handed to the Student Submission app's
  `encryptJsonGb2()`, and the fixture private key opens the result. This is the
  check that would catch the two apps drifting apart.

`exportService.ts` imports jspdf / jszip / file-saver at module scope; none are
on the `buildAssignmentSpec` path and jspdf does not load outside a browser, so
the runner stubs them.

## The fixture

Tests need `gb2_test_fixture.json` — a throwaway 2048-bit keypair plus a
known-good SPKI PEM.

It is **not committed**: it contains a private key, test-only or not, and this
repo is public. Default lookup is `../Encryption/gb2_test_fixture.json`
relative to the repo root; override with `GB2_FIXTURE`:

```bash
GB2_FIXTURE=/path/to/gb2_test_fixture.json npm test
```

Without it the suite still runs every fixture-independent check using ephemeral
keypairs and reports the rest as SKIPPED. The cross-app check additionally
needs `GradeBridge-Student-Submission` checked out alongside this repo.

**Never add a private key to this repo.** This app handles public keys only —
it neither generates keypairs nor accepts a private one.

## UI verification

The paste field itself was exercised in the running app on 2026-08-10 (Chrome,
`npm run dev`): the fixture key shows "Valid RSA public key (2048-bit) —
exported specs will carry it"; a private key, a PKCS#1 key, garbage, and a
truncated paste each show their specific error; an empty box reports the gb1
default. The key saves to localStorage, survives a reload into the editor, and
re-validates on load without needing another blur.
