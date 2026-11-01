// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { ChartFrame } from '../../components/charts/chart-frame';
import { type BarDatum, RankedBars } from '../../components/charts/ranked-bars';
import { EmptyState } from '../../components/states';
import { formatInteger } from '../../lib/format';
import { BreakdownTable } from './breakdown-table';
import type { Row } from './overview-rows';

export function SitesBreakdown({ rows, busy }: Readonly<{ rows: readonly Row[]; busy: boolean }>) {
  const ranked = rows
    .flatMap((row) => (row.stats === undefined ? [] : [{ site: row.site, stats: row.stats }]))
    .sort((a, b) => b.stats.totals.consents - a.stats.totals.consents);
  const data: BarDatum[] = ranked.map(({ site, stats }) => ({
    name: site.name,
    value: stats.totals.consents,
    display: formatInteger(stats.totals.consents),
    details: [{ label: 'subjects', value: formatInteger(stats.totals.subjects) }],
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
      table={<BreakdownTable rows={rows} />}
    />
  );
}
