// =====================================================
// Third-party notices: generated, complete, or the build stops
// =====================================================
// WORKORDER_ATTRIBUTION_AND_THIRD_PARTY_NOTICES_2026-09-27, items 1, 2 and 4.
// The generator (scripts/thirdPartyNotices.mjs) is exercised on a fabricated
// node_modules tree, so each refusal is proved without touching the real one.
// `bundle-tests.mjs` checks what a real build emits.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectNotices, noticesText, packageDirOf } from '../scripts/thirdPartyNotices.mjs';
import { suiteExit } from './suiteExit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

let passed = 0, failed = 0;
const results = [];
const check = (name, fn) => {
  try { fn(); passed++; results.push(`  PASS  ${name}`); }
  catch (err) { failed++; results.push(`  FAIL  ${name}\n          ${err.message}`); }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEqual = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n          expected: ${y}\n          actual:   ${x}`);
};

console.log('\nThird-party notices\n');

const root = mkdtempSync(join(tmpdir(), 'gb-notices-'));
const nm = join(root, 'node_modules');
const pkg = (name, fields, files = {}) => {
  const dir = join(nm, ...name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', ...fields }));
  for (const [f, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), text);
  }
  return join(dir, 'index.js');
};
const MIT = 'MIT License\n\nCopyright (c) 2020 Someone\n\nPermission is hereby granted, free of charge...';

const good = pkg('good-lib', { license: 'MIT' }, { LICENSE: MIT });
const scoped = pkg('@scope/thing', { license: 'ISC' }, { 'LICENSE.md': 'ISC License\n\nCopyright (c) 2021 Scope' });
const bare = pkg('bare-lib', { license: 'MIT' });
const jszip = pkg('jszip', { license: '(MIT OR GPL-3.0-or-later)' }, { 'LICENSE.markdown': MIT });
const unchosen = pkg('two-ways', { license: '(MIT OR Apache-2.0)' }, { LICENSE: MIT });
const qr = pkg('qrcode-generator', { license: 'MIT' }, {
  'dist/qrcode.mjs': '//---\n//\n// QR Code Generator\n//\n// Copyright (c) 2009 An Author\n//\n// Licensed under the MIT license\n//---\n\n//---\n// qrcode\n//---\nvar qrcode = 1;\n',
});

check('a module is mapped to its package, scoped packages and queries included', () => {
  assertEqual(packageDirOf('/x/node_modules/a/b/c.js').endsWith('/node_modules/a'), true, 'plain');
  assertEqual(packageDirOf('\0/x/node_modules/@s/p/i.js?commonjs-proxy').endsWith('/node_modules/@s/p'), true, 'scoped');
  // Backslashes, as Windows gives them, without a drive letter (the absolute-path guard refuses one).
  assertEqual(packageDirOf('x\\node_modules\\a\\node_modules\\b\\i.js').endsWith('/node_modules/b'), true, 'nested');
  assertEqual(packageDirOf('/x/src/app.tsx'), null, 'the app itself is not a package');
});

check('ITEM 1: each package carries its name, version, licence and full notice text', () => {
  const { packages, problems } = collectNotices([good, scoped, good]);
  assertEqual(problems, [], 'a complete tree was refused');
  assertEqual(packages.map(p => [p.name, p.version, p.licence]), [['@scope/thing', '1.0.0', 'ISC'], ['good-lib', '1.0.0', 'MIT']],
    'wrong packages');
  assertEqual(packages.find(p => p.name === 'good-lib').notice, MIT, 'the notice is not the licence file in full');
});

check('ITEM 2: a bundled package with no notice text is a problem that NAMES the package', () => {
  const { problems } = collectNotices([good, bare]);
  assertEqual(problems.length, 1, 'not exactly one problem');
  assert(problems[0].startsWith('bare-lib@1.0.0 (MIT): no licence, copying or notice file'), `not named: ${problems[0]}`);
});

check('ITEM 1: jszip records MIT as this project\'s choice', () => {
  const p = collectNotices([jszip]).packages[0];
  assertEqual(p.licenceChosen, 'MIT', 'no choice recorded');
  assert(/used under MIT, by choice of this project/.test(noticesText({ name: 'X', licence: 'L' }, [p])),
    'the notices file does not say so');
});

check('a dual-licensed package with no recorded choice stops the build too', () => {
  const { problems } = collectNotices([unchosen]);
  assert(problems.some(p => /two-ways.*dual-licensed, and no choice is recorded/.test(p)), `not refused: ${problems}`);
});

check('ITEM 4: a package with no licence file takes its notice from its own source header, and only the header', () => {
  const p = collectNotices([qr]).packages[0];
  assert(/Copyright \(c\) 2009 An Author/.test(p.notice) && /Licensed under the MIT license/.test(p.notice), p.notice);
  assert(!/var qrcode/.test(p.notice) && !/\/\/ qrcode\n/.test(p.notice), 'the notice ran past the header');
  assert(/header of dist\/qrcode\.mjs \(the package ships no licence file\)/.test(p.noticeSource), p.noticeSource);
});

check('the build refuses rather than warns: the plugin calls this.error on any problem', () => {
  const cfg = readFileSync(join(REPO, 'vite.config.ts'), 'utf8');
  assert(/thirdPartyNotices\(\)/.test(cfg.slice(cfg.indexOf('plugins:'))), 'the plugin is not in the build');
  assert(/if \(problems\.length\) \{\s*this\.error\(/.test(cfg), 'a problem does not stop the build');
  assert(/for \(const out of Object\.values\(bundle\)\)/.test(cfg), 'the notices are not taken from the bundle');
});

try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
suiteExit(passed, failed);
