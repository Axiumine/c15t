// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { C15TInstance } from '@c15t/backend';
import type { Entry } from './registry-types.js';
import type { SiteRecord } from './site-store.js';

export function fingerprintOf(site: SiteRecord): string {
  return JSON.stringify([
    site.key,
    site.policyPreset,
    [...site.domains].sort((a, b) => a.localeCompare(b)),
  ]);
}

export interface NewEntry {
  readonly id: number;
  readonly record: SiteRecord;
  readonly fingerprint: string;
  readonly instance: C15TInstance;
  readonly now: number;
}

export function createEntry({ id, record, fingerprint, instance, now }: NewEntry): Entry {
  return {
    id,
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
}
