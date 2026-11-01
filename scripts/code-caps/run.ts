// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { join } from 'node:path';
import { readBaseline, writeBaseline } from './baseline.ts';
import { compare, isFailure } from './compare.ts';
import { table } from './report.ts';
import { scan } from './scan.ts';
import { BASELINE, type Io } from './types.ts';

export function run(update: boolean, root: string, io: Io): number {
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
