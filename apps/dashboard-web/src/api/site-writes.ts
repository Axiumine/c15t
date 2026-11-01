// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { SiteCreateInput, SiteUpdate } from '@consent/shared';
import { useAdminMutation } from './admin-mutation';
import { client } from './client';
import { queryKeys } from './keys';

const SITE_KEYS = [queryKeys.adminSites, queryKeys.sites] as const;

export const useCreateSite = () =>
  useAdminMutation(
    async (input: SiteCreateInput) => (await client.admin.sites.$post({ json: input })).json(),
    SITE_KEYS,
  );

export const useUpdateSite = () =>
  useAdminMutation(
    async (variables: { siteKey: string; changes: SiteUpdate }) =>
      (
        await client.admin.sites[':siteKey'].$patch({
          param: { siteKey: variables.siteKey },
          json: variables.changes,
        })
      ).json(),
    SITE_KEYS,
  );
