// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { test as base } from '@playwright/test';
import { randomClientIp } from './api.js';
import { type Hygiene, instrumentContext } from './instrument.js';
import { names } from './names.js';
import { type Runtime, runtime } from './runtime.js';
import {
  assertClean,
  closeVisitor,
  openVisitorContext,
  type Visitor,
  type VisitorOptions,
} from './visitor.js';

export { closeVisitor, openVisitorContext, type Visitor, type VisitorOptions };

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
