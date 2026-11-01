// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { Field, fieldProps } from '../components/form-field';
import { Input } from '../components/ui/input';
import type { PasswordForm } from './password-form';

export function PasswordFields({
  errors,
  register,
}: Readonly<{
  errors: FieldErrors<PasswordForm>;
  register: UseFormRegister<PasswordForm>;
}>) {
  return (
    <>
      <Field id="current-password" label="Current password" error={errors.currentPassword?.message}>
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
    </>
  );
}
