// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { z } from 'zod';
import './zod-setup';

function messageOf(schema: z.ZodType, input: unknown): string | undefined {
  const result = schema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

test('zod runs interpreted, because the dashboard CSP forbids new Function', () => {
  expect(z.config().jitless).toBe(true);
});

test('empty required strings and wrong types read as "required"', () => {
  expect(messageOf(z.string().min(1), '')).toBe('This field is required');
  expect(messageOf(z.string(), 42)).toBe('This field is required');
  expect(messageOf(z.object({ name: z.string() }), {})).toBe('This field is required');
});

test('string length limits name the limit', () => {
  expect(messageOf(z.string().min(3), 'ab')).toBe('Must be at least 3 characters');
  expect(messageOf(z.string().max(4), 'abcde')).toBe('Must be at most 4 characters');
});

test('an empty list asks for at least one item', () => {
  expect(messageOf(z.array(z.string()).min(1), [])).toBe('Add at least one item');
});

test('email and pattern failures have their own wording', () => {
  expect(messageOf(z.email(), 'nope')).toBe('Enter a valid email address');
  expect(messageOf(z.string().regex(/^[a-z]+$/), '123')).toBe('This value has an invalid format');
});

test('an enum miss tells the user to pick a listed option', () => {
  expect(messageOf(z.enum(['a', 'b']), 'c')).toBe('Choose one of the listed options');
});

test('issues without a custom wording keep the zod default', () => {
  const tooSmall = messageOf(z.number().min(5), 1);
  expect(tooSmall).toBeTypeOf('string');
  expect(tooSmall).toContain('5');
  expect(messageOf(z.number().max(5), 9)).toContain('5');
  expect(
    messageOf(
      z.string().refine(() => false),
      'x',
    ),
  ).toBe('Invalid input');
  // A different string format than email or regex is not reworded either.
  expect(messageOf(z.uuid(), 'x')).not.toBe('Enter a valid email address');
  expect(messageOf(z.uuid(), 'x')).not.toBe('This value has an invalid format');
});

test('a bigint lower bound on a string issue is also treated as "required"', () => {
  const customError = z.config().customError;
  const issue = { code: 'too_small', origin: 'string', minimum: 1n, input: '' } as never;
  expect(customError?.(issue)).toBe('This field is required');
});
