// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import {
  ApiError,
  client,
  consentsCsvHref,
  createQueryClient,
  errorMessage,
  fieldIssues,
  isUnavailable,
  meQueryOptions,
  shouldRetry,
} from './api';
import { apiError, json, mockFetch, route } from './test/harness';

async function failureOf(call: () => Promise<unknown>): Promise<ApiError> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

const getMe = () => client.me.$get();

test('requests are same-origin under /api and carry the session cookie', async () => {
  const { calls } = mockFetch(
    route(
      'GET /api/me',
      json({ id: 'u', name: 'N', email: 'e@x.io', role: 'user', mustChangePassword: false }),
    ),
  );
  await getMe();
  expect(calls[0]?.url.pathname).toBe('/api/me');
  expect(calls[0]?.credentials).toBe('include');
});

test('401 becomes an unauthorized error', async () => {
  mockFetch(route('GET /api/me', apiError(401, 'UNAUTHORIZED', 'Authentication is required')));
  const error = await failureOf(getMe);
  expect(error).toMatchObject({ status: 401, kind: 'unauthorized', code: 'UNAUTHORIZED' });
});

test('403 PASSWORD_CHANGE_REQUIRED is told apart from a plain 403', async () => {
  mockFetch(
    route('GET /api/me', apiError(403, 'PASSWORD_CHANGE_REQUIRED')),
    route('GET /api/sites', apiError(403, 'FORBIDDEN', 'Administrator access is required')),
  );
  expect(await failureOf(getMe)).toMatchObject({ kind: 'password-change-required', status: 403 });
  expect(await failureOf(() => client.sites.$get())).toMatchObject({ kind: 'forbidden' });
});

test('503 from the API is a friendly, retryable "unavailable" error', async () => {
  mockFetch(route('GET /api/me', apiError(503, 'SERVICE_UNAVAILABLE')));
  const error = await failureOf(getMe);
  expect(error.kind).toBe('unavailable');
  expect(isUnavailable(error)).toBe(true);
  expect(errorMessage(error)).toBe(
    'The service is temporarily unavailable. Try again in a moment.',
  );
});

test('nginx answers 503 with its own code, and a gateway can answer with HTML: both are "unavailable"', async () => {
  mockFetch(
    route('GET /api/me', json({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'x' } }, 503)),
    route('GET /api/sites', new Response('<html>Bad gateway</html>', { status: 502 })),
  );
  expect((await failureOf(getMe)).kind).toBe('unavailable');
  expect((await failureOf(() => client.sites.$get())).kind).toBe('unavailable');
});

test('a dropped connection is a network error, not a crash', async () => {
  mockFetch(() => {
    throw new TypeError('Failed to fetch');
  });
  const error = await failureOf(getMe);
  expect(error).toMatchObject({ kind: 'network', status: 0 });
  expect(errorMessage(error)).toContain('Cannot reach the server');
});

test('validation errors keep their field issues and their server message', async () => {
  mockFetch(
    route(
      'POST /api/admin/sites',
      apiError(400, 'VALIDATION_ERROR', 'The request is invalid', [
        { path: 'domains.0', message: 'Wildcards are not allowed' },
      ]),
    ),
  );
  const error = await failureOf(() =>
    client.admin.sites.$post({
      json: { key: 'shop', name: 'Shop', domains: ['*.x.io'], policyPreset: 'eu-opt-in' },
    }),
  );
  expect(error.kind).toBe('validation');
  expect(fieldIssues(error)).toEqual([{ path: 'domains.0', message: 'Wildcards are not allowed' }]);
  expect(errorMessage(error)).toBe('The request is invalid');
});

test('an unexpected 500 never shows server text', async () => {
  mockFetch(route('GET /api/me', apiError(500, 'INTERNAL_ERROR', 'select * from secret failed')));
  const error = await failureOf(getMe);
  expect(error.kind).toBe('unknown');
  expect(errorMessage(error)).not.toContain('secret');
});

test('only unavailable reads are retried, at most twice', () => {
  const unavailable = new ApiError({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  expect(shouldRetry(0, unavailable)).toBe(true);
  expect(shouldRetry(1, unavailable)).toBe(true);
  expect(shouldRetry(2, unavailable)).toBe(false);
  expect(shouldRetry(0, new ApiError({ status: 0, kind: 'network' }))).toBe(true);
  expect(shouldRetry(0, new ApiError({ status: 404, code: 'NOT_FOUND' }))).toBe(false);
  expect(shouldRetry(0, new Error('boom'))).toBe(false);
});

test('the query client reports 401 and PASSWORD_CHANGE_REQUIRED to the session handlers', async () => {
  const seen: string[] = [];
  const queryClient = createQueryClient({
    onUnauthorized: () => seen.push('unauthorized'),
    onPasswordChangeRequired: () => seen.push('password'),
  });
  mockFetch(route('GET /api/me', apiError(401, 'UNAUTHORIZED')));
  await queryClient.fetchQuery(meQueryOptions()).catch(() => undefined);
  mockFetch(route('GET /api/me', apiError(403, 'PASSWORD_CHANGE_REQUIRED')));
  queryClient.clear();
  await queryClient.fetchQuery(meQueryOptions()).catch(() => undefined);
  mockFetch(route('GET /api/me', apiError(404, 'NOT_FOUND')));
  queryClient.clear();
  await queryClient.fetchQuery(meQueryOptions()).catch(() => undefined);
  expect(seen).toEqual(['unauthorized', 'password']);
});

test('the CSV export is a plain same-origin link with the chosen dates', () => {
  expect(consentsCsvHref('shop', {})).toBe('/api/sites/shop/consents.csv');
  expect(consentsCsvHref('shop', { from: '2026-03-01', to: '2026-03-31' })).toBe(
    '/api/sites/shop/consents.csv?from=2026-03-01&to=2026-03-31',
  );
  expect(consentsCsvHref('a b', { from: '' })).toBe('/api/sites/a%20b/consents.csv');
});
