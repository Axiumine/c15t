// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { StatsResponse } from '@consent/shared';
import { formatInteger, formatPercent } from '../../lib/format';
import { EmptyState } from '../states';
import { ChartFrame } from './chart-frame';
import { ChartTable } from './chart-table';
import { type BarDatum, RankedBars } from './ranked-bars';
import { StatTile } from './stat-tile';
import { VolumeChart } from './volume-chart';

type Purpose = StatsResponse['purposes'][number];
type Jurisdiction = StatsResponse['jurisdictions'][number];

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

function PurposeChart({
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

function JurisdictionChart({
  jurisdictions,
  total,
  busy,
}: Readonly<{
  jurisdictions: readonly Jurisdiction[];
  total: number;
  busy: boolean;
}>) {
  const folded = foldJurisdictions(jurisdictions);
  const share = (consents: number) => (total === 0 ? 0 : consents / total);
  const data: BarDatum[] = folded.map((item) => ({
    name: item.jurisdiction,
    value: item.consents,
    display: formatInteger(item.consents),
    details: [{ label: 'of all consents', value: formatPercent(share(item.consents)) }],
  }));
  return (
    <ChartFrame
      title="Consents by jurisdiction"
      summary="Where the visitors were when they decided."
      busy={busy}
      chart={
        data.length === 0 ? (
          <EmptyState title="No consents in this period" />
        ) : (
          <RankedBars data={data} valueLabel="consents" />
        )
      }
      table={
        <ChartTable
          caption="Consents by jurisdiction"
          label={{ header: 'Jurisdiction', cell: (item) => item.jurisdiction }}
          columns={[
            { header: 'Consents', cell: (item) => formatInteger(item.consents) },
            { header: 'Share', cell: (item) => formatPercent(share(item.consents)) },
          ]}
          rows={folded}
          rowKey={(item) => item.jurisdiction}
        />
      }
    />
  );
}

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
