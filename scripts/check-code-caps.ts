// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * `yarn code-caps`: size and shape caps for the hand-written TypeScript, with a ratchet.
 *
 * Caps: file 500 lines, function 50 lines, class 300 lines, 4 parameters, nesting depth 4. Code that
 * is over a cap today is recorded in .code-caps-baseline.json. The check fails for a violation that
 * is not in the baseline or whose value grew, and only reports one that shrank or vanished.
 * `--update` rewrites the baseline, and refuses to raise it.
 *
 * Scope: the src folders of apps/<name> and packages/<name>, and scripts/, without generated files
 * and declarations. Test files (and src/test, src/testing) only count towards the file cap: their
 * bodies are nested describe/test callbacks, so function length and nesting there would measure the
 * number of cases, not complexity.
 */
import { existsSync, globSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

export type Kind = 'file-lines' | 'function-lines' | 'class-lines' | 'params' | 'nesting';

export interface Violation {
  path: string;
  kind: Kind;
  name: string;
  value: number;
}

export interface Change {
  type: 'new' | 'grew' | 'shrank' | 'fixed';
  path: string;
  kind: Kind;
  name: string;
  before: number | undefined;
  now: number | undefined;
}

interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

const CAPS: Record<Kind, number> = {
  'file-lines': 500,
  'function-lines': 50,
  'class-lines': 300,
  params: 4,
  nesting: 4,
};
const BASELINE = '.code-caps-baseline.json';
const ROOTS = ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}'];
const SKIPPED = /\.d\.ts$|\.(generated|gen)\.tsx?$/;
const TEST_CODE = /\.(test|spec)\.tsx?$|\/(test|testing)\//;
const USAGE = 'usage: node scripts/check-code-caps.ts [--update]\n';

// Measuring one file

interface Frame {
  depth: number;
  max: number;
}

interface Ctx {
  path: string;
  source: ts.SourceFile;
  found: Violation[];
  seen: Map<string, number>;
}

const lineCount = (text: string): number => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

function spanLines(node: ts.Node, source: ts.SourceFile): number {
  const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  return source.getLineAndCharacterOfPosition(node.getEnd()).line - first + 1;
}

function add(ctx: Ctx, kind: Kind, name: string, value: number): void {
  if (value > CAPS[kind]) ctx.found.push({ path: ctx.path, kind, name, value });
}

/** A function, method or accessor that has a body (not an overload or an interface member). */
const hasBody = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionLike(node) && 'body' in node && node.body !== undefined;

/** Control statements that open a level of nesting. An `else if` stays on its `if`'s level. */
function opensLevel(node: ts.Node): boolean {
  if (ts.isIfStatement(node)) {
    return !(ts.isIfStatement(node.parent) && node.parent.elseStatement === node);
  }
  return (
    ts.isIterationStatement(node, false) || ts.isSwitchStatement(node) || ts.isTryStatement(node)
  );
}

function labelOf(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  return ts.getNameOfDeclaration(node as ts.Declaration)?.getText(source) ?? '<anonymous>';
}

/** The dotted path of the enclosing names, with `#2`, `#3` for repeats so that a key is unique. */
function uniqueName(ctx: Ctx, scope: readonly string[], label: string): string {
  const base = [...scope, label].join('.');
  const count = (ctx.seen.get(base) ?? 0) + 1;
  ctx.seen.set(base, count);
  return count === 1 ? base : `${base}#${count}`;
}

function walkFunction(node: ts.FunctionLikeDeclaration, scope: readonly string[], ctx: Ctx): void {
  const label = labelOf(node, ctx.source);
  const name = uniqueName(ctx, scope, label);
  const frame: Frame = { depth: 0, max: 0 };
  add(ctx, 'function-lines', name, spanLines(node, ctx.source));
  add(ctx, 'params', name, node.parameters.filter((p) => p.name.getText() !== 'this').length);
  ts.forEachChild(node, (child) => walk(child, [...scope, label], frame, ctx));
  add(ctx, 'nesting', name, frame.max);
}

function walkClass(node: ts.ClassLikeDeclaration, scope: readonly string[], ctx: Ctx): void {
  const label = labelOf(node, ctx.source);
  add(ctx, 'class-lines', uniqueName(ctx, scope, label), spanLines(node, ctx.source));
  ts.forEachChild(node, (child) => walk(child, [...scope, label], { depth: 0, max: 0 }, ctx));
}

/** Any other node: its children belong to the same function, one level deeper if it opens one. */
function walkInner(node: ts.Node, scope: readonly string[], frame: Frame, ctx: Ctx): void {
  const opens = opensLevel(node);
  if (opens) {
    frame.depth += 1;
    frame.max = Math.max(frame.max, frame.depth);
  }
  ts.forEachChild(node, (child) => walk(child, scope, frame, ctx));
  if (opens) frame.depth -= 1;
}

