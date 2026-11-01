// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Field, FormError, fieldProps } from '../components/form-field';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { useLoginForm } from './use-login-form';

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
