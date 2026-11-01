// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

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

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const CAPS: Record<Kind, number> = {
  'file-lines': 500,
  'function-lines': 50,
  'class-lines': 300,
  params: 4,
  nesting: 4,
};
export const BASELINE = '.code-caps-baseline.json';
