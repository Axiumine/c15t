// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { infiniteQueryOptions, keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import type { DateRange } from '../lib/range';
import { API_BASE, client } from './client';
import { type ConsentFilters, queryKeys } from './keys';

function consentQuery(filters: ConsentFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.subject !== undefined && filters.subject !== '') query['subject'] = filters.subject;
  if (filters.from !== undefined && filters.from !== '') query['from'] = filters.from;
  if (filters.to !== undefined && filters.to !== '') query['to'] = filters.to;
  return query;
}

export const useConsents = (siteKey: string, filters: ConsentFilters) =>
  useInfiniteQuery(
    infiniteQueryOptions({
      queryKey: queryKeys.consents(siteKey, filters),
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) =>
        (
          await client.sites[':siteKey'].consents.$get({
            param: { siteKey },
            query: {
              ...consentQuery(filters),
              ...(pageParam === undefined ? {} : { cursor: pageParam }),
            },
          })
        ).json(),
      getNextPageParam: (last) => last.nextCursor ?? undefined,
      placeholderData: keepPreviousData,
    }),
  );

/**
 * The export is a plain link: the browser streams the file to disk, so nothing is buffered in
 * memory, and the session cookie goes along because the request is same-origin.
 */
export function consentsCsvHref(siteKey: string, range: Partial<DateRange>): string {
  const query = new URLSearchParams();
  if (range.from !== undefined && range.from !== '') query.set('from', range.from);
  if (range.to !== undefined && range.to !== '') query.set('to', range.to);
  const suffix = query.size > 0 ? `?${query}` : '';
  return `${API_BASE}/sites/${encodeURIComponent(siteKey)}/consents.csv${suffix}`;
}
