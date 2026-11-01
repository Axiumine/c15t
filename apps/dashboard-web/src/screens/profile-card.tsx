// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Me } from '@consent/shared';
import { RoleBadge } from '../components/badges';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

export function ProfileCard({ user }: Readonly<{ user: Me }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{user.name}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="break-all">{user.email}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>
            <RoleBadge role={user.role} />
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}
