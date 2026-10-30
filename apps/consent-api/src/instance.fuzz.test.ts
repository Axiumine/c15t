// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { domainSchema } from '@consent/shared';
import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import { SiteConfigError } from './errors.js';
import { assertTrustedOrigins } from './instance.js';

/*
 * c15t 3.1.0 honours `*` in `trustedOrigins`, and an empty list only changes CORS. Whatever the
 * database holds, neither may reach a c15t instance (CLAUDE.md "Multi-tenancy").
 */

const RUNS = { numRuns: 300 };

const label = fc.stringMatching(/^[a-z0-9]([a-z0-9-]{0,10}[a-z0-9])?$/);
const validHost = fc
  .tuple(fc.array(label, { minLength: 1, maxLength: 3 }), fc.stringMatching(/^[a-z]{2,6}$/))
  .map(([labels, tld]) => [...labels, tld].join('.'));
const entry = fc.oneof(
  validHost,
  fc.string(),
  fc.constantFrom('*', '*.example.com', '', ' ', 'https://a.example.com', 'a.example.com/x'),
);

test('the result is never empty, never holds a wildcard and holds only valid hosts', () => {
  fc.assert(
    fc.property(fc.array(entry, { maxLength: 6 }), (origins) => {
      try {
        const accepted = assertTrustedOrigins('shop', origins);
        expect(accepted.length).toBeGreaterThan(0);
        expect(accepted.length).toBeLessThanOrEqual(origins.length);
        for (const host of accepted) {
          expect(host).not.toContain('*');
          expect(domainSchema.safeParse(host).success).toBe(true);
        }
        expect(new Set(accepted).size).toBe(accepted.length);
      } catch (error) {
        expect(error).toBeInstanceOf(SiteConfigError);
        expect((error as SiteConfigError).siteKey).toBe('shop');
      }
    }),
    RUNS,
  );
});

test('a unique list of valid hosts is returned as it came', () => {
  fc.assert(
    fc.property(fc.uniqueArray(validHost, { minLength: 1, maxLength: 6 }), (hosts) => {
      expect(assertTrustedOrigins('shop', hosts)).toEqual(hosts);
    }),
    RUNS,
  );
});

test('one wildcard anywhere in the list refuses the whole site', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(validHost, { maxLength: 5 }),
      fc.constantFrom('*', '*.example.com', 'a*.example.com', 'a.*'),
      fc.nat(),
      (hosts, wildcard, at) => {
        const origins = [...hosts];
        origins.splice(at % (origins.length + 1), 0, wildcard);
        expect(() => assertTrustedOrigins('shop', origins)).toThrow(SiteConfigError);
      },
    ),
    RUNS,
  );
});

test('the error names the site and never echoes the offending value', () => {
  fc.assert(
    fc.property(fc.stringMatching(/^zq[a-z0-9]{8,12}$/), (marker) => {
      for (const origin of [`*.${marker}.example`, `https://${marker}.example`, `${marker}/path`]) {
        try {
          assertTrustedOrigins('shop', [origin]);
          expect.unreachable('the origin should have been refused');
        } catch (error) {
          expect(error).toBeInstanceOf(SiteConfigError);
          expect((error as SiteConfigError).message).not.toContain(marker);
        }
      }
    }),
    RUNS,
  );
});
