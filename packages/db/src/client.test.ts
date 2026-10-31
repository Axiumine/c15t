// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type postgres from 'postgres';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDatabase } from './client.js';
import { createPool } from './pool.js';

/*
 * The pools are replaced by recording fakes, so ping() and close() run without a database.
 * (The real pool settings are covered in pool.test.ts.)
 */
vi.mock('./pool.js', () => ({ createPool: vi.fn() }));

interface FakePool {
  readonly sql: postgres.Sql;
  readonly queries: string[];
  readonly end: ReturnType<typeof vi.fn>;
}

function fakePool(options: { failWith?: Error } = {}): FakePool {
  const queries: string[] = [];
  const end = vi.fn(async () => undefined);
  const tag = async (strings: TemplateStringsArray) => {
    queries.push(strings.join('?'));
    if (options.failWith !== undefined) throw options.failWith;
    return [];
  };
  // drizzle's postgres-js driver registers its type parsers on `options` when it wraps a pool.
  const sql = Object.assign(tag, { end, options: { parsers: {}, serializers: {} } });
  return { sql: sql as unknown as postgres.Sql, queries, end };
}

const createPoolMock = vi.mocked(createPool);
const url = 'postgres://user:pw@db.invalid:5432/app';
const replicaUrl = 'postgres://user:pw@replica.invalid:5432/app';

afterEach(() => {
  createPoolMock.mockReset();
});

describe('createDatabase pools', () => {
  test('the primary pool is named after the app and sized by primaryMax', () => {
    createPoolMock.mockReturnValueOnce(fakePool().sql);
    createDatabase({ primaryUrl: url, applicationName: 'dash', primaryMax: 4 });
    expect(createPoolMock).toHaveBeenCalledTimes(1);
    expect(createPoolMock).toHaveBeenCalledWith({
      url,
      role: 'primary',
      applicationName: 'dash',
      max: 4,
    });
  });

  test('the pool size is left to the pool default when no max is given', () => {
    createPoolMock.mockReturnValue(fakePool().sql);
    createDatabase({ primaryUrl: url, replicaUrl, applicationName: 'dash' });
    const [primary, replica] = createPoolMock.mock.calls.map(([options]) => options);
    expect(primary).toEqual({ url, role: 'primary', applicationName: 'dash' });
    expect(replica).toEqual({
      url: replicaUrl,
      role: 'replica',
      applicationName: 'dash-analytics',
    });
    expect(primary).not.toHaveProperty('max');
    expect(replica).not.toHaveProperty('max');
  });

  test('replicaMax sizes only the replica pool', () => {
    createPoolMock.mockReturnValue(fakePool().sql);
    createDatabase({ primaryUrl: url, replicaUrl, applicationName: 'dash', replicaMax: 2 });
    const [primary, replica] = createPoolMock.mock.calls.map(([options]) => options);
    expect(primary).not.toHaveProperty('max');
    expect(replica).toMatchObject({ role: 'replica', max: 2 });
  });
});

describe('ping', () => {
  test('runs a cheap query on the primary and leaves the replica alone', async () => {
    const primary = fakePool();
    const replica = fakePool();
    createPoolMock.mockReturnValueOnce(primary.sql).mockReturnValueOnce(replica.sql);
    const db = createDatabase({ primaryUrl: url, replicaUrl, applicationName: 'dash' });
    await expect(db.ping()).resolves.toBeUndefined();
    expect(primary.queries).toEqual(['select 1']);
    expect(replica.queries).toEqual([]);
  });

  test('rejects when the primary cannot answer, so /api/health can report it', async () => {
    const down = Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
    createPoolMock.mockReturnValueOnce(fakePool({ failWith: down }).sql);
    const db = createDatabase({ primaryUrl: url, applicationName: 'dash' });
    await expect(db.ping()).rejects.toBe(down);
  });
});

describe('close', () => {
  test('ends the primary and the replica pool with a 5 s grace period', async () => {
    const primary = fakePool();
    const replica = fakePool();
    createPoolMock.mockReturnValueOnce(primary.sql).mockReturnValueOnce(replica.sql);
    const db = createDatabase({ primaryUrl: url, replicaUrl, applicationName: 'dash' });
    await db.close();
    expect(primary.end).toHaveBeenCalledExactlyOnceWith({ timeout: 5 });
    expect(replica.end).toHaveBeenCalledExactlyOnceWith({ timeout: 5 });
  });

  test('ends just the primary pool when there is no replica', async () => {
    const primary = fakePool();
    createPoolMock.mockReturnValueOnce(primary.sql);
    const db = createDatabase({ primaryUrl: url, applicationName: 'dash' });
    await db.close();
    expect(createPoolMock).toHaveBeenCalledTimes(1);
    expect(primary.end).toHaveBeenCalledExactlyOnceWith({ timeout: 5 });
  });
});
