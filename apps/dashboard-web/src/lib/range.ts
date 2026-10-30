// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { MAX_RANGE_DAYS } from '@consent/shared';

export const RANGE_PRESETS = [
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number]['value'];
export const DEFAULT_RANGE_PRESET: RangePreset = '30d';

/** What lives in the URL: a preset, or a custom `from`/`to` pair of calendar dates. */
export interface RangeSearch {
  readonly range?: RangePreset | 'custom' | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

/** What the API takes: whole UTC days, both ends inclusive. */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

const DAY_MS = 86_400_000;

export const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
}

/** Resolves the URL state to concrete dates. The window ends today (UTC), like the API default. */
export function resolveRange(search: RangeSearch, now: Date = new Date()): DateRange {
  if (search.range === 'custom' && search.from !== undefined && search.to !== undefined) {
    return { from: search.from, to: search.to };
  }
  const preset = RANGE_PRESETS.find((item) => item.value === search.range);
  const days = (preset ?? RANGE_PRESETS.find((item) => item.value === DEFAULT_RANGE_PRESET))?.days;
  const to = toIsoDate(now);
  const from = toIsoDate(new Date(now.getTime() - ((days ?? 30) - 1) * DAY_MS));
  return { from, to };
}

/** Message for a custom range the API would reject, or `undefined` when it is acceptable. */
export function validateCustomRange(from: string, to: string): string | undefined {
  if (from === '' || to === '') return 'Choose both dates';
  if (from > to) return 'The start date must not be after the end date';
  if (daysBetween(from, to) > MAX_RANGE_DAYS) {
    return `The range may span at most ${MAX_RANGE_DAYS} days`;
  }
  return undefined;
}
