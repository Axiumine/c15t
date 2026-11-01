// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { loginSchema } from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { meQueryOptions } from '../api';
import { signIn } from '../auth';
import { Field, FormError, fieldProps } from '../components/form-field';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { safeRedirectPath } from '../session';

/** The form state, and a submit that signs in, then goes where the user was headed. */
function useLoginForm(redirectTo: string | undefined) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  async function onSubmit(values: { email: string; password: string }) {
    setFailure(undefined);
    const result = await signIn(values);
    if (!result.ok) {
      setFailure(result.failure.message);
      return;
    }
    queryClient.removeQueries({ queryKey: meQueryOptions().queryKey });
    const me = await queryClient.query(meQueryOptions());
    const target = me.mustChangePassword ? '/account' : (safeRedirectPath(redirectTo) ?? '/sites');
    router.history.push(target);
  }

  return { register, errors, isSubmitting, failure, submit: handleSubmit(onSubmit) };
}

export function LoginScreen({ redirectTo }: Readonly<{ redirectTo?: string | undefined }>) {
  const { register, errors, isSubmitting, failure, submit } = useLoginForm(redirectTo);

  return (
    <div className="mx-auto grid min-h-dvh w-full max-w-sm content-center gap-4 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Sign in</CardTitle>
          <CardDescription>
            Consent dashboard. Accounts are created by an administrator.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit} noValidate>
            <FormError message={failure} />
            <Field id="login-email" label="Email" error={errors.email?.message}>
              <Input
                {...fieldProps('login-email', errors.email?.message)}
                {...register('email')}
                type="email"
                autoComplete="username"
                autoFocus
              />
            </Field>
            <Field id="login-password" label="Password" error={errors.password?.message}>
              <Input
                {...fieldProps('login-password', errors.password?.message)}
                {...register('password')}
                type="password"
                autoComplete="current-password"
              />
            </Field>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
