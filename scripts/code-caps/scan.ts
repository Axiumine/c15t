// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { order } from './compare.ts';
import { measure } from './measure.ts';
import type { Violation } from './types.ts';

const ROOTS = ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}', 'scripts/**/*.{ts,tsx}'];
const SKIPPED = /\.d\.ts$|\.(generated|gen)\.tsx?$/;

/** The violations of every hand-written file under `root`, in a stable order. */
export function scan(root: string): Violation[] {
  const files = globSync(ROOTS, { cwd: root }).filter((file) => !SKIPPED.test(file));
  return files
    .flatMap((file) =>
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- file comes from globbing the repository's own source roots
      measure(file, readFileSync(join(root, file), 'utf8')),
    )
    .sort(order);
}
