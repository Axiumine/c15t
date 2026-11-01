// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { changePasswordSchema } from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { meQueryOptions } from '../api';
import { changePassword } from '../auth';

/**
 * The shared `changePasswordSchema` stays the source of truth (length limit, "differs from the
 * current password"); the form only adds the confirmation field on top of it.
 */
const passwordFormSchema = z
  .object({ currentPassword: z.string(), newPassword: z.string(), confirmPassword: z.string() })
  .superRefine((value, ctx) => {
    const result = changePasswordSchema.safeParse({
      currentPassword: value.currentPassword,
      newPassword: value.newPassword,
    });
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
      }
    }
    if (value.newPassword !== value.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'The passwords do not match',
      });
    }
  });

export type PasswordForm = z.input<typeof passwordFormSchema>;
const EMPTY: PasswordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };

/** The form state, and a submit that changes the password and then refreshes the session. */
export function usePasswordForm(forced: boolean) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(passwordFormSchema), defaultValues: EMPTY });

  async function onSubmit(values: PasswordForm) {
    setFailure(undefined);
    setDone(false);
    const result = await changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: true,
    });
    if (!result.ok) {
      setFailure(result.failure.message);
      return;
    }
    reset(EMPTY);
    queryClient.removeQueries({ queryKey: meQueryOptions().queryKey });
    await queryClient.query(meQueryOptions());
    if (forced) router.history.push('/sites');
    else setDone(true);
  }

  return { register, errors, isSubmitting, failure, done, submit: handleSubmit(onSubmit) };
}
