// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Me } from '@consent/shared';
import type { QueryClient } from '@tanstack/react-query';
import { redirect, useNavigate } from '@tanstack/react-router';
import { ApiError, meQueryOptions } from './api';
import { signOut } from './auth';

/** Only same-origin paths may be a post-login target: no scheme, no `//host`, no backslashes. */
export function safeRedirectPath(value: string | undefined): string | undefined {
  if (value === undefined || !value.startsWith('/') || value.startsWith('//')) return undefined;
  if (value.includes('\\') || value.startsWith('/login')) return undefined;
  return value;
}

/**
 * The signed-in user, or `null` when there is no session. Other failures propagate. `fresh`
 * skips the cache: the login screen must ask the server, not trust an old answer.
 */
export async function currentUser(
  queryClient: QueryClient,
  options: { fresh?: boolean } = {},
): Promise<Me | null> {
  try {
    return options.fresh === true
      ? await queryClient.query({ ...meQueryOptions(), staleTime: 0 })
      : await queryClient.query({ ...meQueryOptions(), staleTime: 'static' });
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'unauthorized') return null;
    throw error;
  }
}

/** Route guard for everything behind the login. UX only: the API enforces access itself. */
export async function requireUser(queryClient: QueryClient, pathname: string, href: string) {
  const me = await currentUser(queryClient);
  if (me === null) {
    queryClient.removeQueries({ queryKey: meQueryOptions().queryKey });
    throw redirect({ to: '/login', search: { redirect: safeRedirectPath(href) } });
  }
  // While an admin-set password is pending the API refuses everything but /api/me.
  if (me.mustChangePassword && pathname !== '/account') throw redirect({ to: '/account' });
  return me;
}

export function useSignOut(queryClient: QueryClient) {
  const navigate = useNavigate();
  return async () => {
    await signOut();
    queryClient.clear();
    await navigate({ to: '/login', search: { redirect: undefined } });
  };
}
