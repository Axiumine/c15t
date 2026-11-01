// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { apiErrorSchema, type ErrorCode } from '@consent/shared';
import { APIError } from 'better-auth/api';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { expect, test } from 'vitest';
import { createErrorHandler, notFoundHandler } from './error-handler.js';
import { errorResponse } from './error-response.js';
import { HttpError, notFound } from './errors.js';
import { createLogger } from './logger.js';

const lines: string[] = [];
const logger = createLogger((line) => lines.push(line));

function failing(error: () => unknown) {
  const app = new Hono();
  app.get('/boom', () => {
    throw error();
  });
  app.onError(createErrorHandler(logger));
  app.notFound(notFoundHandler);
  return app;
}

async function run(error: () => unknown) {
  const response = await failing(error).request('/boom');
  const text = await response.text();
  return { status: response.status, text, body: apiErrorSchema.parse(JSON.parse(text)) };
}

test('HttpError keeps its code, status and message', async () => {
  const result = await run(
    () => new HttpError('LAST_ADMIN', 'At least one active administrator must remain'),
  );
  expect(result.status).toBe(409);
  expect(result.body.error).toEqual({
    code: 'LAST_ADMIN',
    message: 'At least one active administrator must remain',
  });
});

test('validation errors carry issues', async () => {
  const result = await run(
    () =>
      new HttpError('VALIDATION_ERROR', 'The request is invalid', [
        { path: 'name', message: 'Required' },
      ]),
  );
  expect(result.status).toBe(400);
  expect(result.body.error.issues).toEqual([{ path: 'name', message: 'Required' }]);
});

test('notFound() is a 404', async () => {
  expect((await run(() => notFound('Site not found'))).status).toBe(404);
});

test.each(['57P01', '25006', '08006', 'ECONNRESET', 'CONNECT_TIMEOUT'])(
  'the failover error %s is a 503 without database details',
  async (code) => {
    const result = await run(() =>
      Object.assign(new Error('terminating connection due to administrator command'), { code }),
    );
    expect(result.status).toBe(503);
    expect(result.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(result.text).not.toContain('terminating');
  },
);

test('a failover is logged as a warning with the path, not as an unhandled error', async () => {
  lines.length = 0;
  await run(() => Object.assign(new Error('terminating connection'), { code: '57P01' }));
  const logged = lines.join('\n');
  expect(logged).toContain('database unavailable (failover?)');
  expect(logged).toContain('/boom');
  expect(logged).not.toContain('unhandled error');
});

test('an error that is not a failover is not logged as one', async () => {
  lines.length = 0;
  await run(() => new HttpError('NOT_FOUND', 'No such site'));
  expect(lines).toEqual([]);
});

/** The text a client reads for each code when the handler adds none (never an upstream message). */
const FIXED_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  BAD_REQUEST: 'The request could not be processed',
  VALIDATION_ERROR: 'The request is invalid',
  UNAUTHORIZED: 'Authentication is required',
  FORBIDDEN: 'You are not allowed to do this',
  PASSWORD_CHANGE_REQUIRED: 'You must change your password before continuing',
  NOT_FOUND: 'Not found',
  CONFLICT: 'The request conflicts with the current state',
  SITE_KEY_TAKEN: 'A site with this key already exists',
  EMAIL_TAKEN: 'A user with this email already exists',
  LAST_ADMIN: 'At least one active administrator must remain',
  SUBJECT_CONFLICT: 'The subject belongs to another site',
  RATE_LIMITED: 'Too many requests, try again later',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable',
  INTERNAL_ERROR: 'Internal server error',
};

test.each(Object.entries(FIXED_MESSAGES))('the fixed text of %s', async (code, message) => {
  const app = new Hono().get('/code', (c) => errorResponse(c, code as ErrorCode));
  const body = apiErrorSchema.parse(await (await app.request('/code')).json());
  expect(body.error).toEqual({ code, message });
  expect(new HttpError(code as ErrorCode, 'x').name).toBe('HttpError');
});

