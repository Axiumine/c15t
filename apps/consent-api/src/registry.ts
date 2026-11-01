// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { C15TInstance } from '@c15t/backend';
import { SITE_KEY_PATTERN } from '@consent/shared';
import { errorFields, type Logger, silentLogger } from './log.js';
import type { SiteRecord, SiteStore } from './site-store.js';

export type InstanceFactory = (site: SiteRecord) => C15TInstance;

/** What a request gets to work with. `id` identifies the cached instance for `evict`. */
export interface SiteHandle {
  readonly id: number;
  readonly site: SiteRecord;
  readonly instance: C15TInstance;
}

export type SiteLookup<T> = { readonly found: true; readonly value: T } | { readonly found: false };

/**
 * `evicted`: this call retired the instance. `replaced`: it was already gone or replaced.
 * `throttled`: it was built moments ago, so rebuilding it again would not help.
 */
export type EvictOutcome = 'evicted' | 'replaced' | 'throttled';

export interface RegistryOptions {
  readonly store: SiteStore;
  readonly factory: InstanceFactory;
  readonly logger?: Logger;
  /** Backstop for a lost `NOTIFY`: a cached site is re-read after this long. Default 5 minutes. */
  readonly ttlMs?: number;
  /** How long an unknown or disabled site is remembered, so probing keys cannot hammer the database. */
  readonly negativeTtlMs?: number;
  /** Minimum age of an instance before `evict` may retire it. */
  readonly evictCooldownMs?: number;
  /** A retired instance is disposed once idle, and in any case after this long. */
  readonly drainMs?: number;
  readonly now?: () => number;
}

interface Entry {
  readonly id: number;
  readonly record: SiteRecord;
  readonly fingerprint: string;
  readonly instance: C15TInstance;
  readonly createdAt: number;
  loadedAt: number;
  inflight: number;
  retired: boolean;
  disposed: boolean;
  hardTimer: NodeJS.Timeout | undefined;
}

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_NEGATIVE_TTL_MS = 30_000;
const DEFAULT_EVICT_COOLDOWN_MS = 5_000;
const DEFAULT_DRAIN_MS = 30_000;
const MAX_MISSING_KEYS = 1_000;
const MAX_STALE_RELOADS = 2;

