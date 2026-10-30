// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type ReactNode, useId, useState } from 'react';
import { cn } from '../../lib/cn';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';

type View = 'chart' | 'table';

/**
 * Card around one chart: a title, a "Chart / Table" switch (the table is the accessible twin of
 * the chart and carries every value), and a dimmed state while a refetch keeps the old render.
 */
export function ChartFrame({
  title,
  summary,
  busy = false,
  chart,
  table,
}: {
  title: string;
  summary: string;
  busy?: boolean;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [view, setView] = useState<View>('chart');
  const captionId = useId();
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <CardTitle>{title}</CardTitle>
          <p id={captionId} className="text-sm text-muted-foreground">
            {summary}
          </p>
        </div>
        <fieldset className="m-0 flex min-w-0 rounded-md border p-0.5">
          <legend className="sr-only">{`${title} view`}</legend>
          {(['chart', 'table'] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                'rounded-sm px-2.5 py-1 text-xs font-medium capitalize',
                view === option
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option}
            </button>
          ))}
        </fieldset>
      </CardHeader>
      <CardContent aria-busy={busy} className={cn('transition-opacity', busy && 'opacity-60')}>
        <figure aria-labelledby={captionId} className="m-0">
          {view === 'chart' ? chart : table}
        </figure>
      </CardContent>
    </Card>
  );
}
