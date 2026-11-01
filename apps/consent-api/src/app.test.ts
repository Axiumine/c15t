// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test } from 'vitest';
import {
  bindings,
  callCount,
  databaseFailure,
  errorBody,
  harness,
  LAN,
  LOOPBACK,
  lastRequest,
} from './testing/app-harness.js';
import { siteRecord } from './testing/fakes.js';

describe('routing and tenancy', () => {
  test('hands the request to the instance of the site in the path', async () => {
    const h = harness(siteRecord('shop'), siteRecord('blog'));
    const response = await h.send('/s/shop/init?x=1', { headers: { 'cf-ipcountry': 'DE' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ site: 'shop' });
    expect(new URL(lastRequest(h, 'shop').url).pathname).toBe('/s/shop/init');
    expect(callCount(h, 'blog')).toBe(0);
    await h.registry.close();
  });

  test.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'])(
    'routes %s to the handler',
    async (method) => {
      const h = harness(siteRecord('shop'));
      const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
      const response = await h.send('/s/shop/subjects', {
        method,
        ...(hasBody ? { body: '{"a":1}', headers: { 'content-type': 'application/json' } } : {}),
      });
      expect(response.status).toBe(200);
      expect(lastRequest(h, 'shop').method).toBe(method);
      await h.registry.close();
    },
  );

  test('passes a request body through intact', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', async (request) => Response.json({ echoed: await request.json() }));
    const response = await h.send('/s/shop/subjects', {
      method: 'POST',
      body: JSON.stringify({ subjectId: 'sub_1', givenAt: 1 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(await response.json()).toEqual({ echoed: { subjectId: 'sub_1', givenAt: 1 } });
    await h.registry.close();
  });

  test('routes the bare site path', async () => {
    const h = harness(siteRecord('shop'));
    expect((await h.send('/s/shop')).status).toBe(200);
    await h.registry.close();
  });

  test('an unknown site is a JSON 404', async () => {
    const h = harness(siteRecord('shop'));
    const response = await h.send('/s/nobody/init');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    await h.registry.close();
  });

  test('a disabled site is a 404 and its instance is never built', async () => {
    const h = harness(siteRecord('shop', { status: 'disabled' }));
    expect((await h.send('/s/shop/init')).status).toBe(404);
    expect(h.instances.size).toBe(0);
    await h.registry.close();
  });

  test('disabling a live site stops it being served once the change is seen', async () => {
    const h = harness(siteRecord('shop'));
    expect((await h.send('/s/shop/init')).status).toBe(200);
    h.store.sites.set('shop', siteRecord('shop', { status: 'disabled' }));
    h.registry.invalidate('shop');
    expect((await h.send('/s/shop/init')).status).toBe(404);
    await h.registry.close();
  });

  test.each(['/', '/s', '/s/', '/x/shop/init', '/s/AB/init'])('%s is a JSON 404', async (path) => {
    const h = harness(siteRecord('shop'));
    const response = await h.send(path);
    expect(response.status).toBe(404);
    expect((await errorBody(response)).error.code).toBe('NOT_FOUND');
    await h.registry.close();
  });

  test('an unsupported method is a JSON 404', async () => {
    const h = harness(siteRecord('shop'));
    const response = await h.send('/s/shop/init', { method: 'PURGE' });
    expect(response.status).toBe(404);
    expect(callCount(h, 'shop')).toBe(0);
    await h.registry.close();
  });

  test('refuses an oversized body', async () => {
    const h = harness(siteRecord('shop'));
    const response = await h.send('/s/shop/subjects', {
      method: 'POST',
      body: 'x'.repeat(1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    expect(callCount(h, 'shop')).toBe(0);
    await h.registry.close();
  });
});

describe('trusted proxy headers', () => {
  const spoofed = {
    'x-forwarded-for': '6.6.6.6',
    'cf-connecting-ip': '6.6.6.6',
    'cf-ipcountry': 'US',
    'cf-region-code': 'CA',
    forwarded: 'for=6.6.6.6',
    'x-real-ip': '6.6.6.6',
    'x-c15t-country': 'US',
    'x-c15t-region': 'CA',
    'x-vercel-ip-country': 'US',
    'x-country-code': 'US',
  };

  test('an untrusted peer cannot spoof the IP, the country or any forwarding header', async () => {
    const h = harness(siteRecord('shop'));
    await h.send('/s/shop/init', { headers: spoofed }, LAN);
    const seen = lastRequest(h, 'shop').headers;
    for (const name of Object.keys(spoofed)) expect(seen.has(name), name).toBe(false);
    await h.registry.close();
  });

  test('a request with no connection info is treated as untrusted', async () => {
    const h = harness(siteRecord('shop'));
    await h.send('/s/shop/init', { headers: spoofed }, null);
    const seen = lastRequest(h, 'shop').headers;
    for (const name of Object.keys(spoofed)) expect(seen.has(name), name).toBe(false);
    await h.registry.close();
  });

  test('a trusted peer keeps the Cloudflare country, but x-c15t-country cannot override it', async () => {
    const h = harness(siteRecord('shop'));
    await h.send('/s/shop/init', {
      headers: {
        'x-forwarded-for': '203.0.113.7',
        'cf-ipcountry': 'DE',
        'cf-region-code': 'BY',
        'x-c15t-country': 'US',
        'x-c15t-region': 'CA',
        'x-vercel-ip-country': 'US',
        'x-country-code': 'US',
        'x-country': 'US',
      },
    });
    const seen = lastRequest(h, 'shop').headers;
    expect(seen.get('cf-ipcountry')).toBe('DE');
    expect(seen.get('cf-region-code')).toBe('BY');
    expect(seen.get('x-forwarded-for')).toBe('203.0.113.7');
    for (const name of [
      'x-c15t-country',
      'x-c15t-region',
      'x-vercel-ip-country',
      'x-country-code',
      'x-country',
    ]) {
      expect(seen.has(name), name).toBe(false);
    }
    await h.registry.close();
  });

  test('a trusted peer cannot smuggle a visitor-chosen IP in front of the real one', async () => {
    const h = harness(siteRecord('shop'));
    await h.send('/s/shop/init', { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } });
    expect(lastRequest(h, 'shop').headers.get('x-forwarded-for')).toBe('203.0.113.7');
    await h.registry.close();
  });

  test('the query parameters that override the geo headers never reach c15t', async () => {
    const h = harness(siteRecord('shop'));
    await h.send('/s/shop/init?country=US&region=CA&gpc=0&v=3.1.0&language=en', {
      headers: { 'cf-ipcountry': 'DE' },
    });
    const request = lastRequest(h, 'shop');
    const url = new URL(request.url);
    expect(url.pathname).toBe('/s/shop/init');
    expect(Object.fromEntries(url.searchParams)).toEqual({ v: '3.1.0', language: 'en' });
    expect(request.headers.get('cf-ipcountry')).toBe('DE');
    await h.registry.close();
  });

  test('a body survives the removal of override parameters', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', async (request) => Response.json({ echoed: await request.json() }));
    const response = await h.send('/s/shop/subjects?country=US', {
      method: 'POST',
      body: '{"subjectId":"sub_1"}',
      headers: { 'content-type': 'application/json' },
    });
    expect(await response.json()).toEqual({ echoed: { subjectId: 'sub_1' } });
    await h.registry.close();
  });

  test('keeps privacy signals and content headers', async () => {
    const h = harness(siteRecord('shop'));
    await h.send(
      '/s/shop/init',
      { headers: { 'sec-gpc': '1', 'accept-language': 'fr', 'user-agent': 'ua' } },
      LAN,
    );
    const seen = lastRequest(h, 'shop').headers;
    expect(seen.get('sec-gpc')).toBe('1');
    expect(seen.get('accept-language')).toBe('fr');
    expect(seen.get('user-agent')).toBe('ua');
    await h.registry.close();
  });
});

describe('host check and cross-tenant isolation', () => {
  const sites = () => [
    siteRecord('site-a', { domains: ['a.example.com', 'www.a.example.com'] }),
    siteRecord('site-b', { domains: ['b.example.org'] }),
  ];

  test('serves a site under its own domain', async () => {
    const h = harness(...sites());
    const response = await h.send('/s/site-a/init', {
      headers: { 'x-forwarded-host': 'a.example.com' },
    });
    expect(response.status).toBe(200);
    await h.registry.close();
  });

  test("site A's path under site B's domain is a 404, and A's instance is never called", async () => {
    const h = harness(...sites());
    const response = await h.send('/s/site-a/init', {
      headers: { host: 'b.example.org', 'x-forwarded-host': 'b.example.org' },
    });
    expect(response.status).toBe(404);
    expect(callCount(h, 'site-a')).toBe(0);
    expect(callCount(h, 'site-b')).toBe(0);
    await h.registry.close();
  });

  test('the Host header alone is enough to refuse', async () => {
    const h = harness(...sites());
    expect((await h.send('/s/site-a/init', { headers: { host: 'b.example.org' } })).status).toBe(
      404,
    );
    expect((await h.send('/s/site-a/init', { headers: { host: 'a.example.com' } })).status).toBe(
      200,
    );
    await h.registry.close();
  });

  test("each domain reaches only its own site's instance", async () => {
    const h = harness(...sites());
    await h.send('/s/site-a/init', { headers: { 'x-forwarded-host': 'a.example.com' } });
    await h.send('/s/site-b/init', { headers: { 'x-forwarded-host': 'b.example.org' } });
    expect(callCount(h, 'site-a')).toBe(1);
    expect(callCount(h, 'site-b')).toBe(1);
    await h.registry.close();
  });

  test('an untrusted peer cannot pass the check with a forged X-Forwarded-Host', async () => {
    const h = harness(...sites());
    const response = await h.send(
      '/s/site-a/init',
      { headers: { host: 'b.example.org', 'x-forwarded-host': 'a.example.com' } },
      LAN,
    );
    expect(response.status).toBe(404);
    await h.registry.close();
  });

  test('server code calling by IP or localhost has no vhost to verify', async () => {
    const h = harness(...sites());
    expect((await h.send('/s/site-a/init', { headers: { host: '127.0.0.1:4100' } })).status).toBe(
      200,
    );
    expect((await h.send('/s/site-a/init', { headers: { host: 'localhost:4100' } })).status).toBe(
      200,
    );
    await h.registry.close();
  });

  test('a wrong host and an unknown site look the same', async () => {
    const h = harness(...sites());
    const wrongHost = await h.send('/s/site-a/init', { headers: { host: 'b.example.org' } });
    const unknown = await h.send('/s/site-zz/init', { headers: { host: 'b.example.org' } });
    expect(await wrongHost.json()).toEqual(await unknown.json());
    await h.registry.close();
  });
});

describe('path rejection', () => {
  test.each([
    '/s/site-a/../site-b/init',
    '/s/site-a/%2e%2e/site-b/init',
    '/s/site-a/%2E%2E/site-b/init',
    '/s/site-a/..%2fsite-b/init',
    '/s/site-a/a%2fb',
    '/s/site-a/a%5Cb',
    '/s/site-a/a\\b',
    '/s/site-a/%252e%252e/init',
  ])('%s is a 400 and reaches no instance', async (target) => {
    const h = harness(siteRecord('site-a'), siteRecord('site-b'));
    // `new URL` would resolve these before routing: the raw target is what gets checked.
    const response = await h.app.request('/s/site-a/init', {}, bindings(target, LOOPBACK));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'BAD_REQUEST', message: 'Invalid request path.' },
    });
    expect(callCount(h, 'site-a') + callCount(h, 'site-b')).toBe(0);
    await h.registry.close();
  });

  test('a query string with dots is fine', async () => {
    const h = harness(siteRecord('site-a'));
    const target = '/s/site-a/init?next=../x';
    const response = await h.app.request(target, {}, bindings(target, LOOPBACK));
    expect(response.status).toBe(200);
    await h.registry.close();
  });
});

describe('response headers', () => {
  const noStore = (response: Response) => {
    expect(response.headers.get('cloudflare-cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('cdn-cache-control')).toBe('no-store');
  };

  test('every kind of response forbids Cloudflare caching and defaults to no-store', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', (request) =>
      new URL(request.url).pathname.endsWith('/boom') ? databaseFailure() : Response.json({}),
    );
    const responses = await Promise.all([
      h.send('/s/shop/init'),
      h.send('/s/nobody/init'),
      h.send('/'),
      h.send('/health'),
      h.send('/status'),
      h.send('/s/shop/boom', { method: 'POST' }),
      h.app.request('/s/shop/x', {}, bindings('/s/shop/../x', LOOPBACK)),
    ]);
    for (const response of responses) {
      noStore(response);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    await h.registry.close();
  });

  test("keeps c15t's browser cache lifetime for a successful manifest, but not for Cloudflare", async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', () =>
      Response.json(
        {},
        {
          headers: {
            'cache-control': 'public, max-age=300',
            'cdn-cache-control': 'public, max-age=300',
          },
        },
      ),
    );
    const response = await h.send('/s/shop/manifest');
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    noStore(response);
    await h.registry.close();
  });

  test('an error response is never cacheable, whatever c15t said', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', () =>
      Response.json(
        { cause: { code: 'X' } },
        { status: 400, headers: { 'cache-control': 'public' } },
      ),
    );
    expect((await h.send('/s/shop/x')).headers.get('cache-control')).toBe('no-store');
    await h.registry.close();
  });
});
