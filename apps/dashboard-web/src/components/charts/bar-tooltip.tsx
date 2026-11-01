// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ReactNode } from 'react';
import type { TooltipContentProps } from 'recharts';
import type { BarDatum } from './bar-datum';
import { ChartTooltip, hoveredDatum } from './chart-tooltip';

export function barTooltip(props: TooltipContentProps, valueLabel: string): ReactNode {
  const datum = hoveredDatum<BarDatum>(props);
  return datum === undefined ? null : (
    <ChartTooltip
      title={datum.name}
      rows={[{ label: valueLabel, value: datum.display }, ...datum.details]}
    />
  );
}
