// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from 'recharts';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import { ChartTooltip, hoveredDatum, type TooltipRow } from './chart-tooltip';

export interface BarDatum {
  readonly name: string;
  readonly value: number;
  /** The text printed at the tip of the bar. */
  readonly display: string;
  /** Extra rows for the tooltip, besides the value itself. */
  readonly details: readonly TooltipRow[];
}

const ROW_HEIGHT = 34;
const BAR_SIZE = 16;
const CHAR_WIDTH = 7.5;
const AXIS_PADDING = 18;
const TICK = { fill: 'var(--muted-foreground)', fontSize: 12 } as const;

const MARGIN = { top: 4, right: 64, bottom: 4, left: 0 } as const;
const AXIS_LINE = { stroke: 'var(--viz-axis)' } as const;
const CURSOR = { fill: 'var(--viz-grid)', fillOpacity: 0.5 } as const;
const TRACK = { fill: 'var(--viz-track)', radius: 4 } as const;
const BAR_RADIUS: [number, number, number, number] = [0, 4, 4, 0];
const VALUE_LABEL = {
  dataKey: 'display',
  position: 'right',
  fill: 'var(--card-foreground)',
  fontSize: 12,
  fontWeight: 600,
} as const;

/** Room for the category names: as wide as the longest one, within 64 to 200 px. */
function labelWidthFor(data: readonly BarDatum[]): number {
  const widest = data.reduce((longest, item) => Math.max(longest, item.name.length), 0);
  return Math.min(200, Math.max(64, widest * CHAR_WIDTH + AXIS_PADDING));
}

function barTooltip(props: TooltipContentProps, valueLabel: string): ReactNode {
  const datum = hoveredDatum<BarDatum>(props);
  return datum === undefined ? null : (
    <ChartTooltip
      title={datum.name}
      rows={[{ label: valueLabel, value: datum.display }, ...datum.details]}
    />
  );
}

/**
 * Horizontal ranked bars in one hue: at most 16px thick, a 4px rounded tip and a square
 * baseline, the value printed at the tip. With `track`, the bar sits on a lighter step of the
 * same ramp that marks the whole (used for rates).
 */
export function RankedBars({
  data,
  valueLabel,
  max,
  track = false,
}: Readonly<{
  data: readonly BarDatum[];
  valueLabel: string;
  max?: number;
  track?: boolean;
}>) {
  const reducedMotion = useReducedMotion();
  const domainMax = max ?? Math.max(1, ...data.map((item) => item.value));
  return (
    <ResponsiveContainer width="100%" height={data.length * ROW_HEIGHT + 12}>
      <BarChart data={[...data]} layout="vertical" margin={MARGIN} barCategoryGap={8}>
        <XAxis type="number" hide domain={[0, domainMax]} />
        <YAxis
          type="category"
          dataKey="name"
          width={labelWidthFor(data)}
          tick={TICK}
          axisLine={AXIS_LINE}
          tickLine={false}
          interval={0}
        />
        <Tooltip cursor={CURSOR} content={(props) => barTooltip(props, valueLabel)} />
        <Bar
          dataKey="value"
          fill="var(--viz-1)"
          barSize={BAR_SIZE}
          radius={BAR_RADIUS}
          background={track ? TRACK : false}
          isAnimationActive={!reducedMotion}
        >
          <LabelList {...VALUE_LABEL} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
