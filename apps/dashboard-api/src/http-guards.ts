// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import { errorResponse } from './error-response.js';
import { HttpError, type RequestContext } from './errors.js';

const MAX_BODY_BYTES = 64 * 1024;

const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function originOf(url: string | undefined): string | undefined {
  try {
    return url === undefined ? undefined : new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** Headers on every response, errors and 404s included (README D10). */
export const responseHeaders = createMiddleware(async (c: RequestContext, next) => {
  await next();
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
});

/**
 * CSRF: SameSite=Lax cookies are the first line, this origin check is the second. A browser
 * always sends Origin (or Referer) on a same-origin write.
 */
export const originGuard = (trustedOrigin: string) =>
  createMiddleware(async (c: RequestContext, next) => {
    if (UNSAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header('origin') ?? originOf(c.req.header('referer'));
      if (origin !== trustedOrigin) {
        throw new HttpError('FORBIDDEN', 'Cross-origin request rejected');
      }
    }
    await next();
  });

export const requestBodyLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c: RequestContext) => errorResponse(c, 'BAD_REQUEST', 'Request body too large'),
});
