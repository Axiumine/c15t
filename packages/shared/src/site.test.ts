// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test } from 'vitest';
import {
  DEFAULT_POLICY_PRESET,
  domainSchema,
  domainsSchema,
  POLICY_PRESET_LABELS,
  POLICY_PRESET_RULES,
  POLICY_PRESETS,
  siteCreateSchema,
  siteDetailSchema,
  siteKeySchema,
  siteSchema,
  siteUpdateSchema,
} from './site.js';

describe('siteKeySchema', () => {
  test.each(['abc', 'shop', 'my-shop-2', 'a'.repeat(40), '123', '---'])('accepts %s', (key) => {
    expect(siteKeySchema.safeParse(key).success).toBe(true);
  });

  test.each([
    'ab',
    'a'.repeat(41),
    'Shop',
    'my_shop',
    'my shop',
    'shop/',
    '../x',
    'shöp',
    '',
    'a.b.c',
  ])('rejects %j', (key) => {
    expect(siteKeySchema.safeParse(key).success).toBe(false);
  });
});

describe('domainSchema', () => {
  test('accepts host names and host:port, lowercasing them', () => {
    expect(domainSchema.parse('shop.example.com')).toBe('shop.example.com');
    expect(domainSchema.parse(' Shop.Example.COM ')).toBe('shop.example.com');
    expect(domainSchema.parse('localhost:3000')).toBe('localhost:3000');
    expect(domainSchema.parse('xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
  });

  test.each([
    '*',
    '*.example.com',
    'https://shop.example.com',
    'shop.example.com/path',
    'shop.example.com:',
    'shop.example.com:0',
    'shop.example.com:65536',
    '-bad.example.com',
    'bad-.example.com',
    'bad..example.com',
    'shop example.com',
    `${'a'.repeat(64)}.com`,
    '',
  ])('rejects %j', (value) => {
    expect(domainSchema.safeParse(value).success).toBe(false);
  });
});

describe('domainsSchema', () => {
  test('requires at least one unique domain', () => {
    expect(domainsSchema.safeParse([]).success).toBe(false);
    expect(domainsSchema.safeParse(['a.example.com', 'A.example.com']).success).toBe(false);
    expect(domainsSchema.safeParse(['a.example.com', 'b.example.com']).success).toBe(true);
    expect(domainsSchema.safeParse(['*']).success).toBe(false);
  });

  test('caps the list length', () => {
    const many = Array.from({ length: 51 }, (_, i) => `h${i}.example.com`);
    expect(domainsSchema.safeParse(many).success).toBe(false);
  });

  test('rejects an empty list and a wildcard, which must never become trustedOrigins', () => {
    expect(domainsSchema.safeParse([]).success).toBe(false);
    expect(domainsSchema.safeParse(['*']).success).toBe(false);
  });
});

describe('policy presets', () => {
  test('every preset has rules and a label, and the default exists', () => {
    expect(POLICY_PRESETS).toContain(DEFAULT_POLICY_PRESET);
    for (const preset of POLICY_PRESETS) {
      expect(POLICY_PRESET_RULES[preset].length).toBeGreaterThan(0);
      expect(POLICY_PRESET_LABELS[preset]).not.toBe('');
    }
  });
});

describe('siteCreateSchema', () => {
  const valid = { key: 'shop', name: 'Shop', domains: ['shop.example.com'] };

  test('applies the default preset', () => {
    expect(siteCreateSchema.parse(valid)).toEqual({
      ...valid,
      policyPreset: DEFAULT_POLICY_PRESET,
    });
  });

  test('rejects unknown fields, bad keys and empty domains', () => {
    expect(siteCreateSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false);
    expect(siteCreateSchema.safeParse({ ...valid, key: 'No' }).success).toBe(false);
    expect(siteCreateSchema.safeParse({ ...valid, domains: [] }).success).toBe(false);
    expect(siteCreateSchema.safeParse({ ...valid, policyPreset: 'nope' }).success).toBe(false);
    expect(siteCreateSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });
});

describe('siteUpdateSchema', () => {
  test('accepts partial changes', () => {
    expect(siteUpdateSchema.parse({ name: ' New ' })).toEqual({ name: 'New' });
    expect(siteUpdateSchema.parse({ status: 'disabled' })).toEqual({ status: 'disabled' });
  });

  test('the siteKey cannot change', () => {
    expect(siteUpdateSchema.safeParse({ key: 'other' }).success).toBe(false);
    expect(siteUpdateSchema.safeParse({ siteKey: 'other' }).success).toBe(false);
  });

  test('rejects an empty change and an empty domain list', () => {
    expect(siteUpdateSchema.safeParse({}).success).toBe(false);
    expect(siteUpdateSchema.safeParse({ domains: [] }).success).toBe(false);
  });
});

describe('site responses', () => {
  const site = {
    key: 'shop',
    name: 'Shop',
    domains: ['shop.example.com'],
    policyPreset: 'eu-opt-in',
    status: 'active',
    createdAt: '2026-10-30T12:00:00.000Z',
    updatedAt: '2026-10-30T12:00:00.000Z',
  };

  test('parse a site and its detail', () => {
    expect(siteSchema.safeParse(site).success).toBe(true);
    const setup = { nginx: 'n', backendUrl: '/api/c15t', scriptTag: 's', serverClient: 'c' };
    expect(siteDetailSchema.safeParse({ ...site, setup }).success).toBe(true);
    expect(siteDetailSchema.safeParse(site).success).toBe(false);
  });
});
