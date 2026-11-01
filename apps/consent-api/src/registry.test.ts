// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test, vi } from 'vitest';
import { SiteConfigError } from './errors.js';
import { type InstanceFactory, SiteRegistry } from './registry.js';
import type { SiteRecord } from './site-store.js';
import {
  capturingLogger,
  deferred,
  type FakeInstance,
  fakeInstance,
  MemoryStore,
  siteRecord,
} from './testing/fakes.js';

function setup(...records: ReturnType<typeof siteRecord>[]) {
  const store = new MemoryStore(...records);
  const built: FakeInstance[] = [];
  const factory: InstanceFactory = vi.fn((site: SiteRecord) => {
    const instance = fakeInstance(() => Response.json({ site: site.key }));
    built.push(instance);
    return instance;
  });
  let clock = 1_000_000;
  const logger = capturingLogger();
  const registry = new SiteRegistry({
    store,
    factory,
    logger,
    ttlMs: 60_000,
    negativeTtlMs: 10_000,
    evictCooldownMs: 5_000,
    drainMs: 200,
    now: () => clock,
  });
  return {
    store,
    built,
    factory,
    registry,
    logger,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

const run = (registry: SiteRegistry, key: string) =>
  registry.use(key, async (handle) => handle.instance);

describe('SiteRegistry lookup and cache', () => {
  test('builds one instance per active site, lazily, and reuses it', async () => {
    const { registry, factory, store } = setup(siteRecord('shop'), siteRecord('blog'));
    expect(factory).not.toHaveBeenCalled();

    const first = await run(registry, 'shop');
    const second = await run(registry, 'shop');
    const other = await run(registry, 'blog');

    expect(first.found && second.found && other.found).toBe(true);
    if (!(first.found && second.found && other.found)) return;
    expect(first.value).toBe(second.value);
    expect(other.value).not.toBe(first.value);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(store.finds).toBe(2);
    expect(registry.size).toBe(2);
    await registry.close();
  });

  test('hands the factory the row it read, tenant included', async () => {
    const { registry, factory } = setup(siteRecord('shop', { domains: ['a.example.com'] }));
    await run(registry, 'shop');
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'shop', domains: ['a.example.com'] }),
    );
    await registry.close();
  });

  test('an unknown site is not found, and not looked up again until the negative TTL passes', async () => {
    const { registry, store, advance, factory } = setup();
    expect((await run(registry, 'nope-nope')).found).toBe(false);
    expect((await run(registry, 'nope-nope')).found).toBe(false);
    expect(store.finds).toBe(1);

    advance(10_001);
    store.sites.set('nope-nope', siteRecord('nope-nope'));
    expect((await run(registry, 'nope-nope')).found).toBe(true);
    expect(store.finds).toBe(2);
    expect(factory).toHaveBeenCalledTimes(1);
    await registry.close();
  });

  test('a disabled site is not found and gets no instance', async () => {
    const { registry, factory } = setup(siteRecord('off-site', { status: 'disabled' }));
    expect((await run(registry, 'off-site')).found).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    await registry.close();
  });

  test.each(['', 'ab', 'UPPER', 'has_underscore', '../x', 'a/b', 'a'.repeat(41)])(
    'a malformed key %j never reaches the database',
    async (key) => {
      const { registry, store } = setup();
      expect((await run(registry, key)).found).toBe(false);
      expect(store.finds).toBe(0);
      await registry.close();
    },
  );

  test('concurrent first requests share one lookup and one instance', async () => {
    const gate = deferred();
    const { registry, store, factory } = setup(siteRecord('shop'));
    store.onFind = () => gate.promise;
    const lookups = Promise.all([
      run(registry, 'shop'),
      run(registry, 'shop'),
      run(registry, 'shop'),
    ]);
    await vi.waitFor(() => expect(store.finds).toBe(1));
    gate.resolve();
    const results = await lookups;
    expect(results.every((result) => result.found)).toBe(true);
    expect(store.finds).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);
    await registry.close();
  });

  test('a site that fails validation is rejected, not cached, and retried next time', async () => {
    const { registry, store, factory } = setup(siteRecord('shop'));
    vi.mocked(factory).mockImplementationOnce(() => {
      throw new SiteConfigError('shop', 'trustedOrigins must not be empty');
    });
    await expect(run(registry, 'shop')).rejects.toBeInstanceOf(SiteConfigError);
    expect(registry.size).toBe(0);
    expect((await run(registry, 'shop')).found).toBe(true);
    expect(store.finds).toBe(2);
    await registry.close();
  });
});

