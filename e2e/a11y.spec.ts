// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { DashboardClient } from './support/api.js';
import { bootstrapAdmin } from './support/bootstrap.js';
import {
  closeVisitor,
  expect,
  openVisitorContext,
  test,
  type VisitorOptions,
} from './support/fixtures.js';
import type { Runtime } from './support/runtime.js';
import { consentBody, subjectId } from './support/website.js';

/*
 * Scenario 4: accessibility smoke with axe-core. Zero serious or critical violations on the main
 * screens, in light and dark (prefers-color-scheme) and at phone width (390 px), and the page
 * itself never scrolls sideways. Run with data on screen: one site with a few consent records.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const MODES: readonly { name: string; options: VisitorOptions }[] = [
  { name: 'light', options: { colorScheme: 'light', viewport: DESKTOP } },
  { name: 'dark', options: { colorScheme: 'dark', viewport: DESKTOP } },
  { name: 'phone light', options: { colorScheme: 'light', viewport: PHONE } },
  { name: 'phone dark', options: { colorScheme: 'dark', viewport: PHONE } },
];

interface Screen {
  readonly name: string;
  readonly path: (siteKey: string) => string;
  readonly signedIn: boolean;
  /** Resolves when the screen has finished loading its data. */
  readonly ready: (page: Page, world: World) => Promise<void>;
}

interface World {
  readonly siteKey: string;
  readonly siteName: string;
  readonly adminEmail: string;
}

const heading = (page: Page, name: string, level = 1) =>
  expect(page.getByRole('heading', { name, level })).toBeVisible();

const SCREENS: readonly Screen[] = [
  {
    name: 'login',
    path: () => '/login',
    signedIn: false,
    ready: (page) => expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible(),
  },
  {
    name: 'sites list',
    path: () => '/sites',
    signedIn: true,
    ready: async (page, world) => {
      await heading(page, 'Sites');
      await expect(page.getByRole('heading', { name: world.siteName, level: 2 })).toBeVisible();
    },
  },
  {
    name: 'site overview',
    path: (key) => `/sites/${key}`,
    signedIn: true,
    ready: async (page, world) => {
      await heading(page, world.siteName);
      await expect(page.getByRole('figure').first()).toBeVisible();
    },
  },
  {
    name: 'admin users',
    path: () => '/admin/users',
    signedIn: true,
    ready: async (page, world) => {
      await heading(page, 'Users');
      await expect(page.getByRole('row', { name: world.adminEmail })).toBeVisible();
    },
  },
  {
    name: 'consent records',
    path: (key) => `/sites/${key}/consents`,
    signedIn: true,
    ready: async (page) => {
      await expect(
        page.getByRole('table', { name: 'Consent records, newest first' }),
      ).toBeVisible();
    },
  },
  {
    name: 'site setup',
    path: (key) => `/sites/${key}/setup`,
    signedIn: true,
    ready: async (page, world) => {
      await heading(page, world.siteName);
      await expect(page.getByRole('heading', { name: 'Banner script tag' })).toBeVisible();
    },
  },
  {
    name: 'manage sites',
    path: () => '/admin/sites',
    signedIn: true,
    ready: (page) => heading(page, 'Manage sites'),
  },
  {
    name: 'audit log',
    path: () => '/admin/audit',
    signedIn: true,
    ready: async (page) => {
      await heading(page, 'Audit log');
      await expect(
        page.getByRole('table', { name: 'Administrator actions, newest first' }),
      ).toBeVisible();
    },
  },
  {
    name: 'account',
    path: () => '/account',
    signedIn: true,
    ready: (page) => heading(page, 'Account'),
  },
];

let world: World;
let adminPassword = '';

async function seedConsents(rt: Runtime, siteKey: string, host: string): Promise<void> {
  const decisions = [
    { necessary: true, measurement: true, marketing: true },
    { necessary: true, measurement: true, marketing: false },
    { necessary: true, measurement: false, marketing: false },
    { necessary: true, measurement: true, marketing: true },
  ];
  for (const preferences of decisions) {
    const response = await fetch(`${rt.consentApiOrigin}/s/${siteKey}/subjects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://${host}` },
      body: JSON.stringify(consentBody({ domain: host, subject: subjectId(), preferences })),
    });
    if (response.status !== 200) throw new Error(`seeding a consent failed: ${response.status}`);
  }
}

test.beforeAll(async ({ rt, scope }) => {
  const { sites, emails } = scope('a11y');
  const [site] = sites;
  const client = await DashboardClient.firstLogin(rt, await bootstrapAdmin(rt, emails.admin));
  try {
    await client.createSite({ key: site.key, name: site.name, domains: [site.host] });
    await seedConsents(rt, site.key, site.host);
    adminPassword = client.credentials?.password ?? '';
  } finally {
    await client.dispose();
  }
  world = { siteKey: site.key, siteName: site.name, adminEmail: emails.admin };
});

for (const mode of MODES) {
  test.describe(mode.name, () => {
    for (const screen of SCREENS) {
      test(`${screen.name}: no serious or critical violations, no sideways scroll`, async ({
        browser,
        rt,
      }) => {
        // Reduced motion keeps chart animations from changing colours under the scanner.
        const visitor = await openVisitorContext(browser, rt, {
          ...mode.options,
          reducedMotion: 'reduce',
        });
        try {
          const { page, context } = visitor;
          if (screen.signedIn) {
            const response = await context.request.post('/api/auth/sign-in/email', {
              data: { email: world.adminEmail, password: adminPassword },
              headers: { Origin: rt.dashboardOrigin },
            });
            expect(response.status()).toBe(200);
          }
          await page.goto(screen.path(world.siteKey));
          await screen.ready(page, world);

          const scheme = await page.evaluate(
            () => matchMedia('(prefers-color-scheme: dark)').matches,
          );
          expect(scheme).toBe(mode.options.colorScheme === 'dark');

          const results = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
            .analyze();
          const blocking = results.violations
            .filter(
              (violation) => violation.impact === 'serious' || violation.impact === 'critical',
            )
            .map((violation) => ({
              id: violation.id,
              impact: violation.impact,
              help: violation.help,
              targets: violation.nodes.slice(0, 5).map((node) => node.target.join(' ')),
            }));
          expect(blocking, `axe on ${screen.name} (${mode.name})`).toEqual([]);

          const overflow = await page.evaluate(() => ({
            scroll: document.documentElement.scrollWidth,
            client: document.documentElement.clientWidth,
          }));
          expect(overflow.scroll, 'page scrolls sideways').toBeLessThanOrEqual(overflow.client);
        } finally {
          await closeVisitor(visitor, test.info());
        }
      });
    }
  });
}
