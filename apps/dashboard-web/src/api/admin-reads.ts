// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { client } from './client';
import { queryKeys } from './keys';

const adminSitesQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.adminSites,
    queryFn: async () => (await client.admin.sites.$get()).json(),
  });

const adminUsersQueryOptions = () =>
  queryOptions({
    queryKey: queryKeys.adminUsers,
    queryFn: async () => (await client.admin.users.$get()).json(),
  });

export const useAdminSites = () => useQuery(adminSitesQueryOptions());
export const useAdminUsers = () => useQuery(adminUsersQueryOptions());

export const useAuditLog = () =>
  useInfiniteQuery(
    infiniteQueryOptions({
      queryKey: queryKeys.adminAudit,
      initialPageParam: undefined as string | undefined,
      queryFn: async ({ pageParam }) =>
        (
          await client.admin.audit.$get({
            query: pageParam === undefined ? {} : { cursor: pageParam },
          })
        ).json(),
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
