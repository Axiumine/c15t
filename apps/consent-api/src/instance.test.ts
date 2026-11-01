// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { POLICY_PRESET_RULES, POLICY_PRESETS, type PolicyPreset } from '@consent/shared';
import { afterEach, describe, expect, test } from 'vitest';
import { SiteConfigError } from './errors.js';
import {
  assertTrustedOrigins,
  buildInstanceOptions,
  createDatabaseLayer,
  createSiteInstance,
  policyRulesFor,
} from './instance.js';
import { siteRecord } from './testing/fakes.js';

const database = {
  // Nothing in this file connects: pools and instances are lazy.
  url: 'postgres://c15t_api:pw@db.invalid:5432/consent',
  poolMax: 2,
  prepare: true,
  maxLifetimeSeconds: 300,
};

describe('buildInstanceOptions', () => {
  const site = siteRecord('shop', { domains: ['shop.example.com', 'www.shop.example.com'] });
  const options = buildInstanceOptions(site, {
    apiKey: 'k'.repeat(32),
    database: createDatabaseLayer(database),
  });

  test('scopes the instance to its tenant, as CLAUDE.md lists', () => {
    expect(options.basePath).toBe('/s/shop');
    expect(options.tenantId).toBe('shop');
    expect(options.requireTenantId).toBe(true);
    expect(options.trustedOrigins).toEqual(['shop.example.com', 'www.shop.example.com']);
    expect(options.apiKeys).toEqual(['k'.repeat(32)]);
  });

  test('reads the visitor IP from X-Forwarded-For only and points the script at the vhost path', () => {
    expect(options.ipAddress).toEqual({ ipAddressHeaders: ['x-forwarded-for'] });
    expect(options.script).toEqual({ backendURL: '/api/c15t' });
  });

  test('does not publish an OpenAPI document', () => {
    expect(options.openapi).toEqual({ enabled: false });
  });

  test.each(POLICY_PRESETS)('builds the policy rules of the %s preset in order', (preset) => {
    const rules = policyRulesFor(siteRecord('shop', { policyPreset: preset }));
    // eslint-disable-next-line security/detect-object-injection -- `preset` is the closed PolicyPreset union
    expect(rules).toHaveLength(POLICY_PRESET_RULES[preset].length);
    expect(rules.map((rule) => rule.id)).toEqual(
      // eslint-disable-next-line security/detect-object-injection -- `preset` is the closed PolicyPreset union
      {
        'eu-opt-in': ['europe_opt_in', 'world_none'],
        'eu-us-opt-out': [
          'europe_opt_in',
          'quebec_opt_in',
          'us_privacy_states_opt_out',
          'world_none',
        ],
        'global-preferences': [
          'europe_opt_in',
          'quebec_opt_in',
          'us_privacy_states_opt_out',
          'world_opt_out_no_prompt',
        ],
      }[preset],
    );
  });

  test('refuses a site with no domains, before c15t sees it', () => {
    expect(() =>
      buildInstanceOptions(siteRecord('shop', { domains: [] }), {
        apiKey: 'k'.repeat(32),
        database: createDatabaseLayer(database),
      }),
    ).toThrow(SiteConfigError);
  });
});

describe('policyRulesFor with a preset that names a rule c15t does not have', () => {
  // POLICY_PRESET_RULES lists factory names of @c15t/backend. A c15t upgrade that renames one must
  // fail loudly for the site, not build an instance with a rule missing.
  const presets = POLICY_PRESET_RULES as Record<PolicyPreset, readonly string[]>;
  const original = presets['eu-opt-in'];
  afterEach(() => {
    presets['eu-opt-in'] = original;
  });

  test.each(['noSuchRule', 'toString', 'constructor', '__proto__'])(
    'refuses "%s" and names the site',
    (name) => {
      presets['eu-opt-in'] = ['europeOptIn', name];
      try {
        policyRulesFor(siteRecord('shop', { policyPreset: 'eu-opt-in' }));
        expect.unreachable('policyRulesFor accepted an unknown rule');
      } catch (error) {
        expect(error).toBeInstanceOf(SiteConfigError);
        expect((error as SiteConfigError).siteKey).toBe('shop');
      }
    },
  );
});

describe('assertTrustedOrigins', () => {
  test('returns valid hosts unchanged', () => {
    expect(assertTrustedOrigins('shop', ['shop.example.com', 'dev.test:8443'])).toEqual([
      'shop.example.com',
      'dev.test:8443',
    ]);
  });

  test.each([
    ['an empty list', []],
    ['a bare wildcard', ['*']],
    ['a wildcard among valid hosts', ['shop.example.com', '*']],
    ['a wildcard subdomain', ['*.example.com']],
    ['an origin with a scheme', ['https://shop.example.com']],
    ['an empty entry', ['']],
    ['a path', ['shop.example.com/x']],
  ])('rejects %s', (_label, origins) => {
    expect(() => assertTrustedOrigins('shop', origins)).toThrow(SiteConfigError);
  });

  test('names the site but never the offending value', () => {
    try {
      assertTrustedOrigins('shop', ['*.secret-looking.example']);
    } catch (error) {
      expect(error).toBeInstanceOf(SiteConfigError);
      expect((error as SiteConfigError).siteKey).toBe('shop');
      expect((error as SiteConfigError).message).not.toContain('secret-looking');
    }
  });
});

describe('createSiteInstance', () => {
  test('builds a c15t instance without opening a connection, and disposes it', async () => {
    const instance = createSiteInstance(siteRecord('shop'), { apiKey: 'k'.repeat(32), database });
    expect(typeof instance.handler).toBe('function');
    await instance.dispose();
  });

  test('c15t itself rejects a missing tenant: requireTenantId is on', async () => {
    const { c15tInstance } = await import('@c15t/backend');
    const options = buildInstanceOptions(siteRecord('shop'), {
      apiKey: 'k'.repeat(32),
      database: createDatabaseLayer(database),
    });
    const { tenantId: _tenantId, ...withoutTenant } = options;
    expect(() => c15tInstance(withoutTenant)).toThrow();
  });

  test.each([
    ['an IPv6 host', 'postgres://u:p@[::1]:5433/consent'],
    ['a unix socket directory', 'postgres://u:p@localhost/consent?host=/var/run/postgresql'],
    ['a default port', 'postgres://u:p@db.internal/consent'],
  ])('builds the database layer for %s', (_label, url) => {
    expect(() => createDatabaseLayer({ ...database, url })).not.toThrow();
  });
});
