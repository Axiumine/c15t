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
const byText = (a: string, b: string) => a.localeCompare(b);
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

/*
 * The exact contract, written out so that dropping a code from the sets (or one more cause level)
 * fails a test. Found by mutation testing (docs/quality-gates.md): none of these was asserted before.
 */
describe('failover codes and cause depth', () => {
  const SQLSTATES = [
    '25006',
    '57P01',
    '57P02',
    '57P03',
    '08000',
    '08001',
    '08003',
    '08004',
    '08006',
    '08007',
    '08P01',
  ];
  const ERROR_CODES = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ECONNABORTED',
    'EPIPE',
    'ETIMEDOUT',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EAI_AGAIN',
    'CONNECT_TIMEOUT',
    'CONNECTION_CLOSED',
    'CONNECTION_DESTROYED',
    'CONNECTION_ENDED',
  ];

  test.each(SQLSTATES)('SQLSTATE %s is a failover', (code) => {
    expect(FAILOVER_SQLSTATES.has(code)).toBe(true);
    expect(isFailoverError(withCode(code))).toBe(true);
  });

  test.each(ERROR_CODES)('error code %s is a failover', (code) => {
    expect(FAILOVER_ERROR_CODES.has(code)).toBe(true);
    expect(isFailoverError(withCode(code))).toBe(true);
  });

  test('the sets hold no code that is not listed here', () => {
    expect([...FAILOVER_SQLSTATES].sort(byText)).toEqual([...SQLSTATES].sort(byText));
    expect([...FAILOVER_ERROR_CODES].sort(byText)).toEqual([...ERROR_CODES].sort(byText));
  });

  /** An error with a code at the bottom of a chain of `levels` errors (1 = the error itself). */
  const nested = (levels: number) => {
    let error: unknown = withCode('57P01');
    for (let level = 1; level < levels; level++) error = wrapped(error);
    return error;
  };

  test('looks six causes deep and no further', () => {
    expect(isFailoverError(nested(6))).toBe(true);
    expect(dbErrorCode(nested(6))).toBe('57P01');
    expect(isFailoverError(nested(7))).toBe(false);
    expect(dbErrorCode(nested(7))).toBeUndefined();
  });

  test('retryRead waits 150 ms by default before the retry', async () => {
    vi.useFakeTimers();
    try {
      const read = vi.fn().mockRejectedValueOnce(withCode('57P01')).mockResolvedValueOnce('ok');
      const result = retryRead(read);
      await vi.advanceTimersByTimeAsync(149);
      expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe('ok');
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
