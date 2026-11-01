// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loopbackAddress, neighbour } from './loopback.js';
import { freePorts } from './ports.js';
import type { Runtime } from './runtime-type.js';

export type { Runtime };

/*
 * One e2e run = one run id + four free ports. The Playwright config allocates them once, in the
 * runner process, and publishes them through `process.env`; workers inherit that environment and
 * read the same values. Everything the run creates in the shared database carries the run id.
 */

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Names of the variables that carry the run to workers, webServers and the teardown. */
const KEYS = {
  runId: 'E2E_RUN_ID',
  consentApi: 'E2E_PORT_CONSENT_API',
  dashboardApi: 'E2E_PORT_DASHBOARD_API',
  web: 'E2E_PORT_WEB',
  nginx: 'E2E_PORT_NGINX',
} as const;

function build(runId: string, ports: Runtime['ports']): Runtime {
  const loopback = loopbackAddress();
  const runDir = resolve(REPO_ROOT, 'test-results', 'runtime', runId);
  return {
    runId,
    loopback,
    proxyAddress: neighbour(loopback),
    ports,
    runDir,
    webDist: resolve(runDir, 'dashboard-web'),
    siteDir: resolve(runDir, 'site'),
    stateFile: resolve(runDir, 'state.json'),
    dashboardOrigin: `http://${loopback}:${ports.web}`,
    consentApiOrigin: `http://${loopback}:${ports.consentApi}`,
    dashboardApiOrigin: `http://${loopback}:${ports.dashboardApi}`,
    nginxOrigin: `http://${loopback}:${ports.nginx}`,
    composeProject: `c15t-${runId}`,
  };
}

function portFrom(name: string): number {
  // eslint-disable-next-line security/detect-object-injection -- `name` is a constant chosen by the callers in this file
  const port = Number(process.env[name]);
  if (!Number.isInteger(port) || port < 1024) throw new Error(`${name} is not set`);
  return port;
}

/**
 * Called by the Playwright config in the runner process. Allocates the run on the first call and
 * reuses it afterwards (workers re-evaluate the config and must see the same run). Pass
 * `E2E_RUN_ID` yourself to re-run the teardown of an earlier run.
 */
export async function allocateRuntime(): Promise<Runtime> {
  if (process.env[KEYS.runId] === undefined) {
    const [consentApi, dashboardApi, web, nginx] = await freePorts(4);
    process.env[KEYS.runId] = `e2e-${randomBytes(4).toString('hex')}`;
    process.env[KEYS.consentApi] = String(consentApi);
    process.env[KEYS.dashboardApi] = String(dashboardApi);
    process.env[KEYS.web] = String(web);
    process.env[KEYS.nginx] = String(nginx);
  }
  return runtime();
}

/** The run of this process. Throws when the config has not allocated one. */
export function runtime(): Runtime {
  const runId = process.env[KEYS.runId];
  if (runId === undefined || !/^e2e-[0-9a-f]{8}$/.test(runId)) {
    throw new Error('E2E_RUN_ID is missing: run the suite through playwright.config.ts');
  }
  return build(runId, {
    consentApi: portFrom(KEYS.consentApi),
    dashboardApi: portFrom(KEYS.dashboardApi),
    web: portFrom(KEYS.web),
    nginx: portFrom(KEYS.nginx),
  });
}
