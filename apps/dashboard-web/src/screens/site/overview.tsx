// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useSiteStats } from '../../api';
import { StatsCharts } from '../../components/charts/stats-charts';
import { RangeFilter } from '../../components/range-filter';
import { ErrorState, LoadingBlock } from '../../components/states';
import { type RangeSearch, resolveRange } from '../../lib/range';

export function SiteOverviewScreen({
  siteKey,
  search,
  onSearchChange,
}: {
  siteKey: string;
  search: RangeSearch;
  onSearchChange: (next: RangeSearch) => void;
}) {
  const range = resolveRange(search);
  const stats = useSiteStats(siteKey, range);

  return (
    <div className="grid gap-4">
      <RangeFilter value={search} onChange={onSearchChange} />
      {stats.isPending ? <LoadingBlock label="Loading statistics" /> : null}
      {stats.isError ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : null}
      {stats.data === undefined ? null : (
        <StatsCharts stats={stats.data} busy={stats.isPlaceholderData || stats.isFetching} />
      )}
    </div>
  );
}
