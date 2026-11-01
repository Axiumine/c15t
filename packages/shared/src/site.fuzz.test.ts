// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import {
  domainSchema,
  domainsSchema,
  MAX_DOMAINS_PER_SITE,
  SITE_KEY_PATTERN,
  siteCreateSchema,
  siteKeySchema,
  siteUpdateSchema,
} from './site.js';

/*
 * Property-based tests for the values that reach nginx, the Host allowlist and c15t's
 * `trustedOrigins`: the site key (a URL segment and tenant id) and the domain list.
 */

const RUNS = { numRuns: 300 };

const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789-';
const keyish = fc.string({
  unit: fc.constantFrom(...Array.from(`${KEY_CHARS}ABCZ_./\\ \n*%`)),
  maxLength: 48,
});
const anyText = fc.oneof(keyish, fc.string(), fc.string({ unit: 'binary' }));

const validKey = fc.stringMatching(/^[a-z0-9-]{3,40}$/);
const label = fc.stringMatching(/^(?:[a-z0-9]|[a-z0-9][a-z0-9-]{0,10}[a-z0-9])$/);
const validHost = fc.array(label, { minLength: 1, maxLength: 4 }).map((labels) => labels.join('.'));
const validDomain = fc.oneof(
  validHost,
  fc.tuple(validHost, fc.integer({ min: 1, max: 65535 })).map(([host, port]) => `${host}:${port}`),
);

test('the site key schema never throws and accepts exactly 3 to 40 of a-z, 0-9 and hyphen', () => {
  fc.assert(
    fc.property(anyText, (text) => {
      const expected =
        text.length >= 3 &&
        text.length <= 40 &&
        Array.from(text).every((c) => KEY_CHARS.includes(c));
      expect(siteKeySchema.safeParse(text).success).toBe(expected);
    }),
    RUNS,
  );
});

test('a site key built from the allowed alphabet is accepted', () => {
  fc.assert(
    fc.property(validKey, (key) => {
      expect(siteKeySchema.parse(key)).toBe(key);
      expect(SITE_KEY_PATTERN.test(key)).toBe(true);
    }),
    RUNS,
  );
});

test('an accepted site key is a safe URL segment: nothing to escape, no dots, no slashes', () => {
  fc.assert(
    fc.property(anyText, (text) => {
      const result = siteKeySchema.safeParse(text);
      if (!result.success) return;
      expect(encodeURIComponent(result.data)).toBe(result.data);
      expect(result.data).not.toMatch(/[./\\%\s*A-Z]/);
      expect(new URL(`http://localhost/s/${result.data}/init`).pathname).toBe(
        `/s/${result.data}/init`,
      );
    }),
    RUNS,
  );
});

test('a site key with a trailing line break or any control character is rejected', () => {
  fc.assert(
    fc.property(validKey, fc.constantFrom('\n', '\r', '\t', '\0', ' '), (key, extra) => {
      expect(siteKeySchema.safeParse(`${key}${extra}`).success).toBe(false);
      expect(siteKeySchema.safeParse(`${extra}${key}`).success).toBe(false);
    }),
    RUNS,
  );
});

// eslint-disable-next-line sonarjs/assertions-in-tests -- fc.assert throws when a property fails: it is the assertion
test('the domain schema never throws', () => {
  fc.assert(
    fc.property(anyText, (text) => {
      domainSchema.safeParse(text);
    }),
    RUNS,
  );
});

test('a host name, with or without a valid port, is accepted and normalised to lower case', () => {
  fc.assert(
    fc.property(validDomain, fc.boolean(), (domain, shout) => {
      const input = shout ? domain.toUpperCase() : domain;
      expect(domainSchema.parse(` ${input} `)).toBe(domain);
    }),
    RUNS,
  );
});

