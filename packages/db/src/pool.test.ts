// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test } from 'vitest';
import { createDatabase } from './client.js';
import { createPool, POOL_MAX_CEILING } from './pool.js';

// postgres.js connects lazily, so none of these tests opens a socket.
const url = 'postgres://user:pw@db.invalid:5432/app';

describe('createPool', () => {
  test('primary pools demand a read-write session and the failover timeouts', async () => {
    const sql = createPool({ url, role: 'primary', applicationName: 'test' });
    expect(sql.options.target_session_attrs).toBe('read-write');
    expect(sql.options.connect_timeout).toBe(5);
    expect(sql.options.max_lifetime).toBe(300);
    expect(sql.options.keep_alive).toBe(30);
    expect(sql.options.max).toBe(5);
    expect(sql.options.connection.application_name).toBe('test');
    expect(sql.options.connection.TimeZone).toBe('UTC');
    await sql.end({ timeout: 0 });
  });

  test('replica pools prefer a standby', async () => {
    const sql = createPool({ url, role: 'replica', applicationName: 'test' });
    expect(sql.options.target_session_attrs).toBe('prefer-standby');
    await sql.end({ timeout: 0 });
  });

  test('caps the pool size and honours a custom lifetime', async () => {
    const big = createPool({ url, role: 'primary', applicationName: 't', max: 500 });
    const small = createPool({
      url,
      role: 'primary',
      applicationName: 't',
      max: 0,
      maxLifetimeSeconds: 60,
    });
    expect(big.options.max).toBe(POOL_MAX_CEILING);
    expect(small.options.max).toBe(1);
    expect(small.options.max_lifetime).toBe(60);
    await Promise.all([big.end({ timeout: 0 }), small.end({ timeout: 0 })]);
  });
});

describe('createDatabase', () => {
  test('without a replica, analytics is the primary', async () => {
    const db = createDatabase({ primaryUrl: url, applicationName: 'test' });
    expect(db.hasReplica).toBe(false);
    expect(db.analytics).toBe(db.primary);
    await db.close();
  });

  test('an empty replica URL counts as unset', async () => {
    const db = createDatabase({ primaryUrl: url, replicaUrl: '', applicationName: 'test' });
    expect(db.hasReplica).toBe(false);
    await db.close();
  });

  test('with a replica, analytics is a separate pool', async () => {
    const db = createDatabase({
      primaryUrl: url,
      replicaUrl: 'postgres://user:pw@replica.invalid:5432/app',
      applicationName: 'test',
      primaryMax: 4,
      replicaMax: 2,
    });
    expect(db.hasReplica).toBe(true);
    expect(db.analytics).not.toBe(db.primary);
    await db.close();
  });
});
