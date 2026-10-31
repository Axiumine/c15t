// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createDatabase } from '@consent/db';
import { beforeEach, expect, test, vi } from 'vitest';
import { type DatabasePools, openDatabase, wrapDatabase } from './db.js';

vi.mock('@consent/db', () => ({ createDatabase: vi.fn() }));

const PRIMARY_URL = 'postgres://dashboard:pw@pg-primary.internal:5432/consent';
const REPLICA_URL = 'postgres://dashboard:pw@pg-replica.internal:5432/consent';

const primaryHandle = { name: 'primary' };
const analyticsHandle = { name: 'analytics' };
const ping = vi.fn(async () => undefined);
const close = vi.fn(async () => undefined);

beforeEach(() => {
  vi.mocked(createDatabase).mockReset();
  vi.mocked(createDatabase).mockReturnValue({
    primary: primaryHandle,
    analytics: analyticsHandle,
    hasReplica: false,
    ping,
    close,
  } as never);
});

test('without a replica the primary pool takes 8 of the 10 connections and serves analytics', () => {
  const db = openDatabase({
    DATABASE_URL_DASHBOARD: PRIMARY_URL,
    DATABASE_URL_DASHBOARD_REPLICA: undefined,
  });
  expect(createDatabase).toHaveBeenCalledExactlyOnceWith({
    primaryUrl: PRIMARY_URL,
    replicaUrl: undefined,
    applicationName: 'c15t-dashboard-api',
    primaryMax: 8,
    replicaMax: 4,
  });
  expect(db.primary).toBe(primaryHandle);
  expect(db.analytics).toBe(analyticsHandle);
});

test('with a replica the pools split 6 and 4, so the total stays at 10', () => {
  openDatabase({
    DATABASE_URL_DASHBOARD: PRIMARY_URL,
    DATABASE_URL_DASHBOARD_REPLICA: REPLICA_URL,
  });
  const options = vi.mocked(createDatabase).mock.calls[0]?.[0];
  expect(options).toMatchObject({ replicaUrl: REPLICA_URL, primaryMax: 6, replicaMax: 4 });
  expect((options?.primaryMax ?? 0) + (options?.replicaMax ?? 0)).toBeLessThanOrEqual(10);
});

test('the application name is configurable, so pg_stat_activity tells the callers apart', () => {
  openDatabase(
    { DATABASE_URL_DASHBOARD: PRIMARY_URL, DATABASE_URL_DASHBOARD_REPLICA: undefined },
    'c15t-platform-admin-create',
  );
  expect(vi.mocked(createDatabase).mock.calls[0]?.[0]).toMatchObject({
    applicationName: 'c15t-platform-admin-create',
  });
});

test('ping and close are handed through from the pools', async () => {
  const db = openDatabase({
    DATABASE_URL_DASHBOARD: PRIMARY_URL,
    DATABASE_URL_DASHBOARD_REPLICA: undefined,
  });
  await db.ping();
  await db.close();
  expect(ping).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});

interface FakeDatabase {
  readonly label: string;
  readonly marker: string;
  who(): FakeDatabase;
}

function fakeDatabase(label: string): FakeDatabase {
  return {
    label,
    marker: `${label}-marker`,
    who() {
      return this;
    },
  };
}

function fakePools() {
  const primary = Object.assign(fakeDatabase('primary'), {
    transaction: vi.fn(async (run: (tx: FakeDatabase) => Promise<unknown>) =>
      run(fakeDatabase('tx')),
    ),
  });
  const pools = {
    primary,
    analytics: fakeDatabase('analytics'),
    ping: async () => undefined,
    close: async () => undefined,
  };
  return { pools, primary };
}

test('wrapDatabase exposes the pools unchanged', () => {
  const { pools } = fakePools();
  const db = wrapDatabase(pools as unknown as DatabasePools);
  expect(db.primary).toBe(pools.primary);
  expect(db.analytics).toBe(pools.analytics);
  expect(db.ping).toBe(pools.ping);
  expect(db.close).toBe(pools.close);
});

test('authDb is the primary pool outside a transaction, for values and methods alike', () => {
  const { pools, primary } = fakePools();
  const authDb = wrapDatabase(pools as unknown as DatabasePools).authDb as unknown as FakeDatabase;
  expect(authDb.marker).toBe('primary-marker');
  expect(authDb.who()).toBe(primary);
});

test('authDb follows the open transaction, across awaits, and returns to the pool afterwards', async () => {
  const { pools } = fakePools();
  const db = wrapDatabase(pools as unknown as DatabasePools);
  const authDb = db.authDb as unknown as FakeDatabase;
  const result = await db.transaction(async (tx) => {
    expect((tx as unknown as FakeDatabase).label).toBe('tx');
    expect(authDb.marker).toBe('tx-marker');
    await Promise.resolve();
    expect(authDb.who()).toBe(tx);
    return 'done';
  });
  expect(result).toBe('done');
  expect(authDb.marker).toBe('primary-marker');
});

test('authDb returns to the pool when the transaction fails, and the failure propagates', async () => {
  const { pools } = fakePools();
  const db = wrapDatabase(pools as unknown as DatabasePools);
  const authDb = db.authDb as unknown as FakeDatabase;
  await expect(
    db.transaction(async () => {
      throw new Error('rolled back');
    }),
  ).rejects.toThrow('rolled back');
  expect(authDb.marker).toBe('primary-marker');
});

test('concurrent transactions each see their own transaction through authDb', async () => {
  const { pools } = fakePools();
  const db = wrapDatabase(pools as unknown as DatabasePools);
  const authDb = db.authDb as unknown as FakeDatabase;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = (tx: unknown) => async () => {
    await gate;
    return authDb.who() === tx;
  };
  const results = await Promise.all([
    db.transaction(async (tx) => {
      const check = seen(tx);
      const pending = check();
      release();
      return pending;
    }),
    db.transaction(async (tx) => seen(tx)()),
  ]);
  expect(results).toEqual([true, true]);
});