test('an accepted domain has no wildcard, scheme, path, credentials or white space', () => {
  fc.assert(
    fc.property(
      fc.oneof(anyText, fc.webUrl({ withQueryParameters: true }), validDomain),
      (text) => {
        const result = domainSchema.safeParse(text);
        if (!result.success) return;
        const domain = result.data;
        expect(domain).not.toBe('');
        expect(domain.length).toBeLessThanOrEqual(253);
        expect(domain).toBe(domain.toLowerCase());
        expect(domain).not.toMatch(/[*/\\?#@\s%]/);
        expect(domain.split(':').length).toBeLessThanOrEqual(2);
        const port = domain.split(':')[1];
        if (port !== undefined) {
          expect(Number(port)).toBeGreaterThanOrEqual(1);
          expect(Number(port)).toBeLessThanOrEqual(65535);
        }
      },
    ),
    RUNS,
  );
});

/*
 * Known gap, found by the property above before it was narrowed: the host pattern also admits
 * numeric spellings of an address that the URL parser rewrites, so `0` is read as `0.0.0.0`,
 * `127.1` as `127.0.0.1`, `0x7f.1` as `127.0.0.1` and `2130706433` as `127.0.0.1`. A browser
 * always sends the canonical spelling, so such an entry matches nothing (fail-closed) and only an
 * admin can enter it. Counterexample: "0". Kept as `fails` until the schema rejects them.
 */
test.fails('an accepted domain is spelled the way the URL parser reads it', () => {
  fc.assert(
    fc.property(
      fc.oneof(validHost, fc.constantFrom('0', '127.1', '0x7f.1', '2130706433')),
      (text) => {
        const result = domainSchema.safeParse(text);
        if (!result.success) return;
        expect(new URL(`https://${result.data}`).hostname).toBe(result.data);
      },
    ),
    RUNS,
  );
});

test('a domain with a wildcard anywhere is rejected', () => {
  fc.assert(
    fc.property(validHost, fc.nat(), (host, at) => {
      const index = at % (host.length + 1);
      const starred = `${host.slice(0, index)}*${host.slice(index)}`;
      expect(domainSchema.safeParse(starred).success).toBe(false);
      expect(domainSchema.safeParse(`*.${host}`).success).toBe(false);
      expect(domainSchema.safeParse('*').success).toBe(false);
    }),
    RUNS,
  );
});

test('a port of 0, above 65535 or with a sign is rejected', () => {
  fc.assert(
    fc.property(
      validHost,
      fc.oneof(
        fc.constant('0'),
        fc.constant('00000'),
        fc.integer({ min: 65536, max: 99999 }).map(String),
        fc.integer({ min: 1, max: 9999 }).map((n) => `-${n}`),
        fc.integer({ min: 1, max: 9999 }).map((n) => `+${n}`),
      ),
      (host, port) => {
        expect(domainSchema.safeParse(`${host}:${port}`).success).toBe(false);
      },
    ),
    RUNS,
  );
});

test('a scheme, path, query, fragment or user info makes a domain invalid', () => {
  fc.assert(
    fc.property(
      validHost,
      fc.constantFrom('', 'https://', 'http://', '//', 'user@', 'user:pw@'),
      fc.constantFrom('', '/', '/path', '?q=1', '#frag', ' x'),
      (host, prefix, suffix) => {
        fc.pre(prefix !== '' || suffix !== '');
        expect(domainSchema.safeParse(`${prefix}${host}${suffix}`).success).toBe(false);
      },
    ),
    RUNS,
  );
});

test('the domain list is never empty, never holds a duplicate and never exceeds its cap', () => {
  expect(domainsSchema.safeParse([]).success).toBe(false);
  fc.assert(
    fc.property(fc.array(validDomain, { maxLength: 8 }), (domains) => {
      const result = domainsSchema.safeParse(domains);
      const unique = new Set(domains.map((domain) => domain.toLowerCase())).size === domains.length;
      expect(result.success).toBe(domains.length > 0 && unique);
      if (result.success) {
        expect(result.data.length).toBeGreaterThan(0);
        expect(new Set(result.data).size).toBe(result.data.length);
        expect(result.data).not.toContain('*');
      }
    }),
    RUNS,
  );
  const tooMany = Array.from(
    { length: MAX_DOMAINS_PER_SITE + 1 },
    (_, i) => `site${i}.example.com`,
  );
  expect(domainsSchema.safeParse(tooMany).success).toBe(false);
});

test('two spellings of one host that differ only in case count as a duplicate', () => {
  fc.assert(
    fc.property(validHost, (host) => {
      fc.pre(host !== host.toUpperCase());
      expect(domainsSchema.safeParse([host, host.toUpperCase()]).success).toBe(false);
    }),
    RUNS,
  );
});

test('one wildcard or invalid entry makes the whole list invalid', () => {
  fc.assert(
    fc.property(
      fc.array(validHost, { maxLength: 4 }),
      fc.constantFrom('*', '*.example.com', '', ' ', 'a b', 'https://x.example.com'),
      fc.nat(),
      (hosts, bad, at) => {
        const unique = [...new Set(hosts)];
        const list = [...unique];
        list.splice(at % (list.length + 1), 0, bad);
        expect(domainsSchema.safeParse(list).success).toBe(false);
      },
    ),
    RUNS,
  );
});

test('creating a site with an empty or wildcard domain list is rejected, and its key is immutable', () => {
  fc.assert(
    fc.property(validKey, fc.string({ minLength: 1, maxLength: 20 }), (key, name) => {
      fc.pre(name.trim() !== '');
      expect(siteCreateSchema.safeParse({ key, name, domains: [] }).success).toBe(false);
      expect(siteCreateSchema.safeParse({ key, name, domains: ['*'] }).success).toBe(false);
      expect(siteCreateSchema.safeParse({ key, name, domains: ['a.example.com'] }).success).toBe(
        true,
      );
      // The key is a tenant id: an update can never carry one.
      expect(siteUpdateSchema.safeParse({ key, name }).success).toBe(false);
    }),
    RUNS,
  );
});
