// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, type WriteFileOptions, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { REPO_ROOT, type Runtime } from './runtime.js';

/*
 * The nginx test container (infra/test/compose.yaml, the only Docker in the repo). It is started
 * by the website scenario and removed again afterwards. The compose project name carries the run
 * id, so two runs (or another developer's `docker compose up`) never touch each other.
 */

const run = promisify(execFile);
const COMPOSE_FILE = resolve(REPO_ROOT, 'infra/test/compose.yaml');
const TEST_ENV_FILE = resolve(REPO_ROOT, 'infra/test/test.env');

export interface TestSite {
  readonly key: string;
  readonly host: string;
}

function composeArgs(rt: Runtime, ...rest: string[]): string[] {
  return [
    'compose',
    '-p',
    rt.composeProject,
    '-f',
    COMPOSE_FILE,
    '--env-file',
    TEST_ENV_FILE,
    '--env-file',
    resolve(rt.runDir, 'nginx.env'),
    ...rest,
  ];
}

/**
 * The variables of the compose file. They go into an env file *and* into the environment of the
 * `docker compose` process: the shell environment wins over `--env-file`, and it may hold the
 * root env file's own CONSENT_API_PORT and friends.
 */
function composeVariables(rt: Runtime, siteA?: TestSite, siteB?: TestSite): Record<string, string> {
  return {
    // The container receives only these variables, never the rest of the environment.
    CONSENT_API_HOST: rt.loopback,
    CONSENT_API_PORT: String(rt.ports.consentApi),
    DASHBOARD_API_HOST: rt.loopback,
    DASHBOARD_API_PORT: String(rt.ports.dashboardApi),
    NGINX_TEST_PORT: String(rt.ports.nginx),
    ...(siteA === undefined || siteB === undefined
      ? {}
      : {
          NGINX_TEST_SITE_A_HOST: siteA.host,
          NGINX_TEST_SITE_A_KEY: siteA.key,
          NGINX_TEST_SITE_B_HOST: siteB.host,
          NGINX_TEST_SITE_B_KEY: siteB.key,
          NGINX_TEST_PROXY_BIND: rt.proxyAddress,
          NGINX_TEST_SITE_DIR: rt.siteDir,
        }),
  };
}

/* The paths below all lie inside the run's own scratch directory (Runtime.runDir, siteDir). */

function makeDir(path: string, mode?: number): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a directory inside the run's scratch directory
  mkdirSync(path, { recursive: true, ...(mode === undefined ? {} : { mode }) });
}

function writeText(path: string, content: string, options?: WriteFileOptions): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file inside the run's scratch directory
  writeFileSync(path, content, options);
}

function writeNginxEnv(rt: Runtime, variables: Record<string, string>): void {
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

/** `fetch` cannot set `Host`; the vhost is chosen by it, so this uses `node:http`. */
function statusOf(rt: Runtime, host: string, path: string): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const req = request(
      {
        host: rt.loopback,
        port: rt.ports.nginx,
        path,
        headers: { host: `${host}:${rt.ports.nginx}` },
      },
      (response) => {
        response.resume();
        resolveStatus(response.statusCode ?? 0);
      },
    );
    req.setTimeout(2_000, () => req.destroy(new Error('timeout')));
    req.once('error', reject);
    req.end();
  });
}

async function waitUntilServing(rt: Runtime, host: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const status = await statusOf(rt, host, '/index.html');
      if (status === 200) return;
      last = `HTTP ${status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`nginx test container did not serve ${host} in time (${last})`);
}

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
