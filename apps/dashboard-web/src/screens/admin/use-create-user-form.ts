// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { userCreateSchema } from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useCreateUser } from '../../api/user-writes';
import { useOneTimeSecret } from '../../components/use-one-time-secret';
import { serverFormError } from './server-form-error';

/** The form state, and a submit that maps server rejections onto the email field or the form. */
export function useCreateUserForm(onClose: () => void) {
  const { secret, reveal, clear } = useOneTimeSecret();
  const create = useCreateUser(reveal);
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(userCreateSchema),
    defaultValues: { name: '', email: '', role: 'user' as const, siteKeys: [] as string[] },
  });

  function finish() {
    reset();
    setFormError(undefined);
    onClose();
  }

  async function submit(values: z.output<typeof userCreateSchema>) {
    setFormError(undefined);
    try {
      await create.mutateAsync(values);
      finish();
    } catch (error) {
      const mapped = serverFormError(error, true);
      if (mapped.email !== undefined) setError('email', { message: mapped.email });
      else setFormError(mapped.message);
    }
  }

  return {
    secret,
    clear,
    register,
    control,
    errors,
    isSubmitting,
    formError,
    finish,
    submit: handleSubmit(submit),
  };
}

export type CreateUserForm = ReturnType<typeof useCreateUserForm>;
