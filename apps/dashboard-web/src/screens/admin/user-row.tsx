// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { UserSummary } from '@consent/shared';
import { RoleBadge, UserStateBadges } from '../../components/badges';
import { TableCell, TableRow } from '../../components/ui/table';
import { formatDateTime } from '../../lib/format';
import type { UserAction } from './user-actions';
import { RowMenu } from './user-row-menu';

/** Who may sign in to what: admins see every site, users only the ones assigned to them. */
function sitesLabel(user: UserSummary): string {
  if (user.role === 'admin') return 'All sites';
  return user.siteKeys.length === 0 ? 'None' : user.siteKeys.join(', ');
}

export function UserRow({
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
