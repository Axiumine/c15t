// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { mkdirSync } from 'node:fs';
import { runtime } from './support/runtime.js';

/** Runs after the webServers are up. Scenarios create their own data in `beforeAll`. */
export default function globalSetup(): void {
  mkdirSync(runtime().runDir, { recursive: true, mode: 0o755 });
}
