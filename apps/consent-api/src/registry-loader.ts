// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Epochs } from './registry-state.js';
import type { Entry } from './registry-types.js';
import type { SiteRecord, SiteStore } from './site-store.js';

const MAX_STALE_RELOADS = 2;

export type Settle = (siteKey: string, record: SiteRecord | null) => Entry | null;

/** Reads a site from the store and hands the row to `settle`. */
export class SiteLoader {
  private readonly store: SiteStore;
  private readonly epochs: Epochs;
  private readonly settle: Settle;
  private readonly loading = new Map<string, Promise<Entry | null>>();

  constructor(store: SiteStore, epochs: Epochs, settle: Settle) {
    this.store = store;
    this.epochs = epochs;
    this.settle = settle;
  }

  /** One database read per site at a time: concurrent requests share it. */
  pending(siteKey: string): Promise<Entry | null> {
    let pending = this.loading.get(siteKey);
    if (pending === undefined) {
      pending = this.load(siteKey).finally(() => this.loading.delete(siteKey));
      this.loading.set(siteKey, pending);
    }
    return pending;
  }

  private async load(siteKey: string): Promise<Entry | null> {
    for (let attempt = 0; ; attempt++) {
      const stamp = this.epochs.stamp(siteKey);
      const record = await this.store.find(siteKey);
      // A change notification arrived while the row was being read: it may be stale.
      if (this.epochs.stamp(siteKey) !== stamp && attempt < MAX_STALE_RELOADS) continue;
      return this.settle(siteKey, record);
    }
  }
}
