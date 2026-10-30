// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { resolveRange, validateCustomRange } from './range';

const NOW = new Date('2026-03-31T10:00:00Z');

test('presets end today (UTC) and span the stated number of days', () => {
  expect(resolveRange({}, NOW)).toEqual({ from: '2026-03-02', to: '2026-03-31' });
  expect(resolveRange({ range: '7d' }, NOW)).toEqual({ from: '2026-03-25', to: '2026-03-31' });
  expect(resolveRange({ range: '90d' }, NOW)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
});

test('a custom range is used as given, but only when both dates exist', () => {
  expect(resolveRange({ range: 'custom', from: '2026-01-05', to: '2026-01-06' }, NOW)).toEqual({
    from: '2026-01-05',
    to: '2026-01-06',
  });
  expect(resolveRange({ range: 'custom', from: '2026-01-05' }, NOW)).toEqual(resolveRange({}, NOW));
});

test('custom ranges follow the API limits', () => {
  expect(validateCustomRange('2026-01-01', '2026-01-31')).toBeUndefined();
  expect(validateCustomRange('', '2026-01-31')).toBe('Choose both dates');
  expect(validateCustomRange('2026-02-01', '2026-01-31')).toContain('must not be after');
  expect(validateCustomRange('2025-01-01', '2026-03-31')).toContain('at most 366 days');
});