function fingerprintOf(site: SiteRecord): string {
  return JSON.stringify([
    site.key,
    site.policyPreset,
    [...site.domains].sort((a, b) => a.localeCompare(b)),
  ]);
}

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
  private readonly store: SiteStore;
  private readonly factory: InstanceFactory;
  private readonly log: Logger;
  private readonly ttlMs: number;
  private readonly negativeTtlMs: number;
  private readonly evictCooldownMs: number;
  private readonly drainMs: number;
  private readonly now: () => number;

  private readonly entries = new Map<string, Entry>();
  private readonly retiring = new Set<Entry>();
  private readonly missing = new Map<string, number>();
  private readonly loading = new Map<string, Promise<Entry | null>>();
  private readonly epochs = new Map<string, number>();
  private readonly disposals = new Set<Promise<void>>();
  private globalEpoch = 0;
  private nextId = 1;
  private closed = false;

  constructor(options: RegistryOptions) {
    this.store = options.store;
    this.factory = options.factory;
    this.log = options.logger ?? silentLogger;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.negativeTtlMs = options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS;
    this.evictCooldownMs = options.evictCooldownMs ?? DEFAULT_EVICT_COOLDOWN_MS;
    this.drainMs = options.drainMs ?? DEFAULT_DRAIN_MS;
    this.now = options.now ?? Date.now;
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
    const entry = await this.acquire(siteKey);
    if (entry === null) return { found: false };
    entry.inflight += 1;
    try {
      const value = await work({ id: entry.id, site: entry.record, instance: entry.instance });
      return { found: true, value };
    } finally {
      this.release(entry);
    }
  }

  /** The site changed (`NOTIFY site_changed`): forget it so the next request rebuilds it. */
  invalidate(siteKey: string): void {
    this.epochs.set(siteKey, (this.epochs.get(siteKey) ?? 0) + 1);
    this.missing.delete(siteKey);
    const entry = this.entries.get(siteKey);
    if (entry === undefined) return;
    this.entries.delete(siteKey);
    this.retire(entry);
  }

  /** Notifications may have been missed (listener reconnect): forget every site. */
  invalidateAll(): void {
    this.globalEpoch += 1;
    this.missing.clear();
    for (const entry of this.entries.values()) this.retire(entry);
    this.entries.clear();
  }

  /**
   * A request saw a database failure through this instance. Retire it so the next request opens
   * fresh connections, which resolve the primary's DNS name again (README D9).
   */
  evict(siteKey: string, handle: SiteHandle): EvictOutcome {
    const entry = this.entries.get(siteKey);
    if (entry === undefined || entry.id !== handle.id) return 'replaced';
    if (this.now() - entry.createdAt < this.evictCooldownMs) return 'throttled';
    this.entries.delete(siteKey);
    this.retire(entry);
    return 'evicted';
  }

  /** Disposes every instance, including retired ones, and waits for the pools to close. */
  async close(): Promise<void> {
    this.closed = true;
    this.invalidateAll();
    for (const entry of [...this.retiring]) this.dispose(entry);
    await Promise.allSettled([...this.disposals]);
  }

  private stamp(siteKey: string): string {
    return `${this.globalEpoch}:${this.epochs.get(siteKey) ?? 0}`;
  }

  private async acquire(siteKey: string): Promise<Entry | null> {
    if (this.closed || !SITE_KEY_PATTERN.test(siteKey)) return null;
    const now = this.now();
    const cached = this.entries.get(siteKey);
    if (cached !== undefined && now - cached.loadedAt < this.ttlMs) return cached;
    if (cached === undefined && (this.missing.get(siteKey) ?? 0) > now) return null;

    try {
      return await this.pendingLoad(siteKey);
    } catch (error) {
      return this.keepServing(siteKey, cached, error);
    }
  }

  /** One database read per site at a time: concurrent requests share it. */
  private pendingLoad(siteKey: string): Promise<Entry | null> {
    let pending = this.loading.get(siteKey);
    if (pending === undefined) {
      pending = this.load(siteKey).finally(() => this.loading.delete(siteKey));
      this.loading.set(siteKey, pending);
    }
    return pending;
  }

  /**
   * The cached copy is the last known good configuration: keep serving it while the database is
   * unreachable, rather than turning a failover into a 404 or a 5xx.
   */
  private keepServing(siteKey: string, cached: Entry | undefined, error: unknown): Entry {
    if (cached === undefined || cached.retired) throw error;
    this.log.warn('site reload failed, serving the cached instance', {
      siteKey,
      ...errorFields(error),
    });
    return cached;
  }

  private async load(siteKey: string): Promise<Entry | null> {
    for (let attempt = 0; ; attempt++) {
      const stamp = this.stamp(siteKey);
      const record = await this.store.find(siteKey);
      // A change notification arrived while the row was being read: it may be stale.
      if (this.stamp(siteKey) !== stamp && attempt < MAX_STALE_RELOADS) continue;
      return this.settle(siteKey, record);
    }
  }

  private settle(siteKey: string, record: SiteRecord | null): Entry | null {
    if (this.closed) return null;
    const current = this.entries.get(siteKey);

    if (record === null || record.status !== 'active') {
      if (current !== undefined) {
        this.entries.delete(siteKey);
        this.retire(current);
      }
      this.rememberMissing(siteKey);
      return null;
    }

    this.missing.delete(siteKey);
    const fingerprint = fingerprintOf(record);
    if (current !== undefined && current.fingerprint === fingerprint) {
      current.loadedAt = this.now();
      return current;
    }

    const instance = this.factory(record);
    const now = this.now();
    const entry: Entry = {
      id: this.nextId++,
      record,
      fingerprint,
      instance,
      createdAt: now,
      loadedAt: now,
      inflight: 0,
      retired: false,
      disposed: false,
      hardTimer: undefined,
    };
    this.entries.set(siteKey, entry);
    if (current !== undefined) this.retire(current);
    return entry;
  }

  private rememberMissing(siteKey: string): void {
    if (this.missing.size >= MAX_MISSING_KEYS) this.missing.clear();
    this.missing.set(siteKey, this.now() + this.negativeTtlMs);
  }

  private release(entry: Entry): void {
    entry.inflight -= 1;
    if (entry.retired && entry.inflight === 0) this.dispose(entry);
  }

  /** Called once per entry: every caller takes it out of `entries` first, and only live entries are in there. */
  private retire(entry: Entry): void {
    entry.retired = true;
    this.retiring.add(entry);
    // The next macrotask, not now: a request that has just been handed this entry has not
    // counted itself in yet.
    setTimeout(() => {
      if (entry.inflight === 0) this.dispose(entry);
    }, 0).unref();
    entry.hardTimer = setTimeout(() => this.dispose(entry), this.drainMs);
    entry.hardTimer.unref();
  }

  private dispose(entry: Entry): void {
    if (entry.disposed) return;
    entry.disposed = true;
    this.retiring.delete(entry);
    clearTimeout(entry.hardTimer);
    const done: Promise<void> = Promise.resolve()
      .then(() => entry.instance.dispose())
      .catch((error: unknown) => {
        this.log.warn('disposing a c15t instance failed', {
          siteKey: entry.record.key,
          ...errorFields(error),
        });
      })
      .then(() => {
        this.disposals.delete(done);
      });
    this.disposals.add(done);
  }
}
