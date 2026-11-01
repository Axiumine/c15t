// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { UserSummary } from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useBanUser } from '../../api/user-writes';
import { Field, FormError, fieldProps } from '../../components/form-field';
import { Button } from '../../components/ui/button';
import { DialogFooter } from '../../components/ui/dialog';
import { Select, Textarea } from '../../components/ui/input';
import { BAN_DURATIONS, banFormSchema } from './ban-form-schema';
import { serverFormError } from './server-form-error';

function DurationOptions() {
  return BAN_DURATIONS.map((item) => (
    <option key={item.value} value={item.value}>
      {item.label}
    </option>
  ));
}

export function BanUserForm({
  user,
  onClose,
}: Readonly<{ user: UserSummary; onClose: () => void }>) {
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
