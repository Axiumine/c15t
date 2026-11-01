// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query';
import type { DateRange } from '../lib/range';
import { client } from './client';
import { queryKeys } from './keys';

/* ---------------------------------------------------------------------------------------------
 * Reads
 * ------------------------------------------------------------------------------------------- */

export const meQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.me,
    queryFn: async () => (await client.me.$get()).json(),
  });

export const sitesQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.sites,
    queryFn: async () => (await client.sites.$get()).json(),
  });

const siteQueryOptions = (siteKey: string) =>
  queryOptions({
    queryKey: queryKeys.site(siteKey),
    queryFn: async () => (await client.sites[':siteKey'].$get({ param: { siteKey } })).json(),
  });

export const statsQueryOptions = (siteKey: string, range: DateRange) =>
  queryOptions({
    queryKey: queryKeys.stats(siteKey, range),
    queryFn: async () =>
      (await client.sites[':siteKey'].stats.$get({ param: { siteKey }, query: range })).json(),
  });

export const useMe = () => useQuery(meQueryOptions());
export const useSites = () => useQuery(sitesQueryOptions());
export const useSite = (siteKey: string) => useQuery(siteQueryOptions(siteKey));

/** Keeps the previous chart on screen while another range loads (no skeleton flash). */
export const useSiteStats = (siteKey: string, range: DateRange) =>
  useQuery({ ...statsQueryOptions(siteKey, range), placeholderData: keepPreviousData });
