// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { changePasswordSchema, PASSWORD_MIN_LENGTH } from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { meQueryOptions, useMe } from '../api';
import { changePassword } from '../auth';
import { RoleBadge } from '../components/badges';
import { Field, FormError, fieldProps } from '../components/form-field';
import { PageHeader } from '../components/page-header';
import { ErrorState, LoadingBlock } from '../components/states';
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useSignOut } from '../session';

/**
 * The shared `changePasswordSchema` stays the source of truth (length limit, "differs from the
 * current password"); the form only adds the confirmation field on top of it.
 */
const passwordFormSchema = z
  .object({ currentPassword: z.string(), newPassword: z.string(), confirmPassword: z.string() })
  .superRefine((value, ctx) => {
    const result = changePasswordSchema.safeParse({
      currentPassword: value.currentPassword,
      newPassword: value.newPassword,
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      }
    }
    if (value.newPassword !== value.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'The passwords do not match',
      });
    }
  });

type PasswordForm = z.input<typeof passwordFormSchema>;
const EMPTY: PasswordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };

function PasswordCard({ forced }: { forced: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(passwordFormSchema), defaultValues: EMPTY });

  async function onSubmit(values: PasswordForm) {
    setFailure(undefined);
    setDone(false);
    const result = await changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    if (!result.ok) {
      setFailure(result.failure.message);
      return;
    }
    reset(EMPTY);
    queryClient.removeQueries({ queryKey: meQueryOptions().queryKey });
    await queryClient.fetchQuery(meQueryOptions());
    if (forced) router.history.push('/sites');
    else setDone(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          At least {PASSWORD_MIN_LENGTH} characters. Other devices are signed out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid max-w-md gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <FormError message={failure} />
          {done ? (
            <p
              role="status"
              className="rounded-md border px-3 py-2 text-sm font-medium text-success"
            >
              Password changed.
            </p>
          ) : null}
          <Field
            id="current-password"
            label="Current password"
            error={errors.currentPassword?.message}
          >
            <Input
              {...fieldProps('current-password', errors.currentPassword?.message)}
              {...register('currentPassword')}
              type="password"
              autoComplete="current-password"
            />
          </Field>
          <Field id="new-password" label="New password" error={errors.newPassword?.message}>
            <Input
              {...fieldProps('new-password', errors.newPassword?.message)}
              {...register('newPassword')}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <Field
            id="confirm-password"
            label="Repeat new password"
            error={errors.confirmPassword?.message}
          >
            <Input
              {...fieldProps('confirm-password', errors.confirmPassword?.message)}
              {...register('confirmPassword')}
              type="password"
              autoComplete="new-password"
            />
          </Field>
          <div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : 'Change password'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

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
      <PasswordCard forced={user.mustChangePassword} />
      <SessionCard />
    </div>
  );
}