function walk(node: ts.Node, scope: readonly string[], frame: Frame, ctx: Ctx): void {
  if (hasBody(node)) walkFunction(node, scope, ctx);
  else if (ts.isClassLike(node)) walkClass(node, scope, ctx);
  else walkInner(node, scope, frame, ctx);
}

/** Every cap that the content `text` of the file `path` exceeds. */
export function measure(path: string, text: string): Violation[] {
  const kind = path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const ctx: Ctx = { path, source, found: [], seen: new Map() };
  add(ctx, 'file-lines', '(file)', lineCount(text));
  if (!TEST_CODE.test(path)) {
    ts.forEachChild(source, (child) => walk(child, [], { depth: 0, max: 0 }, ctx));
  }
  return ctx.found;
}

// Comparing with the baseline

const keyOf = (v: Pick<Violation, 'path' | 'kind' | 'name'>): string =>
  `${v.path}\0${v.kind}\0${v.name}`;

// Keys are unique, so two violations never compare equal.
const order = (a: Violation, b: Violation): number => (keyOf(a) < keyOf(b) ? -1 : 1);

/** What differs between the baseline and the current violations. */
export function compare(baseline: readonly Violation[], current: readonly Violation[]): Change[] {
  const remaining = new Map(baseline.map((v) => [keyOf(v), v]));
  const changes: Change[] = [];
  for (const { path, kind, name, value } of current) {
    const before = remaining.get(keyOf({ path, kind, name }))?.value;
    remaining.delete(keyOf({ path, kind, name }));
    if (before === value) continue;
    const type = before === undefined ? 'new' : value > before ? 'grew' : 'shrank';
    changes.push({ type, path, kind, name, before, now: value });
  }
  for (const { path, kind, name, value } of remaining.values()) {
    changes.push({ type: 'fixed', path, kind, name, before: value, now: undefined });
  }
  return changes;
}

const isFailure = (change: Change): boolean => change.type === 'new' || change.type === 'grew';

type Row = [change: string, where: string, baseline: string, now: string, cap: string];

function table(changes: readonly Change[]): string {
  const rows = changes.map(
    (c): Row => [
      c.type,
      `${c.path} ${c.kind} ${c.name}`,
      `${c.before ?? '-'}`,
      `${c.now ?? '-'}`,
      `${CAPS[c.kind]}`,
    ],
  );
  const width = Math.max('where'.length, ...rows.map((r) => r[1].length));
  const format = (r: Row): string =>
    `  ${r[0].padEnd(6)}  ${r[1].padEnd(width)}  ${r[2].padStart(8)}  ${r[3].padStart(5)}  ${r[4].padStart(4)}`;
  return [['change', 'where', 'baseline', 'now', 'cap'] as Row, ...rows].map(format).join('\n');
}

// Command line

/** The violations of every hand-written file under `root`, in a stable order. */
export function scan(root: string): Violation[] {
  const files = globSync(ROOTS, { cwd: root }).filter((file) => !SKIPPED.test(file));
  return files.flatMap((file) => measure(file, readFileSync(join(root, file), 'utf8'))).sort(order);
}

function readBaseline(file: string): Violation[] | undefined {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
}

function writeBaseline(file: string, current: readonly Violation[], io: Io): number {
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  io.out(`code-caps: wrote ${BASELINE} with ${current.length} violations\n`);
  return 0;
}

function run(update: boolean, root: string, io: Io): number {
  const file = join(root, BASELINE);
  const current = scan(root);
  const baseline = readBaseline(file);
  if (baseline === undefined) {
    if (update) return writeBaseline(file, current, io);
    io.err(`No ${BASELINE}. Create it with: node scripts/check-code-caps.ts --update\n`);
    return 1;
  }
  const changes = compare(baseline, current);
  const failures = changes.filter(isFailure);
  if (failures.length > 0) {
    io.err(`Over the caps, and new or worse than the baseline:\n${table(failures)}\n`);
    io.err(
      update ? 'Refusing to raise the baseline: fix the code instead.\n' : 'code-caps: failed\n',
    );
    return 1;
  }
  if (changes.length > 0) {
    io.out(`Better than the baseline:\n${table(changes)}\n`);
    if (!update) io.out('Run with --update to lower the baseline.\n');
  }
  return update ? writeBaseline(file, current, io) : 0;
}

/** Runs the tool for `argv` (flags only) in the repository at `root` and returns the exit code. */
export function main(argv: readonly string[], root: string, io: Io): number {
  const update = argv.includes('--update');
  if (argv.length > (update ? 1 : 0)) {
    io.err(USAGE);
    return 2;
  }
  const code = run(update, root, io);
  if (code === 0 && !update) io.out('code-caps: ok\n');
  return code;
}

if (import.meta.main) {
  const io: Io = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  };
  process.exitCode = main(process.argv.slice(2), process.cwd(), io);
}
