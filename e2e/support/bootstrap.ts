// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { REPO_ROOT, type Runtime } from './runtime.js';

const run = promisify(execFile);

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

/**
 * Creates an administrator through the code path of `yarn admin:create`: the same entry point
 * (src/admin-create.ts, i.e. `createAdmin` with the real Better Auth), run from source so that
 * the suite does not depend on a fresh `tsc -b` of dashboard-api. The account has
 * `mustChangePassword` set, exactly like the first admin of a real installation.
 */
export async function bootstrapAdmin(rt: Runtime, email: string): Promise<Credentials> {
  const { stdout } = await run(
    resolve(REPO_ROOT, 'node_modules/.bin/tsx'),
    ['--conditions=source', 'src/admin-create.ts', '--email', email, '--name', 'E2E Admin'],
    {
      cwd: resolve(REPO_ROOT, 'apps/dashboard-api'),
      env: { ...process.env, BETTER_AUTH_URL: rt.dashboardOrigin },
    },
  );
  const match = /One-time password \(shown once[^)]*\): (\S+)/.exec(stdout);
  if (match?.[1] === undefined) throw new Error('admin:create printed no one-time password');
  return { email, password: match[1] };
}
