// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { HttpBindings } from '@hono/node-server';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { type AppEnv, createApp } from './app.js';
import { SiteConfigError } from './errors.js';
import { type InstanceFactory, SiteRegistry } from './registry.js';
import {
  capturingLogger,
  type FakeInstance,
  fakeInstance,
  MemoryStore,
  siteRecord,
} from './testing/fakes.js';

const TRUSTED = ['127.0.0.1/32', '::1/128'];
const LOOPBACK = '127.0.0.1';
const LAN = '192.168.1.50';

function bindings(target: string, peer: string | null): HttpBindings | undefined {
  if (peer === null) return undefined;
  return { incoming: { url: target, socket: { remoteAddress: peer } } } as unknown as HttpBindings;
}

interface Harness {
  readonly app: Hono<AppEnv>;
  readonly registry: SiteRegistry;
  readonly store: MemoryStore;
  readonly instances: Map<string, FakeInstance[]>;
  readonly logger: ReturnType<typeof capturingLogger>;
  readonly advance: (ms: number) => void;
  /** Overrides what instances of one site answer, for the next ones built. */
  readonly respondWith: (
    key: string,
    respond: (request: Request, built: number) => Response | Promise<Response>,
  ) => void;
  readonly send: (
    target: string,
    init?: RequestInit,
    /** `null`: no socket behind the request. */
    peer?: string | null,
  ) => Promise<Response>;
}

function harness(...records: ReturnType<typeof siteRecord>[]): Harness {
  const store = new MemoryStore(...records);
  const instances = new Map<string, FakeInstance[]>();
  const responders = new Map<
    string,
    (request: Request, built: number) => Response | Promise<Response>
  >();
  const factory: InstanceFactory = (site) => {
    const list = instances.get(site.key) ?? [];
    instances.set(site.key, list);
    const built = list.length;
    const instance = fakeInstance((request) => {
      const respond = responders.get(site.key);
      return respond === undefined ? Response.json({ site: site.key }) : respond(request, built);
    });
    list.push(instance);
    return instance;
  };
  let clock = 5_000_000;
  const logger = capturingLogger();
  const registry = new SiteRegistry({
    store,
    factory,
    logger,
    evictCooldownMs: 5_000,
    drainMs: 100,
    now: () => clock,
  });
  const app = createApp({
    registry,
    trustedProxies: TRUSTED,
    readiness: () => store.check(),
    listenerState: () => 'listening',
    logger,
  });
  return {
    app,
    registry,
    store,
    instances,
    logger,
    advance: (ms) => {
      clock += ms;
    },
    respondWith: (key, respond) => {
      responders.set(key, respond);
    },
    send: (target, init, peer = LOOPBACK) => {
      return Promise.resolve(app.request(target, init, bindings(target, peer)));
    },
  };
}

function lastRequest(h: Harness, key: string): Request {
  const request = h.instances.get(key)?.at(-1)?.requests.at(-1);
  if (request === undefined) throw new Error(`site ${key} received no request`);
  return request;
}

function callCount(h: Harness, key: string): number {
  return (h.instances.get(key) ?? []).reduce((sum, instance) => sum + instance.requests.length, 0);
}

interface ErrorBody {
  error: { code: string; message: string };
}

const errorBody = async (response: Response): Promise<ErrorBody> =>
  (await response.json()) as ErrorBody;

const databaseFailure = () =>
  Response.json(
    { cause: { code: 'DATABASE_ERROR' }, message: 'Internal server error' },
    { status: 500 },
  );

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

