// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, pageQuerySchema, pageSchema } from './pagination.js';

describe('pageQuerySchema', () => {
  test('defaults the limit and coerces query strings', () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: DEFAULT_PAGE_SIZE });
    expect(pageQuerySchema.parse({ limit: '25', cursor: 'abc' })).toEqual({
      limit: 25,
      cursor: 'abc',
    });
  });

  test('rejects out-of-range limits and empty cursors', () => {
    expect(pageQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ limit: String(MAX_PAGE_SIZE + 1) }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ limit: '1.5' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ cursor: '' }).success).toBe(false);
    expect(pageQuerySchema.safeParse({ cursor: 'x'.repeat(513) }).success).toBe(false);
  });
});

describe('pageSchema', () => {
  const schema = pageSchema(z.object({ id: z.string() }));

  test('wraps items and a nullable cursor', () => {
    expect(schema.safeParse({ items: [{ id: '1' }], nextCursor: null }).success).toBe(true);
    expect(schema.safeParse({ items: [], nextCursor: 'next' }).success).toBe(true);
    expect(schema.safeParse({ items: [{ id: 1 }], nextCursor: null }).success).toBe(false);
    expect(schema.safeParse({ items: [] }).success).toBe(false);
  });
});
