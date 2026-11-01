// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useReducedMotion } from '../../lib/use-reduced-motion';
import type { BarDatum } from './bar-datum';
import {
  BAR_RADIUS,
  BAR_SIZE,
  CURSOR,
  labelWidthFor,
  MARGIN,
  ROW_HEIGHT,
  TRACK,
  VALUE_LABEL,
} from './bar-layout';
import { barTooltip } from './bar-tooltip';
import { AXIS_LINE, TICK } from './chart-style';

export type { BarDatum } from './bar-datum';

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
