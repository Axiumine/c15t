// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { fieldOf } from '@consent/shared';
import { describe, expect, test } from 'vitest';
import { createApp } from './app.js';
import { SiteConfigError } from './errors.js';
import { SiteRegistry } from './registry.js';
import { databaseFailure, errorBody, harness, LAN, TRUSTED } from './testing/app-harness.js';
import { MemoryStore, siteRecord } from './testing/fakes.js';

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
    expect(fieldOf(fieldOf(JSON.parse(text), 'error'), 'code')).toBe('SERVICE_UNAVAILABLE');
    expect(text).not.toContain('10.0.0.9');
    await h.registry.close();
  });
});