describe('errors are JSON', () => {
  test('passes c15t JSON errors through untouched', async () => {
    const h = harness(siteRecord('shop'));
    const body = {
      cause: { code: 'SUBJECT_CONFLICT' },
      message: 'Subject belongs to another tenant',
    };
    h.respondWith('shop', () => Response.json(body, { status: 409 }));
    const response = await h.send('/s/shop/subjects', { method: 'POST', body: '{}' });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual(body);
    await h.registry.close();
  });

  test.each([
    [404, 'text/plain', '404 Not Found', 'NOT_FOUND'],
    [500, 'text/html', '<html><body>oops</body></html>', 'INTERNAL_ERROR'],
    [502, 'text/html', '<h1>Bad gateway</h1>', 'INTERNAL_ERROR'],
    [400, 'text/plain', 'bad', 'BAD_REQUEST'],
    [401, 'text/plain', 'who are you', 'UNAUTHORIZED'],
    [403, 'text/html', '<h1>Forbidden</h1>', 'FORBIDDEN'],
    [409, 'text/plain', 'conflict', 'CONFLICT'],
    [429, 'text/html', '<h1>Slow down</h1>', 'RATE_LIMITED'],
    [503, 'text/html', '<h1>Unavailable</h1>', 'SERVICE_UNAVAILABLE'],
  ])('rewrites a %s %s body as JSON', async (status, contentType, text, code) => {
    const h = harness(siteRecord('shop'));
    h.respondWith(
      'shop',
      () => new Response(text, { status, headers: { 'content-type': contentType, etag: '"x"' } }),
    );
    const response = await h.send('/s/shop/x');
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.has('etag')).toBe(false);
    const body = await errorBody(response);
    expect(body.error.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain('<');
    await h.registry.close();
  });

  test('a 304 and a 204 are left alone', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith(
      'shop',
      (request) => new Response(null, { status: request.method === 'OPTIONS' ? 204 : 304 }),
    );
    expect((await h.send('/s/shop/c15t.js')).status).toBe(304);
    expect((await h.send('/s/shop/init', { method: 'OPTIONS' })).status).toBe(204);
    await h.registry.close();
  });

  test('an unexpected exception is a generic JSON 500 with no stack or message', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', () => {
      throw new Error('select * from "c15t"."subject" failed: password=hunter2');
    });
    const response = await h.send('/s/shop/init');
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error.' },
    });
    expect(text).not.toMatch(/hunter2|select|stack|at /);
    await h.registry.close();
  });

  test('a site the registry rejects is a JSON 500 that names no value', async () => {
    const store = new MemoryStore(siteRecord('shop'));
    const registry = new SiteRegistry({
      store,
      factory: () => {
        throw new SiteConfigError('shop', 'trustedOrigins must not be empty');
      },
    });
    const app = createApp({
      registry,
      trustedProxies: TRUSTED,
      readiness: () => store.check(),
      listenerState: () => 'listening',
    });
    const response = await app.request('/s/shop/init');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Site configuration is invalid.' },
    });
    await registry.close();
  });
});

