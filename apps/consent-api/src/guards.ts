// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Hono } from 'hono';
import { jsonError } from './api-error.js';
import type { AppContext, AppEnv } from './app-types.js';
import { isSafePath } from './request-path.js';
import { requestTarget } from './request-source.js';

const NO_STORE = 'no-store';

export function addGuards(app: Hono<AppEnv>): void {
  // No response from this service is cacheable by Cloudflare: /init depends on the visitor's
  // country. c15t's own browser cache lifetime for the manifest and the script is kept.
  app.use('*', async (c: AppContext, next) => {
    await next();
    const { headers, status } = c.res;
    headers.set('Cloudflare-CDN-Cache-Control', NO_STORE);
    headers.set('CDN-Cache-Control', NO_STORE);
    if (status >= 400 || !headers.has('cache-control')) headers.set('Cache-Control', NO_STORE);
  });

  app.use('*', async (c: AppContext, next) => {
    if (!isSafePath(requestTarget(c))) return jsonError('BAD_REQUEST', 'Invalid request path.');
    return next();
  });
}
