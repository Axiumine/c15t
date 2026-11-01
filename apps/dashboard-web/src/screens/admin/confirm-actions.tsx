// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ComponentProps } from 'react';
import { useResetPassword, useRevokeSessions, useUnbanUser } from '../../api/user-writes';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { OneTimePasswordDialog } from '../../components/one-time-password-dialog';
import { useOneTimeSecret } from '../../components/use-one-time-secret';
import type { Pending } from './user-actions';
import { confirmFor } from './user-confirmations';

/** A closed dialog keeps empty texts, so it can animate out without changing its contents. */
function confirmDialogProps(
  active: ReturnType<typeof confirmFor>,
): Omit<ComponentProps<typeof ConfirmDialog>, 'onOpenChange' | 'onConfirm'> {
  if (active === undefined) {
    return {
      open: false,
      title: '',
      description: '',
      confirmLabel: '',
      destructive: false,
      pending: false,
      error: undefined,
    };
  }
  return {
    open: true,
    title: active.title,
    description: active.description,
    confirmLabel: active.label,
    destructive: active.destructive,
    pending: active.mutation.isPending,
    error: active.mutation.error,
  };
}

/** Reset, unban and revoke are plain confirmations; the others have their own form dialog. */
export function ConfirmActions({
  pending,
  onClose,
}: Readonly<{ pending: Pending | null; onClose: () => void }>) {
  const { secret, reveal, clear } = useOneTimeSecret();
  const reset = useResetPassword(reveal);
  const unban = useUnbanUser();
  const revoke = useRevokeSessions();
  const active = confirmFor(pending, { reset, unban, revoke });

  function close() {
    reset.reset();
    unban.reset();
    revoke.reset();
    onClose();
  }

  return (
    <>
      <ConfirmDialog
        {...confirmDialogProps(active)}
        onOpenChange={() => close()}
        onConfirm={() => active?.mutation.mutate(active.userId, { onSuccess: close })}
      />
      <OneTimePasswordDialog secret={secret} onClose={clear} />
    </>
  );
}
