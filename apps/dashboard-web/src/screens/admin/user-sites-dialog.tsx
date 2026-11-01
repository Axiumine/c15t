// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site, UserSummary } from '@consent/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { SitesForm } from './user-sites-form';

export function UserSitesDialog({
  user,
  sites,
  onClose,
}: Readonly<{
  user: UserSummary | null;
  sites: readonly Site[];
  onClose: () => void;
}>) {
  return (
    <Dialog open={user !== null} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign sites</DialogTitle>
          <DialogDescription>
            {user?.email} can open the checked sites, read-only.
            {user?.role === 'admin' ? ' Administrators see every site regardless.' : ''}
          </DialogDescription>
        </DialogHeader>
        {user === null ? null : (
          <SitesForm key={user.id} user={user} sites={sites} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
