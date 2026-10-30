// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { HttpError } from './errors.js';
import { decodeCursor, encodeCursor, toPage } from './pagination.js';

/*
 * Property-based tests for the opaque cursor. A client controls the cursor string, so decoding
 * has to turn every possible input into either a validated value or a 400, and nothing else.
 */

const RUNS = { numRuns: 300 };

/*
 * Every arbitrary below is built once, at import. `fc.string({ unit: 'binary' })` takes a few
 * hundred milliseconds the first time it is built (a lazy table in fast-check), and on a loaded CI
 * runner with coverage on, that cost inside the test body exceeded Vitest's 5 s default timeout.
 * `codeUnitString` covers the same input domain (any UTF-16 code unit, so lone surrogates and
 * NUL included) and costs nothing to build.
 */
const codeUnitString = fc
  .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 40 })
  .map((units) => String.fromCharCode(...units));

/** Whatever a client could put in the `cursor` query parameter. */
const anyCursor = fc.oneof(
  fc.string(),
  codeUnitString,
  fc.base64String(),
  fc.stringMatching(/^[A-Za-z0-9_=-]{0,60}$/),
);

const keySchema = z.strictObject({ at: z.string(), id: z.string() });
const payload = fc.record({ at: fc.string(), id: fc.string() });

function decodeOutcome(cursor: string, schema: z.ZodType) {
  try {
    return { value: decodeCursor(cursor, schema) };
  } catch (error) {
    return { error };
  }
}

test('a cursor round-trips: decode(encode(x)) gives x back', () => {
  fc.assert(
    fc.property(payload, (key) => {
      expect(decodeCursor(encodeCursor(key), keySchema)).toEqual(key);
    }),
    RUNS,
  );
});

test('a numeric sort key round-trips too', () => {
  fc.assert(
    fc.property(fc.record({ n: fc.integer(), id: fc.string() }), (key) => {
      const schema = z.strictObject({ n: z.number(), id: z.string() });
      expect(decodeCursor(encodeCursor(key), schema)).toEqual(key);
    }),
    RUNS,
  );
});

test('an encoded cursor uses the URL-safe alphabet only, so it needs no escaping', () => {
  fc.assert(
    fc.property(payload, (key) => {
      expect(encodeCursor(key)).toMatch(/^[A-Za-z0-9_-]+$/);
    }),
    RUNS,
  );
});

test('no cursor means no position', () => {
  expect(decodeCursor(undefined, keySchema)).toBeUndefined();
});

test('any string decodes to a valid value or to a 400, never to another error', () => {
  fc.assert(
    fc.property(anyCursor, (cursor) => {
      const outcome = decodeOutcome(cursor, keySchema);
      if ('error' in outcome) {
        expect(outcome.error).toBeInstanceOf(HttpError);
        expect((outcome.error as HttpError).code).toBe('BAD_REQUEST');
        expect((outcome.error as HttpError).message).toBe('Invalid cursor');
      } else {
        expect(keySchema.safeParse(outcome.value).success).toBe(true);
      }
    }),
    RUNS,
  );
});

test('a cursor that carries JSON of the wrong shape is a 400', () => {
  fc.assert(
    fc.property(
      fc.oneof(
        fc.jsonValue().filter((json) => !keySchema.safeParse(json).success),
        fc.record({ at: fc.string(), id: fc.string(), extra: fc.string() }),
        fc.record({ at: fc.integer(), id: fc.string() }),
      ),
      (json) => {
        const cursor = Buffer.from(JSON.stringify(json), 'utf8').toString('base64url');
        const outcome = decodeOutcome(cursor, keySchema);
        expect('error' in outcome && outcome.error instanceof HttpError).toBe(true);
      },
    ),
    RUNS,
  );
});

test('a page holds at most `limit` rows, and has a next cursor exactly when rows were left over', () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer(), { maxLength: 60 }),
      fc.integer({ min: 1, max: 50 }),
      (rows, limit) => {
        const page = toPage(
          rows,
          limit,
          (row) => row * 2,
          (row) => `after:${row}`,
        );
        expect(page.items).toEqual(rows.slice(0, limit).map((row) => row * 2));
        expect(page.items.length).toBeLessThanOrEqual(limit);
        if (rows.length > limit) expect(page.nextCursor).toBe(`after:${rows[limit - 1]}`);
        else expect(page.nextCursor).toBeNull();
      },
    ),
    RUNS,
  );
});

test('following the cursors visits every row exactly once, in order', () => {
  fc.assert(
    fc.property(
      fc.uniqueArray(fc.integer({ min: 0, max: 10_000 }), { maxLength: 80 }),
      fc.integer({ min: 1, max: 17 }),
      (ids, limit) => {
        const rows = [...ids].sort((a, b) => a - b);
        const seen: number[] = [];
        let after = -1;
        for (let guard = 0; guard <= rows.length + 1; guard++) {
          // The query asks for `limit + 1` rows after the cursor, as the routes do.
          const window = rows.filter((row) => row > after).slice(0, limit + 1);
          const page = toPage(
            window,
            limit,
            (row) => row,
            (row) => encodeCursor({ id: String(row) }),
          );
          seen.push(...page.items);
          if (page.nextCursor === null) break;
          after = Number(decodeCursor(page.nextCursor, z.object({ id: z.string() }))?.id);
        }
        expect(seen).toEqual(rows);
      },
    ),
    RUNS,
  );
});
