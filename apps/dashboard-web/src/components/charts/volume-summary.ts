// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { StatsResponse } from '@consent/shared';
import { formatDay, formatInteger } from '../../lib/format';

export type Day = StatsResponse['volume'][number];

export function volumeSummary(volume: readonly Day[]): string {
  const total = volume.reduce((sum, day) => sum + day.consents, 0);
  const peak = volume.reduce<Day | undefined>(
    (best, day) => (best === undefined || day.consents > best.consents ? day : best),
    undefined,
  );
  return peak === undefined || total === 0
    ? 'No consents in this period.'
    : `${formatInteger(total)} consents. Busiest day: ${formatDay(peak.date, true)} with ${formatInteger(peak.consents)}.`;
}
