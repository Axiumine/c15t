// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { C15TInstance } from '@c15t/backend';
import type { Logger } from './log.js';
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

export interface Entry {
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
