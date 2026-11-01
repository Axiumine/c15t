// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useAdminSites } from '../../api';
import { PageHeader } from '../../components/page-header';
import { RangeFilter } from '../../components/range-filter';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import { type RangeSearch, resolveRange } from '../../lib/range';
import { useSiteRows } from './overview-rows';
import { OverviewTiles, StatsFailure } from './overview-tiles';
import { SitesBreakdown } from './sites-breakdown';

export function AdminOverviewScreen({
  search,
  onSearchChange,
}: Readonly<{
  search: RangeSearch;
  onSearchChange: (next: RangeSearch) => void;
}>) {
  const sites = useAdminSites();
  const list = sites.data?.items ?? [];
  const { results, rows } = useSiteRows(list, resolveRange(search));

  if (sites.isPending) return <LoadingBlock label="Loading sites" />;
  if (sites.isError) return <ErrorState error={sites.error} onRetry={() => void sites.refetch()} />;

  return (
    <div className="grid gap-6">
      <PageHeader title="Overview" description="All sites side by side, for the same period." />
      <RangeFilter value={search} onChange={onSearchChange} />
      {list.length === 0 ? (
        <EmptyState title="No sites yet" description="Create a site under Manage sites." />
      ) : (
        <>
          <OverviewTiles list={list} rows={rows} />
          <StatsFailure results={results} />
          <SitesBreakdown rows={rows} busy={results.some((result) => result.isFetching)} />
        </>
      )}
    </div>
  );
}
