// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { RegistryOptions } from './registry-types.js';

export interface RegistryConfig {
  readonly ttlMs: number;
  readonly negativeTtlMs: number;
  readonly evictCooldownMs: number;
  readonly drainMs: number;
  readonly now: () => number;
}

const DEFAULT_TTL_MS = 5 * 60_000;
const DEFAULT_NEGATIVE_TTL_MS = 30_000;
const DEFAULT_EVICT_COOLDOWN_MS = 5_000;
const DEFAULT_DRAIN_MS = 30_000;

export function resolveConfig(options: RegistryOptions): RegistryConfig {
  return {
    ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
    negativeTtlMs: options.negativeTtlMs ?? DEFAULT_NEGATIVE_TTL_MS,
    evictCooldownMs: options.evictCooldownMs ?? DEFAULT_EVICT_COOLDOWN_MS,
    drainMs: options.drainMs ?? DEFAULT_DRAIN_MS,
    now: options.now ?? Date.now,
  };
}
