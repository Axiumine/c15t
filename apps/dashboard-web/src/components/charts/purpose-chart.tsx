// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { formatInteger, formatPercent } from '../../lib/format';
import { EmptyState } from '../states';
import { ChartFrame } from './chart-frame';
import { ChartTable } from './chart-table';
import { type BarDatum, RankedBars } from './ranked-bars';
import type { Purpose } from './stats-figures';

export function PurposeChart({
  purposes,
  busy,
}: Readonly<{ purposes: readonly Purpose[]; busy: boolean }>) {
  const ranked = [...purposes].sort((a, b) => b.optInRate - a.optInRate);
  const data: BarDatum[] = ranked.map((item) => ({
    name: item.purpose,
    value: item.optInRate,
    display: formatPercent(item.optInRate),
    details: [
      { label: 'granted', value: formatInteger(item.granted) },
      { label: 'denied', value: formatInteger(item.denied) },
    ],
  }));
  return (
    <ChartFrame
      title="Opt-in rate by category"
      summary="Share of decisions that granted each category."
      busy={busy}
      chart={
        data.length === 0 ? (
          <EmptyState title="No decisions in this period" />
        ) : (
          <RankedBars data={data} valueLabel="opt-in rate" max={1} track />
        )
      }
      table={
        <ChartTable
          caption="Opt-in rate by category"
          label={{ header: 'Category', cell: (item) => item.purpose }}
          columns={[
            { header: 'Granted', cell: (item) => formatInteger(item.granted) },
            { header: 'Denied', cell: (item) => formatInteger(item.denied) },
            { header: 'Opt-in rate', cell: (item) => formatPercent(item.optInRate) },
          ]}
          rows={ranked}
          rowKey={(item) => item.purpose}
        />
      }
    />
  );
}
