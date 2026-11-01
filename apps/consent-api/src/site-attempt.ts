// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { isFailoverError } from '@consent/db';
import type { AppDeps } from './app-types.js';
import { isDatabaseFailure } from './database-failure.js';
import { stripOverrideParams } from './override-params.js';
import type { EvictOutcome, SiteLookup } from './registry-types.js';
import { requestHostAllowed } from './request-host.js';

export type Attempt =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'denied' }
  | { readonly kind: 'database-failure'; readonly outcome: EvictOutcome };

/** What one attempt forwards to c15t: the request as received and its sanitized headers. */
export interface Forward {
  readonly request: Request;
  readonly headers: Headers;
  readonly trusted: boolean;
}

/** The request c15t gets: sanitized headers, and no query parameters that override the geo headers. */
function forwardable(request: Request, headers: Headers): Request {
  const url = stripOverrideParams(request.url);
  return url === request.url
    ? new Request(request, { headers })
    : new Request(url, {
        method: request.method,
        headers,
        body: request.body,
        signal: request.signal,
        duplex: 'half',
      });
}

export async function attemptSite(
  deps: AppDeps,
  siteKey: string,
  { request, headers, trusted }: Forward,
): Promise<SiteLookup<Attempt>> {
  return deps.registry.use(siteKey, async (handle): Promise<Attempt> => {
    if (!requestHostAllowed(headers, trusted, handle.site.domains)) return { kind: 'denied' };
    try {
      const response = await handle.instance.handler(forwardable(request, headers));
      if (!(await isDatabaseFailure(response))) return { kind: 'response', response };
    } catch (error) {
      if (!isFailoverError(error)) throw error;
    }
    return { kind: 'database-failure', outcome: deps.registry.evict(siteKey, handle) };
  });
}
