// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { TooltipRow } from './chart-tooltip';

export interface BarDatum {
  readonly name: string;
  readonly value: number;
  /** The text printed at the tip of the bar. */
  readonly display: string;
  /** Extra rows for the tooltip, besides the value itself. */
  readonly details: readonly TooltipRow[];
}
