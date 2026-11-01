// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { StatsResponse } from '@consent/shared';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompact, formatDay, formatInteger } from '../../lib/format';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { ChartFrame } from './chart-frame';
import { ChartTable } from './chart-table';
import { ChartTooltip, hoveredDatum } from './chart-tooltip';

type Day = StatsResponse['volume'][number];

const TICK = { fill: 'var(--muted-foreground)', fontSize: 12 } as const;
const AXIS_LINE = { stroke: 'var(--viz-axis)' } as const;

const ACTIVE_DOT = {
  r: 4,
  fill: 'var(--viz-1)',
  stroke: 'var(--viz-surface)',
  strokeWidth: 2,
} as const;

function volumeSummary(volume: readonly Day[]): string {
  const total = volume.reduce((sum, day) => sum + day.consents, 0);
  const peak = volume.reduce<Day | undefined>(
    (best, day) => (best === undefined || day.consents > best.consents ? day : best),
    undefined,
  );
  return peak === undefined || total === 0
    ? 'No consents in this period.'
    : `${formatInteger(total)} consents. Busiest day: ${formatDay(peak.date, true)} with ${formatInteger(peak.consents)}.`;
}

function VolumeTooltip(props: TooltipContentProps) {
  const day = hoveredDatum<Day>(props);
  return day === undefined ? null : (
    <ChartTooltip
      title={formatDay(day.date, true)}
      rows={[{ label: 'consents', value: formatInteger(day.consents) }]}
    />
  );
}

function VolumeArea({ volume }: Readonly<{ volume: readonly Day[] }>) {
  const reducedMotion = useReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={[...volume]} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis
          dataKey="date"
          tickFormatter={(value: string) => formatDay(value)}
          tick={TICK}
          axisLine={AXIS_LINE}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          allowDecimals={false}
          tickFormatter={(value: number) => formatCompact(value)}
          tick={TICK}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }} content={VolumeTooltip} />
        <Area
          type="monotone"
          dataKey="consents"
          stroke="var(--viz-1)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="var(--viz-1)"
          fillOpacity={0.1}
          dot={false}
          activeDot={ACTIVE_DOT}
          isAnimationActive={!reducedMotion}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function VolumeChart({ volume, busy }: Readonly<{ volume: readonly Day[]; busy: boolean }>) {
  return (
    <ChartFrame
      title="Consent volume"
      summary={volumeSummary(volume)}
      busy={busy}
      chart={<VolumeArea volume={volume} />}
      table={
        <ChartTable
          caption="Consents per day"
          label={{ header: 'Date (UTC)', cell: (day) => formatDay(day.date, true) }}
          columns={[{ header: 'Consents', cell: (day) => formatInteger(day.consents) }]}
          rows={volume}
          rowKey={(day) => day.date}
        />
      }
    />
  );
}