describe('database failover', () => {
  const failoverError = (code: string) => Object.assign(new Error('driver detail'), { code });

  test('a read that hits a database error is retried once on a fresh instance', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', (_request, built) =>
      built === 0 ? databaseFailure() : Response.json({ built }),
    );
    await h.registry.use('shop', async () => undefined);
    h.advance(6_000);
    const response = await h.send('/s/shop/init');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ built: 1 });
    expect(h.instances.get('shop')).toHaveLength(2);
    await h.registry.close();
  });

  test('a write is never retried, but the instance is replaced for the next request', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', (_request, built) =>
      built === 0 ? databaseFailure() : Response.json({ built }),
    );
    h.advance(0);
    await h.registry.use('shop', async () => undefined);
    h.advance(6_000);

    const failed = await h.send('/s/shop/subjects', { method: 'POST', body: '{}' });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Consent storage is temporarily unavailable. Please retry.',
      },
    });
    expect(failed.headers.get('retry-after')).toBe('1');
    expect(h.instances.get('shop')).toHaveLength(1);
    expect(h.instances.get('shop')?.[0]?.requests).toHaveLength(1);

    const next = await h.send('/s/shop/subjects', { method: 'POST', body: '{}' });
    expect(next.status).toBe(200);
    expect(h.instances.get('shop')).toHaveLength(2);
    await h.registry.close();
  });

  test('a brand-new instance is not thrown away: the failure is a 503 and nothing is retried', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', () => databaseFailure());
    const response = await h.send('/s/shop/init');
    expect(response.status).toBe(503);
    expect(h.instances.get('shop')).toHaveLength(1);
    expect(h.instances.get('shop')?.[0]?.requests).toHaveLength(1);
    await h.registry.close();
  });

  test('a read that still fails after the retry is a 503, not a loop', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', () => databaseFailure());
    await h.registry.use('shop', async () => undefined);
    h.advance(6_000);
    const response = await h.send('/s/shop/init');
    expect(response.status).toBe(503);
    expect(h.instances.get('shop')).toHaveLength(2);
    expect(h.instances.get('shop')?.[1]?.requests).toHaveLength(1);
    await h.registry.close();
  });

  test('c15t reporting its own database check as unavailable is treated the same way', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', () =>
      Response.json({ cause: { code: 'SERVICE_UNAVAILABLE' }, message: 'down' }, { status: 503 }),
    );
    expect((await h.send('/s/shop/status')).status).toBe(503);
    await h.registry.close();
  });

  test.each(['25006', '57P01', 'ECONNRESET', 'CONNECTION_CLOSED'])(
    'an exception with code %s is a failover: 503, and a read is retried',
    async (code) => {
      const h = harness(siteRecord('shop'));
      h.respondWith('shop', (_request, built) => {
        if (built === 0) throw failoverError(code);
        return Response.json({ built });
      });
      await h.registry.use('shop', async () => undefined);
      h.advance(6_000);
      expect((await h.send('/s/shop/init')).status).toBe(200);

      const h2 = harness(siteRecord('shop'));
      h2.respondWith('shop', () => {
        throw failoverError(code);
      });
      expect((await h2.send('/s/shop/subjects', { method: 'POST', body: '{}' })).status).toBe(503);
      await h.registry.close();
      await h2.registry.close();
    },
  );

  test('other 5xx responses from c15t are not mistaken for a failover', async () => {
    const h = harness(siteRecord('shop'));
    h.respondWith('shop', () =>
      Response.json({ cause: { code: 'SCRIPT_UNAVAILABLE' }, message: 'bundle' }, { status: 503 }),
    );
    await h.registry.use('shop', async () => undefined);
    h.advance(6_000);
    const response = await h.send('/s/shop/c15t.js');
    expect(response.status).toBe(503);
    expect(h.instances.get('shop')).toHaveLength(1);
    await h.registry.close();
  });

  test('an unreachable registry is a 503 when nothing is cached', async () => {
    const h = harness(siteRecord('shop'));
    h.store.failure = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    const response = await h.send('/s/shop/init');
    expect(response.status).toBe(503);
    expect((await errorBody(response)).error.code).toBe('SERVICE_UNAVAILABLE');
    await h.registry.close();
  });

  test('a registry error that is not a failover is a generic 500', async () => {
    const h = harness(siteRecord('shop'));
    h.store.failure = new Error('permission denied for table site');
    const response = await h.send('/s/shop/init');
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('permission');
    await h.registry.close();
  });
});

describe('health and status', () => {
  test('/health answers without touching the database', async () => {
    const h = harness();
    h.store.failure = new Error('database down');
    const response = await h.send('/health', undefined, LAN);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    await h.registry.close();
  });

  test('/status reports readiness and the listener', async () => {
    const h = harness(siteRecord('shop'), siteRecord('off-site', { status: 'disabled' }));
    await h.send('/s/shop/init');
    const response = await h.send('/status');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      listener: 'listening',
      activeSites: 1,
      cachedInstances: 1,
    });
    await h.registry.close();
  });

  test('/status is a 503 when the database or the schema is unreachable, with no detail', async () => {
    const h = harness();
    h.store.failure = new Error('connect ECONNREFUSED 10.0.0.9:5432');
    const response = await h.send('/status');
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text).error.code).toBe('SERVICE_UNAVAILABLE');
    expect(text).not.toContain('10.0.0.9');
    await h.registry.close();
  });
});