describe('SiteRegistry invalidation and disposal', () => {
  test('invalidate disposes the instance and the next request rebuilds it', async () => {
    const { registry, built, factory } = setup(siteRecord('shop'));
    await run(registry, 'shop');
    registry.invalidate('shop');
    expect(registry.size).toBe(0);
    await vi.waitFor(() => expect(built[0]?.disposed).toBe(1));

    await run(registry, 'shop');
    expect(factory).toHaveBeenCalledTimes(2);
    expect(built[1]?.disposed).toBe(0);
    await registry.close();
  });

  test('invalidate leaves the other sites alone', async () => {
    const { registry, built } = setup(siteRecord('shop'), siteRecord('blog'));
    await run(registry, 'shop');
    await run(registry, 'blog');
    registry.invalidate('shop');
    await vi.waitFor(() => expect(built[0]?.disposed).toBe(1));
    expect(built[1]?.disposed).toBe(0);
    expect(registry.size).toBe(1);
    await registry.close();
  });

  test('a retired instance is not disposed under a request that still uses it', async () => {
    const { registry, built } = setup(siteRecord('shop'));
    const gate = deferred();
    const inFlight = registry.use('shop', async () => gate.promise);
    await vi.waitFor(() => expect(built).toHaveLength(1));

    registry.invalidate('shop');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(built[0]?.disposed).toBe(0);

    gate.resolve();
    await inFlight;
    await vi.waitFor(() => expect(built[0]?.disposed).toBe(1));
    await registry.close();
  });

  test('a retired instance is disposed after the drain deadline even if a request hangs', async () => {
    const { registry, built } = setup(siteRecord('shop'));
    const forever = deferred();
    const hung = registry.use('shop', async () => forever.promise);
    await vi.waitFor(() => expect(built).toHaveLength(1));
    registry.invalidate('shop');
    await vi.waitFor(() => expect(built[0]?.disposed).toBe(1));
    forever.resolve();
    await hung;
    expect(built[0]?.disposed).toBe(1);
    await registry.close();
  });

  test('invalidateAll disposes every instance and forgets negative results', async () => {
    const { registry, built, store, advance } = setup(siteRecord('shop'), siteRecord('blog'));
    await run(registry, 'shop');
    await run(registry, 'blog');
    expect((await run(registry, 'gone-gone')).found).toBe(false);
    store.sites.set('gone-gone', siteRecord('gone-gone'));
    advance(1);

    registry.invalidateAll();
    await vi.waitFor(() => expect(built.map((i) => i.disposed)).toEqual([1, 1]));
    expect(registry.size).toBe(0);
    expect((await run(registry, 'gone-gone')).found).toBe(true);
    await registry.close();
  });

  test('a change notification that lands mid-lookup forces a fresh read', async () => {
    const { registry, store, factory } = setup(
      siteRecord('shop', { domains: ['old.example.com'] }),
    );
    const gate = deferred();
    store.onFind = async () => {
      // Only the first, slow read waits.
      store.onFind = undefined;
      await gate.promise;
    };
    const lookup = run(registry, 'shop');
    await vi.waitFor(() => expect(store.finds).toBe(1));

    store.sites.set('shop', siteRecord('shop', { domains: ['new.example.com'] }));
    registry.invalidate('shop');
    gate.resolve();
    await lookup;

    expect(store.finds).toBe(2);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ domains: ['new.example.com'] }));
    await registry.close();
  });

  test('close disposes everything, including instances that were already retired', async () => {
    const { registry, built } = setup(siteRecord('shop'), siteRecord('blog'));
    await run(registry, 'shop');
    await run(registry, 'blog');
    registry.invalidate('shop');
    await registry.close();
    expect(built.map((i) => i.disposed)).toEqual([1, 1]);
    expect((await run(registry, 'blog')).found).toBe(false);
  });

  test('a failing dispose is logged, not thrown', async () => {
    const { registry, built, logger } = setup(siteRecord('shop'));
    await run(registry, 'shop');
    const instance = built[0];
    if (instance === undefined) throw new Error('no instance');
    instance.dispose = async () => {
      throw new Error('pool is already closed');
    };
    await registry.close();
    expect(logger.lines.some((line) => line.message.includes('disposing'))).toBe(true);
  });
});

