// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePorts } from './ports.js';

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

export interface Runtime {
  /** `e2e-<8 hex>`. Prefix of every site key, hostname and email the run creates. */
  readonly runId: string;
  /** The loopback address of this machine, read from the network interfaces. */
  readonly loopback: string;
  /** A second loopback address: nginx binds it as its source address towards consent-api. */
  readonly proxyAddress: string;
  readonly ports: {
    readonly consentApi: number;
    readonly dashboardApi: number;
    readonly web: number;
    readonly nginx: number;
  };
  /** Scratch space of the run (built SPA, site files, state). Removed by the teardown. */
  readonly runDir: string;
  readonly webDist: string;
  readonly siteDir: string;
  readonly stateFile: string;
  /** What the browser uses for the dashboard; equals `BETTER_AUTH_URL` of dashboard-api. */
  readonly dashboardOrigin: string;
  readonly consentApiOrigin: string;
  readonly dashboardApiOrigin: string;
  readonly nginxOrigin: string;
  /** docker compose project name, unique per run. */
  readonly composeProject: string;
}

function loopbackAddress(): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal && entry.family === 'IPv4') return entry.address;
    }
  }
  throw new Error('No IPv4 loopback interface found');
}

/** The next address in the loopback /8, so the proxy and the test client differ as TCP peers. */
function neighbour(address: string): string {
  const parts = address.split('.').map(Number);
  const last = parts[3];
  if (last === undefined) throw new Error('Not an IPv4 address');
  parts[3] = last === 254 ? 253 : last + 1;
  return parts.join('.');
}

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

/**
 * Names of the objects one scenario (and worker) creates: every one starts with the run id, so
 * the teardown can find them, and carries the scenario `tag`, so parallel workers never clash.
 */
export function names(rt: Runtime, tag: string) {
  const site = (n: number) => ({
    key: `${rt.runId}-${tag}-s${n}`,
    name: `E2E ${rt.runId} ${tag} site ${n}`,
    host: `${rt.runId}-${tag}-s${n}.test`,
  });
  const email = (label: string) => `${rt.runId}-${tag}-${label}@e2e.example.com`;
  return {
    sites: [site(1), site(2), site(3)] as const,
    emails: {
      admin: email('admin'),
      userA: email('user-a'),
      userB: email('user-b'),
    },
  };
}
