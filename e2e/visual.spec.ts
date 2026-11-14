// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Locator, Page } from '@playwright/test';
import { DashboardClient, newPassword } from './support/api.js';
import { bootstrapAdmin } from './support/bootstrap.js';
import {
  closeVisitor,
  expect,
  openVisitorContext,
  test,
  type VisitorOptions,
} from './support/fixtures.js';
import { consentBody, subjectId } from './support/website.js';

/*
 * Visual regression: screenshots of a few stable dashboard screens, compared with committed
 * baselines. docs/quality-gates.md ("Visual regression") says why this is NOT part of `yarn test:e2e`:
 * the dashboard uses system fonts, so a baseline is only valid on the platform that made it. The
 * baselines belong to the GitHub runner image (ubuntu-24.04, Playwright's Chromium) and are made by
 * the manual workflow .github/workflows/visual.yml, never on a developer machine.
 *
 * Run with `yarn test:e2e:visual` (project `visual`, see playwright.config.ts).
 *
 * What keeps a screenshot reproducible:
 * - fixed viewport, colour scheme, device scale, reduced motion, UTC and en-US (`PINNED` below);
 * - `animations: 'disabled'` and a hidden caret (`expect.toHaveScreenshot` in playwright.config.ts);
 * - everything that depends on the run (the run id in site keys and e-mail addresses, "created"
 *   times, chart data) is masked, or the screen has none (the login page).
 */

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };

interface Shot {
  /** File name of the baseline (`e2e/__screenshots__/visual.spec.ts/<name>.png`). */
  readonly name: string;
  readonly path: string;
  readonly signedIn: boolean;
  readonly options: VisitorOptions;
  /** Resolves when the screen has finished loading its data. */
  readonly ready: (page: Page, runId: string) => Promise<void>;
  /** Regions whose content differs from run to run. They are painted over, the layout stays. */
  readonly mask?: (page: Page, runId: string) => Locator[];
}

const PINNED = {
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'UTC',
  deviceScaleFactor: 1,
} as const;
const light = { ...PINNED, colorScheme: 'light', viewport: DESKTOP } as const;
const dark = { ...PINNED, colorScheme: 'dark', viewport: DESKTOP } as const;
const phoneDark = { ...PINNED, colorScheme: 'dark', viewport: PHONE } as const;

const SHOTS: readonly Shot[] = [
  {
    name: 'login-light',
    path: '/login',
    signedIn: false,
    options: light,
    ready: (page) => expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible(),
  },
  {
    name: 'login-phone-dark',
    path: '/login',
    signedIn: false,
    options: phoneDark,
    ready: (page) => expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible(),
  },
  {
    name: 'sites-list-light',
    path: '/sites',
    signedIn: true,
    options: light,
    // The h1 renders before the sites request returns, so wait for the site card's own heading too
    // (its name carries the run id): otherwise the shot could show the loading skeleton.
    ready: async (page, runId) => {
      await expect(page.getByRole('heading', { name: 'Sites', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: runId, level: 2 })).toBeVisible();
    },
    mask: (page, runId) => [page.getByText(runId)],
  },
  {
    name: 'account-dark',
    path: '/account',
    signedIn: true,
    options: dark,
    ready: (page) => expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible(),
    mask: (page, runId) => [page.getByText(runId)],
  },
];

let userEmail = '';
let userPassword = '';

test.beforeAll(async ({ rt, scope }) => {
  const { sites, emails } = scope('visual');
  const [site] = sites;
  const admin = await DashboardClient.firstLogin(rt, await bootstrapAdmin(rt, emails.admin));
  try {
    await admin.createSite({ key: site.key, name: site.name, domains: [site.host] });
    const created = await admin.createUser({
      name: 'Visual User',
      email: emails.userA,
      siteKeys: [site.key],
    });
    const member = await DashboardClient.firstLogin(rt, {
      email: emails.userA,
      password: created.oneTimePassword,
    });
    userEmail = emails.userA;
    userPassword = member.credentials?.password ?? newPassword();
    await member.dispose();
    for (const preferences of [
      { necessary: true, measurement: true, marketing: true },
      { necessary: true, measurement: false, marketing: false },
    ]) {
      const response = await fetch(`${rt.consentApiOrigin}/s/${site.key}/subjects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: `http://${site.host}` },
        body: JSON.stringify(consentBody({ domain: site.host, subject: subjectId(), preferences })),
      });
      if (response.status !== 200) throw new Error(`seeding a consent failed: ${response.status}`);
    }
  } finally {
    await admin.dispose();
  }
});

for (const shot of SHOTS) {
  test(`screenshot: ${shot.name}`, async ({ browser, rt }) => {
    const visitor = await openVisitorContext(browser, rt, shot.options);
    try {
      const { page, context } = visitor;
      if (shot.signedIn) {
        const response = await context.request.post('/api/auth/sign-in/email', {
          data: { email: userEmail, password: userPassword },
          headers: { Origin: rt.dashboardOrigin },
        });
        expect(response.status()).toBe(200);
      }
      await page.goto(shot.path);
      await shot.ready(page, rt.runId);
      await expect(page).toHaveScreenshot(`${shot.name}.png`, {
        fullPage: true,
        ...(shot.mask === undefined ? {} : { mask: shot.mask(page, rt.runId) }),
      });
    } finally {
      await closeVisitor(visitor, test.info());
    }
  });
}
