// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { UserSummary } from '@consent/shared';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useAdminSites, useMe } from '../../api';
import { useAdminUsers } from '../../api/admin-reads';
import { PageHeader } from '../../components/page-header';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import { Button } from '../../components/ui/button';
import { BanUserDialog } from './ban-user-dialog';
import { ConfirmActions } from './confirm-actions';
import { CreateUserDialog } from './create-user-dialog';
import { EditUserDialog } from './edit-user-dialog';
import type { Pending, UserAction } from './user-actions';
import { UserSitesDialog } from './user-sites-dialog';
import { UsersTable } from './users-table';

function UsersBody({
  users,
  selfId,
  onAction,
}: Readonly<{
  users: ReturnType<typeof useAdminUsers>;
  selfId: string | undefined;
  onAction: (pending: Pending) => void;
}>) {
  if (users.isPending) return <LoadingBlock label="Loading users" />;
  if (users.isError) return <ErrorState error={users.error} onRetry={() => void users.refetch()} />;
  if (users.data.items.length === 0) {
    return <EmptyState title="No users yet" description="Create the first user." />;
  }
  return <UsersTable users={users.data.items} selfId={selfId} onAction={onAction} />;
}

/** The user a menu action was chosen for, when it is the given kind of action. */
const userFor = (pending: Pending | null, kind: UserAction): UserSummary | null =>
  pending?.kind === kind ? pending.user : null;

export function AdminUsersScreen() {
  const users = useAdminUsers();
  const sites = useAdminSites();
  const me = useMe();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const close = () => setPending(null);
  const allSites = sites.data?.items ?? [];
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Users"
        description="Accounts are created here only. Users see the sites assigned to them, read-only."
        actions={
          <Button type="button" onClick={() => setCreating(true)}>
            <UserPlus aria-hidden="true" />
            New user
          </Button>
        }
      />
      <UsersBody users={users} selfId={me.data?.id} onAction={setPending} />
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} sites={allSites} />
      <EditUserDialog user={userFor(pending, 'edit')} onClose={close} />
      <UserSitesDialog user={userFor(pending, 'sites')} sites={allSites} onClose={close} />
      <BanUserDialog user={userFor(pending, 'ban')} onClose={close} />
      <ConfirmActions pending={pending} onClose={close} />
    </div>
  );
}
