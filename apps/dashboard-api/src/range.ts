// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type ConsentExportQuery, isRepresentableInstant, MAX_RANGE_DAYS } from '@consent/shared';
import { HttpError } from './errors.js';

const DAY_MS = 86_400_000;
export const DEFAULT_RANGE_DAYS = 30;

/** Half-open interval `[from, to)` in UTC. Both bounds are optional for record search. */
export interface TimeBounds {
  readonly from?: Date;
  readonly to?: Date;
}

export interface StatsRange {
  readonly from: Date;
  readonly to: Date;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** `Z`, `+hh`, `+hh:mm` or `+hhmm` at the end: the text already says which zone it is in. */
const OFFSET_SUFFIX = /(?:Z|[+-]\d{2}|[+-]\d{2}:?\d{2})$/;

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** A calendar date means the whole day, so as an upper bound it is the start of the next day. */
function parseLowerBound(value: string): Date {
  return new Date(value);
}

function parseUpperBound(value: string): Date {
  const instant = new Date(value);
  const widened = new Date(instant.getTime() + (DATE_ONLY.test(value) ? DAY_MS : 1));
  // `to=9999-12-31` widens to year 10000, which Postgres cannot read: a 400, never a database error.
  if (!isRepresentableInstant(widened.getTime())) {
    throw new HttpError('VALIDATION_ERROR', 'The upper bound is out of range', [
      { path: 'to', message: 'The end of the range must be before the year 9999 ends' },
    ]);
  }
  return widened;
}

export function boundsFromQuery(query: ConsentExportQuery): TimeBounds {
  return {
    ...(query.from === undefined ? {} : { from: parseLowerBound(query.from) }),
    ...(query.to === undefined ? {} : { to: parseUpperBound(query.to) }),
  };
}

/**
 * Stats default to the last 30 UTC days including today. The range is capped, because the
 * volume series has one entry per day.
 */
export function statsRange(query: ConsentExportQuery, now: Date): StatsRange {
  const bounds = boundsFromQuery(query);
  const to = bounds.to ?? new Date(startOfUtcDay(now).getTime() + DAY_MS);
  const from = bounds.from ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  if (from >= to) {
    throw new HttpError('VALIDATION_ERROR', 'The range is empty', [
      { path: 'from', message: '`from` must be before `to`' },
    ]);
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new HttpError('VALIDATION_ERROR', `The range may span at most ${MAX_RANGE_DAYS} days`, [
      { path: 'from', message: `The range may span at most ${MAX_RANGE_DAYS} days` },
    ]);
  }
  return { from, to };
}

/**
 * c15t stores `timestamp without time zone` columns. dashboard-api reads and compares them as
 * UTC with plain string handling, so its result does not depend on its own TZ (timezone.test.ts).
 * The stored values are UTC only because consent-api runs with TZ=UTC (see README, hosting).
 */
export function toNaiveUtc(date: Date): string {
  const ms = date.getTime();
  if (!isRepresentableInstant(ms)) {
    throw new HttpError('VALIDATION_ERROR', 'The date is out of range', [
      { path: 'range', message: 'Dates must be between the years 0001 and 9999' },
    ]);
  }
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

export function fromNaiveUtc(value: string | Date): string {
  if (value instanceof Date) return value.toISOString();
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  return new Date(OFFSET_SUFFIX.test(normalized) ? normalized : `${normalized}Z`).toISOString();
}
