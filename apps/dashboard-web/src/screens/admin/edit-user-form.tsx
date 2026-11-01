// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type UserSummary, userUpdateSchema } from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { useUpdateUser } from '../../api/user-writes';
import { Field, FormError, fieldProps } from '../../components/form-field';
import { Button } from '../../components/ui/button';
import { DialogFooter } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { RoleField } from './role-field';
import { serverFormError } from './server-form-error';

export function EditUserForm({
  user,
  onClose,
}: Readonly<{ user: UserSummary; onClose: () => void }>) {
  const update = useUpdateUser();
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(userUpdateSchema),
    defaultValues: { name: user.name, role: user.role },
  });

  async function submit(values: z.output<typeof userUpdateSchema>) {
    const changes = {
      ...(values.name === user.name ? {} : { name: values.name }),
      ...(values.role === user.role ? {} : { role: values.role }),
    };
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    try {
      await update.mutateAsync({ id: user.id, changes });
      onClose();
    } catch (error) {
      setFormError(serverFormError(error, false).message);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit(submit)} noValidate>
      <FormError message={formError} />
      <Field id="edit-name" label="Name" error={errors.name?.message}>
        <Input {...fieldProps('edit-name', errors.name?.message)} {...register('name')} />
      </Field>
      <RoleField id="edit-role" error={errors.role?.message} registration={register('role')} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          Save changes
        </Button>
      </DialogFooter>
    </form>
  );
}
