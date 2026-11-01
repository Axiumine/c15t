// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { loginSchema } from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { meQueryOptions } from '../api';
import { signIn } from '../auth';
import { safeRedirectPath } from '../session';

/** The form state, and a submit that signs in, then goes where the user was headed. */
export function useLoginForm(redirectTo: string | undefined) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  async function onSubmit(values: { email: string; password: string }) {
    setFailure(undefined);
    const result = await signIn(values);
    if (!result.ok) {
      setFailure(result.failure.message);
      return;
    }
    queryClient.removeQueries({ queryKey: meQueryOptions().queryKey });
    const me = await queryClient.query(meQueryOptions());
    const target = me.mustChangePassword ? '/account' : (safeRedirectPath(redirectTo) ?? '/sites');
    router.history.push(target);
  }

  return { register, errors, isSubmitting, failure, submit: handleSubmit(onSubmit) };
}
