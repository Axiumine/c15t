// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { SITE_KEY_PATTERN } from '@consent/shared';
import { errorFields, type Logger } from './log.js';
import type { RegistryConfig } from './registry-config.js';
import { createEntry, fingerprintOf } from './registry-entry.js';
import { SiteLoader } from './registry-loader.js';
import type { EntryTable, Epochs, MissingKeys } from './registry-state.js';
import type { Entry, InstanceFactory } from './registry-types.js';
import type { SiteRecord, SiteStore } from './site-store.js';

export interface ResolverDeps {
  readonly store: SiteStore;
  readonly factory: InstanceFactory;
  readonly config: RegistryConfig;
  readonly log: Logger;
  readonly entries: EntryTable;
  readonly missing: MissingKeys;
  readonly epochs: Epochs;
}

/** Turns a `siteKey` into the entry that serves it: the cached one, or one read from the store. */
export class SiteResolver {
  private readonly deps: ResolverDeps;
  private readonly loader: SiteLoader;
  private nextId = 1;
  private closed = false;

  constructor(deps: ResolverDeps) {
    this.deps = deps;
    this.loader = new SiteLoader(deps.store, deps.epochs, (siteKey, record) =>
      this.settle(siteKey, record),
    );
  }

  /** From now on nothing resolves. */
  close(): void {
    this.closed = true;
  }

  async acquire(siteKey: string): Promise<Entry | null> {
    if (this.closed || !SITE_KEY_PATTERN.test(siteKey)) return null;
    const now = this.deps.config.now();
    const cached = this.deps.entries.get(siteKey);
    if (cached !== undefined && now - cached.loadedAt < this.deps.config.ttlMs) return cached;
    if (cached === undefined && this.deps.missing.isMissing(siteKey, now)) return null;

    try {
      return await this.loader.pending(siteKey);
    } catch (error) {
      return this.keepServing(siteKey, cached, error);
    }
  }

  /**
   * The cached copy is the last known good configuration: keep serving it while the database is
   * unreachable, rather than turning a failover into a 404 or a 5xx.
   */
  private keepServing(siteKey: string, cached: Entry | undefined, error: unknown): Entry {
    if (cached === undefined || cached.retired) throw error;
    this.deps.log.warn('site reload failed, serving the cached instance', {
      siteKey,
      ...errorFields(error),
    });
    return cached;
  }

  private settle(siteKey: string, record: SiteRecord | null): Entry | null {
    const { config, entries, missing } = this.deps;
    if (this.closed) return null;
    const current = entries.get(siteKey);

    if (record === null || record.status !== 'active') {
      entries.remove(siteKey);
      missing.remember(siteKey, config.now() + config.negativeTtlMs);
      return null;
    }

    missing.forget(siteKey);
    const fingerprint = fingerprintOf(record);
    if (current?.fingerprint === fingerprint) {
      current.loadedAt = config.now();
      return current;
    }

    const instance = this.deps.factory(record);
    const id = this.nextId++;
    const entry = createEntry({ id, record, fingerprint, instance, now: config.now() });
    entries.replace(siteKey, entry);
    return entry;
  }
}
