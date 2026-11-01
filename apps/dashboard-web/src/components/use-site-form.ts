// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { DEFAULT_POLICY_PRESET, type Site } from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { errorMessage } from '../api';
import { serverFieldErrors } from './site-form-errors';
import { type SiteFormInput, type SiteFormValues, siteFormSchema } from './site-form-schema';

function defaultValuesOf(site: Site | undefined): SiteFormInput {
  return {
    key: site?.key ?? '',
    name: site?.name ?? '',
    domains: site?.domains.join('\n') ?? '',
    policyPreset: site?.policyPreset ?? DEFAULT_POLICY_PRESET,
  };
}

/** The form state, and a submit that turns server rejections into field or form errors. */
export function useSiteForm(
  site: Site | undefined,
  onSubmit: (values: SiteFormValues) => Promise<unknown>,
) {
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(siteFormSchema), defaultValues: defaultValuesOf(site) });

  async function submit(values: SiteFormValues) {
    setFormError(undefined);
    try {
      await onSubmit(values);
    } catch (error) {
      const handled = serverFieldErrors(error);
      if (handled.length === 0) setFormError(errorMessage(error));
      for (const [name, message] of handled) setError(name, { message });
    }
  }

  return { register, errors, isSubmitting, formError, submit: handleSubmit(submit) };
}
