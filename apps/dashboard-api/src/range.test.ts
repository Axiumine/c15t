// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { MAX_RANGE_DAYS } from '@consent/shared';
import { expect, test } from 'vitest';
import { HttpError } from './errors.js';
import { boundsFromQuery, fromNaiveUtc, startOfUtcDay, statsRange, toNaiveUtc } from './range.js';

const now = new Date('2026-03-10T15:30:00.000Z');

test('stats default to the last 30 UTC days including today', () => {
  const range = statsRange({}, now);
  expect(range.to.toISOString()).toBe('2026-03-11T00:00:00.000Z');
  expect(range.from.toISOString()).toBe('2026-02-09T00:00:00.000Z');
});

test('a date-only `to` includes that whole day', () => {
  const range = statsRange({ from: '2026-03-01', to: '2026-03-05' }, now);
  expect(range.from.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  expect(range.to.toISOString()).toBe('2026-03-06T00:00:00.000Z');
});

test('a timestamp `to` is inclusive of that instant', () => {
  const bounds = boundsFromQuery({ to: '2026-03-05T10:00:00.000Z' });
  expect(bounds.to?.toISOString()).toBe('2026-03-05T10:00:00.001Z');
});

test('rejects empty and oversized ranges with a validation error', () => {
  // A `from` in the future leaves nothing between it and the default `to`.
  expect(() => statsRange({ from: '2027-01-01' }, now)).toThrow(HttpError);
  const wide = () => statsRange({ from: '2020-01-01', to: '2026-03-05' }, now);
  expect(wide).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  expect(wide).toThrow(String(MAX_RANGE_DAYS));
});

test('naive UTC conversion round-trips and tolerates c15t formats', () => {
  expect(toNaiveUtc(new Date('2026-03-01T12:00:00.123Z'))).toBe('2026-03-01 12:00:00.123');
  expect(fromNaiveUtc('2026-03-01 12:00:00.123')).toBe('2026-03-01T12:00:00.123Z');
  expect(fromNaiveUtc('2026-03-01 12:00:00.123456')).toBe('2026-03-01T12:00:00.123Z');
  expect(fromNaiveUtc('2026-03-01 12:00:00')).toBe('2026-03-01T12:00:00.000Z');
  expect(fromNaiveUtc(new Date('2026-03-01T12:00:00Z'))).toBe('2026-03-01T12:00:00.000Z');
});

test('fromNaiveUtc keeps a zone the text already carries and appends Z to the rest', () => {
  expect(fromNaiveUtc('2026-03-01T12:00:00Z')).toBe('2026-03-01T12:00:00.000Z');
  expect(fromNaiveUtc('2026-03-01T12:00:00+02:00')).toBe('2026-03-01T10:00:00.000Z');
  expect(fromNaiveUtc('2026-03-01T12:00:00+0200')).toBe('2026-03-01T10:00:00.000Z');
  expect(fromNaiveUtc('2026-03-01T12:00:00-05:30')).toBe('2026-03-01T17:30:00.000Z');
});

test('startOfUtcDay drops the time', () => {
  expect(startOfUtcDay(new Date('2026-03-10T23:59:59.999Z')).toISOString()).toBe(
    '2026-03-10T00:00:00.000Z',
  );
});

test('an upper bound that widens past year 9999 is a validation error, not a database error', () => {
  for (const to of ['9999-12-31', '9999-12-31T23:59:59.999Z']) {
    const call = () => boundsFromQuery({ to });
    expect(call, to).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  }
  expect(boundsFromQuery({ to: '9999-12-30' }).to?.toISOString()).toBe('9999-12-31T00:00:00.000Z');
  expect(() => statsRange({ to: '9999-12-31' }, now)).toThrow(HttpError);
});

test('toNaiveUtc refuses dates Postgres cannot read', () => {
  const bad = [
    new Date('0000-01-01T00:00:00.000Z'),
    new Date('-000001-01-01T00:00:00.000Z'),
    new Date('+010000-01-01T00:00:00.000Z'),
    new Date(Number.NaN),
  ];
  for (const date of bad) {
    expect(() => toNaiveUtc(date)).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  }
  expect(toNaiveUtc(new Date('0001-01-01T00:00:00.000Z'))).toBe('0001-01-01 00:00:00.000');
  expect(toNaiveUtc(new Date('9999-12-31T23:59:59.999Z'))).toBe('9999-12-31 23:59:59.999');
});

/* Boundaries and error details, found by mutation testing (docs/quality-gates.md). */

test('a range of exactly zero length is empty, one millisecond is not', () => {
  const instant = '2026-03-01T00:00:00.000Z';
  const empty = () => statsRange({ from: instant, to: '2026-02-28T23:59:59.999Z' }, now);
  expect(empty).toThrow(
    expect.objectContaining({
      code: 'VALIDATION_ERROR',
      message: 'The range is empty',
      issues: [{ path: 'from', message: '`from` must be before `to`' }],
    }),
  );
  // `to` is inclusive of its own instant (widened by 1 ms), so this is from == to after widening.
  expect(() => statsRange({ from: instant, to: '2026-02-28T23:59:59.998Z' }, now)).toThrow(
    HttpError,
  );
  expect(statsRange({ from: instant, to: instant }, now).to.getTime()).toBe(
    Date.parse(instant) + 1,
  );
});

test('the longest range is MAX_RANGE_DAYS days, and one more millisecond is refused', () => {
  const from = '2025-01-01T00:00:00.000Z';
  const limit = Date.parse(from) + MAX_RANGE_DAYS * 86_400_000;
  // `to` is widened by 1 ms, so pass the instant one millisecond before the limit.
  const exactly = statsRange({ from, to: new Date(limit - 1).toISOString() }, now);
  expect(exactly.to.getTime() - exactly.from.getTime()).toBe(MAX_RANGE_DAYS * 86_400_000);

  const tooLong = () => statsRange({ from, to: new Date(limit).toISOString() }, now);
  const message = `The range may span at most ${MAX_RANGE_DAYS} days`;
  expect(tooLong).toThrow(
    expect.objectContaining({
      code: 'VALIDATION_ERROR',
      message,
      issues: [{ path: 'from', message }],
    }),
  );
});

test('the out-of-range errors name the field and say what is wrong', () => {
  expect(() => boundsFromQuery({ to: '9999-12-31' })).toThrow(
    expect.objectContaining({
      message: 'The upper bound is out of range',
      issues: [{ path: 'to', message: 'The end of the range must be before the year 9999 ends' }],
    }),
  );
  expect(() => toNaiveUtc(new Date(Number.NaN))).toThrow(
    expect.objectContaining({
      message: 'The date is out of range',
      issues: [{ path: 'range', message: 'Dates must be between the years 0001 and 9999' }],
    }),
  );
});

test('fromNaiveUtc keeps an explicit offset, with or without the colon, and assumes UTC otherwise', () => {
  expect(fromNaiveUtc('2026-03-01T12:00:00+02:00')).toBe('2026-03-01T10:00:00.000Z');
  expect(fromNaiveUtc('2026-03-01T12:00:00+0200')).toBe('2026-03-01T10:00:00.000Z');
  expect(fromNaiveUtc('2026-03-01T12:00:00-05:00')).toBe('2026-03-01T17:00:00.000Z');
  expect(fromNaiveUtc('2026-03-01T12:00:00Z')).toBe('2026-03-01T12:00:00.000Z');
  expect(fromNaiveUtc('2026-03-01T12:00:00')).toBe('2026-03-01T12:00:00.000Z');
  // A space instead of `T` is the stored shape; an offset elsewhere in the text is not an offset.
  expect(fromNaiveUtc('2026-03-01 12:00:00')).toBe('2026-03-01T12:00:00.000Z');
});
