// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BASELINE, type Io, type Violation } from './types.ts';

export function readBaseline(file: string): Violation[] | undefined {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- <root>/.code-caps-baseline.json, root from the command line or the working directory
  if (!existsSync(file)) return undefined;
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the same baseline path
  const text = readFileSync(file, 'utf8');
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- the baseline is this script's own output (--update): a Violation[]
  return JSON.parse(text);
}

export function writeBaseline(file: string, current: readonly Violation[], io: Io): number {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the baseline path, see readBaseline
  writeFileSync(file, `${JSON.stringify(current, null, 2)}\n`);
  io.out(`code-caps: wrote ${BASELINE} with ${current.length} violations\n`);
  return 0;
}
