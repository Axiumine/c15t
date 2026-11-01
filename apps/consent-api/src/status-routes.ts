// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { apiError } from '@consent/shared';
import type { Hono } from 'hono';
import type { AppDeps, AppEnv } from './app-types.js';
import { errorFields, type Logger } from './log.js';

export function addStatusRoutes(app: Hono<AppEnv>, deps: AppDeps, log: Logger): void {
  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/status', async (c) => {
    try {
      const { activeSites } = await deps.readiness();
      return c.json({
        status: 'ok',
        listener: deps.listenerState(),
        activeSites,
        cachedInstances: deps.registry.size,
      });
    } catch (error) {
      log.error('readiness check failed', errorFields(error));
      return c.json(apiError('SERVICE_UNAVAILABLE', 'The database is not reachable.'), 503);
    }
  });
}
