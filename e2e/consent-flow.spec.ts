// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { buffer } from 'node:stream/consumers';
import { type Browser, type BrowserContext, request as playwrightRequest } from '@playwright/test';
import { DashboardClient, type SiteSummary } from './support/api.js';
import { bootstrapAdmin } from './support/bootstrap.js';
import { closeVisitor, expect, openVisitorContext, test } from './support/fixtures.js';
import { startNginx, stopNginx, writeSiteFile } from './support/nginx.js';
import type { Runtime } from './support/runtime.js';
import {
  consentBody,
  maskedIp,
  policyOf,
  sitePage,
  subjectId,
  visitorIp,
} from './support/website.js';

/*
 * Scenario 2: the consent flow from a website to the dashboard.
 *
 *   Chromium -> nginx test container (vhost = site key) -> consent-api -> c15t -> Postgres
 *   dashboard-api (as the assigned user) -> consents, stats, CSV
 *
 * Two sites, each with its own nginx vhost and its own assigned reader.
 */

interface ConsentItem {
  readonly id: string;
  readonly subjectId: string;
  readonly domain: string | null;
  readonly purposes: Record<string, boolean>;
  readonly consentAction: string | null;
  readonly countryCode: string | null;
  readonly ipAddress: string | null;
}

test.describe
  .serial('consent flow: website, nginx, consent-api, dashboard', () => {
    let rt: Runtime;
    let siteA: { key: string; host: string; origin: string };
    let siteB: { key: string; host: string; origin: string };
    let admin: DashboardClient;
    let readerA: DashboardClient;
    let readerB: DashboardClient;
    let browserRef: Browser;
    let visitor: BrowserContext;
    const consents = { a: '', b: '' };

    test.beforeAll(async ({ rt: runtimeFixture, scope, browser }) => {
      rt = runtimeFixture;
      browserRef = browser;
      const { sites, emails } = scope('flow');
      const [a, b] = sites;
      const origin = (host: string) => `http://${host}:${rt.ports.nginx}`;
      siteA = { key: a.key, host: a.host, origin: origin(a.host) };
      siteB = { key: b.key, host: b.host, origin: origin(b.host) };

      admin = await DashboardClient.firstLogin(rt, await bootstrapAdmin(rt, emails.admin));
      const created: SiteSummary[] = [];
      for (const site of [a, b]) {
        created.push(
          await admin.createSite({ key: site.key, name: site.name, domains: [site.host] }),
        );
      }
      const readers: DashboardClient[] = [];
      for (const [email, site] of [
        [emails.userA, a],
        [emails.userB, b],
      ] as const) {
        const user = await admin.createUser({
          name: `Reader ${site.key}`,
          email,
          siteKeys: [site.key],
        });
        readers.push(
          await DashboardClient.firstLogin(rt, { email, password: user.oneTimePassword }),
        );
      }
      [readerA, readerB] = readers as [DashboardClient, DashboardClient];

      // The banner tag is the one the Setup screen shows, not a copy kept in the test.
      const { scriptTag } = (
        await admin.json<{ setup: { scriptTag: string } }>('GET', `/api/sites/${a.key}`)
      ).setup;
      expect(scriptTag).toContain('data-categories=');
      writeSiteFile(rt, 'index.html', sitePage(scriptTag));
      await startNginx(rt, { key: a.key, host: a.host }, { key: b.key, host: b.host });
    });

    test.afterAll(async () => {
      await Promise.allSettled([admin?.dispose(), readerA?.dispose(), readerB?.dispose()]);
      await stopNginx(rt);
    });

    /** A browser on the website, with the headers Cloudflare adds in front of nginx. */
    async function openWebsite(country: string, ip: string): Promise<BrowserContext> {
      const context = await browserRef.newContext();
      await context.route('**/api/c15t/**', (route) =>
        route.continue({
          headers: {
            ...route.request().headers(),
            'cf-ipcountry': country,
            'cf-connecting-ip': ip,
          },
        }),
      );
      return context;
    }

    async function consentsOf(client: DashboardClient, site: { key: string }) {
      return (await client.json<{ items: ConsentItem[] }>('GET', `/api/sites/${site.key}/consents`))
        .items;
    }

    test('the banner appears on site A and "Accept All" is stored for tenant A', async () => {
      const ip = visitorIp();
      visitor = await openWebsite('DE', ip);
      const page = await visitor.newPage();
      const init = page.waitForResponse((r) => r.url().includes('/api/c15t/init'));
      const script = page.waitForResponse((r) => r.url().includes('/api/c15t/c15t.js'));
      await page.goto(`${siteA.origin}/index.html`);

      // The script and /init come through nginx, on the website's own origin (README D1).
      const scriptResponse = await script;
      expect(scriptResponse.status()).toBe(200);
      expect(scriptResponse.headers()['server'] ?? '').toContain('nginx');
      expect(scriptResponse.headers()['content-type']).toContain('javascript');
      const initResponse = await init;
      expect(initResponse.status()).toBe(200);
      expect(new URL(initResponse.url()).origin).toBe(siteA.origin);
      // Cloudflare's country reached c15t, so the banner policy resolved.
      expect(await initResponse.json()).toMatchObject({ location: { countryCode: 'DE' } });

      const accept = page.getByRole('button', { name: 'Accept All' });
      await expect(accept).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reject All' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();

      const save = page.waitForResponse((r) => r.url().includes('/api/c15t/subjects'));
      await accept.click();
      const saved = await save;
      expect(saved.request().method()).toBe('POST');
      expect(saved.status()).toBeGreaterThanOrEqual(200);
      expect(saved.status()).toBeLessThan(300);
      expect(saved.headers()['server'] ?? '').toContain('nginx');
      expect(new URL(saved.url()).origin).toBe(siteA.origin);
      const body = (await saved.json()) as { ok: boolean; subjectId: string; domain: string };
      expect(body).toMatchObject({ ok: true, domain: siteA.host });
      consents.a = body.subjectId;
      await expect(accept).toBeHidden();

      // The row exists for tenant A, as the assigned user sees it in the dashboard API.
      const rows = await consentsOf(readerA, siteA);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        subjectId: consents.a,
        domain: siteA.host,
        countryCode: 'DE',
        consentAction: 'accept_all',
        // CF-Connecting-IP -> real_ip -> X-Forwarded-For -> consent-api -> c15t (masked, /24).
        ipAddress: maskedIp(ip),
        purposes: { necessary: true, measurement: true, marketing: true },
      });

      // The decision is remembered: after a reload there is nothing to ask.
      const reinit = page.waitForResponse((r) => r.url().includes('/api/c15t/init'));
      await page.reload();
      expect((await reinit).status()).toBe(200);
      await expect(page.getByRole('button', { name: 'Accept All' })).toBeHidden();
      await page.close();
    });

    test('"Reject All" on site B is stored for tenant B', async () => {
      const context = await openWebsite('FR', visitorIp());
      try {
        const page = await context.newPage();
        await page.goto(`${siteB.origin}/index.html`);
        const save = page.waitForResponse((r) => r.url().includes('/api/c15t/subjects'));
        await page.getByRole('button', { name: 'Reject All' }).click();
        const saved = await save;
        expect(saved.status()).toBe(200);
        consents.b = ((await saved.json()) as { subjectId: string }).subjectId;
      } finally {
        await context.close();
      }
      const rows = await consentsOf(readerB, siteB);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        subjectId: consents.b,
        domain: siteB.host,
        countryCode: 'FR',
        consentAction: 'reject_all',
        purposes: { necessary: true, measurement: false, marketing: false },
      });
    });

    test('each reader sees only their own tenant: list, stats and CSV', async () => {
      expect(consents.a).not.toBe('');
      expect(consents.b).not.toBe('');
      const listed = async (client: DashboardClient, site: { key: string }) =>
        (await consentsOf(client, site)).map((row) => row.subjectId);
      expect(await listed(readerA, siteA)).toEqual([consents.a]);
      expect(await listed(readerB, siteB)).toEqual([consents.b]);
      expect(await listed(admin, siteA)).toEqual([consents.a]);
      expect(await listed(admin, siteB)).toEqual([consents.b]);

      // The other site is a 404 for a reader, on every route.
      for (const path of ['', '/stats', '/consents', '/consents.csv']) {
        expect((await readerA.http.get(`/api/sites/${siteB.key}${path}`)).status(), path).toBe(404);
        expect((await readerB.http.get(`/api/sites/${siteA.key}${path}`)).status(), path).toBe(404);
      }
      // Search by the other tenant's subject id finds nothing, even on one's own site.
      const probe = await readerA.json<{ items: unknown[] }>(
        'GET',
        `/api/sites/${siteA.key}/consents?subject=${consents.b}`,
      );
      expect(probe.items).toEqual([]);

      // Stats: one consent per site, with the opt-in rate per purpose.
      type Stats = {
        totals: { consents: number; subjects: number };
        purposes: { purpose: string; granted: number; denied: number; optInRate: number }[];
      };
      const statsA = await readerA.json<Stats>('GET', `/api/sites/${siteA.key}/stats`);
      expect(statsA.totals).toEqual({ consents: 1, subjects: 1 });
      expect(statsA.purposes.find((p) => p.purpose === 'marketing')).toMatchObject({
        granted: 1,
        denied: 0,
        optInRate: 1,
      });
      const statsB = await readerB.json<Stats>('GET', `/api/sites/${siteB.key}/stats`);
      expect(statsB.totals).toEqual({ consents: 1, subjects: 1 });
      expect(statsB.purposes.find((p) => p.purpose === 'marketing')).toMatchObject({
        granted: 0,
        denied: 1,
        optInRate: 0,
      });

      // CSV: own row, no row of any other tenant.
      const csvA = await (await readerA.http.get(`/api/sites/${siteA.key}/consents.csv`)).text();
      expect(csvA).toContain(consents.a);
      expect(csvA).toContain(siteA.host);
      expect(csvA).not.toContain(consents.b);
      expect(csvA).not.toContain(siteB.host);
      const csvB = await (await readerB.http.get(`/api/sites/${siteB.key}/consents.csv`)).text();
      expect(csvB).toContain(consents.b);
      expect(csvB).not.toContain(consents.a);
      expect(csvB).not.toContain(siteA.host);
      expect(csvA.trim().split('\n')).toHaveLength(2); // header + one record
    });

    test('the assigned user finds the record in the dashboard and exports it', async ({
      browser,
    }) => {
      const reader = await openVisitorContext(browser, rt);
      try {
        const credentials = readerA.credentials;
        if (credentials === undefined) throw new Error('reader A has no credentials');
        const signedIn = await reader.context.request.post('/api/auth/sign-in/email', {
          data: credentials,
          headers: { Origin: rt.dashboardOrigin },
        });
        expect(signedIn.status()).toBe(200);

        const { page } = reader;
        await page.goto(`/sites/${siteA.key}/consents`);
        const row = page.getByRole('row', { name: new RegExp(consents.a) });
        await expect(row).toBeVisible();
        await expect(row).toContainText('DE');
        await row.getByRole('button', { name: 'Details' }).click();
        await expect(page.getByRole('dialog')).toContainText(consents.a);
        await page.keyboard.press('Escape');

        const download = page.waitForEvent('download');
        await page.getByRole('link', { name: 'Export CSV' }).click();
        const file = await download;
        expect(file.suggestedFilename()).toBe(
          `consents-${siteA.key}-${new Date().toISOString().slice(0, 10)}.csv`,
        );
        const stream = await file.createReadStream();
        const csv = (await buffer(stream)).toString('utf8');
        expect(csv).toContain(consents.a);
        expect(csv).not.toContain(consents.b);
      } finally {
        await closeVisitor(reader);
      }
    });

    test('forwarded headers from an untrusted peer are ignored; nginx with Cloudflare headers is honoured', async () => {
      const spoof = {
        'X-Forwarded-For': '198.51.100.99',
        'CF-Connecting-IP': '198.51.100.99',
        'CF-IPCountry': 'FR',
        'X-Vercel-IP-Country': 'FR',
        'X-C15T-Country': 'FR',
        Forwarded: 'for=198.51.100.99',
      };
      const direct = await playwrightRequest.newContext({ baseURL: rt.consentApiOrigin });
      const viaNginx = await playwrightRequest.newContext({ baseURL: rt.nginxOrigin });
      try {
        // 1. Straight to consent-api from the test client, which is not a trusted proxy.
        const bare = await direct.get(`/s/${siteA.key}/init`, { headers: spoof });
        expect(bare.status()).toBe(200);
        const bareLocation = ((await bare.json()) as { location: { countryCode: string | null } })
          .location;
        expect(bareLocation.countryCode).toBeNull();
        // The query override is stripped from every peer, trusted or not.
        const override = await direct.get(`/s/${siteA.key}/init?country=FR&region=BE`, {
          headers: spoof,
        });
        expect(
          ((await override.json()) as { location: { countryCode: string | null } }).location
            .countryCode,
        ).toBeNull();

        // 2. Through nginx, whose Cloudflare headers are real: the country is honoured, and a
        // visitor-supplied override (query or header) does not beat it.
        const hostHeader = { Host: `${siteA.host}:${rt.ports.nginx}` };
        const honoured = await viaNginx.get('/api/c15t/init', {
          headers: { ...hostHeader, 'CF-IPCountry': 'FR', 'X-C15T-Country': 'US' },
        });
        expect(honoured.status()).toBe(200);
        expect(
          ((await honoured.json()) as { location: { countryCode: string | null } }).location
            .countryCode,
        ).toBe('FR');
        const overridden = await viaNginx.get('/api/c15t/init?country=US', {
          headers: { ...hostHeader, 'CF-IPCountry': 'FR' },
        });
        expect(
          ((await overridden.json()) as { location: { countryCode: string | null } }).location
            .countryCode,
        ).toBe('FR');

        // 3. The visitor address, as stored on a saved consent (masked by c15t).
        const policy = policyOf(
          await (
            await viaNginx.get('/api/c15t/init', {
              headers: { ...hostHeader, 'CF-IPCountry': 'DE' },
            })
          ).json(),
        );
        const body = (subject: string) =>
          consentBody({ domain: siteA.host, subject, preferences: { necessary: true }, policy });
        const origin = { Origin: siteA.origin };
        const forged = subjectId();
        const directSave = await direct.post(`/s/${siteA.key}/subjects`, {
          headers: { ...spoof, ...origin },
          data: body(forged),
        });
        expect(directSave.status(), await directSave.text()).toBe(200);
        const real = subjectId();
        const proxied = await viaNginx.post('/api/c15t/subjects', {
          headers: {
            ...hostHeader,
            ...origin,
            'CF-Connecting-IP': '203.0.113.45',
            'X-Forwarded-For': '198.51.100.99',
          },
          data: body(real),
        });
        expect(proxied.status(), await proxied.text()).toBe(200);

        const rows = await consentsOf(readerA, siteA);
        const forgedRow = rows.find((row) => row.subjectId === forged);
        const realRow = rows.find((row) => row.subjectId === real);
        expect(forgedRow, 'direct request stored').toBeDefined();
        expect(realRow, 'nginx request stored').toBeDefined();
        // Neither forged address was believed.
        for (const row of rows) expect(row.ipAddress ?? '').not.toContain('198.51.100');
        expect(forgedRow?.ipAddress ?? null).not.toBe('198.51.100.0');
        expect(realRow?.ipAddress).toBe('203.0.113.0');
      } finally {
        await Promise.all([direct.dispose(), viaNginx.dispose()]);
      }
    });

    test("a site cannot be served under another site's hostname", async () => {
      const direct = await playwrightRequest.newContext({ baseURL: rt.consentApiOrigin });
      try {
        // consent-api checks Host against the domains of the site it was asked for.
        const wrong = await direct.get(`/s/${siteB.key}/init`, { headers: { Host: siteA.host } });
        expect(wrong.status()).toBe(404);
        const unknown = await direct.get(`/s/${rt.runId}-missing/init`);
        expect(unknown.status()).toBe(404);
        const traversal = await direct.get(`/s/${siteA.key}/..%2f${siteB.key}/init`);
        expect(traversal.status()).toBe(400);
      } finally {
        await direct.dispose();
      }
    });

    test('disabling a site stops its banner at once and keeps its records', async () => {
      const viaNginx = await playwrightRequest.newContext({
        baseURL: rt.nginxOrigin,
        extraHTTPHeaders: { Host: `${siteB.host}:${rt.ports.nginx}` },
      });
      try {
        expect((await viaNginx.get('/api/c15t/init')).status()).toBe(200);
        await admin.json('PATCH', `/api/admin/sites/${siteB.key}`, { status: 'disabled' });
        // dashboard-api NOTIFYs, consent-api disposes the instance and answers 404.
        await expect.poll(async () => (await viaNginx.get('/api/c15t/init')).status()).toBe(404);
        expect((await viaNginx.get('/api/c15t/c15t.js')).status()).toBe(404);
        // The reader loses sight of a disabled site; the admin keeps the records.
        expect((await readerB.http.get(`/api/sites/${siteB.key}`)).status()).toBe(404);
        expect((await consentsOf(admin, siteB)).map((row) => row.subjectId)).toEqual([consents.b]);

        await admin.json('PATCH', `/api/admin/sites/${siteB.key}`, { status: 'active' });
        await expect.poll(async () => (await viaNginx.get('/api/c15t/init')).status()).toBe(200);
      } finally {
        await viaNginx.dispose();
      }
    });
  });
