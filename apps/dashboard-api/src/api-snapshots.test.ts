// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { afterAll, beforeAll, expect, test } from 'vitest';

import { createApp } from './app.js';
import { silentLogger } from './logger.js';
import {
  closeIfOpen,
  createTestApp,
  TEST_ORIGIN,
  type TestApp,
  type TestUser,
} from './testing/harness.js';
import { normalize, visibleLineEnds } from './testing/normalize.js';
import { describeEnvironments } from './testing/suite.js';

/*
 * Snapshots of what the dashboard hands to other programs: the JSON shapes dashboard-web depends
 * on, the error envelope, and the CSV export that an admin opens in a spreadsheet. A change to any
 * of them is a change of contract: the snapshot diff shows it, and a reviewer decides on purpose.
 *
 * Only stable content is snapshotted. The run prefix, generated ids, "now" timestamps, client
 * addresses and opaque cursors are replaced by labels (testing/normalize.ts); the consents, the
 * clock and the domain data are fixed here. PGlite only: the answers must not depend on a server.
 * Update the files with `yarn vitest run -u apps/dashboard-api/src/api-snapshots.test.ts` and read the diff.
 */

const NOW = '2026-03-15T12:00:00.000Z';

describeEnvironments(
  'API response snapshots',
  ({ env }) => {
    let t: TestApp;
    let admin: TestUser;
    let member: TestUser;
    let outsider: TestUser;
    let adminCookie: string;
    let memberCookie: string;
    let outsiderCookie: string;
    let siteKey: string;
    let siteId: string;
    let tidy: (value: unknown) => unknown;

    // The same application on the same database, with the clock fixed.
    const get = async (path: string, cookie?: string) =>
      createApp({
        env: { BETTER_AUTH_URL: TEST_ORIGIN },
        db: t.db,
        auth: t.auth,
        logger: silentLogger,
        now: () => new Date(NOW),
      }).request(`${TEST_ORIGIN}${path}`, {
        headers: {
          origin: TEST_ORIGIN,
          'x-forwarded-for': t.nextIp(),
          ...(cookie === undefined ? {} : { cookie }),
        },
      });

    const body = async (response: Response) => ({
      status: response.status,
      body: tidy(await response.json()),
    });

    beforeAll(async () => {
      t = createTestApp(env());
      admin = await t.createUser({ role: 'admin', label: 'snap-admin' });
      member = await t.createUser({ label: 'snap-member' });
      outsider = await t.createUser({ label: 'snap-outsider' });
      const site = await t.createSite({ label: 'snap', members: [member] });
      siteKey = site.key;
      siteId = site.id;
      [adminCookie, memberCookie, outsiderCookie] = await Promise.all([
        t.signIn(admin),
        t.signIn(member),
        t.signIn(outsider),
      ]);
      const literals = new Map<string, string>([
        [env().prefix, '<run>'],
        [admin.id, '<admin-id>'],
        [member.id, '<member-id>'],
        [outsider.id, '<outsider-id>'],
        [siteId, '<site-id>'],
        [admin.email, '<admin-email>'],
        [member.email, '<member-email>'],
        [outsider.email, '<outsider-email>'],
      ]);
      tidy = (value) =>
        normalize(value, {
          literals,
          opaqueKeys: new Map([
            ['nextCursor', '<cursor>'],
            ['ip', '<ip>'],
          ]),
          volatileTimeKeys: ['createdAt', 'updatedAt', 'banExpires'],
        });

      const tenantId = siteKey;
      const subject = (name: string) => `${env().prefix}-snap-${name}`;
      await env().seedConsents([
        {
          id: `${env().prefix}-c1`,
          tenantId,
          subjectId: subject('a'),
          externalId: 'customer-1',
          domain: 'shop.example.test',
          givenAt: '2026-03-10 09:30:00',
          choice: { measurement: true, marketing: false },
          jurisdiction: 'GDPR',
          countryCode: 'DE',
          regionCode: 'BE',
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0',
        },
        {
          id: `${env().prefix}-c2`,
          tenantId,
          subjectId: subject('b'),
          domain: 'shop.example.test',
          givenAt: '2026-03-12 18:05:00',
          choice: { measurement: true, marketing: true },
          jurisdiction: 'GDPR',
          countryCode: 'FR',
          userAgent: 'curl/8.9',
        },
        {
          id: `${env().prefix}-c3`,
          tenantId,
          subjectId: subject('c'),
          // Visitor-controlled text a spreadsheet would run, a comma, a quote and a line break.
          externalId: 'a,b "quoted"',
          domain: 'shop.example.test',
          givenAt: '2026-03-14 23:59:59',
          choice: { measurement: false, marketing: false },
          countryCode: 'US',
          regionCode: 'CA',
          userAgent: '=HYPERLINK("https://evil.example","click")\nsecond line',
        },
      ]);
    }, 180_000);

    afterAll(async () => {
      await closeIfOpen(t);
    });

    test('GET /api/me: the signed-in user, for each role', async () => {
      expect({
        admin: await body(await get('/api/me', adminCookie)),
        member: await body(await get('/api/me', memberCookie)),
      }).toMatchSnapshot();
    });

    test('GET /api/sites and /api/sites/:siteKey: list item and detail with the setup text', async () => {
      expect({
        list: await body(await get('/api/sites', memberCookie)),
        detail: await body(await get(`/api/sites/${siteKey}`, memberCookie)),
      }).toMatchSnapshot();
    });

    test('GET /api/sites/:siteKey/stats: totals, volume per day, purposes, jurisdictions', async () => {
      expect(
        await body(
          await get(`/api/sites/${siteKey}/stats?from=2026-03-09&to=2026-03-15`, memberCookie),
        ),
      ).toMatchSnapshot();
    });

    test('GET /api/sites/:siteKey/consents: a page with the cursor of the next one', async () => {
      const first = await get(`/api/sites/${siteKey}/consents?limit=2`, memberCookie);
      const page = (await first.clone().json()) as { nextCursor?: string | null };
      expect(page.nextCursor).toEqual(expect.any(String));
      const second = await get(
        `/api/sites/${siteKey}/consents?limit=2&cursor=${encodeURIComponent(String(page.nextCursor))}`,
        memberCookie,
      );
      expect({ first: await body(first), second: await body(second) }).toMatchSnapshot();
    });

    test('GET /api/sites/:siteKey/consents.csv: header row, quoting and formula guard, byte for byte', async () => {
      const response = await get(`/api/sites/${siteKey}/consents.csv`, memberCookie);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
      // The file name carries the site key and the (fixed) date; the key holds the run prefix.
      expect(
        (response.headers.get('content-disposition') ?? '').replace(env().prefix, '<run>'),
      ).toBe('attachment; filename="consents-<run>-snap-2026-03-15.csv"');
      const text = (await response.text()).replaceAll(env().prefix, '<run>');
      await expect(visibleLineEnds(text)).toMatchFileSnapshot(
        './__snapshots__/consents-export.csv.txt',
      );
    });

    test('GET /api/admin/sites and /api/admin/users: one row each', async () => {
      const sites = (await (await get('/api/admin/sites', adminCookie)).json()) as {
        items: { key: string }[];
      };
      const users = (await (await get('/api/admin/users', adminCookie)).json()) as {
        items: { id: string }[];
      };
      expect({
        site: tidy(sites.items.find((item) => item.key === siteKey)),
        user: tidy(users.items.find((item) => item.id === member.id)),
      }).toMatchSnapshot();
    });

    test('the error envelope: unauthenticated, forbidden, unknown site, invalid query', async () => {
      expect({
        noSession: await body(await get('/api/me')),
        userOnAdminRoute: await body(await get('/api/admin/users', memberCookie)),
        foreignSite: await body(await get(`/api/sites/${siteKey}/stats`, outsiderCookie)),
        invalidRange: await body(
          await get(`/api/sites/${siteKey}/stats?from=2026-03-15&to=2026-03-01`, memberCookie),
        ),
        invalidLimit: await body(await get(`/api/sites/${siteKey}/consents?limit=0`, memberCookie)),
      }).toMatchSnapshot();
    });
  },
  ['pglite'],
);
