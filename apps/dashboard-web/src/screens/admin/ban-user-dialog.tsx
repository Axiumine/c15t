// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { banUserSchema, type UserSummary } from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useBanUser } from '../../api';
import { Field, FormError, fieldProps } from '../../components/form-field';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Select, Textarea } from '../../components/ui/input';
import { serverFormError } from './user-dialogs';

const BAN_DURATIONS = [
  { value: '', label: 'Until an administrator lifts it' },
  { value: String(24 * 3600), label: '1 day' },
  { value: String(7 * 24 * 3600), label: '7 days' },
  { value: String(30 * 24 * 3600), label: '30 days' },
] as const;

const banFormSchema = z
  .object({ reason: z.string(), duration: z.string() })
  .transform(
    ({ reason, duration }): z.input<typeof banUserSchema> => ({
      ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      ...(duration === '' ? {} : { expiresInSeconds: Number(duration) }),
    }),
  )
  .pipe(banUserSchema);

function DurationOptions() {
  return BAN_DURATIONS.map((item) => (
    <option key={item.value} value={item.value}>
      {item.label}
    </option>
  ));
}

function BanUserForm({ user, onClose }: Readonly<{ user: UserSummary; onClose: () => void }>) {
  const ban = useBanUser();
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(banFormSchema),
    defaultValues: { reason: '', duration: '' },
  });

  async function submit(values: z.output<typeof banFormSchema>) {
    try {
      await ban.mutateAsync({ id: user.id, ban: values });
      onClose();
    } catch (error) {
      setFormError(serverFormError(error, false).message);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit(submit)} noValidate>
      <FormError message={formError} />
      <Field id="ban-reason" label="Reason (optional)" error={errors.reason?.message}>
        <Textarea
          {...fieldProps('ban-reason', errors.reason?.message)}
          {...register('reason')}
          rows={3}
        />
      </Field>
      <Field id="ban-duration" label="Duration">
        <Select {...fieldProps('ban-duration')} {...register('duration')}>
          <DurationOptions />
        </Select>
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" disabled={isSubmitting}>
          Ban user
        </Button>
      </DialogFooter>
    </form>
  );
}

export function BanUserDialog({
  user,
  onClose,
}: Readonly<{
  user: UserSummary | null;
  onClose: () => void;
}>) {
  return (
    <Dialog open={user !== null} onOpenChange={() => onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban user</DialogTitle>
          <DialogDescription>
            {user?.email} is signed out everywhere and cannot sign in while the ban lasts.
          </DialogDescription>
        </DialogHeader>
        {user === null ? null : <BanUserForm key={user.id} user={user} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
