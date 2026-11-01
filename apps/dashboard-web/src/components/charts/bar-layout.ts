// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { BarDatum } from './bar-datum';

export const ROW_HEIGHT = 34;
export const BAR_SIZE = 16;
const CHAR_WIDTH = 7.5;
const AXIS_PADDING = 18;

export const MARGIN = { top: 4, right: 64, bottom: 4, left: 0 } as const;
export const CURSOR = { fill: 'var(--viz-grid)', fillOpacity: 0.5 } as const;
export const TRACK = { fill: 'var(--viz-track)', radius: 4 } as const;
export const BAR_RADIUS: [number, number, number, number] = [0, 4, 4, 0];
export const VALUE_LABEL = {
  dataKey: 'display',
  position: 'right',
  fill: 'var(--card-foreground)',
  fontSize: 12,
  fontWeight: 600,
} as const;

/** Room for the category names: as wide as the longest one, within 64 to 200 px. */
export function labelWidthFor(data: readonly BarDatum[]): number {
  const widest = data.reduce((longest, item) => Math.max(longest, item.name.length), 0);
  return Math.min(200, Math.max(64, widest * CHAR_WIDTH + AXIS_PADDING));
}
