// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { UserSummary } from '@consent/shared';
import { MoreHorizontal, UserPlus } from 'lucide-react';
import { type ComponentProps, useState } from 'react';
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
}: Readonly<{
  user: UserSummary;
  isSelf: boolean;
  onAction: (action: UserAction) => void;
}>) {
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

/** Who may sign in to what: admins see every site, users only the ones assigned to them. */
function sitesLabel(user: UserSummary): string {
  if (user.role === 'admin') return 'All sites';
  return user.siteKeys.length === 0 ? 'None' : user.siteKeys.join(', ');
}

function UserRow({
  user,
  isSelf,
  onAction,
}: Readonly<{
  user: UserSummary;
  isSelf: boolean;
  onAction: (action: UserAction) => void;
}>) {
  return (
    <TableRow>
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
      <TableCell className="max-w-48 text-xs break-words">{sitesLabel(user)}</TableCell>
      <TableCell className="whitespace-nowrap text-xs">{formatDateTime(user.createdAt)}</TableCell>
      <TableCell className="text-right">
        <RowMenu user={user} isSelf={isSelf} onAction={onAction} />
      </TableCell>
    </TableRow>
  );
}

function UsersTable({
  users,
  selfId,
  onAction,
}: Readonly<{
  users: readonly UserSummary[];
  selfId: string | undefined;
  onAction: (pending: Pending) => void;
}>) {
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
          <UserRow
            key={user.id}
            user={user}
            isSelf={user.id === selfId}
            onAction={(kind) => onAction({ kind, user })}
          />
        ))}
      </TableBody>
    </Table>
  );
}

type ConfirmMutations = Readonly<{
  reset: ReturnType<typeof useResetPassword>;
  unban: ReturnType<typeof useUnbanUser>;
  revoke: ReturnType<typeof useRevokeSessions>;
}>;

/** The confirmation behind a menu action, or `undefined` for the actions with their own form. */
function confirmFor(pending: Pending | null, mutations: ConfirmMutations) {
  if (pending === null) return undefined;
  const { kind, user } = pending;
  switch (kind) {
    case 'reset':
      return {
        mutation: mutations.reset,
        title: 'Reset password?',
        description: `A new one-time password is generated for ${user.email}. The old one stops working, all their sessions end, and they must choose a new password at the next sign-in.`,
        label: 'Reset password',
        destructive: true,
        userId: user.id,
      };
    case 'unban':
      return {
        mutation: mutations.unban,
        title: 'Unban user?',
        description: `${user.email} can sign in again.`,
        label: 'Unban',
        destructive: false,
        userId: user.id,
      };
    case 'revoke':
      return {
        mutation: mutations.revoke,
        title: 'Revoke all sessions?',
        description: `${user.email} is signed out on every device. They can sign in again with their password.`,
        label: 'Revoke sessions',
        destructive: true,
        userId: user.id,
      };
    default:
      return undefined;
  }
}

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
function ConfirmActions({
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
