// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import {
  formatCompact,
  formatDateTime,
  formatDay,
  formatInteger,
  formatPercent,
  pluralize,
} from './format';

test('numbers use British grouping, compact notation and one-decimal percentages', () => {
  expect(formatInteger(1280)).toBe('1,280');
  expect(formatCompact(1_250)).toBe('1.3k');
  expect(formatCompact(950)).toBe('950');
  expect(formatPercent(0.7031)).toBe('70.3%');
  expect(formatPercent(0)).toBe('0%');
});

test('a valid ISO timestamp becomes a readable date and time', () => {
  expect(formatDateTime('2026-03-05T12:00:00.000Z')).toMatch(/Mar 2026/);
});

test('an unparsable timestamp is shown as it came in instead of "Invalid Date"', () => {
  expect(formatDateTime('not a date')).toBe('not a date');
});

test('a UTC day is formatted without a timezone shift, with or without the year', () => {
  expect(formatDay('2026-03-05')).toBe('5 Mar');
  expect(formatDay('2026-03-05', true)).toBe('5 Mar 2026');
  // The first instant of a day must not slip into the previous day.
  expect(formatDay('2026-01-01')).toBe('1 Jan');
});

test('an unparsable day is returned unchanged', () => {
  expect(formatDay('soon')).toBe('soon');
  expect(formatDay('soon', true)).toBe('soon');
});

test('pluralize picks the singular only for exactly one and formats the count', () => {
  expect(pluralize(1, 'consent')).toBe('1 consent');
  expect(pluralize(0, 'consent')).toBe('0 consents');
  expect(pluralize(2500, 'consent')).toBe('2,500 consents');
  expect(pluralize(2, 'domain', 'domains!')).toBe('2 domains!');
  expect(pluralize(1, 'jurisdiction', 'jurisdictions')).toBe('1 jurisdiction');
});
