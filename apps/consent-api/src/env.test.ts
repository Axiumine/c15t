// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { afterEach, describe, expect, test, vi } from 'vitest';
import { EnvError, loadEnv, parseEnv } from './env.js';

const required = {
  DATABASE_URL_C15T: 'postgres://c15t_api:secret-pw@pg-primary.internal:5432/consent',
  C15T_ADMIN_API_KEY: 'k'.repeat(32),
};

function issuesFor(source: Record<string, string | undefined>): readonly string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.issues;
    throw error;
  }
  throw new Error('parseEnv accepted the environment');
}

describe('parseEnv', () => {
  test('applies the network defaults from CLAUDE.md', () => {
    const env = parseEnv(required);
    expect(env.CONSENT_API_HOST).toBe('127.0.0.1');
    expect(env.CONSENT_API_PORT).toBe(4100);
    expect(env.CONSENT_API_TRUSTED_PROXIES).toEqual(['127.0.0.1/32', '::1/128']);
    expect(env.CONSENT_API_INSTANCE_POOL_MAX).toBe(2);
    expect(env.CONSENT_API_REGISTRY_POOL_MAX).toBe(2);
    expect(env.CONSENT_API_DB_PREPARE).toBe(true);
  });

  test('treats empty values like unset ones', () => {
    const env = parseEnv({ ...required, CONSENT_API_HOST: '', CONSENT_API_PORT: '' });
    expect(env.CONSENT_API_HOST).toBe('127.0.0.1');
    expect(env.CONSENT_API_PORT).toBe(4100);
  });

  test.each([
    '127.0.0.1',
    '::1',
    '10.1.2.3',
    '172.20.0.5',
    '192.168.1.10',
    '100.64.0.7',
    'fd00::5',
  ])('accepts the bind address %s', (host) => {
    expect(parseEnv({ ...required, CONSENT_API_HOST: host }).CONSENT_API_HOST).toBe(host);
  });

  test.each(['0.0.0.0', '::', '8.8.8.8', '203.0.113.9', '2001:db8::1', 'example.com'])(
    'rejects the bind address %s',
    (host) => {
      expect(issuesFor({ ...required, CONSENT_API_HOST: host })[0]).toMatch(/^CONSENT_API_HOST:/);
    },
  );

  test.each(['80', '1023', '65536', 'abc', '4100.5', '-1'])('rejects the port %s', (port) => {
    expect(issuesFor({ ...required, CONSENT_API_PORT: port })[0]).toMatch(/^CONSENT_API_PORT:/);
  });

  test('parses a custom port and a trusted proxy list', () => {
    const env = parseEnv({
      ...required,
      CONSENT_API_PORT: '4300',
      CONSENT_API_TRUSTED_PROXIES: '10.0.0.0/8, fd00::/8',
    });
    expect(env.CONSENT_API_PORT).toBe(4300);
    expect(env.CONSENT_API_TRUSTED_PROXIES).toEqual(['10.0.0.0/8', 'fd00::/8']);
  });

  test.each(['10.0.0.1', '10.0.0.0/33', 'not-a-cidr', ','])(
    'rejects the trusted proxy list "%s"',
    (value) => {
      expect(issuesFor({ ...required, CONSENT_API_TRUSTED_PROXIES: value })[0]).toMatch(
        /^CONSENT_API_TRUSTED_PROXIES(?:\.\d+|):/,
      );
    },
  );

  test('requires the database URL and the API key', () => {
    const issues = issuesFor({});
    expect(issues.some((issue) => issue.startsWith('DATABASE_URL_C15T:'))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('C15T_ADMIN_API_KEY:'))).toBe(true);
  });

  test('rejects a database URL that is not postgres, and never echoes it', () => {
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- test input: a made-up URL whose password the test proves is never echoed
    const secret = 'mysql://user:hunter2@db.internal/app';
    const issues = issuesFor({ ...required, DATABASE_URL_C15T: secret });
    expect(issues[0]).toMatch(/^DATABASE_URL_C15T:/);
    expect(issues.join('\n')).not.toContain('hunter2');
  });

  test.each(['not a url', 'postgres://', '//db.internal/app'])(
    'rejects a database URL that is unparseable or has no host: "%s"',
    (value) => {
      const issues = issuesFor({ ...required, DATABASE_URL_C15T: value });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatch(/^DATABASE_URL_C15T:/);
    },
  );

  test('rejects a short API key', () => {
    expect(issuesFor({ ...required, C15T_ADMIN_API_KEY: 'short' })[0]).toMatch(
      /^C15T_ADMIN_API_KEY:/,
    );
  });

  test('keeps the pools small and parses the prepared statement switch', () => {
    expect(issuesFor({ ...required, CONSENT_API_INSTANCE_POOL_MAX: '4' })[0]).toMatch(
      /^CONSENT_API_INSTANCE_POOL_MAX:/,
    );
    expect(issuesFor({ ...required, CONSENT_API_REGISTRY_POOL_MAX: '0' })[0]).toMatch(
      /^CONSENT_API_REGISTRY_POOL_MAX:/,
    );
    const env = parseEnv({
      ...required,
      CONSENT_API_INSTANCE_POOL_MAX: '3',
      CONSENT_API_DB_PREPARE: 'false',
    });
    expect(env.CONSENT_API_INSTANCE_POOL_MAX).toBe(3);
    expect(env.CONSENT_API_DB_PREPARE).toBe(false);
    expect(issuesFor({ ...required, CONSENT_API_DB_PREPARE: 'yes' })[0]).toMatch(
      /^CONSENT_API_DB_PREPARE:/,
    );
  });
});

describe('loadEnv', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('parses process.env, the only place that reads it', () => {
    vi.stubEnv('DATABASE_URL_C15T', required.DATABASE_URL_C15T);
    vi.stubEnv('C15T_ADMIN_API_KEY', required.C15T_ADMIN_API_KEY);
    vi.stubEnv('CONSENT_API_HOST', '10.1.2.3');
    vi.stubEnv('CONSENT_API_PORT', '4300');
    vi.stubEnv('CONSENT_API_TRUSTED_PROXIES', '10.0.0.0/8');
    vi.stubEnv('CONSENT_API_INSTANCE_POOL_MAX', '3');
    vi.stubEnv('CONSENT_API_REGISTRY_POOL_MAX', '1');
    vi.stubEnv('CONSENT_API_DB_PREPARE', 'false');
    expect(loadEnv()).toEqual({
      ...required,
      CONSENT_API_HOST: '10.1.2.3',
      CONSENT_API_PORT: 4300,
      CONSENT_API_TRUSTED_PROXIES: ['10.0.0.0/8'],
      CONSENT_API_INSTANCE_POOL_MAX: 3,
      CONSENT_API_REGISTRY_POOL_MAX: 1,
      CONSENT_API_DB_PREPARE: false,
    });
  });

  test('throws an EnvError for an invalid process.env', () => {
    vi.stubEnv('DATABASE_URL_C15T', required.DATABASE_URL_C15T);
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_api_key -- test input: "short" is the too-short value the schema must reject, not a credential
    vi.stubEnv('C15T_ADMIN_API_KEY', 'short');
    expect(() => loadEnv()).toThrow(EnvError);
  });
});
