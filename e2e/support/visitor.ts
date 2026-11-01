// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { randomClientIp } from './api.js';
import { type Hygiene, hygieneProblems, instrumentContext } from './instrument.js';
import type { Runtime } from './runtime.js';

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

export function assertClean(hygiene: Hygiene): void {
  expect(hygieneProblems(hygiene), 'dashboard hygiene (CSP, inline scripts, exceptions)').toEqual(
    [],
  );
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
