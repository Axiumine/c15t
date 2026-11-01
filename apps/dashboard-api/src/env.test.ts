// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test, vi } from 'vitest';
import { EnvError, loadCliEnv, loadEnv, parseCliEnv, parseEnv } from './env.js';

const valid = {
  DATABASE_URL_DASHBOARD: 'postgres://dashboard:pw@pg-primary.internal:5432/consent',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://dashboard.example.com',
};

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return [...error.problems];
    throw error;
  }
  return [];
}

test('applies the documented defaults', () => {
  const env = parseEnv(valid);
  expect(env.DASHBOARD_API_HOST).toBe('127.0.0.1');
  expect(env.DASHBOARD_API_PORT).toBe(4200);
  // Reserved for future SDK calls: no default address is invented for them.
  expect(env.CONSENT_API_URL).toBeUndefined();
  expect(env.C15T_ADMIN_API_KEY).toBeUndefined();
  expect(env.DATABASE_URL_DASHBOARD_REPLICA).toBeUndefined();
});

test('accepts a private LAN bind address and a numeric port string', () => {
  const env = parseEnv({ ...valid, DASHBOARD_API_HOST: '10.0.0.5', DASHBOARD_API_PORT: '4300' });
  expect(env.DASHBOARD_API_HOST).toBe('10.0.0.5');
  expect(env.DASHBOARD_API_PORT).toBe(4300);
});

test.each(['0.0.0.0', '::', '8.8.8.8', 'example.com'])('rejects the bind address %s', (host) => {
  expect(problems({ ...valid, DASHBOARD_API_HOST: host }).join()).toContain('DASHBOARD_API_HOST');
});

test.each(['80', '1023', '65536', 'abc'])('rejects the port %s', (port) => {
  expect(problems({ ...valid, DASHBOARD_API_PORT: port }).join()).toContain('DASHBOARD_API_PORT');
});

test('requires the database URL, the secret and the public URL', () => {
  const found = problems({}).join('\n');
  for (const name of ['DATABASE_URL_DASHBOARD', 'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL']) {
    expect(found).toContain(name);
  }
});

test('starts without C15T_ADMIN_API_KEY and CONSENT_API_URL, which nothing in dashboard-api uses yet', () => {
  expect(problems(valid)).toEqual([]);
  expect(problems(valid).join()).not.toMatch(/C15T_ADMIN_API_KEY|CONSENT_API_URL/);
  const empty = parseEnv({ ...valid, C15T_ADMIN_API_KEY: '', CONSENT_API_URL: '  ' });
  expect(empty.C15T_ADMIN_API_KEY).toBeUndefined();
  expect(empty.CONSENT_API_URL).toBeUndefined();
});

test('validates the two optional variables when they are set', () => {
  const set = parseEnv({
    ...valid,
    C15T_ADMIN_API_KEY: 'a-key',
    CONSENT_API_URL: 'http://10.0.0.7:4100',
  });
  expect(set.C15T_ADMIN_API_KEY).toBe('a-key');
  expect(set.CONSENT_API_URL).toBe('http://10.0.0.7:4100');
  for (const url of ['not a url', 'ftp://x.example.com', 'http://10.0.0.7:4100/path']) {
    expect(problems({ ...valid, CONSENT_API_URL: url }).join(), url).toContain('CONSENT_API_URL');
  }
});

test('rejects a short secret and an origin with a path', () => {
  expect(problems({ ...valid, BETTER_AUTH_SECRET: 'short' }).join()).toContain(
    'BETTER_AUTH_SECRET',
  );
  expect(
    problems({ ...valid, BETTER_AUTH_URL: 'https://dashboard.example.com/app' }).join(),
  ).toContain('BETTER_AUTH_URL');
});

test('treats an empty replica URL as unset and validates a real one', () => {
  expect(
    parseEnv({ ...valid, DATABASE_URL_DASHBOARD_REPLICA: '' }).DATABASE_URL_DASHBOARD_REPLICA,
  ).toBeUndefined();
  expect(
    parseEnv({
      ...valid,
      DATABASE_URL_DASHBOARD_REPLICA: 'postgres://r:pw@pg-replica.internal/consent',
    }).DATABASE_URL_DASHBOARD_REPLICA,
  ).toContain('pg-replica.internal');
  expect(problems({ ...valid, DATABASE_URL_DASHBOARD_REPLICA: 'mysql://x' }).join()).toContain(
    'DATABASE_URL_DASHBOARD_REPLICA',
  );
});

test('error messages name variables and never echo values', () => {
  const found = problems({
    ...valid,
    DATABASE_URL_DASHBOARD: 'not a url with-secret-pw',
    BETTER_AUTH_SECRET: 'tiny-secret',
  }).join('\n');
  expect(found).not.toContain('with-secret-pw');
  expect(found).not.toContain('tiny-secret');
});

test('the CLI only needs the database URL, the secret and the public URL', () => {
  expect(
    parseCliEnv({
      DATABASE_URL_DASHBOARD: valid.DATABASE_URL_DASHBOARD,
      BETTER_AUTH_SECRET: valid.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: valid.BETTER_AUTH_URL,
    }).BETTER_AUTH_URL,
  ).toBe('https://dashboard.example.com');
});

test('a source that is not an object is reported as the environment itself', () => {
  expect(problems(null as unknown as Record<string, string>)).toEqual([
    expect.stringMatching(/^\(env\): /),
  ]);
});

test('loadEnv and loadCliEnv read the process environment', () => {
  vi.stubEnv('DATABASE_URL_DASHBOARD', valid.DATABASE_URL_DASHBOARD);
  vi.stubEnv('DATABASE_URL_DASHBOARD_REPLICA', undefined);
  vi.stubEnv('BETTER_AUTH_SECRET', valid.BETTER_AUTH_SECRET);
  vi.stubEnv('BETTER_AUTH_URL', valid.BETTER_AUTH_URL);
  vi.stubEnv('DASHBOARD_API_HOST', '10.0.0.9');
  vi.stubEnv('DASHBOARD_API_PORT', '4321');
  try {
    expect(loadEnv()).toMatchObject({
      DASHBOARD_API_HOST: '10.0.0.9',
      DASHBOARD_API_PORT: 4321,
      DATABASE_URL_DASHBOARD: valid.DATABASE_URL_DASHBOARD,
    });
    // The CLI schema keeps only what the admin CLI needs.
    expect(loadCliEnv()).toEqual({
      DATABASE_URL_DASHBOARD: valid.DATABASE_URL_DASHBOARD,
      BETTER_AUTH_SECRET: valid.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: valid.BETTER_AUTH_URL,
    });
    // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- test input: "short" is the too-short value the schema must reject, not a credential
    vi.stubEnv('BETTER_AUTH_SECRET', 'short');
    expect(() => loadEnv()).toThrow(EnvError);
    expect(() => loadCliEnv()).toThrow(/BETTER_AUTH_SECRET/);
  } finally {
    vi.unstubAllEnvs();
  }
});
