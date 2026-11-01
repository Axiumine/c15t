// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { PASSWORD_MIN_LENGTH } from '@consent/shared';
import { FormError } from '../components/form-field';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { PasswordFields } from './password-fields';
import { usePasswordForm } from './password-form';

export function PasswordCard({ forced }: Readonly<{ forced: boolean }>) {
  const { register, errors, isSubmitting, failure, done, submit } = usePasswordForm(forced);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change password</CardTitle>
        <CardDescription>
          At least {PASSWORD_MIN_LENGTH} characters. Other devices are signed out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid max-w-md gap-4" onSubmit={submit} noValidate>
          <FormError message={failure} />
          {done ? (
            <p
              role="status"
              className="rounded-md border px-3 py-2 text-sm font-medium text-success"
            >
              Password changed.
            </p>
          ) : null}
          <PasswordFields errors={errors} register={register} />
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
