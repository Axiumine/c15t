// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { CONSENT_CATEGORIES, siteDetailSchema } from '@consent/shared';
import { expect, test } from 'vitest';
import { siteSetup, toSiteDetail } from './site-mapping.js';

test('the nginx snippet is exactly the two lines of the README', () => {
  expect(siteSetup('shop').nginx).toBe('set $c15t_site shop;\ninclude snippets/c15t.conf;');
});

test('the frontend snippets use the same-origin path', () => {
  const setup = siteSetup('shop');
  expect(setup.backendUrl).toBe('/api/c15t');
  expect(setup.scriptTag).toMatch(/^<script src="\/api\/c15t\/c15t\.js" data-cfasync="false" /);
});

test('the banner script tag declares the categories, or "Accept All" records only necessary', () => {
  const { scriptTag } = siteSetup('shop');
  expect(scriptTag).toBe(
    '<script src="/api/c15t/c15t.js" data-cfasync="false" data-categories="measurement,marketing"></script>',
  );
  // Every declared category is a c15t category, and never the always-on one.
  const declared = /data-categories="([^"]+)"/.exec(scriptTag)?.[1]?.split(',') ?? [];
  expect(declared.length).toBeGreaterThan(0);
  for (const category of declared) {
    expect(CONSENT_CATEGORIES).toContain(category);
    expect(category).not.toBe('necessary');
  }
});

test('the server snippet names environment variables: no key, no address', () => {
  const { serverClient } = siteSetup('shop');
  expect(serverClient).toContain('process.env.CONSENT_API_URL}/s/shop');
  expect(serverClient).toContain('process.env.C15T_ADMIN_API_KEY');
  expect(serverClient).not.toMatch(/\d+\.\d+\.\d+\.\d+|localhost|:\d{4}/);
});

test('a site row becomes a valid detail', () => {
  const now = new Date('2026-03-01T00:00:00Z');
  const detail = toSiteDetail({
    id: '5c1a0d8e-6f4b-4a3a-8d0f-2c3f4a5b6c7d',
    key: 'shop',
    name: 'Shop',
    domains: ['shop.example.com'],
    policyPreset: 'eu-opt-in',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  expect(siteDetailSchema.parse(detail)).toEqual(detail);
  expect(detail.createdAt).toBe('2026-03-01T00:00:00.000Z');
});
