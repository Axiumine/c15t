// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import { cursorSchema, MAX_PAGE_SIZE, pageQuerySchema } from './pagination.js';

const RUNS = { numRuns: 300 };

test('a cursor is accepted exactly when it is 1 to 512 characters long', () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 600 }), (cursor) => {
      expect(cursorSchema.safeParse(cursor).success).toBe(
        cursor.length >= 1 && cursor.length <= 512,
      );
    }),
    RUNS,
  );
});

test('the page query never throws, and an accepted limit is an integer from 1 to the cap', () => {
  fc.assert(
    fc.property(
      fc.oneof(fc.string(), fc.integer(), fc.double(), fc.constant(undefined)),
      (limit) => {
        const result = pageQuerySchema.safeParse({ limit });
        if (!result.success) return;
        expect(Number.isInteger(result.data.limit)).toBe(true);
        expect(result.data.limit).toBeGreaterThanOrEqual(1);
        expect(result.data.limit).toBeLessThanOrEqual(MAX_PAGE_SIZE);
      },
    ),
    RUNS,
  );
});

test('every limit from 1 to the cap is accepted as a number and as a query-string value', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: MAX_PAGE_SIZE }), (limit) => {
      expect(pageQuerySchema.parse({ limit }).limit).toBe(limit);
      expect(pageQuerySchema.parse({ limit: String(limit) }).limit).toBe(limit);
    }),
    RUNS,
  );
});

test('a limit of zero, below zero, above the cap or not finite is rejected', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.integer({ min: -10_000, max: 0 }),
        fc.integer({ min: MAX_PAGE_SIZE + 1, max: 1_000_000 }),
        fc.double({ noInteger: true, noNaN: true, min: 1, max: MAX_PAGE_SIZE }),
        fc.constantFrom('abc', 'NaN', 'Infinity', '-1', '1.5', ''),
      ),
      (limit) => {
        expect(pageQuerySchema.safeParse({ limit }).success).toBe(false);
      },
    ),
    RUNS,
  );
});
