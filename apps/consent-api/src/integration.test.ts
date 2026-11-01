// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { randomBytes } from 'node:crypto';
import { type IncomingHttpHeaders, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createApp } from './app.js';
import { createSiteInstance } from './instance.js';
import { SiteChangeListener } from './listener.js';
import { createPostgresListenerDriver } from './listener-driver.js';
import { SiteRegistry } from './registry.js';
import { createPgSiteStore } from './site-store.js';
import { deleteTenantData, integrationEnv, testPool } from './testing/db.js';

/*
 * The whole service against the real database: the dashboard role creates sites in `app.site`,
 * consent-api reads them as `c15t_api`, serves them through a real HTTP server, and c15t writes
 * to the `c15t` schema. Every key carries a per-run prefix and only those rows are deleted.
 */

const env = integrationEnv();

/** Postgres type oid of text[]; postgres.js cannot infer it for an array parameter. */
const TEXT_ARRAY = 1009;

const runId = randomBytes(4).toString('hex');
const keyA = `t-${runId}-a`;
const keyB = `t-${runId}-b`;
const keyRo = `t-${runId}-ro`;
const keys = [keyA, keyB, keyRo];
const domainA = `a-${runId}.example.test`;
const domainB = `b-${runId}.example.test`;
const domainRo = `ro-${runId}.example.test`;
const testStart = new Date();

const dashboard = testPool(env.dashboardUrl, 'consent-api-test-dashboard');
const consentDb = testPool(env.c15tUrl, 'consent-api-test-c15t');
const registryPool = testPool(env.c15tUrl, 'consent-api-test-registry');

/** The same connection string, but every session is read-only: what a demoted Patroni node gives. */
function readOnlyUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('options', '-c default_transaction_read_only=on');
  return parsed.toString();
}

const database = (url: string) => ({ url, poolMax: 2, prepare: true, maxLifetimeSeconds: 300 });

const store = createPgSiteStore(registryPool);
const registry = new SiteRegistry({
  store,
  evictCooldownMs: 0,
  factory: (site) =>
    createSiteInstance(site, {
      apiKey: env.apiKey,
      database: database(site.key === keyRo ? readOnlyUrl(env.c15tUrl) : env.c15tUrl),
    }),
});
const listener = new SiteChangeListener({
  driver: createPostgresListenerDriver({ url: env.c15tUrl }),
  onChange: (siteKey) => registry.invalidate(siteKey),
  onResync: () => registry.invalidateAll(),
  backoffInitialMs: 100,
  backoffMaxMs: 500,
});
const app = createApp({
  registry,
  trustedProxies: ['127.0.0.1/32', '::1/128'],
  readiness: () => store.check(),
  listenerState: () => listener.state,
});

let port = 0;
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, (info: AddressInfo) => {
  port = info.port;
});

interface Reply {
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly text: string;
  readonly json: () => unknown;
}

