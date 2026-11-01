// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { silentLogger } from './log.js';
import { type RegistryConfig, resolveConfig } from './registry-config.js';
import { SiteResolver } from './registry-resolver.js';
import { EntryRetirer } from './registry-retirer.js';
import { EntryTable, Epochs, MissingKeys } from './registry-state.js';
import type { EvictOutcome, RegistryOptions, SiteHandle, SiteLookup } from './registry-types.js';

/**
 * One c15t instance per active site (CLAUDE.md "Multi-tenancy"), built lazily from `app.site`,
 * cached, and disposed when the site changes. The tenant is resolved here and only here: from the
 * `siteKey` that nginx put in the path, against the database. An unknown or disabled site yields
 * `{ found: false }`.
 *
 * An instance that is retired (site changed, listener reconnected, database error) is not
 * disposed under a request that still uses it: disposal waits for the in-flight requests.
 */
export class SiteRegistry {
  private readonly config: RegistryConfig;
  private readonly retirer: EntryRetirer;
  private readonly entries: EntryTable;
  private readonly missing = new MissingKeys();
  private readonly epochs = new Epochs();
  private readonly resolver: SiteResolver;

  constructor(options: RegistryOptions) {
    const log = options.logger ?? silentLogger;
    this.config = resolveConfig(options);
    this.retirer = new EntryRetirer(log, this.config.drainMs);
    this.entries = new EntryTable(this.retirer);
    this.resolver = new SiteResolver({
      store: options.store,
      factory: options.factory,
      config: this.config,
      log,
      entries: this.entries,
      missing: this.missing,
      epochs: this.epochs,
    });
  }

  /** Number of live cached instances. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Runs `work` with the site's instance. Rejects when the registry table cannot be read and no
   * cached copy exists, and with `SiteConfigError` when the row cannot become a safe instance.
   */
  async use<T>(siteKey: string, work: (handle: SiteHandle) => Promise<T>): Promise<SiteLookup<T>> {
    const entry = await this.resolver.acquire(siteKey);
    if (entry === null) return { found: false };
    entry.inflight += 1;
    try {
      const value = await work({ id: entry.id, site: entry.record, instance: entry.instance });
      return { found: true, value };
    } finally {
      this.retirer.release(entry);
    }
  }

  /** The site changed (`NOTIFY site_changed`): forget it so the next request rebuilds it. */
  invalidate(siteKey: string): void {
    this.epochs.bump(siteKey);
    this.missing.forget(siteKey);
    this.entries.remove(siteKey);
  }

  /** Notifications may have been missed (listener reconnect): forget every site. */
  invalidateAll(): void {
    this.epochs.bumpAll();
    this.missing.clear();
    this.entries.clear();
  }

  /**
   * A request saw a database failure through this instance. Retire it so the next request opens
   * fresh connections, which resolve the primary's DNS name again (docs/decisions.md D9).
   */
  evict(siteKey: string, handle: SiteHandle): EvictOutcome {
    const entry = this.entries.get(siteKey);
    if (entry === undefined || entry.id !== handle.id) return 'replaced';
    if (this.config.now() - entry.createdAt < this.config.evictCooldownMs) return 'throttled';
    this.entries.remove(siteKey);
    return 'evicted';
  }

  /** Disposes every instance, including retired ones, and waits for the pools to close. */
  async close(): Promise<void> {
    this.resolver.close();
    this.invalidateAll();
    await this.retirer.disposeAll();
  }
}
