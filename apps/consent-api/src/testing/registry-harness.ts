// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { vi } from 'vitest';
import { SiteRegistry } from '../registry.js';
import type { InstanceFactory, RegistryOptions } from '../registry-types.js';
import type { SiteRecord } from '../site-store.js';
import {
  capturingLogger,
  type FakeInstance,
  fakeInstance,
  MemoryStore,
  type siteRecord,
} from './fakes.js';

/** A registry over an in-memory store and fake instances, with a clock the test moves by hand. */
export type RegistryTimings = Partial<
  Pick<RegistryOptions, 'ttlMs' | 'negativeTtlMs' | 'evictCooldownMs' | 'drainMs'>
>;

export function setup(...records: ReturnType<typeof siteRecord>[]) {
  return build({}, ...records);
}

export function build(timings: RegistryTimings, ...records: ReturnType<typeof siteRecord>[]) {
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
    ...timings,
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

export const run = (registry: SiteRegistry, key: string) =>
  registry.use(key, async (handle) => handle.instance);
