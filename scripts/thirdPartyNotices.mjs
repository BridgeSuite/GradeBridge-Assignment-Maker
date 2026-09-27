// =====================================================
// THIRD-PARTY NOTICES, GENERATED FROM WHAT THE BUNDLE ACTUALLY CONTAINS
// =====================================================
// WORKORDER_ATTRIBUTION_AND_THIRD_PARTY_NOTICES_2026-09-27.
//
// The bundle a browser downloads is a copy of every library compiled into it,
// and MIT and ISC both require the copyright and permission notice to travel
// with every copy. Until this existed the deployed bundle carried none of them.
//
// GENERATED, NEVER HAND-MAINTAINED. A hand-written list of dependencies is
// wrong the first time anyone runs `npm install`, because it lives apart from
// what it describes. This reads the modules the build actually put in the
// bundle, maps each to its installed package, and takes the licence text from
// that package on disk. No network access, and no list of packages here.
//
// IT FAILS THE BUILD, NOT WARNS. A package with no notice text stops the build
// and is named. A notices page that silently omits a library is worse than
// none, because it reads as complete.
//
// The only hand-written entries are the two DECISIONS the packages cannot make
// for us, each saying why:
//   * DUAL_LICENCE_CHOICE: which licence we take a dual-licensed package under.
//   * NOTICE_FROM_SOURCE_HEADER: where to read a notice for a package that
//     ships no licence file, from its own installed source, never invented.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A dual-licensed package, and the licence this project takes it under. */
export const DUAL_LICENCE_CHOICE = {
  // "(MIT OR GPL-3.0-or-later)". Taken under MIT; recorded because a reader
  // cannot otherwise tell which of the two applies, and the other is GPL-3.0.
  jszip: 'MIT',
  // "(MPL-2.0 OR Apache-2.0)", reached through jspdf. Taken under Apache-2.0,
  // the permissive option, for the same reason as jszip: MPL-2.0 is file-level
  // copyleft. Found by this generator on 2026-09-27; the choice is recorded for
  // the project owner to confirm.
  dompurify: 'Apache-2.0',
  // "MIT OR SEE LICENSE IN FEEL-FREE.md", reached through jspdf's canvg. MIT.
  rgbcolor: 'MIT',
};

/**
 * A package that ships no licence file, and the installed source file whose
 * leading comment block carries its notice. Read from disk at build time.
 */
export const NOTICE_FROM_SOURCE_HEADER = {
  // qrcode-generator 2.x ships no LICENSE. Its source opens with the author's
  // copyright line and "Licensed under the MIT license", with the licence URL.
  'qrcode-generator': 'dist/qrcode.mjs',
};

const NOTICE_FILE_RE = /^(licen[cs]e|copying|notice)([._-].*)?$/i;

/** The installed package directory a module id belongs to, or null if it is not a package. */
export const packageDirOf = (id) => {
  const path = String(id).replace(/^\0/, '').split('?')[0].replace(/\\/g, '/');
  const at = path.lastIndexOf('/node_modules/');
  if (at < 0) return null;
  const rest = path.slice(at + '/node_modules/'.length).split('/');
  const name = rest[0].startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0];
  return path.slice(0, at + '/node_modules/'.length) + name;
};

const licenceOf = (pkg) => {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license.type === 'string') return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map(l => l.type || l).join(' OR ');
  return 'UNDECLARED';
};

/** The first comment block at the top of a source file, ending at its first blank line. */
const leadingComment = (text) => {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) out.push(line);
    else if (out.length || !/^\s*$/.test(line)) break;
  }
  return out.join('\n').trim();
};

/**
 * One entry per installed package the given modules come from, sorted by name.
 * `problems` names every package with no notice text; the caller must refuse.
 */
export const collectNotices = (moduleIds) => {
  const dirs = new Set();
  for (const id of moduleIds) {
    const dir = packageDirOf(id);
    if (dir) dirs.add(dir);
  }
  const packages = [];
  const problems = [];
  for (const dir of dirs) {
    const pkgFile = join(dir, 'package.json');
    if (!existsSync(pkgFile)) continue;
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
    const files = readdirSync(dir).filter(f => NOTICE_FILE_RE.test(f)).sort();
    let notice = files.map(f => readFileSync(join(dir, f), 'utf8').trim()).filter(Boolean).join('\n\n');
    let noticeSource = files.join(', ');
    if (!notice && NOTICE_FROM_SOURCE_HEADER[pkg.name]) {
      const src = join(dir, NOTICE_FROM_SOURCE_HEADER[pkg.name]);
      if (existsSync(src)) {
        notice = leadingComment(readFileSync(src, 'utf8'));
        noticeSource = `header of ${NOTICE_FROM_SOURCE_HEADER[pkg.name]} (the package ships no licence file)`;
      }
    }
    const licence = licenceOf(pkg);
    if (!notice) problems.push(`${pkg.name}@${pkg.version} (${licence}): no licence, copying or notice file in ${dir}`);
    // A choice of licences is a decision, not something to read off a package:
    // until one is recorded, a reader cannot tell which terms we use it under.
    if (/\bOR\b/.test(licence) && !DUAL_LICENCE_CHOICE[pkg.name]) {
      problems.push(`${pkg.name}@${pkg.version} (${licence}): dual-licensed, and no choice is recorded in DUAL_LICENCE_CHOICE`);
    }
    packages.push({
      name: pkg.name,
      version: pkg.version,
      licence,
      ...(DUAL_LICENCE_CHOICE[pkg.name] ? { licenceChosen: DUAL_LICENCE_CHOICE[pkg.name] } : {}),
      noticeSource,
      notice,
    });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  problems.sort();
  return { packages, problems };
};

/** The human-readable file, one section per package with its notice in full. */
export const noticesText = (project, packages) => [
  'THIRD-PARTY NOTICES',
  '',
  `${project.name} is Copyright (c) 2026 The Regents of the University of California and is made`,
  'available under the MIT License, reproduced at the end of this file.',
  '',
  `It includes the following ${packages.length} third-party packages, each under its own licence.`,
  'This file is generated at build time from the packages compiled into the application.',
  '',
  ...packages.flatMap(p => [
    '='.repeat(78),
    `${p.name} ${p.version}`,
    `Licence: ${p.licence}${p.licenceChosen ? `  (used under ${p.licenceChosen}, by choice of this project)` : ''}`,
    `Notice from: ${p.noticeSource}`,
    '-'.repeat(78),
    p.notice,
    '',
  ]),
  '='.repeat(78),
  `${project.name}`,
  '-'.repeat(78),
  project.licence.trim(),
  '',
].join('\n');
