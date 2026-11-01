// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { CAPS, type Change } from './types.ts';

type Row = [change: string, where: string, baseline: string, now: string, cap: string];

export function table(changes: readonly Change[]): string {
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
