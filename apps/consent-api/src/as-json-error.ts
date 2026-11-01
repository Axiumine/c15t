// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { apiError, type ErrorCode } from '@consent/shared';

function errorBody(status: number): { code: ErrorCode; message: string } {
  if (status === 404) return { code: 'NOT_FOUND', message: 'Not found.' };
  if (status === 401) return { code: 'UNAUTHORIZED', message: 'Unauthorized.' };
  if (status === 403) return { code: 'FORBIDDEN', message: 'Forbidden.' };
  if (status === 409) return { code: 'CONFLICT', message: 'Conflict.' };
  if (status === 429) return { code: 'RATE_LIMITED', message: 'Too many requests.' };
  if (status === 503) return { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' };
  if (status >= 500) return { code: 'INTERNAL_ERROR', message: 'Internal server error.' };
  return { code: 'BAD_REQUEST', message: 'Bad request.' };
}

/** The banner calls these routes with `fetch`: whatever goes wrong, it must see JSON, never HTML. */
export function asJsonError(response: Response): Response {
  if (response.status < 400 || response.headers.get('content-type')?.includes('json')) {
    return response;
  }
  const { code, message } = errorBody(response.status);
  const headers = new Headers(response.headers);
  for (const name of ['content-type', 'content-length', 'content-encoding', 'etag']) {
    headers.delete(name);
  }
  const body = JSON.stringify(apiError(code, message));
  headers.set('content-type', 'application/json');
  return new Response(body, { status: response.status, headers });
}
