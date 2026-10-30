// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import {
  apiError,
  apiErrorSchema,
  ERROR_CODES,
  ERROR_STATUS,
  errorCodeSchema,
  issuesFromZod,
} from './errors.js';

describe('error codes', () => {
  test('include the codes the contract promises', () => {
    for (const code of [
      'PASSWORD_CHANGE_REQUIRED',
      'SUBJECT_CONFLICT',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
    ]) {
      expect(errorCodeSchema.safeParse(code).success).toBe(true);
    }
  });

  test('every code has an HTTP status in the 4xx or 5xx range', () => {
    for (const code of ERROR_CODES) {
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
    }
    expect(ERROR_STATUS.PASSWORD_CHANGE_REQUIRED).toBe(403);
    expect(ERROR_STATUS.SUBJECT_CONFLICT).toBe(409);
    expect(ERROR_STATUS.SERVICE_UNAVAILABLE).toBe(503);
  });
});

describe('apiError', () => {
  test('builds the { error: { code, message } } envelope', () => {
    const body = apiError('NOT_FOUND', 'Site not found');
    expect(body).toEqual({ error: { code: 'NOT_FOUND', message: 'Site not found' } });
    expect(apiErrorSchema.safeParse(body).success).toBe(true);
  });

  test('carries validation issues when given', () => {
    const body = apiError('VALIDATION_ERROR', 'Invalid body', [{ path: 'key', message: 'bad' }]);
    expect(body.error.issues).toEqual([{ path: 'key', message: 'bad' }]);
    expect(apiErrorSchema.safeParse(body).success).toBe(true);
  });

  test('rejects unknown codes', () => {
    expect(apiErrorSchema.safeParse({ error: { code: 'WAT', message: 'x' } }).success).toBe(false);
    expect(apiErrorSchema.safeParse({ error: { code: 'NOT_FOUND' } }).success).toBe(false);
  });
});

describe('issuesFromZod', () => {
  test('keeps path and message but not the input value', () => {
    const result = z
      .object({ a: z.object({ b: z.string().min(3) }) })
      .safeParse({ a: { b: 'ab' } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = issuesFromZod(result.error);
      expect(issues[0]?.path).toBe('a.b');
      expect(JSON.stringify(issues)).not.toContain('"ab"');
    }
  });
});
