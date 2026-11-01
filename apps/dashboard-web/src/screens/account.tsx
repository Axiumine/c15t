// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useQueryClient } from '@tanstack/react-query';
import { useMe } from '../api';
import { PageHeader } from '../components/page-header';
import { ErrorState, LoadingBlock } from '../components/states';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useSignOut } from '../session';
import { PasswordCard } from './password-card';
import { ProfileCard } from './profile-card';

function SessionCard() {
  const signOut = useSignOut(useQueryClient());
  return (
    <Card>
      <CardHeader>
        <CardTitle>Session</CardTitle>
        <CardDescription>Sign out of this browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={() => void signOut()}>
          Sign out
        </Button>
      </CardContent>
    </Card>
  );
}

export function AccountScreen() {
  const me = useMe();
  if (me.isPending) return <LoadingBlock label="Loading your account" />;
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  const user = me.data;
  return (
    <div className="grid gap-6">
      <PageHeader title="Account" description={user.email} />
      {user.mustChangePassword ? (
        <Alert variant="warning">
          <AlertTitle>Choose a new password to continue</AlertTitle>
          <AlertDescription>
            An administrator set a temporary password for this account. The dashboard stays locked
            until you replace it.
          </AlertDescription>
        </Alert>
      ) : null}
      <ProfileCard user={user} />
      <PasswordCard forced={user.mustChangePassword} />
      <SessionCard />
    </div>
  );
}
