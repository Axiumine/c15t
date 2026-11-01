// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { StatsResponse } from '@consent/shared';

export type Purpose = StatsResponse['purposes'][number];
export type Jurisdiction = StatsResponse['jurisdictions'][number];

const MAX_JURISDICTIONS = 8;

/** Granted over granted plus denied, across every purpose. `null` when nothing was decided. */
export function overallOptInRate(purposes: readonly Purpose[]): number | null {
  const granted = purposes.reduce((sum, item) => sum + item.granted, 0);
  const denied = purposes.reduce((sum, item) => sum + item.denied, 0);
  return granted + denied === 0 ? null : granted / (granted + denied);
}

/** The largest jurisdictions, with the tail folded into "Other" (never more than 8 bars). */
export function foldJurisdictions(items: readonly Jurisdiction[]): Jurisdiction[] {
  const sorted = [...items].sort((a, b) => b.consents - a.consents);
  if (sorted.length <= MAX_JURISDICTIONS) return sorted;
  const head = sorted.slice(0, MAX_JURISDICTIONS - 1);
  const rest = sorted.slice(MAX_JURISDICTIONS - 1).reduce((sum, item) => sum + item.consents, 0);
  return [...head, { jurisdiction: 'Other', consents: rest }];
}
