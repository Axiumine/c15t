// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import {
  COUNTRY_HEADERS,
  DEFAULT_IP_HEADERS_LIST,
  GPC_HEADERS,
  REGION_HEADERS,
} from '@c15t/schema/geo';
import { describe, expect, test } from 'vitest';
import { clientAddress } from './forwarding-headers.js';
import { VISITOR_OVERRIDE_HEADERS } from './override-headers.js';
import { stripOverrideParams, VISITOR_OVERRIDE_PARAMS } from './override-params.js';
import { sanitizeHeaders } from './request-guard.js';
import { requestHostAllowed } from './request-host.js';
import { isSafePath, rawPathname, siteKeyFromPath } from './request-path.js';

const TRUSTED = ['127.0.0.1/32', '::1/128'];

function sanitize(headers: Record<string, string>, peer: string | undefined) {
  return sanitizeHeaders(new Headers(headers), { peer, trustedProxies: TRUSTED });
}

const spoofed = {
  'x-forwarded-for': '6.6.6.6',
  'x-forwarded-host': 'evil.example',
  'x-forwarded-proto': 'http',
  forwarded: 'for=6.6.6.6',
  'cf-connecting-ip': '6.6.6.6',
  'cf-ipcountry': 'US',
  'cf-region-code': 'CA',
  'cf-ray': 'abc',
  'x-real-ip': '6.6.6.6',
  'true-client-ip': '6.6.6.6',
  'x-client-ip': '6.6.6.6',
  'x-c15t-country': 'US',
  'x-c15t-region': 'CA',
  'x-vercel-ip-country': 'US',
  'x-country-code': 'US',
};

describe('sanitizeHeaders from an untrusted peer', () => {
  test.each([
    ['a LAN host', '192.168.1.50'],
    ['an unknown peer', undefined],
    ['a malformed peer address', 'not-an-ip'],
  ])('drops every forwarding, CF and geo header from %s', (_label, peer) => {
    const { headers, trusted } = sanitize(
      { ...spoofed, accept: 'application/json', 'accept-language': 'it-IT', 'sec-gpc': '1' },
      peer,
    );
    expect(trusted).toBe(false);
    for (const name of Object.keys(spoofed)) expect(headers.has(name), name).toBe(false);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('accept-language')).toBe('it-IT');
    expect(headers.get('sec-gpc')).toBe('1');
  });

  test('does not touch the headers it was given', () => {
    const source = new Headers(spoofed);
    sanitizeHeaders(source, { peer: '192.168.1.50', trustedProxies: TRUSTED });
    expect(source.get('x-forwarded-for')).toBe('6.6.6.6');
  });
});

describe('sanitizeHeaders from a trusted peer', () => {
  test.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('trusts %s', (peer) => {
    expect(sanitize({}, peer).trusted).toBe(true);
  });

  test('keeps Cloudflare geo and the forwarded host, and drops every geo override', () => {
    const { headers } = sanitize(
      {
        ...spoofed,
        'x-forwarded-for': '203.0.113.7',
        'cf-ipcountry': 'DE',
        'cf-region-code': 'BY',
      },
      '127.0.0.1',
    );
    expect(headers.get('cf-ipcountry')).toBe('DE');
    expect(headers.get('cf-region-code')).toBe('BY');
    expect(headers.get('x-forwarded-host')).toBe('evil.example');
    for (const name of [
      'x-c15t-country',
      'x-c15t-region',
      'x-vercel-ip-country',
      'x-country-code',
    ]) {
      expect(headers.has(name), name).toBe(false);
    }
  });

  test('a spoofed x-c15t-country cannot override the Cloudflare country', () => {
    const { headers } = sanitize({ 'x-c15t-country': 'US', 'cf-ipcountry': 'FR' }, '127.0.0.1');
    expect(headers.get('x-c15t-country')).toBeNull();
    expect(headers.get('cf-ipcountry')).toBe('FR');
  });

  test('reduces X-Forwarded-For to the client address and drops the other IP headers', () => {
    const { headers } = sanitize(
      {
        'x-forwarded-for': '6.6.6.6, 203.0.113.7',
        'cf-connecting-ip': '6.6.6.6',
        'x-real-ip': '6.6.6.6',
        forwarded: 'for=6.6.6.6',
      },
      '127.0.0.1',
    );
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7');
    for (const name of ['cf-connecting-ip', 'x-real-ip', 'forwarded']) {
      expect(headers.has(name), name).toBe(false);
    }
  });

  test('drops malformed codes instead of passing them to c15t', () => {
    const { headers } = sanitize({ 'cf-ipcountry': 'DE;drop', 'cf-region-code': '<x>' }, '::1');
    expect(headers.has('cf-ipcountry')).toBe(false);
    expect(headers.has('cf-region-code')).toBe(false);
    expect(sanitize({ 'cf-ipcountry': 'T1' }, '::1').headers.get('cf-ipcountry')).toBe('T1');
  });
});

