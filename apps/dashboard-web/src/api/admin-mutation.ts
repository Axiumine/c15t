// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './keys';

/* ---------------------------------------------------------------------------------------------
 * Admin writes. Each one refreshes what it changed, and the audit log.
 * ------------------------------------------------------------------------------------------- */

export function useAdminMutation<Variables, Result>(
  mutationFn: (variables: Variables) => Promise<Result>,
  invalidate: readonly (readonly unknown[])[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: async () => {
      await Promise.all(
        [...invalidate, queryKeys.adminAudit].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
