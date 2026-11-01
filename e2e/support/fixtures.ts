// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import {
  type Browser,
  type BrowserContext,
  test as base,
  expect,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { randomClientIp } from './api.js';
import { type Hygiene, hygieneProblems, instrumentContext } from './instrument.js';
import { names, type Runtime, runtime } from './runtime.js';

export interface Visitor {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly hygiene: Hygiene;
  /** The address this browser sends as `X-Forwarded-For`, as nginx would set it. */
  readonly clientIp: string;
}

export interface VisitorOptions {
  readonly colorScheme?: 'light' | 'dark';
  readonly viewport?: { width: number; height: number };
  readonly reducedMotion?: 'reduce' | 'no-preference';
}

/**
 * A new instrumented browser context with its own client address. Use it directly in a
 * `beforeAll` when a context must outlive one test (serial scenarios), and close it with
 * `closeVisitor`; the `openVisitor` fixture does both for a single test.
 */
export async function openVisitorContext(
  browser: Browser,
  rt: Runtime,
  options: VisitorOptions = {},
): Promise<Visitor> {
  const clientIp = randomClientIp(rt);
  const context = await browser.newContext({
    baseURL: rt.dashboardOrigin,
    ...options,
    extraHTTPHeaders: { 'X-Forwarded-For': clientIp },
  });
  const hygiene = await instrumentContext(context, rt);
  return { context, page: await context.newPage(), hygiene, clientIp };
}

/**
 * Closes the context, then fails when it had broken the dashboard's CSP rules. Pass the test's
 * info to keep a screenshot of every page when that test failed: Playwright only does it for
 * the pages of its own `page` fixture.
 */
export async function closeVisitor(visitor: Visitor, info?: TestInfo): Promise<void> {
  if (info !== undefined && info.status !== info.expectedStatus) {
    for (const [index, page] of visitor.context.pages().entries()) {
      await info.attach(`visitor-page-${index}`, {
        body: await page.screenshot({ timeout: 5_000 }).catch(() => Buffer.from('')),
        contentType: 'image/png',
      });
    }
  }
  await visitor.context.close();
  assertClean(visitor.hygiene);
}

interface TestFixtures {
  /** Opens another instrumented browser context (another user, another viewport). */
  openVisitor: (options?: VisitorOptions) => Promise<Visitor>;
  /** The default page's CSP, inline-script and exception watcher. */
  hygiene: Hygiene;
}

interface WorkerFixtures {
  rt: Runtime;
  /** Names of this worker's objects: `<run id>-<label><worker index>` prefixes. */
  scope: (label: string) => ReturnType<typeof names>;
}

function assertClean(hygiene: Hygiene): void {
  expect(hygieneProblems(hygiene), 'dashboard hygiene (CSP, inline scripts, exceptions)').toEqual(
    [],
  );
}

/**
 * Every browser context is instrumented, and the test fails when a page broke the dashboard's
 * strict CSP, contained an inline script or threw. Contexts send a random client address in
 * `X-Forwarded-For` (nginx does the same in production): Better Auth rate-limits sign-ins per
 * address, and the shared development database remembers the counters between runs.
 */
export const test = base.extend<TestFixtures, WorkerFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern
  rt: [async ({}, use) => use(runtime()), { scope: 'worker' }], // eslint-disable-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern

  scope: [
    async ({ rt }, use, workerInfo) => {
      await use((label) => names(rt, `${label}${workerInfo.workerIndex}`));
    },
    { scope: 'worker' },
  ],

  context: async ({ context, rt }, use) => {
    await context.setExtraHTTPHeaders({ 'X-Forwarded-For': randomClientIp(rt) });
    await use(context);
  },

  hygiene: [
    async ({ context, rt }, use) => {
      const hygiene = await instrumentContext(context, rt);
      await use(hygiene);
      assertClean(hygiene);
    },
    { auto: true },
  ],

  openVisitor: async ({ browser, rt }, use, testInfo) => {
    const opened: Visitor[] = [];
    await use(async (options = {}) => {
      const visitor = await openVisitorContext(browser, rt, options);
      opened.push(visitor);
      return visitor;
    });
    for (const visitor of opened) await closeVisitor(visitor, testInfo);
  },
});

export { expect } from '@playwright/test';
