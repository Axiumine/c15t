// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { ROLES } from '@consent/shared';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { Field, fieldProps } from '../../components/form-field';
import { Select } from '../../components/ui/input';

const ROLE_LABELS = {
  admin: 'Administrator (all sites, full access)',
  user: 'User (assigned sites, read-only)',
} as const;

const ROLE_OPTIONS = ROLES.map((role) => ({
  value: role,
  // eslint-disable-next-line security/detect-object-injection -- `role` is a member of the closed ROLES union
  label: ROLE_LABELS[role],
}));

export function RoleField({
  id,
  error,
  registration,
}: Readonly<{
  id: string;
  error: string | undefined;
  registration: UseFormRegisterReturn<'role'>;
}>) {
  return (
    <Field id={id} label="Role" error={error}>
      <Select {...fieldProps(id, error)} {...registration}>
        {ROLE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
