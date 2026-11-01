// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Change, Violation } from './types.ts';

const keyOf = (v: Pick<Violation, 'path' | 'kind' | 'name'>): string =>
  `${v.path}\0${v.kind}\0${v.name}`;

// Keys are unique, so two violations never compare equal.
export const order = (a: Violation, b: Violation): number => (keyOf(a) < keyOf(b) ? -1 : 1);

function changeType(before: number | undefined, value: number): Change['type'] {
  if (before === undefined) return 'new';
  return value > before ? 'grew' : 'shrank';
}

/** What differs between the baseline and the current violations. */
export function compare(baseline: readonly Violation[], current: readonly Violation[]): Change[] {
  const remaining = new Map(baseline.map((v) => [keyOf(v), v]));
  const changes: Change[] = [];
  for (const { path, kind, name, value } of current) {
    const before = remaining.get(keyOf({ path, kind, name }))?.value;
    remaining.delete(keyOf({ path, kind, name }));
    if (before === value) continue;
    changes.push({ type: changeType(before, value), path, kind, name, before, now: value });
  }
  for (const { path, kind, name, value } of remaining.values()) {
    changes.push({ type: 'fixed', path, kind, name, before: value, now: undefined });
  }
  return changes;
}

export const isFailure = (change: Change): boolean =>
  change.type === 'new' || change.type === 'grew';
