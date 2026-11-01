// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { isFailoverError } from '@consent/db';
import { apiError } from '@consent/shared';
import type { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { jsonError, unavailable } from './api-error.js';
import type { AppContext, AppDeps, AppEnv } from './app-types.js';
import { SiteConfigError } from './errors.js';
import { errorFields, type Logger } from './log.js';
import { siteKeyFromPath } from './request-path.js';
import { requestTarget } from './request-source.js';
import { createSiteServer } from './site-server.js';

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const MAX_BODY_BYTES = 1024 * 1024;

export function addSiteRoutes(app: Hono<AppEnv>, deps: AppDeps, log: Logger): void {
  app.use(
    '/s/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c: AppContext) =>
        c.json(apiError('BAD_REQUEST', 'Request body is too large.'), 413),
    }),
  );

  const serveSite = createSiteServer(deps, log);

  app.on(METHODS, '/s/:siteKey/*', async (c) => {
    const siteKey = siteKeyFromPath(requestTarget(c));
    if (siteKey === undefined) return jsonError('NOT_FOUND', 'Not found.');
    try {
      return await serveSite(c, siteKey);
    } catch (error) {
      if (error instanceof SiteConfigError) {
        log.error('site configuration rejected', { siteKey, message: error.message });
        return jsonError('INTERNAL_ERROR', 'Site configuration is invalid.');
      }
      if (isFailoverError(error)) {
        log.warn('site registry unreachable', { siteKey, ...errorFields(error) });
        return unavailable();
      }
      throw error;
    }
  });
}
