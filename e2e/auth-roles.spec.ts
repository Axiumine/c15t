// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { request as playwrightRequest } from '@playwright/test';
import { DashboardClient, newPassword } from './support/api.js';
import { bootstrapAdmin, type Credentials } from './support/bootstrap.js';
import {
  closeVisitor,
  expect,
  openVisitorContext,
  test,
  type Visitor,
} from './support/fixtures.js';
import { mainNav, signInUi, signOutUi, userRow } from './support/ui.js';

/*
 * Scenario 1: authentication and roles, through the real UI, dashboard-api and database.
 * The tests share state (the admin, two sites, two users), so they run in order in one worker.
 */

interface CreatedUser {
  readonly email: string;
  readonly oneTimePassword: string;
  password: string;
}

test.describe
  .serial('authentication and roles', () => {
    let admin: Credentials;
    let userA: CreatedUser;
    let userB: CreatedUser;
    let visitorA: Visitor;
    let adminId = '';

    test.beforeAll(async ({ rt, scope, browser }) => {
      admin = await bootstrapAdmin(rt, scope('auth').emails.admin);
      visitorA = await openVisitorContext(browser, rt);
    });

    test.afterAll(async () => {
      await closeVisitor(visitorA);
    });

    test('a new admin must change the one-time password before anything else', async ({ page }) => {
      await signInUi(page, admin);

      // The account screen is the only screen: no navigation, and every other route comes back.
      await expect(page).toHaveURL(/\/account$/);
      await expect(page.getByRole('heading', { name: 'Account', level: 1 })).toBeVisible();
      await expect(page.getByText('Choose a new password to continue')).toBeVisible();
      await expect(mainNav(page)).toHaveCount(0);
      for (const path of [
        '/sites',
        '/admin/users',
        '/admin/sites',
        '/admin/audit',
        '/admin/overview',
      ]) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/account$/);
      }

      // The API refuses too, whatever the UI shows: only /api/me and the password change work.
      for (const path of ['/api/sites', '/api/admin/users', '/api/admin/audit']) {
        const response = await page.request.get(path);
        expect(response.status(), path).toBe(403);
        expect(await response.json()).toMatchObject({
          error: { code: 'PASSWORD_CHANGE_REQUIRED' },
        });
      }
      const me = await page.request.get('/api/me');
      expect(me.status()).toBe(200);
      expect(await me.json()).toMatchObject({
        email: admin.email,
        role: 'admin',
        mustChangePassword: true,
      });

      // A mismatch is caught by the form before any request is sent.
      await page.getByLabel('Current password').fill(admin.password);
      await page.getByLabel('New password', { exact: true }).fill(newPassword());
      await page.getByLabel('Repeat new password').fill('something else entirely');
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(page.getByText('The passwords do not match')).toBeVisible();

      const next = newPassword();
      await page.getByLabel('New password', { exact: true }).fill(next);
      await page.getByLabel('Repeat new password').fill(next);
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(page).toHaveURL(/\/sites$/);
      await expect(mainNav(page).getByRole('link', { name: 'Manage sites' })).toBeVisible();
      admin = { email: admin.email, password: next };
      const after = await page.request.get('/api/me');
      expect(await after.json()).toMatchObject({ mustChangePassword: false });
      adminId = ((await after.json()) as { id: string }).id;
      expect(adminId).not.toBe('');
    });

    test('the admin creates two sites', async ({ page, scope }) => {
      const { sites } = scope('auth');
      await signInUi(page, admin);
      await expect(page).toHaveURL(/\/sites$/);
      await mainNav(page).getByRole('link', { name: 'Manage sites' }).click();
      await expect(page.getByRole('heading', { name: 'Manage sites', level: 1 })).toBeVisible();

      for (const site of [sites[0], sites[1]]) {
        await page.getByRole('button', { name: 'New site' }).first().click(); // an empty list repeats the action
        const dialog = page.getByRole('dialog', { name: 'New site' });
        await dialog.getByLabel('Site key').fill(site.key);
        await dialog.getByLabel('Name', { exact: true }).fill(site.name);
        await dialog.getByLabel('Domains').fill(site.host);
        await dialog.getByRole('button', { name: 'Create site' }).click();
        await expect(dialog).toBeHidden();
        await expect(page.getByRole('row', { name: site.key })).toBeVisible();
      }

      // A key is unique: the form shows the clash on the field.
      await page.getByRole('button', { name: 'New site' }).first().click(); // an empty list repeats the action
      const dialog = page.getByRole('dialog', { name: 'New site' });
      await dialog.getByLabel('Site key').fill(sites[0].key);
      await dialog.getByLabel('Name', { exact: true }).fill('Duplicate');
      await dialog.getByLabel('Domains').fill(`other-${sites[0].host}`);
      await dialog.getByRole('button', { name: 'Create site' }).click();
      await expect(dialog.getByText('This site key is already in use')).toBeVisible();
    });

    test('the admin creates two users and sees each one-time password only once', async ({
      page,
      scope,
    }) => {
      const { sites, emails } = scope('auth');
      await signInUi(page, admin);
      await mainNav(page).getByRole('link', { name: 'Users' }).click();
      await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();

      const created: CreatedUser[] = [];
      for (const [email, site, name] of [
        [emails.userA, sites[0], 'E2E User A'],
        [emails.userB, sites[1], 'E2E User B'],
      ] as const) {
        await page.getByRole('button', { name: 'New user' }).click();
        const form = page.getByRole('dialog', { name: 'New user' });
        await form.getByLabel('Name', { exact: true }).fill(name);
        await form.getByLabel('Email').fill(email);
        await form.getByRole('checkbox', { name: site.key }).check();
        await form.getByRole('button', { name: 'Create user' }).click();

        const secret = page.getByRole('dialog', { name: 'User created' });
        await expect(secret).toBeVisible();
        const oneTimePassword = await secret.getByLabel('One-time password').inputValue();
        expect(oneTimePassword.length).toBeGreaterThanOrEqual(12);

        // Only the button closes it: Escape and a click outside must not lose the password.
        await page.keyboard.press('Escape');
        await expect(secret).toBeVisible();
        await secret.getByRole('button', { name: 'I have stored the password' }).click();
        await expect(secret).toBeHidden();

        // Gone: not in the page, not in browser storage, not in the API's user list.
        await expect(page.getByLabel('One-time password')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(oneTimePassword);
        const storage = await page.evaluate(() =>
          JSON.stringify([
            Object.fromEntries(Object.entries(localStorage)),
            Object.fromEntries(Object.entries(sessionStorage)),
            document.cookie,
          ]),
        );
        expect(storage).not.toContain(oneTimePassword);
        const listing = await page.request.get('/api/admin/users');
        expect(await listing.text()).not.toContain(oneTimePassword);
        await page.reload();
        await expect(page.getByRole('row', { name: email })).toBeVisible();
        await expect(page.locator('body')).not.toContainText(oneTimePassword);

        created.push({ email, oneTimePassword, password: oneTimePassword });
      }
      const [a, b] = created;
      if (a === undefined || b === undefined) throw new Error('users were not created');
      userA = a;
      userB = b;

      // The table shows the assignment: A has site 1 only, B has site 2 only.
      await expect(await userRow(page, userA.email)).toContainText(sites[0].key);
      await expect(await userRow(page, userA.email)).not.toContainText(sites[1].key);
      await expect(await userRow(page, userB.email)).toContainText(sites[1].key);
      await expect(await userRow(page, userA.email)).toContainText('Password change pending');
    });

    test('user A must change the password, then sees only site 1', async ({ scope, rt }) => {
      const { sites } = scope('auth');
      const { page } = visitorA;
      userA.password = newPassword();
      await signInUi(page, { email: userA.email, password: userA.oneTimePassword });

      // Forced password change: nothing else is reachable until it is done.
      await expect(page).toHaveURL(/\/account$/);
      await expect(mainNav(page)).toHaveCount(0);
      await page.goto(`/sites/${sites[0].key}`);
      await expect(page).toHaveURL(/\/account$/);
      expect((await page.request.get(`/api/sites/${sites[0].key}`)).status()).toBe(403);
      await page.getByLabel('Current password').fill(userA.oneTimePassword);
      await page.getByLabel('New password', { exact: true }).fill(userA.password);
      await page.getByLabel('Repeat new password').fill(userA.password);
      await page.getByRole('button', { name: 'Change password' }).click();
      await expect(page).toHaveURL(/\/sites$/);

      // Only site 1, and no admin navigation.
      await expect(page.getByRole('heading', { name: sites[0].name, level: 2 })).toBeVisible();
      await expect(page.getByText(sites[1].name)).toHaveCount(0);
      await expect(mainNav(page).getByRole('link')).toHaveText(['Sites']);
      for (const admin of ['Users', 'Manage sites', 'Audit log', 'Overview']) {
        await expect(mainNav(page).getByRole('link', { name: admin })).toHaveCount(0);
      }
      await page.getByRole('link', { name: sites[0].name }).click();
      await expect(page).toHaveURL((url) => url.pathname === `/sites/${sites[0].key}`);
      await expect(page.getByRole('heading', { name: sites[0].name, level: 1 })).toBeVisible();
      await page.getByRole('link', { name: 'Consent records' }).click();
      await expect(page).toHaveURL((url) => url.pathname === `/sites/${sites[0].key}/consents`);
      await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();

      // Direct navigation to site 2 looks exactly like a site that does not exist.
      await page.goto(`/sites/${sites[1].key}`);
      await expect(page.getByText('Site not found')).toBeVisible();
      await page.goto(`/sites/${rt.runId}-does-not-exist`);
      await expect(page.getByText('Site not found')).toBeVisible();

      // The API: 404 for site 2 on every route of the group, 200 for site 1.
      for (const path of ['', '/stats', '/consents', '/consents.csv']) {
        const other = await page.request.get(`/api/sites/${sites[1].key}${path}`);
        expect(other.status(), `site 2 ${path}`).toBe(404);
        const own = await page.request.get(`/api/sites/${sites[0].key}${path}`);
        expect(own.status(), `site 1 ${path}`).toBe(200);
      }
      const mine = await page.request.get('/api/sites');
      const listed = ((await mine.json()) as { items: { key: string }[] }).items.map((s) => s.key);
      expect(listed).toEqual([sites[0].key]);

      // Admin screens bounce to the sites list, and the admin API answers 403.
      for (const path of ['/admin/users', '/admin/sites', '/admin/audit', '/admin/overview']) {
        await page.goto(path);
        await expect(page).toHaveURL(/\/sites$/);
        await expect(page.getByRole('heading', { name: 'Sites', level: 1 })).toBeVisible();
      }
      for (const path of ['/api/admin/users', '/api/admin/sites', '/api/admin/audit']) {
        expect((await page.request.get(path)).status(), path).toBe(403);
      }
      const write = await page.request.post('/api/admin/sites', {
        headers: { Origin: rt.dashboardOrigin },
        data: { key: `${rt.runId}-nope`, name: 'Nope', domains: ['nope.test'] },
      });
      expect(write.status()).toBe(403);
      const grant = await page.request.put(`/api/admin/users/${adminId}/sites`, {
        headers: { Origin: rt.dashboardOrigin },
        data: { siteKeys: [sites[1].key] },
      });
      expect(grant.status()).toBe(403);
    });

    test('banning user A ends their access at the next call', async ({ page, scope, rt }) => {
      const { emails, sites } = scope('auth');
      await signInUi(page, admin);
      const row = await userRow(page, emails.userA);
      await row.getByRole('button', { name: `Actions for ${emails.userA}` }).click();
      await page.getByRole('menuitem', { name: 'Ban user' }).click();
      const dialog = page.getByRole('dialog', { name: 'Ban user' });
      await dialog.getByLabel('Reason (optional)').fill('e2e: ban check');
      await dialog.getByRole('button', { name: 'Ban user' }).click();
      await expect(dialog).toBeHidden();
      await expect(row).toContainText('Banned');
      await expect(row).toContainText('e2e: ban check');

      // A's session is still in A's browser, and the server refuses it.
      const { page: pageA } = visitorA;
      for (const path of ['/api/me', '/api/sites']) {
        expect((await pageA.request.get(path)).status(), path).toBe(401);
      }
      await pageA.reload();
      await expect(pageA).toHaveURL(/\/login/);

      // And signing in again fails with a message.
      await pageA.getByLabel('Email').fill(userA.email);
      await pageA.getByLabel('Password').fill(userA.password);
      await pageA.getByRole('button', { name: 'Sign in' }).click();
      await expect(pageA.getByRole('alert')).toBeVisible();
      await expect(pageA).toHaveURL(/\/login/);

      // User B is not affected, and sees site 2 only: the same rule from the other side.
      const clientB = await DashboardClient.firstLogin(rt, {
        email: userB.email,
        password: userB.oneTimePassword,
      });
      try {
        const sitesOfB = await clientB.json<{ items: { key: string }[] }>('GET', '/api/sites');
        expect(sitesOfB.items.map((site) => site.key)).toEqual([sites[1].key]);
        expect((await clientB.http.get(`/api/sites/${sites[0].key}`)).status()).toBe(404);
      } finally {
        await clientB.dispose();
      }
    });

    test('the audit log shows every administrator action', async ({ page, scope, rt }) => {
      const { sites } = scope('auth');
      await signInUi(page, admin);
      await mainNav(page).getByRole('link', { name: 'Audit log' }).click();
      await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
      const table = page.getByRole('table', { name: 'Administrator actions, newest first' });
      for (const site of [sites[0], sites[1]]) {
        await expect(
          table.getByRole('row').filter({ hasText: 'Site created' }).filter({ hasText: site.key }),
        ).toBeVisible();
      }
      await expect(table.getByRole('row', { name: /User created/ }).first()).toBeVisible();
      await expect(table.getByRole('row', { name: /User banned/ }).first()).toBeVisible();

      // The same facts through the API, with the actor and the client address that nginx would set.
      const audit = await page.request.get('/api/admin/audit?limit=50');
      expect(audit.status()).toBe(200);
      const entries = (
        (await audit.json()) as {
          items: {
            action: string;
            actorEmail: string | null;
            targetId: string;
            ip: string | null;
          }[];
        }
      ).items.filter((entry) => entry.actorEmail === admin.email);
      const actions = entries.map((entry) => entry.action);
      expect(actions.filter((action) => action === 'site.create')).toHaveLength(2);
      expect(actions.filter((action) => action === 'user.create')).toHaveLength(2);
      expect(actions).toContain('user.ban');
      const createdTarget = entries.find((entry) => entry.action === 'site.create')?.targetId;
      expect(createdTarget?.startsWith(`${rt.runId}-`), createdTarget).toBe(true);
      // Each browser context sent its own X-Forwarded-For (198.18.0.0/15), as nginx would.
      for (const entry of entries) expect(entry.ip, entry.action).toMatch(/^198\.1[89]\./);
    });

    test('signing out invalidates the session on the server', async ({ page, context, rt }) => {
      await signInUi(page, admin);
      await expect(page).toHaveURL(/\/sites$/);
      const stolen = await context.cookies();
      expect(stolen.some((cookie) => cookie.httpOnly)).toBe(true);
      await signOutUi(page);

      expect((await page.request.get('/api/me')).status()).toBe(401);
      await page.goto('/sites');
      await expect(page).toHaveURL(/\/login/);
      await page.goBack();
      await expect(page).toHaveURL(/\/login/);

      // Deleting the cookie is not enough: the old token itself no longer works.
      const replay = await playwrightRequest.newContext({
        baseURL: rt.dashboardOrigin,
        storageState: { cookies: stolen, origins: [] },
      });
      try {
        expect((await replay.get('/api/me')).status()).toBe(401);
      } finally {
        await replay.dispose();
      }
    });
  });
