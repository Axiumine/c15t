// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Duration, Redacted } from 'effect';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { SiteConfigError } from './errors.js';

/*
 * The pool that every site's c15t instance gets (CLAUDE.md "PostgreSQL (Patroni cluster)"). The
 * real PgClient and the real socket are replaced by recorders, so the test sees exactly what
 * consent-api asks for: pool size, lifetime, timeouts, the `c15t` search path, UTC, and a
 * keepalive socket. Mutation testing showed that no other test looked at any of these values.
 */

const hoisted = vi.hoisted(() => ({
  layer: vi.fn((config: unknown) => ({ config })),
  connect: vi.fn((options: unknown) => ({ socket: options })),
}));

vi.mock('@effect/sql-pg', () => ({ PgClient: { layer: hoisted.layer } }));
vi.mock('node:net', () => ({ connect: hoisted.connect }));

const { assertTrustedOrigins } = await import('./instance-checks.js');
const { createDatabaseLayer } = await import('./instance-database.js');

interface RecordedConfig {
  url: Redacted.Redacted;
  applicationName: string;
  maxConnections: number;
  minConnections: number;
  idleTimeout: Duration.Duration;
  connectionTTL: Duration.Duration;
  connectTimeout: Duration.Duration;
  startupParameters: Record<string, string>;
  prepare: boolean;
  stream?: () => unknown;
}

const base = {
  url: 'postgres://c15t_api:pw@db.internal:5433/consent',
  poolMax: 3,
  prepare: false,
  maxLifetimeSeconds: 240,
};

function configFor(overrides: Partial<typeof base> = {}): RecordedConfig {
  hoisted.layer.mockClear();
  createDatabaseLayer({ ...base, ...overrides });
  return hoisted.layer.mock.calls[0]?.[0] as RecordedConfig;
}

beforeEach(() => {
  hoisted.layer.mockClear();
  hoisted.connect.mockClear();
});

describe('createDatabaseLayer', () => {
  test('pool size, lifetime, timeouts, search path and time zone', () => {
    const config = configFor();
    expect(Redacted.value(config.url)).toBe(base.url);
    expect(JSON.stringify(config.url)).not.toContain('pw');
    expect(config.applicationName).toBe('consent-api');
    expect(config.maxConnections).toBe(3);
    expect(config.minConnections).toBe(0);
    expect(Duration.toMillis(config.idleTimeout)).toBe(30_000);
    expect(Duration.toMillis(config.connectionTTL)).toBe(240_000);
    expect(Duration.toMillis(config.connectTimeout)).toBe(5_000);
    expect(config.startupParameters).toEqual({ search_path: 'c15t', timezone: 'UTC' });
    expect(config.prepare).toBe(false);
    expect(configFor({ prepare: true }).prepare).toBe(true);
    expect(configFor({ poolMax: 1, maxLifetimeSeconds: 60 })).toMatchObject({
      maxConnections: 1,
    });
  });

  test('dials TCP with keepalive and no Nagle delay, on the URL host and port', () => {
    const config = configFor();
    expect(typeof config.stream).toBe('function');
    config.stream?.();
    expect(hoisted.connect).toHaveBeenCalledExactlyOnceWith({
      host: 'db.internal',
      port: 5433,
      noDelay: true,
      keepAlive: true,
      keepAliveInitialDelay: 30_000,
    });
  });

  test('a URL without a port uses 5432', () => {
    configFor({ url: 'postgres://u:p@db.internal/consent' }).stream?.();
    expect(hoisted.connect).toHaveBeenCalledWith(expect.objectContaining({ port: 5432 }));
  });

  test('an IPv6 host is dialled without its brackets', () => {
    configFor({ url: 'postgres://u:p@[::1]:5434/consent' }).stream?.();
    expect(hoisted.connect).toHaveBeenCalledWith(
      expect.objectContaining({ host: '::1', port: 5434 }),
    );
  });

  test('a `?host=` unix-socket URL gets no custom stream', () => {
    const config = configFor({ url: 'postgres://u:p@localhost/consent?host=/var/run/postgresql' });
    expect(config.stream).toBeUndefined();
  });

  test('a URL with no host gets no custom stream', () => {
    expect(configFor({ url: 'postgres:///consent' }).stream).toBeUndefined();
  });
});

describe('assertTrustedOrigins says why a site is refused', () => {
  const reason = (origins: string[]) => {
    try {
      assertTrustedOrigins('shop', origins);
    } catch (error) {
      expect(error).toBeInstanceOf(SiteConfigError);
      return (error as SiteConfigError).message;
    }
    throw new Error('expected a SiteConfigError');
  };

  test('the error names itself and carries the site key', () => {
    const error = new SiteConfigError('shop', 'something is wrong');
    expect(error.name).toBe('SiteConfigError');
    expect(error.siteKey).toBe('shop');
    expect(error.message).toBe('something is wrong');
  });

  test('an empty list', () => {
    expect(reason([])).toContain('trustedOrigins must not be empty');
  });

  test('a wildcard anywhere in the list', () => {
    expect(reason(['shop.example.com', '*.example.com'])).toContain(
      'trustedOrigins must not contain wildcards',
    );
  });

  test('a value that is not a host name', () => {
    expect(reason(['https://shop.example.com'])).toContain(
      'trustedOrigins contains an invalid host name',
    );
  });
});