describe('geo header coverage', () => {
  test('every country and region header the installed c15t reads is stripped or Cloudflare-only', () => {
    const sanctioned = new Set(['cf-ipcountry', 'cf-region-code']);
    for (const name of [...COUNTRY_HEADERS, ...REGION_HEADERS]) {
      expect(sanctioned.has(name) || VISITOR_OVERRIDE_HEADERS.includes(name), name).toBe(true);
    }
  });

  test('GPC can only come from the browser: x-c15t-gpc goes, sec-gpc stays', () => {
    expect(GPC_HEADERS).toContain('sec-gpc');
    for (const peer of ['127.0.0.1', '192.168.1.50']) {
      const { headers } = sanitize({ 'x-c15t-gpc': '0', 'sec-gpc': '1' }, peer);
      expect(headers.has('x-c15t-gpc')).toBe(false);
      expect(headers.get('sec-gpc')).toBe('1');
    }
  });

  test('every IP header the installed c15t reads is gone for a trusted peer except x-forwarded-for', () => {
    const source = Object.fromEntries(DEFAULT_IP_HEADERS_LIST.map((name) => [name, '6.6.6.6']));
    const { headers } = sanitize({ ...source, 'x-forwarded-for': '203.0.113.7' }, '127.0.0.1');
    for (const name of DEFAULT_IP_HEADERS_LIST) {
      expect(headers.has(name), name).toBe(name === 'x-forwarded-for');
    }
  });
});

describe('clientAddress', () => {
  test.each([
    ['203.0.113.7', '203.0.113.7'],
    ['6.6.6.6, 203.0.113.7', '203.0.113.7'],
    ['203.0.113.7, 127.0.0.1', '203.0.113.7'],
    ['6.6.6.6, 203.0.113.7, ::1', '203.0.113.7'],
    ['127.0.0.1', '127.0.0.1'],
    ['2001:db8::7', '2001:db8::7'],
  ])('%s -> %s', (header, expected) => {
    expect(clientAddress(header, TRUSTED)).toBe(expected);
  });

  test('ignores an empty trailing entry', () => {
    expect(clientAddress('203.0.113.7,', TRUSTED)).toBe('203.0.113.7');
  });

  test.each([null, '', 'unknown', '203.0.113.7, garbage'])('yields no address for %j', (header) => {
    expect(clientAddress(header, TRUSTED)).toBeUndefined();
  });
});

describe('paths', () => {
  test('control characters are unsafe from 0x00 up to 0x1f and at 0x7f, a space is not one', () => {
    expect(isSafePath('/s/shop/a b')).toBe(true);
    for (const code of [0x00, 0x09, 0x1f, 0x7f]) {
      expect(isSafePath(`/s/shop/a${String.fromCharCode(code)}b`), `0x${code.toString(16)}`).toBe(
        false,
      );
    }
  });

  test('only a leading scheme and authority is removed from an absolute-form target', () => {
    expect(rawPathname('https://shop.example.com/s/shop/init?x=1')).toBe('/s/shop/init');
    expect(rawPathname('/s/shop/foo://bar')).toBe('/s/shop/foo://bar');
  });

  test.each([
    '/s/shop/init',
    '/s/shop/init?x=1',
    '/s/shop/subjects/sub_abc123',
    '/s/shop/c15t.js',
    '/health',
    'http://localhost/s/shop/init',
  ])('accepts %s', (target) => {
    expect(isSafePath(target)).toBe(true);
  });

  test.each([
    '/s/a/../b/init',
    '/s/shop/..',
    '/s/shop/%2e%2e/b/init',
    '/s/shop/%2E%2E/init',
    '/s/shop/.%2e/init',
    '/s/shop/a%2fb',
    '/s/shop/a%2Fb',
    '/s/shop/a%5cb',
    '/s/shop/a\\b',
    '/s/shop/%252e%252e/init',
    '/s/shop/%00',
    '/s/shop/a%0ab',
    '/s/shop/./init',
    '/s/shop/init\u0000',
    'http://localhost/s/a/../b/init',
  ])('rejects %j', (target) => {
    expect(isSafePath(target)).toBe(false);
  });

  test('a dot-dot in the query string is not a path traversal', () => {
    expect(isSafePath('/s/shop/init?next=../x')).toBe(true);
  });

  test('rawPathname strips the query, the fragment and an absolute-form origin', () => {
    expect(rawPathname('/s/a/init?x=1#f')).toBe('/s/a/init');
    expect(rawPathname('https://example.com:8443/s/a/init?x=1')).toBe('/s/a/init');
  });

  test.each([
    ['/s/shop/init', 'shop'],
    ['/s/shop', 'shop'],
    ['/s/shop/', 'shop'],
    ['/s/my-site-2/subjects?x=1', 'my-site-2'],
    ['http://localhost/s/shop/init', 'shop'],
  ])('siteKeyFromPath(%s) = %s', (target, key) => {
    expect(siteKeyFromPath(target)).toBe(key);
  });

  test.each([
    '/s/ab/init',
    '/s/UPPER/init',
    '/s/sh%6Fp/init',
    '/s/shop_x/init',
    '/s//init',
    '/x/shop/init',
    `/s/${'a'.repeat(41)}/init`,
  ])('siteKeyFromPath rejects %s', (target) => {
    expect(siteKeyFromPath(target)).toBeUndefined();
  });
});

