// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import ts from 'typescript';
import { hasBody, labelOf, opensLevel, spanLines } from './ast.ts';
import { CAPS, type Kind, type Violation } from './types.ts';

interface Frame {
  depth: number;
  max: number;
}

export interface Ctx {
  path: string;
  source: ts.SourceFile;
  found: Violation[];
  seen: Map<string, number>;
}

export function add(ctx: Ctx, kind: Kind, name: string, value: number): void {
  // eslint-disable-next-line security/detect-object-injection -- kind is the closed Kind union
  if (value > CAPS[kind]) ctx.found.push({ path: ctx.path, kind, name, value });
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

export function walk(node: ts.Node, scope: readonly string[], frame: Frame, ctx: Ctx): void {
  if (hasBody(node)) walkFunction(node, scope, ctx);
  else if (ts.isClassLike(node)) walkClass(node, scope, ctx);
  else walkInner(node, scope, frame, ctx);
}