describe('SiteRegistry TTL backstop', () => {
  test('re-reads an expired site and keeps the instance when nothing changed', async () => {
    const { registry, store, factory, advance } = setup(siteRecord('shop'));
    await run(registry, 'shop');
    advance(60_001);
    await run(registry, 'shop');
    expect(store.finds).toBe(2);
    expect(factory).toHaveBeenCalledTimes(1);
    advance(30_000);
    await run(registry, 'shop');
    expect(store.finds).toBe(2);
    await registry.close();
  });

  test('swaps the instance when the re-read row changed (a missed NOTIFY)', async () => {
    const { registry, store, built, advance } = setup(siteRecord('shop'));
    await run(registry, 'shop');
    store.sites.set(
      'shop',
      siteRecord('shop', { domains: ['shop.example.com', 'www.example.com'] }),
    );
    advance(60_001);
    await run(registry, 'shop');
    expect(built).toHaveLength(2);
    await vi.waitFor(() => expect(built[0]?.disposed).toBe(1));
    await registry.close();
  });

  test('stops serving a site that was disabled while the notification was missed', async () => {
    const { registry, store, built, advance } = setup(siteRecord('shop'));
    await run(registry, 'shop');
    store.sites.set('shop', siteRecord('shop', { status: 'disabled' }));
    advance(60_001);
    expect((await run(registry, 'shop')).found).toBe(false);
    await vi.waitFor(() => expect(built[0]?.disposed).toBe(1));
    await registry.close();
  });

  test('keeps serving the cached instance while the database is down', async () => {
    const { registry, store, factory, advance, logger } = setup(siteRecord('shop'));
    await run(registry, 'shop');
    store.failure = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    advance(60_001);
    expect((await run(registry, 'shop')).found).toBe(true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(logger.lines.some((line) => line.level === 'warn')).toBe(true);
    await registry.close();
  });

  test('rejects when the database is down and nothing is cached', async () => {
    const { registry, store } = setup(siteRecord('shop'));
    store.failure = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    await expect(run(registry, 'shop')).rejects.toThrow('connection reset');
    await registry.close();
  });
});

describe('SiteRegistry.evict', () => {
  test('retires an instance that is old enough, and the next request rebuilds it', async () => {
    const { registry, built, advance } = setup(siteRecord('shop'));
    advance(0);
    const lookup = await registry.use('shop', async (handle) => handle);
    if (!lookup.found) throw new Error('not found');
    advance(5_001);
    expect(registry.evict('shop', lookup.value)).toBe('evicted');
    await vi.waitFor(() => expect(built[0]?.disposed).toBe(1));
    await run(registry, 'shop');
    expect(built).toHaveLength(2);
    await registry.close();
  });

  test('does not rebuild an instance that was built moments ago', async () => {
    const { registry, built } = setup(siteRecord('shop'));
    const lookup = await registry.use('shop', async (handle) => handle);
    if (!lookup.found) throw new Error('not found');
    expect(registry.evict('shop', lookup.value)).toBe('throttled');
    expect(built).toHaveLength(1);
    expect(registry.size).toBe(1);
    await registry.close();
  });

  test('reports that the instance was already replaced', async () => {
    const { registry, advance } = setup(siteRecord('shop'));
    const lookup = await registry.use('shop', async (handle) => handle);
    if (!lookup.found) throw new Error('not found');
    registry.invalidate('shop');
    await run(registry, 'shop');
    advance(10_000);
    expect(registry.evict('shop', lookup.value)).toBe('replaced');
    expect(registry.size).toBe(1);
    await registry.close();
  });
});

describe('SiteRegistry shutdown and bounds', () => {
  test('a lookup that finishes after close builds nothing and finds nothing', async () => {
    const { registry, store, factory } = setup(siteRecord('shop'));
    const gate = deferred();
    store.onFind = async () => {
      store.onFind = undefined;
      await gate.promise;
    };
    const lookup = run(registry, 'shop');
    await vi.waitFor(() => expect(store.finds).toBe(1));

    await registry.close();
    gate.resolve();

    expect((await lookup).found).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  test('the memory of unknown sites is bounded: a full one is emptied before it remembers the next', async () => {
    const { registry, store } = setup();
    for (let i = 0; i < 1_000; i++) await run(registry, `miss-${i}`);
    expect(store.finds).toBe(1_000);
    await run(registry, 'miss-0');
    expect(store.finds).toBe(1_000);

    // The 1001st unknown key finds the memory full.
    await run(registry, 'miss-1000');
    expect(store.finds).toBe(1_001);
    // Everything remembered before it is forgotten, so the database is asked again ...
    await run(registry, 'miss-0');
    expect(store.finds).toBe(1_002);
    // ... while the key that triggered the reset is remembered.
    await run(registry, 'miss-1000');
    expect(store.finds).toBe(1_002);
    await registry.close();
  });
});
