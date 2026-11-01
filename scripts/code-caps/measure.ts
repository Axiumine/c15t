// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import ts from 'typescript';
import type { Violation } from './types.ts';
import { add, type Ctx, walk } from './walk.ts';

const TEST_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx'];
const TEST_DIRECTORIES = ['/test/', '/testing/'];

const lineCount = (text: string): number => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);

/** Test code only counts towards the file cap: its bodies are nested describe/test callbacks. */
function isTestCode(path: string): boolean {
  return (
    TEST_SUFFIXES.some((suffix) => path.endsWith(suffix)) ||
    TEST_DIRECTORIES.some((directory) => path.includes(directory))
  );
}

/** Every cap that the content `text` of the file `path` exceeds. */
export function measure(path: string, text: string): Violation[] {
  const kind = path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
  const ctx: Ctx = { path, source, found: [], seen: new Map() };
  add(ctx, 'file-lines', '(file)', lineCount(text));
  if (!isTestCode(path)) {
    ts.forEachChild(source, (child) => walk(child, [], { depth: 0, max: 0 }, ctx));
  }
  return ctx.found;
}
