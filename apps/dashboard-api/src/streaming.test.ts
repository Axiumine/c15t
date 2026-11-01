// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Database } from '@consent/db';
import { apiErrorSchema } from '@consent/shared';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { closeIfOpen, createTestApp, type TestApp, type TestUser } from './testing/harness.js';
import { describeEnvironments } from './testing/suite.js';

/** A pool wrapper that counts `select` calls and can fail them like a database in failover. */
function instrument(real: Database) {
  const state = {
    selects: 0,
    failNext: 0,
    code: '57P01',
    message: 'terminating connection due to administrator command',
  };
  const pool = new Proxy(real, {
    get(target, property) {
      if (property === 'select') {
        return (...args: unknown[]) => {
          state.selects++;
          if (state.failNext > 0) {
            state.failNext--;
            throw Object.assign(new Error(state.message), { code: state.code });
          }
          return (target.select as (...a: unknown[]) => unknown)(...args);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      const bound: unknown = value.bind(target);
      return bound;
    },
  });
  return { pool, state };
}

const TOTAL = 1100;

describeEnvironments('CSV streaming and failover', ({ env }) => {
  let t: TestApp;
  let user: TestUser;
  let cookie: string;
  let siteKey: string;
  let counters: ReturnType<typeof instrument>['state'];

  beforeAll(async () => {
    const { pool, state } = instrument(env().pools.analytics);
    counters = state;
    t = createTestApp(env(), { analytics: pool });
    user = await t.createUser({ label: 'exporter' });
    const site = await t.createSite({ label: 'export', members: [user] });
    siteKey = site.key;
    cookie = await t.signIn(user);
    await env().seedConsents(
      Array.from({ length: TOTAL }, (_, i) => ({
        tenantId: siteKey,
        subjectId: `${env().prefix}-bulk-${String(i).padStart(5, '0')}`,
        domain: 'bulk.example.test',
        // Distinct minutes, newest last in insertion order.
        givenAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000)
          .toISOString()
          .replace('T', ' ')
          .replace('Z', ''),
        choice: { measurement: i % 2 === 0 },
      })),
    );
  }, 180_000);

  afterAll(async () => {
    await closeIfOpen(t);
  });

  const csv = (query = '') =>
    t.request('GET', `/api/sites/${siteKey}/consents.csv${query}`, { cookie });

  test('streams batch by batch: the first chunk arrives before the rest is read', async () => {
    counters.selects = 0;
    const response = await csv();
    expect(response.status).toBe(200);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();

    const first = await reader.read();
    expect(first.done).toBe(false);
    const firstText = decoder.decode(first.value, { stream: true });
    expect(firstText.startsWith('id,subjectId,')).toBe(true);
    // Purpose codes + batch 1, plus at most one batch pulled ahead. The full export is 4 queries.
    expect(counters.selects).toBeLessThanOrEqual(3);

    let text = firstText;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
    }
    expect(counters.selects).toBe(4);
    const rows = text.trim().split('\r\n');
    expect(rows).toHaveLength(TOTAL + 1);
    expect(new Set(rows.slice(1).map((row) => row.split(',')[1])).size).toBe(TOTAL);
    // Newest first.
    expect(rows[1]).toContain('bulk-01099');
    expect(rows.at(-1)).toContain('bulk-00000');
  });

  test('stops querying when the client goes away', async () => {
    counters.selects = 0;
    const response = await csv();
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    await reader.read();
    await reader.cancel();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(counters.selects).toBeLessThanOrEqual(3);
  });

  test('a date range limits the export', async () => {
    const lines = async (query: string) => (await (await csv(query)).text()).trim().split('\r\n');
    expect(await lines('?from=2026-01-01&to=2026-01-01')).toHaveLength(TOTAL + 1);
    expect(await lines('?to=2026-01-01T00:09:59.999Z')).toHaveLength(10 + 1);
    expect(await lines('?from=2026-01-02')).toHaveLength(1);
    expect((await csv('?from=2026-02-01&to=2026-01-01')).status).toBe(400);
  });

  test('c15t reads use the analytics pool', async () => {
    counters.selects = 0;
    await t.request('GET', `/api/sites/${siteKey}/stats`, { cookie });
    const afterStats = counters.selects;
    expect(afterStats).toBe(4);
    await t.request('GET', `/api/sites/${siteKey}/consents?limit=5`, { cookie });
    expect(counters.selects).toBe(afterStats + 2);
  });

  test('a failover during a read is retried once', async () => {
    counters.failNext = 1;
    const response = await t.request('GET', `/api/sites/${siteKey}/consents?limit=1`, { cookie });
    expect(response.status).toBe(200);
  });

  test.each([
    ['stats', '/stats'],
    ['records', '/consents'],
    ['export', '/consents.csv'],
  ])('a persistent failover on %s is a clean 503 with no database text', async (_name, path) => {
    counters.failNext = 10;
    const response = await t.request('GET', `/api/sites/${siteKey}${path}`, { cookie });
    counters.failNext = 0;
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(apiErrorSchema.parse(JSON.parse(text)).error.code).toBe('SERVICE_UNAVAILABLE');
    expect(text).not.toContain('terminating');
    expect(response.headers.get('content-type')).toContain('application/json');
  });

  test('an unexpected database error is a generic 500 and is logged without its message body', async () => {
    counters.failNext = 1;
    counters.code = '42P01';
    counters.message = 'relation "c15t.consent" does not exist';
    const response = await t.request('GET', `/api/sites/${siteKey}/stats`, { cookie });
    counters.code = '57P01';
    counters.failNext = 0;
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(apiErrorSchema.parse(JSON.parse(text)).error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
    expect(text).not.toContain('relation');
    expect(t.logs.join('\n')).toContain('unhandled error');
  });
});
