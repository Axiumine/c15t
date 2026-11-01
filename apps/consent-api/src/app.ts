// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Hono } from 'hono';
import { jsonError } from './api-error.js';
import type { AppDeps, AppEnv } from './app-types.js';
import { addGuards } from './guards.js';
import { errorFields, silentLogger } from './log.js';
import { addSiteRoutes } from './site-routes.js';
import { addStatusRoutes } from './status-routes.js';

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const log = deps.logger ?? silentLogger;
  const app = new Hono<AppEnv>();

  addGuards(app);
  addStatusRoutes(app, deps, log);
  addSiteRoutes(app, deps, log);

  app.notFound(() => jsonError('NOT_FOUND', 'Not found.'));

  app.onError((error) => {
    log.error('unhandled error', errorFields(error));
    return jsonError('INTERNAL_ERROR', 'Internal server error.');
  });

  return app;
}
