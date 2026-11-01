// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { resolve } from 'node:path';
import { REPO_ROOT, type Runtime } from './runtime.js';

/*
 * How the test container is addressed: the compose file, its project name and its variables.
 * The compose project name carries the run id, so two runs (or another developer's
 * `docker compose up`) never touch each other.
 */

const COMPOSE_FILE = resolve(REPO_ROOT, 'infra/test/compose.yaml');
const TEST_ENV_FILE = resolve(REPO_ROOT, 'infra/test/test.env');

export interface TestSite {
  readonly key: string;
  readonly host: string;
}

export function composeArgs(rt: Runtime, ...rest: string[]): string[] {
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
export function composeVariables(
  rt: Runtime,
  siteA?: TestSite,
  siteB?: TestSite,
): Record<string, string> {
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
