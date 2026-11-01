// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { UserSummary } from '@consent/shared';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import type { UserAction } from './user-actions';

export function RowMenu({
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
