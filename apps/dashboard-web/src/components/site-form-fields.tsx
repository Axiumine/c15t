// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { MAX_DOMAINS_PER_SITE } from '@consent/shared';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { Field, fieldProps } from './form-field';
import { SiteKeyField } from './site-form-key-field';
import { PolicyPresetField } from './site-form-preset-field';
import type { SiteFormInput } from './site-form-schema';
import { Input, Textarea } from './ui/input';

export function SiteFormFields({
  editing,
  errors,
  register,
}: Readonly<{
  editing: boolean;
  errors: FieldErrors<SiteFormInput>;
  register: UseFormRegister<SiteFormInput>;
}>) {
  return (
    <>
      <SiteKeyField editing={editing} error={errors.key?.message} registration={register('key')} />
      <Field id="site-name" label="Name" error={errors.name?.message}>
        <Input {...fieldProps('site-name', errors.name?.message)} {...register('name')} />
      </Field>
      <Field
        id="site-domains"
        label="Domains"
        error={errors.domains?.message}
        hint={`One per line, such as shop.example.com. No scheme, path or wildcard. Up to ${MAX_DOMAINS_PER_SITE}.`}
      >
        <Textarea
          {...fieldProps('site-domains', errors.domains?.message, 'hint')}
          {...register('domains')}
          rows={4}
          className="font-mono"
          spellCheck={false}
        />
      </Field>
      <PolicyPresetField
        error={errors.policyPreset?.message}
        registration={register('policyPreset')}
      />
    </>
  );
}
