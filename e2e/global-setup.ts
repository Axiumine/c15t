// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { mkdirSync } from 'node:fs';
import { runtime } from './support/runtime.js';

/** Runs after the webServers are up. Scenarios create their own data in `beforeAll`. */
export default function globalSetup(): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the run's own scratch directory
  mkdirSync(runtime().runDir, { recursive: true, mode: 0o755 });
}
