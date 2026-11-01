// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { consentExportQuerySchema, MAX_RANGE_DAYS } from '@consent/shared';
import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import { HttpError } from './errors.js';
import { boundsFromQuery, fromNaiveUtc, startOfUtcDay, statsRange, toNaiveUtc } from './range.js';

/*
 * Property-based tests for the time ranges behind the stats, search and export endpoints. The
 * c15t columns are `timestamp without time zone`, read as UTC, so a wrong bound would silently
 * move rows in or out of a report.
 */

const RUNS = { numRuns: 300 };
const DAY_MS = 86_400_000;

const instant = fc.date({
  min: new Date('1990-01-01T00:00:00.000Z'),
  max: new Date('2100-12-31T23:59:59.999Z'),
  noInvalidDate: true,
});
const dateOnly = instant.map((date) => date.toISOString().slice(0, 10));
const timestamp = instant.map((date) => date.toISOString());
const bound = fc.oneof(dateOnly, timestamp);

test('a UTC timestamp survives the trip to the naive column format and back', () => {
  fc.assert(
    fc.property(instant, (date) => {
      const naive = toNaiveUtc(date);
      expect(naive).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
      expect(fromNaiveUtc(naive)).toBe(date.toISOString());
      expect(fromNaiveUtc(date)).toBe(date.toISOString());
    }),
    RUNS,
  );
});

test('a zoned timestamp from the database is read at its own offset', () => {
  fc.assert(
    fc.property(instant, fc.integer({ min: -12, max: 14 }), (date, hours) => {
      const sign = hours < 0 ? '-' : '+';
      const offset = `${sign}${String(Math.abs(hours)).padStart(2, '0')}:00`;
      const local = new Date(date.getTime() + hours * 3_600_000);
      const text = `${local.toISOString().slice(0, 19)}${offset}`;
      expect(fromNaiveUtc(text)).toBe(`${date.toISOString().slice(0, 19)}.000Z`);
    }),
    RUNS,
  );
});

test('the start of a UTC day is midnight, never later than the instant, less than a day before it', () => {
  fc.assert(
    fc.property(instant, (date) => {
      const start = startOfUtcDay(date);
      expect(start.toISOString().slice(11)).toBe('00:00:00.000Z');
      expect(start.getTime()).toBeLessThanOrEqual(date.getTime());
      expect(date.getTime() - start.getTime()).toBeLessThan(DAY_MS);
    }),
    RUNS,
  );
});

test('a calendar date as `to` covers its whole day, and not a millisecond of the next', () => {
  fc.assert(
    fc.property(dateOnly, fc.integer({ min: 0, max: DAY_MS - 1 }), (day, offset) => {
      const { from, to } = boundsFromQuery({ from: day, to: day });
      const start = Date.parse(day);
      expect(from?.getTime()).toBe(start);
      expect(to?.getTime()).toBe(start + DAY_MS);
      // Every instant of the day is inside [from, to); the first instant of the next day is not.
      const inside = start + offset;
      expect(inside >= (from?.getTime() ?? 0) && inside < (to?.getTime() ?? 0)).toBe(true);
      expect(start + DAY_MS < (to?.getTime() ?? 0)).toBe(false);
    }),
    RUNS,
  );
});

test('a timestamp as `to` includes that exact millisecond', () => {
  fc.assert(
    fc.property(timestamp, (stamp) => {
      const { to } = boundsFromQuery({ to: stamp });
      expect(to?.getTime()).toBe(Date.parse(stamp) + 1);
    }),
    RUNS,
  );
});

test('a query that the shared schema accepts always has a non-empty search window', () => {
  fc.assert(
    fc.property(
      fc.option(bound, { nil: undefined }),
      fc.option(bound, { nil: undefined }),
      (from, to) => {
        const parsed = consentExportQuerySchema.safeParse({
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
        });
        fc.pre(parsed.success);
        const bounds = boundsFromQuery(parsed.data);
        if (bounds.from !== undefined && bounds.to !== undefined) {
          expect(bounds.from.getTime()).toBeLessThan(bounds.to.getTime());
        }
      },
    ),
    RUNS,
  );
});

test('the stats range is at most one year long and ends after it begins, or it is a 400', () => {
  fc.assert(
    fc.property(
      fc.option(bound, { nil: undefined }),
      fc.option(bound, { nil: undefined }),
      instant,
      (from, to, now) => {
        const query = {
          ...(from === undefined ? {} : { from }),
          ...(to === undefined ? {} : { to }),
        };
        try {
          const range = statsRange(query, now);
          expect(range.from.getTime()).toBeLessThan(range.to.getTime());
          expect(range.to.getTime() - range.from.getTime()).toBeLessThanOrEqual(
            MAX_RANGE_DAYS * DAY_MS,
          );
        } catch (error) {
          expect(error).toBeInstanceOf(HttpError);
          expect((error as HttpError).code).toBe('VALIDATION_ERROR');
        }
      },
    ),
    RUNS,
  );
});

test('without bounds the stats range is the last 30 UTC days up to the end of today', () => {
  fc.assert(
    fc.property(instant, (now) => {
      const { from, to } = statsRange({}, now);
      expect(to.getTime()).toBe(startOfUtcDay(now).getTime() + DAY_MS);
      expect(to.getTime() - from.getTime()).toBe(30 * DAY_MS);
      expect(now.getTime()).toBeGreaterThanOrEqual(from.getTime());
      expect(now.getTime()).toBeLessThan(to.getTime());
    }),
    RUNS,
  );
});

test('a range longer than the cap is rejected, however it is spelled', () => {
  fc.assert(
    fc.property(instant, fc.integer({ min: MAX_RANGE_DAYS + 1, max: 4000 }), (start, days) => {
      const from = startOfUtcDay(start);
      const to = new Date(from.getTime() + days * DAY_MS);
      const query = { from: from.toISOString(), to: to.toISOString() };
      expect(() => statsRange(query, start)).toThrow(HttpError);
    }),
    RUNS,
  );
});
