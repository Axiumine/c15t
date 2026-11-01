// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import ts from 'typescript';

export function spanLines(node: ts.Node, source: ts.SourceFile): number {
  const first = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  return source.getLineAndCharacterOfPosition(node.getEnd()).line - first + 1;
}

/** A function, method or accessor that has a body (not an overload or an interface member). */
export const hasBody = (node: ts.Node): node is ts.FunctionLikeDeclaration =>
  ts.isFunctionLike(node) && 'body' in node && node.body !== undefined;

/** Control statements that open a level of nesting. An `else if` stays on its `if`'s level. */
export function opensLevel(node: ts.Node): boolean {
  if (ts.isIfStatement(node)) {
    return !(ts.isIfStatement(node.parent) && node.parent.elseStatement === node);
  }
  return (
    ts.isIterationStatement(node, false) || ts.isSwitchStatement(node) || ts.isTryStatement(node)
  );
}

export function labelOf(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  return ts.getNameOfDeclaration(node as ts.Declaration)?.getText(source) ?? '<anonymous>';
}
