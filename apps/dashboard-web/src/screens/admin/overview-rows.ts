// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site, StatsResponse } from '@consent/shared';
import { useQueries } from '@tanstack/react-query';
import { statsQueryOptions } from '../../api';
import type { DateRange } from '../../lib/range';

export interface Row {
  readonly site: Site;
  readonly stats: StatsResponse | undefined;
  readonly failed: boolean;
}

/** One stats query per site; a site whose stats have not arrived yet keeps `stats` undefined. */
export function useSiteRows(list: readonly Site[], range: DateRange) {
  const results = useQueries({
    queries: list.map((site) => ({
      ...statsQueryOptions(site.key, range),
      placeholderData: (previous: StatsResponse | undefined) => previous,
    })),
  });
  const rows: Row[] = list.map((site, index) => {
    const result = results.at(index);
    return { site, stats: result?.data, failed: result?.isError === true };
  });
  return { results, rows };
}
