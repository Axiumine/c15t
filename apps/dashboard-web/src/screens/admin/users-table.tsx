// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { UserSummary } from '@consent/shared';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import type { Pending } from './user-actions';
import { UserRow } from './user-row';

export function UsersTable({
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
