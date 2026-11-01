// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { jsonError, unavailable } from './api-error.js';
import type { AppContext, AppDeps } from './app-types.js';
import { asJsonError } from './as-json-error.js';
import type { Logger } from './log.js';
import { sanitizeHeaders } from './request-guard.js';
import { peerAddress } from './request-source.js';
import { attemptSite, type Forward } from './site-attempt.js';

export function createSiteServer(
  deps: AppDeps,
  log: Logger,
): (c: AppContext, siteKey: string) => Promise<Response> {
  return async (c, siteKey) => {
    const { headers, trusted } = sanitizeHeaders(c.req.raw.headers, {
      peer: peerAddress(c),
      trustedProxies: deps.trustedProxies,
    });
    const method = c.req.method;
    const forward: Forward = { request: c.req.raw, headers, trusted };
    let result = await attemptSite(deps, siteKey, forward);
    // A write may have committed before the connection broke: only reads are retried, once,
    // on the instance that replaced the failed one.
    if (
      (method === 'GET' || method === 'HEAD') &&
      result.found &&
      result.value.kind === 'database-failure' &&
      result.value.outcome !== 'throttled'
    ) {
      result = await attemptSite(deps, siteKey, forward);
    }
    if (!result.found || result.value.kind === 'denied') {
      return jsonError('NOT_FOUND', 'Not found.');
    }
    if (result.value.kind === 'response') return asJsonError(result.value.response);
    log.warn('database failure behind a c15t instance', {
      siteKey,
      method,
      outcome: result.value.outcome,
    });
    return unavailable();
  };
}
