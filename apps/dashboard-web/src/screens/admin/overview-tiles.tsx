// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site, StatsResponse } from '@consent/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { StatTile } from '../../components/charts/stat-tile';
import { overallOptInRate } from '../../components/charts/stats-charts';
import { ErrorState } from '../../components/states';
import { formatInteger, formatPercent } from '../../lib/format';
import type { Row } from './overview-rows';

export function OverviewTiles({
  list,
  rows,
}: Readonly<{ list: readonly Site[]; rows: readonly Row[] }>) {
  const loaded = rows.flatMap((row) => (row.stats === undefined ? [] : [row.stats]));
  const consents = loaded.reduce((sum, stats) => sum + stats.totals.consents, 0);
  const subjects = loaded.reduce((sum, stats) => sum + stats.totals.subjects, 0);
  const rate = overallOptInRate(loaded.flatMap((stats) => stats.purposes));
  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <StatTile
        label="Sites"
        value={formatInteger(list.length)}
        hint={`${formatInteger(list.filter((site) => site.status === 'active').length)} active`}
      />
      <StatTile label="Consents" value={formatInteger(consents)} />
      <StatTile
        label="Subjects"
        value={formatInteger(subjects)}
        hint="Subject IDs are unique across sites"
      />
      <StatTile label="Overall opt-in rate" value={rate === null ? '–' : formatPercent(rate)} />
    </div>
  );
}

export function StatsFailure({
  results,
}: Readonly<{ results: readonly UseQueryResult<StatsResponse>[] }>) {
  const failed = results.find((result) => result.isError);
  if (failed === undefined) return null;
  return (
    <ErrorState
      error={failed.error}
      onRetry={() => void Promise.all(results.map((result) => result.refetch()))}
    />
  );
}
