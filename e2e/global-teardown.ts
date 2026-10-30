// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { rmSync } from 'node:fs';
import { cleanupRun } from './support/db.js';
import { stopNginx } from './support/nginx.js';
import { runtime } from './support/runtime.js';

/**
 * Removes everything the run created: the nginx container (if a scenario left one), then its
 * rows in the shared database (exact run id only), then its scratch directory. Each step runs
 * even when an earlier one failed; the first error is thrown at the end.
 */
export default async function globalTeardown(): Promise<void> {
  const rt = runtime();
  const failures: unknown[] = [];
  try {
    await stopNginx(rt);
  } catch (error) {
    failures.push(error);
  }
  try {
    const report = await cleanupRun(rt);
    process.stdout.write(
      `e2e cleanup ${rt.runId}: ${report.users} users, ${report.sites} sites, ${report.consents} consents removed\n`,
    );
  } catch (error) {
    failures.push(error);
  }
  rmSync(rt.runDir, { recursive: true, force: true });
  if (failures[0] !== undefined) throw failures[0];
}
