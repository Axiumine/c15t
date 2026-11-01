// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { formatInteger } from '../lib/format';
import { Button } from './ui/button';

/** Footer of a cursor-paginated list: how much is loaded, and the button for the next page. */
export function LoadMore({
  loaded,
  noun,
  endLabel,
  hasMore,
  fetching,
  onMore,
  moreLabel = 'Load more',
}: Readonly<{
  loaded: number;
  noun: string;
  endLabel: string;
  hasMore: boolean;
  fetching: boolean;
  onMore: () => void;
  moreLabel?: string;
}>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {formatInteger(loaded)} {noun} loaded{hasMore ? '' : `, ${endLabel}`}
      </p>
      {hasMore ? (
        <Button type="button" variant="outline" disabled={fetching} onClick={onMore}>
          {fetching ? 'Loading…' : moreLabel}
        </Button>
      ) : null}
    </div>
  );
}
