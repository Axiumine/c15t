// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { BanUserInput, UserCreateInput, UserUpdate } from '@consent/shared';
import { useAdminMutation } from './admin-mutation';
import { client } from './client';
import { queryKeys } from './keys';

/** A password the API returned once. It is handed to the caller and never stored by Query. */
export interface OneTimeSecret {
  readonly email: string;
  readonly password: string;
  readonly reason: 'created' | 'reset';
}

const USER_KEYS = [queryKeys.adminUsers];

export const useCreateUser = (onSecret: (secret: OneTimeSecret) => void) =>
  useAdminMutation(async (input: UserCreateInput) => {
    const result = await (await client.admin.users.$post({ json: input })).json();
    onSecret({ email: result.user.email, password: result.oneTimePassword, reason: 'created' });
    return result.user;
  }, USER_KEYS);

export const useResetPassword = (onSecret: (secret: OneTimeSecret) => void) =>
  useAdminMutation(async (id: string) => {
    const result = await (
      await client.admin.users[':id']['reset-password'].$post({ param: { id } })
    ).json();
    onSecret({ email: result.user.email, password: result.oneTimePassword, reason: 'reset' });
    return result.user;
  }, USER_KEYS);

export const useUpdateUser = () =>
  useAdminMutation(
    async (variables: { id: string; changes: UserUpdate }) =>
      (
        await client.admin.users[':id'].$patch({
          param: { id: variables.id },
          json: variables.changes,
        })
      ).json(),
    USER_KEYS,
  );

export const useSetUserSites = () =>
  useAdminMutation(
    async (variables: { id: string; siteKeys: string[] }) =>
      (
        await client.admin.users[':id'].sites.$put({
          param: { id: variables.id },
          json: { siteKeys: variables.siteKeys },
        })
      ).json(),
    USER_KEYS,
  );

export const useBanUser = () =>
  useAdminMutation(
    async (variables: { id: string; ban: BanUserInput }) =>
      (
        await client.admin.users[':id'].ban.$post({
          param: { id: variables.id },
          json: variables.ban,
        })
      ).json(),
    USER_KEYS,
  );

export const useUnbanUser = () =>
  useAdminMutation(
    async (id: string) => (await client.admin.users[':id'].unban.$post({ param: { id } })).json(),
    USER_KEYS,
  );

export const useRevokeSessions = () =>
  useAdminMutation(
    async (id: string) =>
      (await client.admin.users[':id']['revoke-sessions'].$post({ param: { id } })).json(),
    USER_KEYS,
  );