test('notFound() says "Not found" unless told otherwise', () => {
  expect(notFound().message).toBe('Not found');
  expect(notFound('No such site').message).toBe('No such site');
});

test('a failover error wrapped by Drizzle is still a 503', async () => {
  const wrapped = new Error('Failed query: select 1', {
    cause: Object.assign(new Error('x'), { code: '57P01' }),
  });
  expect((await run(() => wrapped)).status).toBe(503);
});

test.each(['22008', '22009', '22021', '22P02', '22003'])(
  'the Postgres data exception %s is a 400 validation error, not a 500',
  async (code) => {
    lines.length = 0;
    const wrapped = new Error('Failed query: select ... where "givenAt" < $1', {
      cause: Object.assign(new Error('date/time field value out of range: "2026-02-31"'), { code }),
    });
    const result = await run(() => wrapped);
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe('VALIDATION_ERROR');
    expect(result.text).not.toMatch(/Failed query|givenAt|2026-02-31/);
    expect(lines.join('\n')).not.toContain('unhandled error');
  },
);

test('other SQLSTATE classes are not mistaken for data exceptions', async () => {
  const unique = Object.assign(new Error('x'), { code: '23505' });
  expect((await run(() => unique)).status).toBe(500);
  expect((await run(() => Object.assign(new Error('x'), { code: '2200' }))).status).toBe(500);
  // The pattern is anchored on both ends: neither a longer nor a prefixed code is class 22.
  expect((await run(() => Object.assign(new Error('x'), { code: '220081' }))).status).toBe(500);
  expect((await run(() => Object.assign(new Error('x'), { code: 'X22008' }))).status).toBe(500);
});

test('Better Auth errors map to a status but never forward their text', async () => {
  const result = await run(
    () => new APIError('BAD_REQUEST', { message: 'password hash is $scrypt$secret' }),
  );
  expect(result.status).toBe(400);
  expect(result.text).not.toContain('scrypt');
  expect(
    (await run(() => new APIError('TOO_MANY_REQUESTS', { message: 'x' }))).body.error.code,
  ).toBe('RATE_LIMITED');
});

test('HTTP exceptions map to the platform codes', async () => {
  expect(
    (await run(() => new HTTPException(400, { message: 'Malformed JSON in request body' }))).body
      .error.code,
  ).toBe('BAD_REQUEST');
  expect((await run(() => new HTTPException(404))).status).toBe(404);
});

test('a status without a platform code is a generic 500 for Better Auth errors and HTTP exceptions', async () => {
  lines.length = 0;
  // 418 and 422 have no entry in the status table: they must not leak through as their own code.
  const teapot = await run(() => new HTTPException(418, { message: 'short and stout' }));
  expect(teapot.status).toBe(500);
  expect(teapot.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
  expect(teapot.text).not.toContain('stout');

  const unprocessable = await run(
    () => new APIError('UNPROCESSABLE_ENTITY', { message: 'hash is $scrypt$secret' }),
  );
  expect(unprocessable.status).toBe(500);
  expect(unprocessable.body.error.code).toBe('INTERNAL_ERROR');
  expect(unprocessable.text).not.toContain('scrypt');
  // Both were logged as unhandled errors.
  expect(lines.filter((line) => line.includes('unhandled error'))).toHaveLength(2);
});

test('an unexpected error is a generic 500 and the log has no stack, SQL or parameters', async () => {
  lines.length = 0;
  const secret = new Error(
    'Failed query: insert into "app"."account" values ($1)\nparams: $scrypt$verysecret',
  );
  const result = await run(() => secret);
  expect(result.status).toBe(500);
  expect(result.body.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
  expect(result.text).not.toMatch(/insert|account|scrypt|verysecret|\.ts:/);
  const logged = lines.join('\n');
  expect(logged).toContain('unhandled error');
  expect(logged).not.toContain('verysecret');
  expect(logged).not.toContain('"stack"');
});

test('unknown routes answer in the platform format', async () => {
  const response = await failing(() => new Error('x')).request('/missing');
  expect(response.status).toBe(404);
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe('NOT_FOUND');
});
