// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { AppType } from '@consent/dashboard-api';
import { hc } from 'hono/client';
import { apiErrorFromResponse } from './error-response';
import { ApiError } from './errors';

export const API_BASE = '/api';

/* ---------------------------------------------------------------------------------------------
 * Client. Every non-2xx response and every network failure becomes an ApiError inside the fetch
 * wrapper, so a resolved hc call is always a success.
 * ------------------------------------------------------------------------------------------- */

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await globalThis.fetch(input, init);
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({ status: 0, kind: 'network' });
  }
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response;
}

export const client = hc<AppType>(API_BASE, {
  fetch: apiFetch,
  init: { credentials: 'include' },
});
