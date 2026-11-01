// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { composeArgs, composeVariables, type TestSite } from './nginx-compose.js';
import { makeDir, writeNginxEnv, writeSiteFile, writeText } from './nginx-files.js';
import { waitUntilServing } from './nginx-ready.js';
import { REPO_ROOT, type Runtime } from './runtime.js';

/*
 * The nginx test container (infra/test/compose.yaml, the only Docker in the repo). It is started
 * by the website scenario and removed again afterwards. The compose project name carries the run
 * id, so two runs (or another developer's `docker compose up`) never touch each other.
 */

const run = promisify(execFile);

export { writeSiteFile };

export async function startNginx(rt: Runtime, siteA: TestSite, siteB: TestSite): Promise<void> {
  const variables = composeVariables(rt, siteA, siteB);
  writeNginxEnv(rt, variables);
  await run('docker', composeArgs(rt, 'up', '-d', '--quiet-pull'), {
    cwd: REPO_ROOT,
    env: { ...process.env, ...variables },
  });
  await waitUntilServing(rt, siteA.host);
}

/** Idempotent: a no-op when nothing of the project is running. */
export async function stopNginx(rt: Runtime): Promise<void> {
  try {
    makeDir(rt.runDir);
    writeText(resolve(rt.runDir, 'nginx.env'), '', { flag: 'a' });
    await run('docker', composeArgs(rt, 'down', '--remove-orphans', '--timeout', '2'), {
      cwd: REPO_ROOT,
      // `down` renders the file too: it needs the required variables even when nothing runs.
      env: { ...process.env, ...composeVariables(rt) },
    });
  } catch (error) {
    throw new Error(
      `Could not remove the nginx test container of ${rt.composeProject}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}
