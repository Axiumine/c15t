// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { UserSummary } from '@consent/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { BanUserForm } from './ban-user-form';

export function BanUserDialog({
  user,
  onClose,
}: Readonly<{
  user: UserSummary | null;
  onClose: () => void;
}>) {
  return (
    <Dialog open={user !== null} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban user</DialogTitle>
          <DialogDescription>
            {user?.email} is signed out everywhere and cannot sign in while the ban lasts.
          </DialogDescription>
        </DialogHeader>
        {user === null ? null : <BanUserForm key={user.id} user={user} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