/** node:http rather than fetch: the path and the Host header go on the wire exactly as written. */
function send(
  path: string,
  options: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: options.method ?? (body === undefined ? 'GET' : 'POST'),
        headers: {
          ...(body === undefined
            ? {}
            : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text,
            json: () => JSON.parse(text) as unknown,
          });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

/** What nginx adds: the vhost's host name and the visitor's address, and Cloudflare's country. */
const visit = (domain: string, country = 'DE'): Record<string, string> => ({
  host: domain,
  'x-forwarded-host': domain,
  'x-forwarded-for': '203.0.113.9',
  'cf-ipcountry': country,
  'user-agent': 'integration-test',
});

const subjectId = `sub_${randomBytes(6).toString('hex').replace(/[01]/g, 'z')}`;
const consentBody = (domain: string, id = subjectId) => ({
  type: 'cookie_banner',
  subjectId: id,
  domain,
  preferences: {
    necessary: true,
    measurement: true,
    marketing: false,
    functionality: false,
    experience: false,
  },
  givenAt: Date.now(),
  consentAction: 'custom',
  uiSource: 'banner',
});

async function eventually<T>(work: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await work();
    if (accept(value) || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function insertSite(key: string, domains: string[], preset = 'eu-opt-in'): Promise<void> {
  const name = `Test ${key}`;
  await dashboard`
    insert into app.site (key, name, domains, policy_preset)
    values (${key}, ${name}, ${dashboard.array(domains, TEXT_ARRAY)}, ${preset})`;
}

beforeAll(async () => {
  await insertSite(keyA, [domainA]);
  await insertSite(keyB, [domainB]);
  await insertSite(keyRo, [domainRo]);
  listener.start();
  await eventually(
    async () => listener.state,
    (state) => state === 'listening',
  );
});

afterAll(async () => {
  try {
    await listener.stop();
    await registry.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  } finally {
    try {
      await deleteTenantData(consentDb, keys);
    } finally {
      await dashboard`delete from app.site where key in ${dashboard(keys)}`;
      await Promise.all([dashboard.end(), consentDb.end(), registryPool.end()]);
    }
  }
});

describe('service health', () => {
  test('/health and /status answer, and the listener is up', async () => {
    expect((await send('/health')).json()).toEqual({ status: 'ok' });
    const status = await send('/status');
    expect(status.status).toBe(200);
    expect(status.json()).toMatchObject({ status: 'ok', listener: 'listening' });
    expect((status.json() as { activeSites: number }).activeSites).toBeGreaterThanOrEqual(3);
  });

  test('c15t_api can read the registry but nothing else in the app schema', async () => {
    const rows = await registryPool`select key from app.site where key = ${keyA}`;
    expect(rows).toHaveLength(1);
    await expect(registryPool`select 1 from app."user" limit 1`).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('serving a site', () => {
  test('/init resolves the Cloudflare country, whatever the visitor claims', async () => {
    const reply = await send(`/s/${keyA}/init?country=US&gpc=0`, {
      headers: { ...visit(domainA, 'DE'), 'x-c15t-country': 'US' },
    });
    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['cloudflare-cdn-cache-control']).toBe('no-store');
    const body = reply.json() as {
      location: { countryCode: string };
      policyResolution: { policyId: string; status: string };
    };
    expect(body.location.countryCode).toBe('DE');
    expect(body.policyResolution).toMatchObject({ policyId: 'europe_opt_in', status: 'matched' });
  });

  test('outside the EU the same site resolves its other rule', async () => {
    const reply = await send(`/s/${keyA}/init`, { headers: visit(domainA, 'BR') });
    const body = reply.json() as { policyResolution: { policyId: string } };
    expect(body.policyResolution.policyId).toBe('world_none');
  });

  test('the script tag points at the same-origin path', async () => {
    const reply = await send(`/s/${keyA}/c15t.js`, { headers: visit(domainA) });
    expect(reply.status).toBe(200);
    expect(reply.text.slice(0, 400)).toContain('"backendURL":"/api/c15t"');
    expect(reply.headers['cloudflare-cdn-cache-control']).toBe('no-store');
    expect(reply.headers['cache-control']).toMatch(/public/);
  });

  test('the per-site status route reports the database as reachable', async () => {
    const reply = await send(`/s/${keyA}/status`, { headers: visit(domainA) });
    expect(reply.status).toBe(200);
  });
});

describe('recording consent', () => {
  test('a subject saved through site A is stored under tenant A, with a masked client address', async () => {
    const reply = await send(`/s/${keyA}/subjects`, {
      headers: { ...visit(domainA), 'x-forwarded-for': '6.6.6.6, 203.0.113.9' },
      body: consentBody(domainA),
    });
    expect(reply.status).toBe(200);
    expect(reply.json()).toMatchObject({ ok: true, subjectId });

    const subjects =
      await consentDb`select id, "tenantId" from c15t.subject where id = ${subjectId}`;
    expect(subjects).toEqual([{ id: subjectId, tenantId: keyA }]);
    const consents = await consentDb`
      select "tenantId", "ipAddress", "userAgent" from c15t.consent where "subjectId" = ${subjectId}`;
    expect(consents).toEqual([
      { tenantId: keyA, ipAddress: '203.0.113.0', userAgent: 'integration-test' },
    ]);
    const orphans = await consentDb`
      select count(*)::int as n from c15t.consent where "subjectId" = ${subjectId} and "tenantId" is distinct from ${keyA}`;
    expect(orphans[0]?.['n']).toBe(0);
  });

  test("site A's reader gets the record, site B's does not", async () => {
    const own = await send(`/s/${keyA}/subjects/${subjectId}`, { headers: visit(domainA) });
    expect(own.status).toBe(200);
    expect((own.json() as { subject: { id: string } }).subject.id).toBe(subjectId);

    const other = await send(`/s/${keyB}/subjects/${subjectId}`, { headers: visit(domainB) });
    expect(other.status).toBe(404);
  });

  test("site B cannot take over site A's subject id, and writes nothing", async () => {
    const reply = await send(`/s/${keyB}/subjects`, {
      headers: visit(domainB),
      body: consentBody(domainB),
    });
    expect(reply.status).toBe(409);
    expect((reply.json() as { cause: { code: string } }).cause.code).toBe('SUBJECT_CONFLICT');
    const rows =
      await consentDb`select count(*)::int as n from c15t.consent where "tenantId" = ${keyB}`;
    expect(rows[0]?.['n']).toBe(0);
  });

  test('site B records its own subject under tenant B', async () => {
    const otherId = `${subjectId}x`;
    const reply = await send(`/s/${keyB}/subjects`, {
      headers: visit(domainB),
      body: consentBody(domainB, otherId),
    });
    expect(reply.status).toBe(200);
    const rows = await consentDb`select "tenantId" from c15t.subject where id = ${otherId}`;
    expect(rows).toEqual([{ tenantId: keyB }]);
  });
});

describe('cross-tenant isolation', () => {
  test("site A's path under site B's domain is a 404, in both directions", async () => {
    const before =
      await consentDb`select count(*)::int as n from c15t.consent where "tenantId" in ${consentDb(keys)}`;
    expect((await send(`/s/${keyA}/init`, { headers: visit(domainB) })).status).toBe(404);
    expect((await send(`/s/${keyB}/init`, { headers: visit(domainA) })).status).toBe(404);
    expect(
      (
        await send(`/s/${keyA}/subjects`, {
          headers: visit(domainB),
          body: consentBody(domainB, `${subjectId}q`),
        })
      ).status,
    ).toBe(404);
    const after =
      await consentDb`select count(*)::int as n from c15t.consent where "tenantId" in ${consentDb(keys)}`;
    expect(after[0]?.['n']).toBe(before[0]?.['n']);
  });

  test('a visitor cannot choose the tenant with a header, a cookie or a body field', async () => {
    const reply = await send(`/s/${keyB}/init`, {
      headers: {
        ...visit(domainB),
        'x-tenant-id': keyA,
        cookie: `tenantId=${keyA}`,
        'x-c15t-tenant': keyA,
      },
    });
    expect(reply.status).toBe(200);
    const forged = `${subjectId}t`;
    const saved = await send(`/s/${keyB}/subjects`, {
      headers: visit(domainB),
      body: { ...consentBody(domainB, forged), tenantId: keyA },
    });
    expect(saved.status).toBe(200);
    const rows = await consentDb`select "tenantId" from c15t.subject where id = ${forged}`;
    expect(rows).toEqual([{ tenantId: keyB }]);
  });

  test('an unknown site is a JSON 404', async () => {
    const reply = await send(`/s/t-${runId}-none/init`, { headers: visit(domainA) });
    expect(reply.status).toBe(404);
    expect(reply.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
  });

  test.each([
    `/s/${keyA}/../${keyB}/init`,
    `/s/${keyA}/%2e%2e/${keyB}/init`,
    `/s/${keyA}/..%2f${keyB}/init`,
    `/s/${keyA}/a%5cb`,
  ])('the path %s is rejected before routing', async (path) => {
    const reply = await send(path, { headers: visit(domainA) });
    expect(reply.status).toBe(400);
    expect(reply.json()).toMatchObject({ error: { code: 'BAD_REQUEST' } });
  });

  test('a peer that is not a trusted proxy gets no geo and no forwarded address', async () => {
    // This server only trusts loopback, so the test exercises the untrusted branch through a
    // second app that trusts nobody.
    const untrusting = createApp({
      registry,
      trustedProxies: ['192.0.2.1/32'],
      readiness: () => store.check(),
      listenerState: () => listener.state,
    });
    const target = `/s/${keyA}/init`;
    const reply = await untrusting.request(
      target,
      { headers: { 'cf-ipcountry': 'DE', host: domainA } },
      {
        incoming: { url: target, socket: { remoteAddress: '127.0.0.1' } },
      },
    );
    expect(reply.status).toBe(200);
    const body = (await reply.json()) as { location: { countryCode: string | null } };
    expect(body.location.countryCode).toBeNull();
  });
});

describe('site changes reach the running service', () => {
  test('disabling a site stops it being served and keeps its data', async () => {
    expect((await send(`/s/${keyA}/init`, { headers: visit(domainA) })).status).toBe(200);
    await dashboard`update app.site set status = 'disabled' where key = ${keyA}`;
    const reply = await eventually(
      () => send(`/s/${keyA}/init`, { headers: visit(domainA) }),
      (r) => r.status === 404,
    );
    expect(reply.status).toBe(404);
    const rows =
      await consentDb`select count(*)::int as n from c15t.subject where "tenantId" = ${keyA}`;
    expect(rows[0]?.['n']).toBe(1);
  });

  test('enabling it again serves it from a fresh instance', async () => {
    await dashboard`update app.site set status = 'active' where key = ${keyA}`;
    const reply = await eventually(
      () => send(`/s/${keyA}/init`, { headers: visit(domainA) }),
      (r) => r.status === 200,
    );
    expect(reply.status).toBe(200);
  });

  test('changing the domains takes effect without a restart', async () => {
    const extra = `extra-${runId}.example.test`;
    expect((await send(`/s/${keyB}/init`, { headers: visit(extra) })).status).toBe(404);
    await dashboard`update app.site set domains = ${dashboard.array([domainB, extra], TEXT_ARRAY)} where key = ${keyB}`;
    const reply = await eventually(
      () => send(`/s/${keyB}/init`, { headers: visit(extra) }),
      (r) => r.status === 200,
    );
    expect(reply.status).toBe(200);
  });

  test('a site created after start is served as soon as it is committed', async () => {
    const late = `t-${runId}-late`;
    keys.push(late);
    const domain = `late-${runId}.example.test`;
    expect((await send(`/s/${late}/init`, { headers: visit(domain) })).status).toBe(404);
    await insertSite(late, [domain]);
    const reply = await eventually(
      () => send(`/s/${late}/init`, { headers: visit(domain) }),
      (r) => r.status === 200,
    );
    expect(reply.status).toBe(200);
  });
});

describe('Patroni failover behaviour', () => {
  test('a connection that is cut is replaced and requests keep working', async () => {
    await send(`/s/${keyB}/init`, { headers: visit(domainB) });
    await consentDb`
      select pg_terminate_backend(pid) from pg_stat_activity
      where application_name like 'consent-api%' and usename = current_user
        and backend_start >= ${testStart} and pid <> pg_backend_pid()`;
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      statuses.push((await send(`/s/${keyB}/init`, { headers: visit(domainB) })).status);
    }
    expect(statuses).not.toContain(500);
    expect(statuses.at(-1)).toBe(200);
  });

  test('the listener reconnects after its connection is cut and sees later changes', async () => {
    await eventually(
      async () => listener.state,
      (state) => state === 'listening',
    );
    await consentDb`
      select pg_terminate_backend(pid) from pg_stat_activity
      where application_name = 'consent-api-listener' and usename = current_user
        and backend_start >= ${testStart}`;
    await eventually(
      async () => listener.state,
      (state) => state === 'reconnecting',
    );
    await eventually(
      async () => listener.state,
      (state) => state === 'listening',
    );

    await dashboard`update app.site set status = 'disabled' where key = ${keyB}`;
    const gone = await eventually(
      () => send(`/s/${keyB}/init`, { headers: visit(domainB) }),
      (r) => r.status === 404,
    );
    expect(gone.status).toBe(404);
    await dashboard`update app.site set status = 'active' where key = ${keyB}`;
    const back = await eventually(
      () => send(`/s/${keyB}/init`, { headers: visit(domainB) }),
      (r) => r.status === 200,
    );
    expect(back.status).toBe(200);
  });

  test('a write on a read-only session is a 503 that replaces the instance, and reads still work', async () => {
    const read = await send(`/s/${keyRo}/init`, { headers: visit(domainRo) });
    expect(read.status).toBe(200);

    const write = await send(`/s/${keyRo}/subjects`, {
      headers: visit(domainRo),
      body: consentBody(domainRo, `${subjectId}r`),
    });
    expect(write.status).toBe(503);
    expect(write.headers['retry-after']).toBe('1');
    expect(write.json()).toMatchObject({ error: { code: 'SERVICE_UNAVAILABLE' } });
    expect(write.text).not.toMatch(/read-only|INSERT|25006/i);

    const unknownSubject = `${subjectId}r`;
    const rows =
      await consentDb`select count(*)::int as n from c15t.subject where id = ${unknownSubject}`;
    expect(rows[0]?.['n']).toBe(0);
    expect((await send(`/s/${keyRo}/init`, { headers: visit(domainRo) })).status).toBe(200);
  });
});
