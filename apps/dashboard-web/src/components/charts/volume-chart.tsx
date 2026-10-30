// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { StatsResponse } from '@consent/shared';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompact, formatDay, formatInteger } from '../../lib/format';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { ChartFrame } from './chart-frame';
import { ChartTooltip, hoveredDatum } from './chart-tooltip';

type Day = StatsResponse['volume'][number];

const TICK = { fill: 'var(--muted-foreground)', fontSize: 12 } as const;
const AXIS_LINE = { stroke: 'var(--viz-axis)' } as const;

export function VolumeChart({ volume, busy }: { volume: readonly Day[]; busy: boolean }) {
  const reducedMotion = useReducedMotion();
  const total = volume.reduce((sum, day) => sum + day.consents, 0);
  const peak = volume.reduce<Day | undefined>(
    (best, day) => (best === undefined || day.consents > best.consents ? day : best),
    undefined,
  );
  const summary =
    peak === undefined || total === 0
      ? 'No consents in this period.'
      : `${formatInteger(total)} consents. Busiest day: ${formatDay(peak.date, true)} with ${formatInteger(peak.consents)}.`;

  return (
    <ChartFrame
      title="Consent volume"
      summary={summary}
      busy={busy}
      chart={
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
            <Tooltip
              cursor={{ stroke: 'var(--viz-axis)', strokeWidth: 1 }}
              content={(props) => {
                const day = hoveredDatum<Day>(props);
                return day === undefined ? null : (
                  <ChartTooltip
                    title={formatDay(day.date, true)}
                    rows={[{ label: 'consents', value: formatInteger(day.consents) }]}
                  />
                );
              }}
            />
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
              activeDot={{
                r: 4,
                fill: 'var(--viz-1)',
                stroke: 'var(--viz-surface)',
                strokeWidth: 2,
              }}
              isAnimationActive={!reducedMotion}
            />
          </AreaChart>
        </ResponsiveContainer>
      }
      table={
        <Table>
          <caption className="sr-only">Consents per day</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Date (UTC)</TableHead>
              <TableHead className="text-right">Consents</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {volume.map((day) => (
              <TableRow key={day.date}>
                <TableCell>{formatDay(day.date, true)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatInteger(day.consents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}
