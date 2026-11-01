// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './errors';
import { isUnavailable } from './messages';

/* ---------------------------------------------------------------------------------------------
 * Query client: 401 sends the user to the login screen, PASSWORD_CHANGE_REQUIRED to the forced
 * change-password screen. Only reads are retried, and only when the service is unavailable.
 * ------------------------------------------------------------------------------------------- */

export interface SessionHandlers {
  readonly onUnauthorized: () => void;
  readonly onPasswordChangeRequired: () => void;
}

const MAX_READ_RETRIES = 2;

export function shouldRetry(failureCount: number, error: unknown): boolean {
  return isUnavailable(error) && failureCount < MAX_READ_RETRIES;
}

export function createQueryClient(handlers: SessionHandlers): QueryClient {
  const onError = (error: unknown) => {
    if (!(error instanceof ApiError)) return;
    if (error.kind === 'unauthorized') handlers.onUnauthorized();
    else if (error.kind === 'password-change-required') handlers.onPasswordChangeRequired();
  };
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 4000),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
