// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { StatsResponse } from '@consent/shared';
import { formatInteger, formatPercent } from '../../lib/format';
import { JurisdictionChart } from './jurisdiction-chart';
import { PurposeChart } from './purpose-chart';
import { StatTile } from './stat-tile';
import { overallOptInRate } from './stats-figures';
import { VolumeChart } from './volume-chart';

export { overallOptInRate } from './stats-figures';

/** Everything the stats endpoint returns, as stat tiles and three charts. */
export function StatsCharts({ stats, busy }: Readonly<{ stats: StatsResponse; busy: boolean }>) {
  const rate = overallOptInRate(stats.purposes);
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Consents" value={formatInteger(stats.totals.consents)} />
        <StatTile
          label="Subjects"
          value={formatInteger(stats.totals.subjects)}
          hint="Distinct subject IDs"
        />
        <StatTile
          label="Overall opt-in rate"
          value={rate === null ? '–' : formatPercent(rate)}
          hint="Granted decisions over all decisions"
        />
      </div>
      <VolumeChart volume={stats.volume} busy={busy} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PurposeChart purposes={stats.purposes} busy={busy} />
        <JurisdictionChart
          jurisdictions={stats.jurisdictions}
          total={stats.totals.consents}
          busy={busy}
        />
      </div>
    </div>
  );
}
