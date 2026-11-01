// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Role, Site, UserSummary } from '@consent/shared';
import { Badge } from './ui/badge';

export function SiteStatusBadge({ status }: { status: Site['status'] }) {
  return status === 'active' ? (
    <Badge variant="success">Active</Badge>
  ) : (
    <Badge variant="warning">Disabled</Badge>
  );
}

export function RoleBadge({ role }: Readonly<{ role: Role }>) {
  return (
    <Badge variant={role === 'admin' ? 'outline' : 'neutral'}>
      {role === 'admin' ? 'Admin' : 'User'}
    </Badge>
  );
}

export function UserStateBadges({ user }: Readonly<{ user: UserSummary }>) {
  return (
    <span className="flex flex-wrap gap-1">
      {user.banned ? (
        <Badge variant="destructive">Banned</Badge>
      ) : (
        <Badge variant="success">Active</Badge>
      )}
      {user.mustChangePassword ? <Badge variant="warning">Password change pending</Badge> : null}
    </span>
  );
}
