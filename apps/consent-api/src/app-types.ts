// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { HttpBindings } from '@hono/node-server';
import type { Context } from 'hono';
import type { Input } from 'hono/types';
import type { Logger } from './log.js';
import type { SiteRegistry } from './registry.js';

export type AppEnv = { Bindings: HttpBindings };

// Hono's own `Context<AppEnv>` leaves the route path and the input as `any` and `{}`.
export type AppContext = Context<AppEnv, string, Input>;

export interface AppDeps {
  readonly registry: Pick<SiteRegistry, 'use' | 'evict' | 'size'>;
  /** `CONSENT_API_TRUSTED_PROXIES`. */
  readonly trustedProxies: readonly string[];
  /** Rejects when the database or the c15t schema is unreachable. */
  readonly readiness: () => Promise<{ readonly activeSites: number }>;
  readonly listenerState: () => string;
  readonly logger?: Logger;
}
