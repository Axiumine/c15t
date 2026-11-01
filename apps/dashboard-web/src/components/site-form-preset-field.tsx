// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { POLICY_PRESET_LABELS, POLICY_PRESETS } from '@consent/shared';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { Field, fieldProps } from './form-field';
import { Select } from './ui/input';

const PRESET_OPTIONS = POLICY_PRESETS.map((value) => ({
  value,
  // eslint-disable-next-line security/detect-object-injection -- `value` is a member of the closed POLICY_PRESETS union
  label: POLICY_PRESET_LABELS[value],
}));

export function PolicyPresetField({
  error,
  registration,
}: Readonly<{
  error: string | undefined;
  registration: UseFormRegisterReturn<'policyPreset'>;
}>) {
  return (
    <Field id="site-preset" label="Policy preset" error={error}>
      <Select {...fieldProps('site-preset', error)} {...registration}>
        {PRESET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
