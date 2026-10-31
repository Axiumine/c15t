// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type postgres from 'postgres';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createPgSiteStore } from './site-store.js';

afterEach(() => {
  vi.useRealTimers();
});

// retryRead waits before its retry: fake timers keep that wait out of the test run.
async function afterRetryDelay<T>(work: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(1_000);
  return work;
}

/*
 * The store against a stand-in for the postgres.js tag: the queries themselves run against the
 * real database in integration.test.ts. Here only what the store does with the rows is checked.
 */

function fakeSql(...answers: Array<unknown[] | Error>) {
  const queue = [...answers];
  const calls: string[] = [];
  const sql = vi.fn(async (strings: TemplateStringsArray, ..._values: unknown[]) => {
    calls.push(strings.join('?'));
    const answer = queue.shift();
    if (answer === undefined) throw new Error('unexpected query');
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return { sql: sql as unknown as postgres.Sql, calls, remaining: () => queue.length };
}

const row = {
  key: 'shop',
  domains: ['shop.example.com'],
  policy_preset: 'eu-opt-in',
  status: 'active',
};

describe('createPgSiteStore.find', () => {
  test('maps the row to a site record', async () => {
    const { sql, calls } = fakeSql([row]);
    await expect(createPgSiteStore(sql).find('shop')).resolves.toEqual({
      key: 'shop',
      domains: ['shop.example.com'],
      policyPreset: 'eu-opt-in',
      status: 'active',
    });
    expect(calls[0]).toContain('from app.site where key =');
  });

  test('returns null when no row has the key', async () => {
    const { sql } = fakeSql([]);
    await expect(createPgSiteStore(sql).find('nope-nope')).resolves.toBeNull();
  });

  test('returns a disabled site with its status', async () => {
    const { sql } = fakeSql([{ ...row, status: 'disabled' }]);
    expect((await createPgSiteStore(sql).find('shop'))?.status).toBe('disabled');
  });

  test.each([
    ['an unknown policy preset', { ...row, policy_preset: 'anything-goes' }],
    ['an unknown status', { ...row, status: 'paused' }],
    ['domains that are not a list', { ...row, domains: 'shop.example.com' }],
    ['a missing key', { ...row, key: undefined }],
  ])('refuses a row with %s', async (_label, bad) => {
    const { sql } = fakeSql([bad]);
    await expect(createPgSiteStore(sql).find('shop')).rejects.toThrow();
  });

  test('retries a read once after a failover error', async () => {
    const failover = Object.assign(new Error('terminating connection'), { code: '57P01' });
    const { sql, remaining } = fakeSql(failover, [row]);
    vi.useFakeTimers();
    const found = await afterRetryDelay(createPgSiteStore(sql).find('shop'));
    expect(found?.key).toBe('shop');
    expect(remaining()).toBe(0);
  });

  test('does not retry an error that is not a failover', async () => {
    const { sql, remaining } = fakeSql(new Error('syntax error'), [row]);
    await expect(createPgSiteStore(sql).find('shop')).rejects.toThrow('syntax error');
    expect(remaining()).toBe(1);
  });
});

describe('createPgSiteStore.check', () => {
  test('reports the number of active sites when the schema is there', async () => {
    const { sql, calls } = fakeSql([{ schema_ok: true, active_sites: 7 }]);
    await expect(createPgSiteStore(sql).check()).resolves.toEqual({ activeSites: 7 });
    expect(calls[0]).toContain("to_regclass('c15t.subject')");
  });

  test('rejects, naming the fix, when the c15t schema is missing', async () => {
    const { sql } = fakeSql([{ schema_ok: false, active_sites: 0 }]);
    await expect(createPgSiteStore(sql).check()).rejects.toThrow(/c15t schema is missing/);
  });

  test('rejects an answer of the wrong shape', async () => {
    const { sql } = fakeSql([{ schema_ok: true }]);
    await expect(createPgSiteStore(sql).check()).rejects.toThrow();
  });

  test('retries once after a failover error', async () => {
    const failover = Object.assign(new Error('read only'), { code: '25006' });
    const { sql } = fakeSql(failover, [{ schema_ok: true, active_sites: 1 }]);
    vi.useFakeTimers();
    const checked = await afterRetryDelay(createPgSiteStore(sql).check());
    expect(checked).toEqual({ activeSites: 1 });
  });
});
