#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

// Adds (or normalises) the SPDX header of every hand-written source file, and checks that every
// other file in the repository is covered by an annotation in REUSE.toml.
//
//   node scripts/add-spdx-headers.mjs           write the header into every file that lacks it
//   node scripts/add-spdx-headers.mjs --check   change nothing, exit 1 when a file is not covered
//
// Idempotent: a file that already carries the canonical header is left byte-for-byte untouched,
// a shebang stays on line 1, and the header is followed by one blank line so that Biome's import
// sorting and formatting leave it alone. The files to scan come from `git ls-files` when the
// directory is a git checkout, otherwise from a directory walk that honours .gitignore.
// Files matched by REUSE.toml (generated code, JSON, Markdown, ...) are never modified.
//
// To change the copyright holder, edit COPYRIGHT below AND the SPDX-FileCopyrightText entries in
// REUSE.toml, then run this script (it rewrites the old header lines).

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const LICENSE_ID = 'AGPL-3.0-or-later';
const COPYRIGHT = 'Copyright (C) 2026 Axiumine';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/** Comment style per extension. Anything not listed must be covered by REUSE.toml instead. */
const STYLES = {
  line: { prefix: '// ', ext: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'] },
  hash: { prefix: '# ', ext: ['.sh', '.conf', '.tmpl', '.template'] },
  dash: { prefix: '-- ', ext: ['.sql'] },
  block: { prefix: ' * ', ext: ['.css'] },
};

const ALWAYS_SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.tsbuild',
  '.gitnexus',
  '.yarn',
  '.idea',
  '.claude',
  '.vite',
  '.tanstack',
  'coverage',
  'playwright-report',
  'test-results',
]);

function styleFor(file) {
  const ext = extname(file);
  for (const style of Object.values(STYLES)) {
    if (style.ext.includes(ext)) return style;
  }
  return null;
}

function headerLines(style) {
  const lines = [`SPDX-License-Identifier: ${LICENSE_ID}`, COPYRIGHT];
  if (style === STYLES.block) return ['/*', ...lines.map((l) => ` * ${l}`), ' */'];
  return lines.map((l) => `${style.prefix}${l}`);
}

/** Translates a REUSE.toml glob (`*` stops at `/`, `**` does not) to an anchored RegExp. */
function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else out += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
  }
  // eslint-disable-next-line security/detect-non-literal-regexp -- every character of `out` is escaped or generated above
  return new RegExp(`^${out}$`);
}

function readReuseGlobs() {
  const file = join(ROOT, 'REUSE.toml');
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8');
  const globs = [];
  for (const block of text.matchAll(/^[ \t]*path[ \t]*=[ \t]*\[([^\]]*)\]/gm)) {
    for (const quoted of (block[1] ?? '').matchAll(/"([^"]+)"/g)) {
      if (quoted[1]) globs.push(globToRegExp(quoted[1]));
    }
  }
  return globs;
}

/** Minimal .gitignore reader for the no-git fallback: names, anchored paths, `*`, `!`, `dir/`. */
function readIgnoreRules() {
  const file = join(ROOT, '.gitignore');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((raw) => {
      const negate = raw.startsWith('!');
      let p = negate ? raw.slice(1) : raw;
      p = p.replace(/\/$/, '');
      const anchored = p.includes('/');
      const body = globToRegExp(p.replace(/^\//, '')).source.slice(1, -1);
      // eslint-disable-next-line security/detect-non-literal-regexp -- `body` is escaped by globToRegExp
      const re = new RegExp(anchored ? `^${body}(?:/.*)?$` : `(?:^|.*/)${body}(?:/.*)?$`);
      return { negate, re };
    });
}

function isIgnored(rel, rules) {
  let ignored = false;
  for (const rule of rules) if (rule.re.test(rel)) ignored = !rule.negate;
  return ignored;
}

function listFiles() {
  try {
    const out = execFileSync(
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- developer and CI tool run on a checkout; without the tool it falls back to a directory walk
      'git',
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `f` is a path listed by git inside ROOT
    const files = out.split('\0').filter((f) => f !== '' && existsSync(join(ROOT, f)));
    if (files.length > 0) return files;
  } catch {
    // Not a git checkout (or git is missing): walk the tree instead.
  }
  const rules = readIgnoreRules();
  const found = [];
  const walk = (dir) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `dir` is ROOT or a directory found by this walk
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = relative(ROOT, abs).split(sep).join('/');
      if (entry.isDirectory()) {
        if (!ALWAYS_SKIPPED_DIRS.has(entry.name) && !isIgnored(rel, rules)) walk(abs);
      } else if (entry.isFile() && !isIgnored(rel, rules)) found.push(rel);
    }
  };
  walk(ROOT);
  return found;
}

const isHeaderLine = (l) => /SPDX-License-Identifier|Copyright \(C\)/.test(l);

/** Number of leading lines that form an existing SPDX/copyright header (0 when there is none). */
function existingHeaderLength(lines, style) {
  if (style === STYLES.block) {
    const end = lines.findIndex((l) => l.trim() === '*/');
    const hasBlock = lines[0]?.trim() === '/*' && end > 0;
    return hasBlock && lines.slice(0, end + 1).some(isHeaderLine) ? end + 1 : 0;
  }
  const comment = style.prefix.trimEnd();
  let n = 0;
  for (const line of lines) {
    if (!(line.startsWith(comment) && isHeaderLine(line))) break;
    n += 1;
  }
  return n;
}

/** Returns the file text with the canonical header, or null when it already has it. */
function withHeader(text, style) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const shebang = lines[0]?.startsWith('#!') ? [lines.shift() ?? ''] : [];
  const canonical = headerLines(style);
  const existing = existingHeaderLength(lines, style);

  if (existing === canonical.length && canonical.every((l, i) => lines.at(i) === l)) return null;
  const rest = lines.slice(existing);
  if (existing === 0 && rest[0] !== '') rest.unshift('');
  return [...shebang, ...canonical, ...rest].join(eol);
}

/** Handles one file; returns a problem description, 'written', or null when it is fine. */
function processFile(rel, style, globs) {
  if (globs.some((g) => g.test(rel))) return null;
  if (!style) return 'no comment style known and not listed in REUSE.toml';
  const abs = join(ROOT, rel);
  // One read decides everything: no stat-then-read, so nothing can change between check and use.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `abs` is a repository file chosen by listFiles()
  const text = readFileSync(abs, 'utf8');
  if (text === '') return null;
  const next = withHeader(text, style);
  if (next === null) return null;
  if (CHECK) return 'missing or outdated SPDX header';
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- `abs` is the same repository file as above
  writeFileSync(abs, next);
  return 'written';
}

function main() {
  const globs = readReuseGlobs();
  const uncovered = [];
  const rewritten = [];

  for (const rel of listFiles().sort()) {
    const result = processFile(rel, styleFor(rel), globs);
    if (result === 'written') rewritten.push(rel);
    else if (result !== null) uncovered.push(`${rel} (${result})`);
  }

  if (!CHECK) {
    process.stdout.write(`SPDX headers written to ${rewritten.length} file(s).\n`);
    for (const rel of rewritten) process.stdout.write(`  ${rel}\n`);
  }
  if (uncovered.length > 0) {
    process.stderr.write(`${uncovered.length} file(s) not covered:\n`);
    for (const line of uncovered) process.stderr.write(`  ${line}\n`);
    process.exitCode = 1;
  } else if (CHECK) {
    process.stdout.write('Every file has an SPDX header or is covered by REUSE.toml.\n');
  }
}

main();
