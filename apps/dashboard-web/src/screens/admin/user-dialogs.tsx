// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import {
  banUserSchema,
  ROLES,
  type Site,
  type UserSummary,
  userCreateSchema,
  userUpdateSchema,
} from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  ApiError,
  errorMessage,
  fieldIssues,
  useBanUser,
  useCreateUser,
  useSetUserSites,
  useUpdateUser,
} from '../../api';
import { Field, FormError, fieldProps } from '../../components/form-field';
import { OneTimePasswordDialog, useOneTimeSecret } from '../../components/one-time-password-dialog';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Checkbox, Input, Select, Textarea } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

const ROLE_LABELS = {
  admin: 'Administrator (all sites, full access)',
  user: 'User (assigned sites, read-only)',
} as const;

function SitePicker({
  sites,
  value,
  onChange,
}: {
  sites: readonly Site[];
  value: readonly string[];
  onChange: (next: string[]) => void;
}) {
  if (sites.length === 0) {
    return <p className="text-sm text-muted-foreground">No sites exist yet.</p>;
  }
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Assigned sites</legend>
      <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-md border p-3">
        {sites.map((site) => {
          const id = `site-pick-${site.key}`;
          return (
            <div key={site.key} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={value.includes(site.key)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, site.key]
                      : value.filter((key) => key !== site.key),
                  )
                }
              />
              <Label htmlFor={id} className="font-normal">
                {site.name}{' '}
                <span className="font-mono text-xs text-muted-foreground">{site.key}</span>
                {site.status === 'disabled' ? (
                  <span className="text-xs text-muted-foreground"> (disabled)</span>
                ) : null}
              </Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function serverFormError(
  error: unknown,
  emailField: boolean,
): { email?: string; message?: string } {
  if (emailField && error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
    return { email: 'A user with this email already exists' };
  }
  const issues = fieldIssues(error);
  const first = issues[0];
  return { message: first === undefined ? errorMessage(error) : first.message };
}

export function CreateUserDialog({
  open,
  onClose,
  sites,
}: {
  open: boolean;
  onClose: () => void;
  sites: readonly Site[];
}) {
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

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : finish())}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              A one-time password is generated and shown once after saving. There is no self
              sign-up.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={handleSubmit(submit)} noValidate>
            <FormError message={formError} />
            <Field id="user-name" label="Name" error={errors.name?.message}>
              <Input
                {...fieldProps('user-name', errors.name?.message)}
                {...register('name')}
                autoComplete="off"
              />
            </Field>
            <Field id="user-email" label="Email" error={errors.email?.message}>
              <Input
                {...fieldProps('user-email', errors.email?.message)}
                {...register('email')}
                type="email"
                autoComplete="off"
              />
            </Field>
            <Field id="user-role" label="Role" error={errors.role?.message}>
              <Select {...fieldProps('user-role', errors.role?.message)} {...register('role')}>
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </Select>
            </Field>
            <Controller
              control={control}
              name="siteKeys"
              render={({ field }) => (
                <SitePicker sites={sites} value={field.value ?? []} onChange={field.onChange} />
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={finish}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Creating…' : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <OneTimePasswordDialog secret={secret} onClose={clear} />
    </>
  );
}

export function EditUserDialog({
  user,
  onClose,
}: {
  user: UserSummary | null;
  onClose: () => void;
}) {
  const update = useUpdateUser();
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(userUpdateSchema),
    defaultValues: { name: user?.name ?? '', role: user?.role ?? ('user' as const) },
  });

  async function submit(values: z.output<typeof userUpdateSchema>) {
    if (user === null) return;
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
    <Dialog open={user !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>{user?.email}. The email cannot be changed.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={handleSubmit(submit)} noValidate>
          <FormError message={formError} />
          <Field id="edit-name" label="Name" error={errors.name?.message}>
            <Input {...fieldProps('edit-name', errors.name?.message)} {...register('name')} />
          </Field>
          <Field id="edit-role" label="Role" error={errors.role?.message}>
            <Select {...fieldProps('edit-role', errors.role?.message)} {...register('role')}>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SitesForm({
  user,
  sites,
  onClose,
}: {
  user: UserSummary;
  sites: readonly Site[];
  onClose: () => void;
}) {
  const setSites = useSetUserSites();
  const [selected, setSelected] = useState<string[]>(user.siteKeys);
  return (
    <div className="grid gap-4">
      <FormError message={setSites.error === null ? undefined : errorMessage(setSites.error)} />
      <SitePicker sites={sites} value={selected} onChange={setSelected} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={setSites.isPending}
          onClick={() =>
            setSites.mutate({ id: user.id, siteKeys: selected }, { onSuccess: onClose })
          }
        >
          {setSites.isPending ? 'Saving…' : 'Save assignments'}
        </Button>
      </DialogFooter>
    </div>
  );
}

export function UserSitesDialog({
  user,
  sites,
  onClose,
}: {
  user: UserSummary | null;
  sites: readonly Site[];
  onClose: () => void;
}) {
  return (
    <Dialog open={user !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign sites</DialogTitle>
          <DialogDescription>
            {user?.email} can open the checked sites, read-only.
            {user?.role === 'admin' ? ' Administrators see every site regardless.' : ''}
          </DialogDescription>
        </DialogHeader>
        {user === null ? null : (
          <SitesForm key={user.id} user={user} sites={sites} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

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

export function BanUserDialog({
  user,
  onClose,
}: {
  user: UserSummary | null;
  onClose: () => void;
}) {
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
    if (user === null) return;
    try {
      await ban.mutateAsync({ id: user.id, ban: values });
      onClose();
    } catch (error) {
      setFormError(serverFormError(error, false).message);
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ban user</DialogTitle>
          <DialogDescription>
            {user?.email} is signed out everywhere and cannot sign in while the ban lasts.
          </DialogDescription>
        </DialogHeader>
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
              {BAN_DURATIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
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
      </DialogContent>
    </Dialog>
  );
}
