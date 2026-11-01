// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { apiErrorSchema } from '@consent/shared';
import { Hono } from 'hono';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { createErrorHandler } from './error-handler.js';
import { createLogger } from './logger.js';
import { validate } from './validate.js';

/*
 * The field errors of a rejected request: one issue per problem, the path to the field written
 * with dots, and never the submitted value (it may be a password).
 */

const schema = z.object({
  name: z.string().min(1),
  address: z.object({ city: z.string().min(1) }),
  tags: z.array(z.string().min(1)),
});

function app() {
  const hono = new Hono();
  hono.post('/', validate('json', schema), (c) => c.json({ ok: true }));
  hono.onError(createErrorHandler(createLogger(() => undefined)));
  return hono;
}

async function post(body: unknown) {
  const response = await app().request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, text: await response.text() };
}

test('a valid body passes', async () => {
  const result = await post({ name: 'Ada', address: { city: 'London' }, tags: ['a'] });
  expect(result.status).toBe(200);
});

test('every problem is one issue, with its path joined by dots', async () => {
  const result = await post({ name: '', address: {}, tags: ['ok', ''] });
  expect(result.status).toBe(400);
  const { error } = apiErrorSchema.parse(JSON.parse(result.text));
  expect(error.code).toBe('VALIDATION_ERROR');
  expect(error.message).toBe('The request is invalid');
  expect(error.issues?.map((issue) => issue.path)).toEqual(['name', 'address.city', 'tags.1']);
});

test('the submitted value is not echoed back', async () => {
  const result = await post({ name: 'secret-value-123', address: 'secret-value-123', tags: [] });
  expect(result.status).toBe(400);
  expect(result.text).not.toContain('secret-value-123');
});
