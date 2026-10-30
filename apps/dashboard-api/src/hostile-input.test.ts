// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { apiErrorSchema } from '@consent/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { encodeCursor } from './pagination.js';
import { createTestApp, type TestApp, type TestUser } from './testing/harness.js';
import { describeEnvironments } from './testing/suite.js';

/*
 * Input that passes a shape check but that Postgres refuses (a date that does not exist, year
 * 0000 or 10000, U+0000 in text). Each one must be a 400 VALIDATION_ERROR or BAD_REQUEST, never
 * a 500 with an error-log line. Runs on PGlite and on the real dev database.
 */
describeEnvironments('hostile input', ({ env }) => {
  let t: TestApp;
  let adminCookie: string;
  let userCookie: string;
  let siteKey: string;
  let adminIp: string;
  let target: TestUser;

  const get = (path: string, cookie = userCookie) => t.request('GET', path, { cookie });
  const send = (method: string, path: string, json: unknown) =>
    t.request(method, path, { cookie: adminCookie, ip: adminIp, json });
  const cursor = (payload: Record<string, string>) => encodeCursor(payload);

  async function expectRejected(response: Response, codes: readonly string[], label: string) {
    const text = await response.text();
    expect(response.status, `${label}: ${text}`).toBe(400);
    const body = apiErrorSchema.parse(JSON.parse(text));
    expect(codes, label).toContain(body.error.code);
    expect(text, label).not.toMatch(/Failed query|SQLSTATE|22008|22021|invalid byte/i);
  }

  beforeAll(async () => {
    t = createTestApp(env());
    const admin = await t.createUser({ role: 'admin', label: 'hostile-admin' });
    const user = await t.createUser({ label: 'hostile-user' });
    target = await t.createUser({ label: 'hostile-target' });
    siteKey = (await t.createSite({ label: 'hostile', members: [user] })).key;
    adminCookie = await t.signIn(admin);
    userCookie = await t.signIn(user);
    adminIp = t.nextIp();
  }, 120_000);

  afterAll(async () => {
    await t?.close();
  });

  test.each([
    ['31 February', { g: '2026-02-31 10:00:00', i: 'x' }],
    ['month 13', { g: '2026-13-01 10:00:00', i: 'x' }],
    ['hour 24', { g: '2026-03-01 24:00:00', i: 'x' }],
    ['year 0000', { g: '0000-01-01 00:00:00', i: 'x' }],
    ['NUL in the id', { g: '2026-03-01 10:00:00', i: '\u0000' }],
    ['NUL inside the id', { g: '2026-03-01 10:00:00', i: 'a\u0000b' }],
    ['a T-separated impossible date', { g: '2026-04-31T10:00:00.123456', i: 'x' }],
  ])('a forged consent cursor (%s) is a 400', async (label, payload) => {
    const base = `/api/sites/${siteKey}/consents`;
    await expectRejected(
      await get(`${base}?cursor=${cursor(payload)}`),
      ['BAD_REQUEST', 'VALIDATION_ERROR'],
      label,
    );
  });

  test('a real cursor still works, in both separators', async () => {
    const base = `/api/sites/${siteKey}/consents`;
    for (const g of ['2026-03-01 10:00:00', '2026-03-01T10:00:00.123456']) {
      const response = await get(`${base}?cursor=${cursor({ g, i: 'x' })}`);
      expect(response.status, g).toBe(200);
    }
  });

  test('a NUL in the subject filter is a 400', async () => {
    await expectRejected(
      await get(`/api/sites/${siteKey}/consents?subject=%00`),
      ['VALIDATION_ERROR'],
      'subject',
    );
    await expectRejected(
      await get(`/api/sites/${siteKey}/consents?subject=a%00b`),
      ['VALIDATION_ERROR'],
      'subject inside',
    );
  });

  test.each([
    ['consents to=9999-12-31', 'consents?to=9999-12-31'],
    ['consents to=9999-12-31T23:59:59.999Z', 'consents?to=9999-12-31T23:59:59.999Z'],
    ['consents from=0000-01-01', 'consents?from=0000-01-01'],
    ['csv to=9999-12-31', 'consents.csv?to=9999-12-31'],
    ['csv from=0000-01-01', 'consents.csv?from=0000-01-01'],
    ['stats to=9999-12-31', 'stats?to=9999-12-31'],
    ['stats year 0000', 'stats?from=0000-01-01&to=0000-06-01'],
    ['stats year 0000 timestamps', 'stats?from=0000-01-01T00:00:00Z&to=0000-02-01T00:00:00Z'],
    ['offset that leaves year 9999', 'consents?to=9999-12-31T23:59:59-05:00'],
  ])('a date range outside years 0001-9999 (%s) is a 400', async (label, path) => {
    await expectRejected(await get(`/api/sites/${siteKey}/${path}`), ['VALIDATION_ERROR'], label);
  });

  test('the full valid range still works', async () => {
    const ok = await get(`/api/sites/${siteKey}/consents?from=0001-01-01&to=9999-12-30`);
    expect(ok.status).toBe(200);
    const csv = await get(`/api/sites/${siteKey}/consents.csv?to=9999-12-30`);
    expect(csv.status).toBe(200);
    await csv.text();
  });

  test('a forged audit cursor is a 400', async () => {
    const uuid = '00000000-0000-4000-8000-000000000000';
    for (const stamp of ['2026-02-31T10:00:00.000000Z', '0000-01-01T00:00:00.000000Z']) {
      const response = await t.request(
        'GET',
        `/api/admin/audit?cursor=${cursor({ t: stamp, i: uuid })}`,
        { cookie: adminCookie, ip: adminIp },
      );
      await expectRejected(response, ['BAD_REQUEST', 'VALIDATION_ERROR'], stamp);
    }
  });

  test('admin free text with a NUL is a 400: site name, user name, ban reason, :id', async () => {
    const prefix = env().prefix;
    await expectRejected(
      await send('POST', '/api/admin/sites', {
        key: `${prefix}-nul`,
        name: 'Sh\u0000op',
        domains: ['nul.example.test'],
      }),
      ['VALIDATION_ERROR'],
      'site name',
    );
    await expectRejected(
      await send('POST', '/api/admin/users', {
        name: 'A\u0000lice',
        email: `${prefix}-nul@example.test`,
      }),
      ['VALIDATION_ERROR'],
      'user name',
    );
    await expectRejected(
      await send('PATCH', `/api/admin/users/${target.id}`, { name: '\u0000' }),
      ['VALIDATION_ERROR'],
      'user rename',
    );
    await expectRejected(
      await send('POST', `/api/admin/users/${target.id}/ban`, { reason: 'abu\u0000se' }),
      ['VALIDATION_ERROR'],
      'ban reason',
    );
    for (const action of ['ban', 'unban', 'reset-password', 'revoke-sessions']) {
      await expectRejected(
        await send('POST', `/api/admin/users/%00/${action}`, {}),
        ['VALIDATION_ERROR'],
        `id ${action}`,
      );
    }
    await expectRejected(
      await send('PUT', '/api/admin/users/a%00b/sites', { siteKeys: [] }),
      ['VALIDATION_ERROR'],
      'id sites',
    );
    expect(t.logs.join('\n')).not.toContain('unhandled error');
  });

  test('a NUL in a site key path is a 404, not a database error', async () => {
    const response = await get(`/api/sites/${siteKey}%00/consents`);
    expect(response.status).toBe(404);
    expect(t.logs.join('\n')).not.toContain('unhandled error');
  });

  test('a NUL in the sign-in email never becomes a 500', async () => {
    const response = await t.request('POST', '/api/auth/sign-in/email', {
      json: { email: 'a\u0000b@example.test', password: 'whatever-password-1' },
      ip: t.nextIp(),
    });
    expect(response.status).toBeLessThan(500);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
