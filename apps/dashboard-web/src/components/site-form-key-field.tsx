// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { UseFormRegisterReturn } from 'react-hook-form';
import { Field, fieldProps } from './form-field';
import { Input } from './ui/input';

export function SiteKeyField({
  editing,
  error,
  registration,
}: Readonly<{
  editing: boolean;
  error: string | undefined;
  registration: UseFormRegisterReturn<'key'>;
}>) {
  return (
    <Field
      id="site-key"
      label="Site key"
      error={error}
      hint={
        editing
          ? 'The key is the URL segment and the c15t tenant ID. It cannot be changed.'
          : 'Lowercase letters, digits and hyphens, 3 to 40 characters. It cannot be changed later.'
      }
    >
      <Input
        {...fieldProps('site-key', error, 'hint')}
        {...registration}
        readOnly={editing}
        className={editing ? 'bg-muted font-mono' : 'font-mono'}
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  );
}
