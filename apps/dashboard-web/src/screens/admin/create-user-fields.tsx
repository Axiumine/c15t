// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site } from '@consent/shared';
import { Controller } from 'react-hook-form';
import { Field, fieldProps } from '../../components/form-field';
import { Input } from '../../components/ui/input';
import { RoleField } from './role-field';
import { SitePicker } from './site-picker';
import type { CreateUserForm } from './use-create-user-form';

export function CreateUserFields({
  form,
  sites,
}: Readonly<{
  form: Pick<CreateUserForm, 'register' | 'control' | 'errors'>;
  sites: readonly Site[];
}>) {
  const { register, control, errors } = form;
  return (
    <>
      <Field id="user-name" label="Name" error={errors.name?.message}>
        <Input
          {...fieldProps('user-name', errors.name?.message)}
          {...register('name')}
          autoComplete="off"
        />
      </Field>
      <Field id="user-email" label="Email" error={errors.email?.message}>
        <Input
          {...fieldProps('user-email', errors.email?.message)}
          {...register('email')}
          type="email"
          autoComplete="off"
        />
      </Field>
      <RoleField id="user-role" error={errors.role?.message} registration={register('role')} />
      <Controller
        control={control}
        name="siteKeys"
        render={({ field }) => (
          // `siteKeys` is optional in the schema's input type, but the defaults always set it.
          // A Set accepts `undefined`, so this needs neither a cast nor a fallback.
          <SitePicker sites={sites} value={[...new Set(field.value)]} onChange={field.onChange} />
        )}
      />
    </>
  );
}
