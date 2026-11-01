// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { chmodSync, mkdirSync, type WriteFileOptions, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Runtime } from './runtime.js';

/* The paths below all lie inside the run's own scratch directory (Runtime.runDir, siteDir). */

export function makeDir(path: string, mode?: number): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a directory inside the run's scratch directory
  mkdirSync(path, { recursive: true, ...(mode === undefined ? {} : { mode }) });
}

export function writeText(path: string, content: string, options?: WriteFileOptions): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file inside the run's scratch directory
  writeFileSync(path, content, options);
}

export function writeNginxEnv(rt: Runtime, variables: Record<string, string>): void {
  makeDir(rt.siteDir, 0o755);
  // The container's nginx workers run as an unprivileged user: the files must be world-readable.
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the run's site directory
  chmodSync(rt.siteDir, 0o755);
  writeText(
    resolve(rt.runDir, 'nginx.env'),
    `${Object.entries(variables)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')}\n`,
  );
}

/** Writes a file into the static site root served by both test vhosts. */
export function writeSiteFile(rt: Runtime, name: string, content: string): void {
  makeDir(rt.siteDir, 0o755);
  writeText(resolve(rt.siteDir, name), content, { mode: 0o644 });
}
