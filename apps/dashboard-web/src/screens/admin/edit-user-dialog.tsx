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
import { EditUserForm } from './edit-user-form';

export function EditUserDialog({
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
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>{user?.email}. The email cannot be changed.</DialogDescription>
        </DialogHeader>
        {user === null ? null : <EditUserForm key={user.id} user={user} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
