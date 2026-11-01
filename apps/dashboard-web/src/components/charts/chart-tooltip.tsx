// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { TooltipContentProps } from 'recharts';

export interface TooltipRow {
  readonly label: string;
  readonly value: string;
}

/**
 * The readout: values lead and are strong, names follow in secondary ink. A short line in the
 * series colour keys the row. React escapes the text, so labels from the API are inert.
 */
export function ChartTooltip({
  title,
  rows,
}: Readonly<{ title: string; rows: readonly TooltipRow[] }>) {
  return (
    <div className="min-w-36 rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-muted-foreground">{title}</p>
      {rows.map((row, index) => (
        <p key={row.label} className="flex items-center gap-2">
          {index === 0 ? (
            <span
              aria-hidden="true"
              className="h-0.5 w-3 shrink-0 rounded-full bg-[var(--viz-1)]"
            />
          ) : (
            <span aria-hidden="true" className="w-3 shrink-0" />
          )}
          <span className="text-sm font-semibold text-card-foreground">{row.value}</span>
          <span className="text-muted-foreground">{row.label}</span>
        </p>
      ))}
    </div>
  );
}

/** Recharts types `payload` as always present, yet it is missing between marks. */
function firstPayload(payload: TooltipContentProps['payload'] | undefined) {
  return payload?.[0];
}

/**
 * Recharts passes `active` and the hovered payload; nothing renders between marks. Recharts types
 * a mark's `payload` as `any`; it is the data point the chart was given, so the caller names its
 * type. `Reflect.get` carries the `any` into `T` here, instead of a cast at every use.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T names the chart's own data type: Recharts types the payload as `any`, so there is no value to infer it from
export function hoveredDatum<T>(props: TooltipContentProps): T | undefined {
  if (!props.active) return undefined;
  const first = firstPayload(props.payload);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- the `any` is Recharts' own typing of `payload`, narrowed to `T` by the caller
  return first === undefined ? undefined : Reflect.get(first, 'payload');
}
