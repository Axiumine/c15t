// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { z } from 'zod';
import { banUserSchema, siteCreateSchema, userCreateSchema, userUpdateSchema } from './index.js';
import { hasNoNul, isRepresentableInstant, MAX_INSTANT_MS, MIN_INSTANT_MS, noNul } from './text.js';

test('noNul keeps the string schema and rejects U+0000 anywhere', () => {
  const schema = noNul(z.string().trim().min(1).max(10));
  expect(schema.parse(' ok ')).toBe('ok');
  for (const value of ['\u0000', 'a\u0000', '\u0000a', 'a\u0000b']) {
    expect(schema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  }
  expect(hasNoNul('plain')).toBe(true);
  expect(hasNoNul('a\u0000')).toBe(false);
});

test('admin free text rejects NUL: site name, user name, ban reason', () => {
  const site = { key: 'shop-site', name: 'Sh\u0000op', domains: ['shop.example.com'] };
  expect(siteCreateSchema.safeParse(site).success).toBe(false);
  expect(siteCreateSchema.safeParse({ ...site, name: 'Shop' }).success).toBe(true);

  const person = { name: 'A\u0000lice', email: 'alice@example.com' };
  expect(userCreateSchema.safeParse(person).success).toBe(false);
  expect(userCreateSchema.safeParse({ ...person, name: 'Alice' }).success).toBe(true);
  expect(userUpdateSchema.safeParse({ name: '\u0000' }).success).toBe(false);

  expect(banUserSchema.safeParse({ reason: 'abu\u0000se' }).success).toBe(false);
  expect(banUserSchema.safeParse({ reason: 'abuse' }).success).toBe(true);
});

test('representable instants are years 0001 to 9999', () => {
  expect(new Date(MIN_INSTANT_MS).toISOString()).toBe('0001-01-01T00:00:00.000Z');
  expect(new Date(MAX_INSTANT_MS).toISOString()).toBe('9999-12-31T23:59:59.999Z');
  expect(isRepresentableInstant(MIN_INSTANT_MS)).toBe(true);
  expect(isRepresentableInstant(MAX_INSTANT_MS)).toBe(true);
  expect(isRepresentableInstant(MIN_INSTANT_MS - 1)).toBe(false);
  expect(isRepresentableInstant(MAX_INSTANT_MS + 1)).toBe(false);
  expect(isRepresentableInstant(Number.NaN)).toBe(false);
  expect(isRepresentableInstant(Number.POSITIVE_INFINITY)).toBe(false);
});
