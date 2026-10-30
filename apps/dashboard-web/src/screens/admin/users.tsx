// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { UserSummary } from '@consent/shared';
import { MoreHorizontal, UserPlus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import {
  useAdminSites,
  useAdminUsers,
  useMe,
  useResetPassword,
  useRevokeSessions,
  useUnbanUser,
} from '../../api';
import { RoleBadge, UserStateBadges } from '../../components/badges';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { OneTimePasswordDialog, useOneTimeSecret } from '../../components/one-time-password-dialog';
import { PageHeader } from '../../components/page-header';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatDateTime } from '../../lib/format';
import { BanUserDialog, CreateUserDialog, EditUserDialog, UserSitesDialog } from './user-dialogs';

type UserAction = 'edit' | 'sites' | 'ban' | 'unban' | 'reset' | 'revoke';
interface Pending {
  readonly kind: UserAction;
  readonly user: UserSummary;
}

function RowMenu({
  user,
  isSelf,
  onAction,
}: {
  user: UserSummary;
  isSelf: boolean;
  onAction: (action: UserAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={`Actions for ${user.email}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onAction('edit')}>Edit name and role</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction('sites')}>Assign sites</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction('revoke')}>Revoke sessions</DropdownMenuItem>
        {isSelf ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction('reset')}>Reset password</DropdownMenuItem>
            {user.banned ? (
              <DropdownMenuItem onSelect={() => onAction('unban')}>Unban</DropdownMenuItem>
            ) : (
              <DropdownMenuItem destructive onSelect={() => onAction('ban')}>
                Ban user
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UsersTable({
  users,
  selfId,
  onAction,
}: {
  users: UserSummary[];
  selfId: string | undefined;
  onAction: (pending: Pending) => void;
}) {
  return (
    <Table>
      <caption className="sr-only">Users</caption>
      <TableHeader>
        <TableRow>
          <TableHead>User</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Sites</TableHead>
          <TableHead>Created</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {users.map((user) => (
          <TableRow key={user.id}>
            <TableCell className="min-w-52">
              <span className="block font-medium">{user.name}</span>
              <span className="block text-xs break-all text-muted-foreground">{user.email}</span>
            </TableCell>
            <TableCell>
              <RoleBadge role={user.role} />
            </TableCell>
            <TableCell>
              <UserStateBadges user={user} />
              {user.banned && user.banReason !== null ? (
                <span className="block text-xs text-muted-foreground">{user.banReason}</span>
              ) : null}
            </TableCell>
            <TableCell className="max-w-48 text-xs break-words">
              {user.role === 'admin'
                ? 'All sites'
                : user.siteKeys.length === 0
                  ? 'None'
                  : user.siteKeys.join(', ')}
            </TableCell>
            <TableCell className="whitespace-nowrap text-xs">
              {formatDateTime(user.createdAt)}
            </TableCell>
            <TableCell className="text-right">
              <RowMenu
                user={user}
                isSelf={user.id === selfId}
                onAction={(kind) => onAction({ kind, user })}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Reset, unban and revoke are plain confirmations; the others have their own form dialog. */
function ConfirmActions({ pending, onClose }: { pending: Pending | null; onClose: () => void }) {
  const { secret, reveal, clear } = useOneTimeSecret();
  const reset = useResetPassword(reveal);
  const unban = useUnbanUser();
  const revoke = useRevokeSessions();
  const kind = pending?.kind;
  const user = pending?.user;

  const config = {
    reset: {
      mutation: reset,
      title: 'Reset password?',
      description: `A new one-time password is generated for ${user?.email}. The old one stops working, all their sessions end, and they must choose a new password at the next sign-in.`,
      label: 'Reset password',
      destructive: true,
    },
    unban: {
      mutation: unban,
      title: 'Unban user?',
      description: `${user?.email} can sign in again.`,
      label: 'Unban',
      destructive: false,
    },
    revoke: {
      mutation: revoke,
      title: 'Revoke all sessions?',
      description: `${user?.email} is signed out on every device. They can sign in again with their password.`,
      label: 'Revoke sessions',
      destructive: true,
    },
  } as const;
  const active =
    kind === 'reset' || kind === 'unban' || kind === 'revoke' ? config[kind] : undefined;

  function close() {
    reset.reset();
    unban.reset();
    revoke.reset();
    onClose();
  }

  return (
    <>
      <ConfirmDialog
        open={active !== undefined}
        onOpenChange={(open) => (open ? undefined : close())}
        title={active?.title ?? ''}
        description={active?.description ?? ''}
        confirmLabel={active?.label ?? ''}
        destructive={active?.destructive ?? false}
        pending={active?.mutation.isPending ?? false}
        error={active?.mutation.error}
        onConfirm={() => {
          if (user === undefined || active === undefined) return;
          active.mutation.mutate(user.id, { onSuccess: close });
        }}
      />
      <OneTimePasswordDialog secret={secret} onClose={clear} />
    </>
  );
}

export function AdminUsersScreen() {
  const users = useAdminUsers();
  const sites = useAdminSites();
  const me = useMe();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const close = () => setPending(null);

  let body: ReactNode;
  if (users.isPending) body = <LoadingBlock label="Loading users" />;
  else if (users.isError)
    body = <ErrorState error={users.error} onRetry={() => void users.refetch()} />;
  else if (users.data.items.length === 0) {
    body = <EmptyState title="No users yet" description="Create the first user." />;
  } else {
    body = <UsersTable users={users.data.items} selfId={me.data?.id} onAction={setPending} />;
  }

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
      {body}
      <CreateUserDialog open={creating} onClose={() => setCreating(false)} sites={allSites} />
      <EditUserDialog
        key={`edit-${pending?.kind === 'edit' ? pending.user.id : 'none'}`}
        user={pending?.kind === 'edit' ? pending.user : null}
        onClose={close}
      />
      <UserSitesDialog
        user={pending?.kind === 'sites' ? pending.user : null}
        sites={allSites}
        onClose={close}
      />
      <BanUserDialog
        key={`ban-${pending?.kind === 'ban' ? pending.user.id : 'none'}`}
        user={pending?.kind === 'ban' ? pending.user : null}
        onClose={close}
      />
      <ConfirmActions pending={pending} onClose={close} />
    </div>
  );
}
