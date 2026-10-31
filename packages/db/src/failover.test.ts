// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test, vi } from 'vitest';
import {
  dbErrorCode,
  FAILOVER_ERROR_CODES,
  FAILOVER_SQLSTATES,
  isFailoverError,
  isUniqueViolation,
  retryRead,
} from './failover.js';

const withCode = (code: string, extra: object = {}) =>
  Object.assign(new Error(code), { code, ...extra });
const wrapped = (cause: unknown) => Object.assign(new Error('Failed query'), { cause });

describe('isFailoverError', () => {
  test.each(['25006', '57P01', '57P02', '57P03', '08006', '08P01'])('SQLSTATE %s', (code) => {
    expect(isFailoverError(withCode(code))).toBe(true);
  });

  test.each([
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ETIMEDOUT',
    'CONNECT_TIMEOUT',
    'CONNECTION_CLOSED',
  ])('socket or driver code %s', (code) => {
    expect(isFailoverError(withCode(code))).toBe(true);
  });

  test('sees through Drizzle wrapper errors', () => {
    expect(isFailoverError(wrapped(withCode('25006')))).toBe(true);
    expect(isFailoverError(wrapped(wrapped(withCode('ECONNRESET'))))).toBe(true);
  });

  test('ordinary errors are not failovers', () => {
    expect(isFailoverError(withCode('23505'))).toBe(false);
    expect(isFailoverError(withCode('42P01'))).toBe(false);
    expect(isFailoverError(new Error('boom'))).toBe(false);
    expect(isFailoverError(undefined)).toBe(false);
    expect(isFailoverError('ECONNRESET')).toBe(false);
    expect(isFailoverError(null)).toBe(false);
  });

  test('a cyclic cause chain terminates', () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(isFailoverError(a)).toBe(false);
  });

  test('the sets include the codes the project rules name', () => {
    for (const code of ['25006', '57P01']) expect(FAILOVER_SQLSTATES.has(code)).toBe(true);
    expect(FAILOVER_ERROR_CODES.has('ECONNRESET')).toBe(true);
  });
});

describe('dbErrorCode and isUniqueViolation', () => {
  test('a thrown non-object has no code, and neither has its absence', () => {
    expect(dbErrorCode('boom')).toBeUndefined();
    expect(dbErrorCode(null)).toBeUndefined();
    expect(dbErrorCode(undefined)).toBeUndefined();
    expect(dbErrorCode(42)).toBeUndefined();
  });

  test('dbErrorCode finds the first string code in the chain', () => {
    expect(dbErrorCode(wrapped(withCode('23505')))).toBe('23505');
    expect(dbErrorCode(new Error('x'))).toBeUndefined();
  });

  test('isUniqueViolation matches the constraint when given', () => {
    const error = wrapped(withCode('23505', { constraint_name: 'site_key_unique' }));
    expect(isUniqueViolation(error)).toBe(true);
    expect(isUniqueViolation(error, 'site_key_unique')).toBe(true);
    expect(isUniqueViolation(error, 'user_email_unique')).toBe(false);
    expect(isUniqueViolation(withCode('23503'))).toBe(false);
    expect(isUniqueViolation('x')).toBe(false);
  });
});

describe('retryRead', () => {
  test('retries once after a failover error and returns the result', async () => {
    const read = vi.fn().mockRejectedValueOnce(withCode('57P01')).mockResolvedValueOnce('ok');
    await expect(retryRead(read, { delayMs: 0 })).resolves.toBe('ok');
    expect(read).toHaveBeenCalledTimes(2);
  });

  test('gives up after the configured retries', async () => {
    const read = vi.fn().mockRejectedValue(withCode('25006'));
    await expect(retryRead(read, { retries: 2, delayMs: 0 })).rejects.toMatchObject({
      code: '25006',
    });
    expect(read).toHaveBeenCalledTimes(3);
  });

  test('never retries an ordinary error', async () => {
    const read = vi.fn().mockRejectedValue(withCode('23505'));
    await expect(retryRead(read, { delayMs: 0 })).rejects.toMatchObject({ code: '23505' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  test('passes a first-try success straight through', async () => {
    const read = vi.fn().mockResolvedValue(42);
    await expect(retryRead(read)).resolves.toBe(42);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