describe('requestHostAllowed', () => {
  const domains = ['shop.example.com', 'www.shop.example.com', 'dev.example.test:8443'];
  const allowed = (headers: Record<string, string>, trusted = true) =>
    requestHostAllowed(new Headers(headers), trusted, domains);

  test('accepts a listed domain in X-Forwarded-Host or Host, in any case', () => {
    expect(allowed({ 'x-forwarded-host': 'shop.example.com' })).toBe(true);
    expect(allowed({ 'x-forwarded-host': 'WWW.Shop.Example.com' })).toBe(true);
    expect(allowed({ host: 'shop.example.com' })).toBe(true);
    expect(allowed({ host: 'shop.example.com:443' })).toBe(true);
  });

  test("rejects another site's domain", () => {
    expect(allowed({ 'x-forwarded-host': 'blog.example.org' })).toBe(false);
    expect(allowed({ host: 'blog.example.org' })).toBe(false);
    expect(allowed({ 'x-forwarded-host': 'shop.example.com.evil.test' })).toBe(false);
    expect(allowed({ 'x-forwarded-host': 'evilshop.example.com' })).toBe(false);
  });

  test('X-Forwarded-Host wins over Host from a trusted proxy, and is ignored from others', () => {
    expect(allowed({ 'x-forwarded-host': 'blog.example.org', host: 'shop.example.com' })).toBe(
      false,
    );
    expect(allowed({ 'x-forwarded-host': 'shop.example.com', host: 'blog.example.org' })).toBe(
      true,
    );
    expect(
      allowed({ 'x-forwarded-host': 'shop.example.com', host: 'blog.example.org' }, false),
    ).toBe(false);
  });

  test('a domain with a port pins it, a domain without one allows any port', () => {
    expect(allowed({ host: 'dev.example.test:8443' })).toBe(true);
    expect(allowed({ host: 'dev.example.test:9000' })).toBe(false);
    expect(allowed({ host: 'dev.example.test' })).toBe(false);
    expect(allowed({ host: 'shop.example.com:8080' })).toBe(true);
  });

  test('every value of a list must match', () => {
    expect(allowed({ 'x-forwarded-host': 'shop.example.com, www.shop.example.com' })).toBe(true);
    expect(allowed({ 'x-forwarded-host': 'shop.example.com, blog.example.org' })).toBe(false);
  });

  test('rejects hosts that are not host names', () => {
    expect(allowed({ 'x-forwarded-host': 'shop.example.com/evil' })).toBe(false);
    expect(allowed({ 'x-forwarded-host': 'user@shop.example.com' })).toBe(false);
    expect(allowed({ 'x-forwarded-host': 'shop example.com' })).toBe(false);
  });

  test('direct calls by IP or localhost have no site host to verify', () => {
    expect(allowed({ host: '127.0.0.1:4100' })).toBe(true);
    expect(allowed({ host: '10.1.2.3' })).toBe(true);
    expect(allowed({ host: '[::1]:4100' })).toBe(true);
    expect(allowed({ host: 'localhost:4100' })).toBe(true);
    expect(allowed({})).toBe(true);
  });
});

describe('stripOverrideParams', () => {
  test('removes the parameters /init reads before the geo headers', () => {
    expect(VISITOR_OVERRIDE_PARAMS).toEqual(['country', 'region', 'gpc']);
    expect(
      stripOverrideParams('http://x.test/s/shop/init?country=US&region=CA&gpc=0&v=3.1.0'),
    ).toBe('http://x.test/s/shop/init?v=3.1.0');
    expect(stripOverrideParams('http://x.test/s/shop/init?country=US')).toBe(
      'http://x.test/s/shop/init',
    );
  });

  test('leaves every other URL byte for byte alone', () => {
    for (const url of [
      'http://x.test/s/shop/init',
      'http://x.test/s/shop/init?language=en&experiment=a%3Db',
      'http://x.test/s/shop/subjects?externalId=a+b%20c',
    ]) {
      expect(stripOverrideParams(url)).toBe(url);
    }
  });
});
