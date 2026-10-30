// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import { assertDatabaseEnv } from './e2e/support/db.js';
import { allocateRuntime, REPO_ROOT } from './e2e/support/runtime.js';

/*
 * End-to-end suite (README Roadmap, phase 4). See docs/e2e.md.
 *
 * The runner starts the real stack on free ports: consent-api and dashboard-api from source
 * (the same entry points as `yarn dev`, without the file watcher) and the built dashboard-web
 * through `vite preview`. nginx (infra/test) is started by the website scenario only.
 * Addresses come from the machine, ports from the free-port helper, and the database settings
 * from the environment that `yarn` injects (the root env file).
 */

assertDatabaseEnv();
const rt = await allocateRuntime();
const { loopback, ports } = rt;

/*
 * The servers are started with the binaries directly, not through `yarn run`: Yarn's
 * `injectEnvironmentFiles` makes the values of the root env file win over the environment, which
 * would replace the free ports and the dashboard origin chosen here. `yarn test:e2e` itself still
 * injects that file once, and the child processes inherit it for the database settings.
 */
const bin = (name: string) => resolve(REPO_ROOT, 'node_modules/.bin', name);
const app = (name: string) => resolve(REPO_ROOT, 'apps', name);

const consentApiEnv = {
  CONSENT_API_HOST: loopback,
  CONSENT_API_PORT: String(ports.consentApi),
  // Only nginx (which binds `proxyAddress` towards consent-api) is a trusted proxy. The test
  // client connects from `loopback`, so its forwarded headers are stripped.
  CONSENT_API_TRUSTED_PROXIES: `${rt.proxyAddress}/32`,
  CONSENT_API_INSTANCE_POOL_MAX: '1',
  CONSENT_API_REGISTRY_POOL_MAX: '1',
};

const dashboardApiEnv = {
  DASHBOARD_API_HOST: loopback,
  DASHBOARD_API_PORT: String(ports.dashboardApi),
  CONSENT_API_URL: rt.consentApiOrigin,
  // Must equal the origin the browser uses: Better Auth checks it on every write.
  BETTER_AUTH_URL: rt.dashboardOrigin,
  // The suite reads what it just wrote: no replica lag.
  DATABASE_URL_DASHBOARD_REPLICA: '',
};

const dashboardWebEnv = {
  DASHBOARD_API_HOST: loopback,
  DASHBOARD_API_PORT: String(ports.dashboardApi),
  DASHBOARD_WEB_DEV_PORT: String(ports.web),
};

const SHUTDOWN = { signal: 'SIGTERM', timeout: 10_000 } as const;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results/artifacts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  workers: 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: rt.dashboardOrigin,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    launchOptions: {
      // Site hostnames of the website scenario resolve to the loopback address.
      args: [`--host-resolver-rules=MAP *.test ${loopback}`],
    },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      name: 'consent-api',
      command: `${bin('tsx')} --conditions=source src/server.ts`,
      cwd: app('consent-api'),
      url: `${rt.consentApiOrigin}/health`,
      env: consentApiEnv,
      reuseExistingServer: false,
      timeout: 90_000,
      gracefulShutdown: SHUTDOWN,
    },
    {
      name: 'dashboard-api',
      command: `${bin('tsx')} --conditions=source src/server.ts`,
      cwd: app('dashboard-api'),
      url: `${rt.dashboardApiOrigin}/api/health`,
      env: dashboardApiEnv,
      reuseExistingServer: false,
      timeout: 90_000,
      gracefulShutdown: SHUTDOWN,
    },
    {
      name: 'dashboard-web',
      // The production build, served by `vite preview` (no nginx): same bundle that nginx ships.
      command: [
        `${bin('vite')} build --outDir ${rt.webDist}`,
        `${bin('vite')} preview --outDir ${rt.webDist}`,
      ].join(' && '),
      cwd: app('dashboard-web'),
      url: `${rt.dashboardOrigin}/robots.txt`,
      env: dashboardWebEnv,
      reuseExistingServer: false,
      timeout: 240_000,
      gracefulShutdown: SHUTDOWN,
    },
  ],
});
