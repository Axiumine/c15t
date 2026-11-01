// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test, vi } from 'vitest';
import { SiteRegistry } from './registry.js';
import { deferred, fakeInstance, MemoryStore, siteRecord } from './testing/fakes.js';
import { build, run, setup } from './testing/registry-harness.js';

/*
 * The edges of the registry's timing rules (TTL, negative TTL, drain, eviction cooldown): each test
 * sits one millisecond either side of a limit. Mutation testing showed that no other test did.
 */

describe('SiteRegistry boundaries', () => {
  test('without options an instance is trusted for five minutes', async () => {
    const store = new MemoryStore(siteRecord('shop'));
    let clock = 0;
    const registry = new SiteRegistry({
      store,
      factory: () => fakeInstance(() => new Response()),
      now: () => clock,
    });
    await run(registry, 'shop');
    clock = 4 * 60_000;
    await run(registry, 'shop');
    expect(store.finds).toBe(1);
    clock = 5 * 60_000;
    await run(registry, 'shop');
    expect(store.finds).toBe(2);
    await registry.close();
  });

  test('an instance expires at exactly the TTL, not a moment later', async () => {
    const { registry, store, advance } = setup(siteRecord('shop'));
    await run(registry, 'shop');
    advance(59_999);
    await run(registry, 'shop');
    expect(store.finds).toBe(1);
    advance(1);
    await run(registry, 'shop');
    expect(store.finds).toBe(2);
    await registry.close();
  });

  test('a missing site is looked up again at exactly the negative TTL', async () => {
    const { registry, store, advance } = setup();
    expect((await run(registry, 'nope-nope')).found).toBe(false);
    advance(9_999);
    expect((await run(registry, 'nope-nope')).found).toBe(false);
    expect(store.finds).toBe(1);
    advance(1);
    store.sites.set('nope-nope', siteRecord('nope-nope'));
    expect((await run(registry, 'nope-nope')).found).toBe(true);
    expect(store.finds).toBe(2);
    await registry.close();
  });

  test('a notification for a missing site makes the next request look again at once', async () => {
    const { registry, store } = setup();
    expect((await run(registry, 'nope-nope')).found).toBe(false);
    store.sites.set('nope-nope', siteRecord('nope-nope'));
    registry.invalidate('nope-nope');
    expect((await run(registry, 'nope-nope')).found).toBe(true);
    await registry.close();
  });

  test('evict works at exactly the cooldown, and not before', async () => {
    const { registry, advance } = setup(siteRecord('shop'));
    const lookup = await registry.use('shop', async (handle) => handle);
    if (!lookup.found) throw new Error('not found');
    advance(4_999);
    expect(registry.evict('shop', lookup.value)).toBe('throttled');
    advance(1);
    expect(registry.evict('shop', lookup.value)).toBe('evicted');
    await registry.close();
  });

  test('the order of the domains does not make a new instance', async () => {
    const { registry, store, factory, advance } = setup(
      siteRecord('shop', { domains: ['a.example.com', 'b.example.com'] }),
    );
    await run(registry, 'shop');
    store.sites.set('shop', siteRecord('shop', { domains: ['b.example.com', 'a.example.com'] }));
    advance(60_001);
    await run(registry, 'shop');
    expect(store.finds).toBe(2);
    expect(factory).toHaveBeenCalledTimes(1);
    await registry.close();
  });

  test('a site that was disabled is no longer counted', async () => {
    const { registry, store, advance } = setup(siteRecord('shop'));
    await run(registry, 'shop');
    store.sites.set('shop', siteRecord('shop', { status: 'disabled' }));
    advance(60_001);
    expect((await run(registry, 'shop')).found).toBe(false);
    expect(registry.size).toBe(0);
    await registry.close();
  });

  test('a failed reload is logged with the site key and the error', async () => {
    const { registry, store, advance, logger } = setup(siteRecord('shop'));
    await run(registry, 'shop');
    store.failure = Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    advance(60_001);
    await run(registry, 'shop');
    expect(logger.lines).toContainEqual({
      level: 'warn',
      message: 'site reload failed, serving the cached instance',
      fields: { siteKey: 'shop', error: 'Error', message: 'connection reset', code: 'ECONNRESET' },
    });
    await registry.close();
  });

  test('notifications that keep arriving during a read cause two re-reads, then the row is used', async () => {
    const { registry, store, factory } = setup(siteRecord('shop'));
    store.onFind = async () => {
      registry.invalidate('shop');
    };
    expect((await run(registry, 'shop')).found).toBe(true);
    expect(store.finds).toBe(3);
    expect(factory).toHaveBeenCalledTimes(1);
    await registry.close();
  });

  test('a second notification during a read is noticed as well', async () => {
    const { registry, store } = setup(siteRecord('shop'));
    registry.invalidate('shop');
    const gate = deferred();
    store.onFind = async () => {
      store.onFind = undefined;
      await gate.promise;
    };
    const lookup = run(registry, 'shop');
    await vi.waitFor(() => expect(store.finds).toBe(1));
    registry.invalidate('shop');
    gate.resolve();
    await lookup;
    expect(store.finds).toBe(2);
    await registry.close();
  });
});

describe('SiteRegistry disposal timing', () => {
  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test('an idle retired instance is disposed at once, not when the drain deadline passes', async () => {
    const { registry, built } = build({ drainMs: 60_000 }, siteRecord('shop'));
    await run(registry, 'shop');
    registry.invalidate('shop');
    await vi.waitFor(() => expect(built[0]?.disposed).toBe(1), { timeout: 500 });
    await registry.close();
  });

  test('the last request out disposes a retired instance, before the drain deadline', async () => {
    const { registry, built } = build({ drainMs: 60_000 }, siteRecord('shop'));
    const first = deferred();
    const second = deferred();
    const one = registry.use('shop', async () => first.promise);
    const two = registry.use('shop', async () => second.promise);
    await vi.waitFor(() => expect(built).toHaveLength(1));
    await settle(10);

    registry.invalidate('shop');
    await settle(20);
    expect(built[0]?.disposed).toBe(0);

    first.resolve();
    await one;
    await settle(20);
    expect(built[0]?.disposed).toBe(0);

    second.resolve();
    await two;
    await vi.waitFor(() => expect(built[0]?.disposed).toBe(1), { timeout: 500 });
    await registry.close();
  });

  test('a live instance is not disposed when its requests finish', async () => {
    const { registry, built } = build({ drainMs: 60_000 }, siteRecord('shop'));
    await run(registry, 'shop');
    await run(registry, 'shop');
    await settle(20);
    expect(built[0]?.disposed).toBe(0);
    await registry.close();
  });
});
