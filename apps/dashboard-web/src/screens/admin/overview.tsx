// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site, StatsResponse } from '@consent/shared';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { statsQueryOptions, useAdminSites } from '../../api';
import { SiteStatusBadge } from '../../components/badges';
import { ChartFrame } from '../../components/charts/chart-frame';
import { type BarDatum, RankedBars } from '../../components/charts/ranked-bars';
import { StatTile } from '../../components/charts/stat-tile';
import { overallOptInRate } from '../../components/charts/stats-charts';
import { PageHeader } from '../../components/page-header';
import { RangeFilter } from '../../components/range-filter';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatInteger, formatPercent } from '../../lib/format';
import { type RangeSearch, resolveRange } from '../../lib/range';

interface Row {
  readonly site: Site;
  readonly stats: StatsResponse | undefined;
  readonly failed: boolean;
}

const cell = (row: Row, render: (stats: StatsResponse) => string): string => {
  if (row.stats !== undefined) return render(row.stats);
  return row.failed ? 'Unavailable' : '…';
};

function SitesBreakdown({ rows, busy }: { rows: Row[]; busy: boolean }) {
  const ranked = rows
    .filter((row) => row.stats !== undefined)
    .sort((a, b) => (b.stats?.totals.consents ?? 0) - (a.stats?.totals.consents ?? 0));
  const data: BarDatum[] = ranked.map((row) => ({
    name: row.site.name,
    value: row.stats?.totals.consents ?? 0,
    display: formatInteger(row.stats?.totals.consents ?? 0),
    details: [{ label: 'subjects', value: formatInteger(row.stats?.totals.subjects ?? 0) }],
  }));
  return (
    <ChartFrame
      title="Consents by site"
      summary="Total consents recorded in the selected period."
      busy={busy}
      chart={
        data.length === 0 ? (
          <EmptyState title="No data to chart yet" />
        ) : (
          <RankedBars data={data} valueLabel="consents" />
        )
      }
      table={
        <Table>
          <caption className="sr-only">Statistics per site</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Site</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Consents</TableHead>
              <TableHead className="text-right">Subjects</TableHead>
              <TableHead className="text-right">Opt-in rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const rate = row.stats === undefined ? null : overallOptInRate(row.stats.purposes);
              return (
                <TableRow key={row.site.key}>
                  <TableCell>
                    <Link
                      to="/sites/$key"
                      params={{ key: row.site.key }}
                      className="font-medium hover:underline"
                    >
                      {row.site.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <SiteStatusBadge status={row.site.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {cell(row, (stats) => formatInteger(stats.totals.consents))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {cell(row, (stats) => formatInteger(stats.totals.subjects))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate === null ? '–' : formatPercent(rate)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      }
    />
  );
}

export function AdminOverviewScreen({
  search,
  onSearchChange,
}: {
  search: RangeSearch;
  onSearchChange: (next: RangeSearch) => void;
}) {
  const sites = useAdminSites();
  const range = resolveRange(search);
  const list = sites.data?.items ?? [];
  const results = useQueries({
    queries: list.map((site) => ({
      ...statsQueryOptions(site.key, range),
      placeholderData: (previous: StatsResponse | undefined) => previous,
    })),
  });

  if (sites.isPending) return <LoadingBlock label="Loading sites" />;
  if (sites.isError) return <ErrorState error={sites.error} onRetry={() => void sites.refetch()} />;

  const rows: Row[] = list.map((site, index) => ({
    site,
    stats: results[index]?.data,
    failed: results[index]?.isError ?? false,
  }));
  const loaded = rows.flatMap((row) => (row.stats === undefined ? [] : [row.stats]));
  const consents = loaded.reduce((sum, stats) => sum + stats.totals.consents, 0);
  const subjects = loaded.reduce((sum, stats) => sum + stats.totals.subjects, 0);
  const rate = overallOptInRate(loaded.flatMap((stats) => stats.purposes));
  const busy = results.some((result) => result.isFetching);

  return (
    <div className="grid gap-6">
      <PageHeader title="Overview" description="All sites side by side, for the same period." />
      <RangeFilter value={search} onChange={onSearchChange} />
      {list.length === 0 ? (
        <EmptyState title="No sites yet" description="Create a site under Manage sites." />
      ) : (
        <>
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
            <StatTile
              label="Overall opt-in rate"
              value={rate === null ? '–' : formatPercent(rate)}
            />
          </div>
          {results.some((result) => result.isError) ? (
            <ErrorState
              error={results.find((result) => result.isError)?.error}
              onRetry={() => void Promise.all(results.map((result) => result.refetch()))}
            />
          ) : null}
          <SitesBreakdown rows={rows} busy={busy} />
        </>
      )}
    </div>
  );
}
