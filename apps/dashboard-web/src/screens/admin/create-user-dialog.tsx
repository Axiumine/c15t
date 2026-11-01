// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site } from '@consent/shared';
import { FormError } from '../../components/form-field';
import { OneTimePasswordDialog } from '../../components/one-time-password-dialog';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { CreateUserFields } from './create-user-fields';
import { useCreateUserForm } from './use-create-user-form';

export function CreateUserDialog({
  open,
  onClose,
  sites,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  sites: readonly Site[];
}>) {
  const form = useCreateUserForm(onClose);
  return (
    <>
      <Dialog open={open} onOpenChange={() => form.finish()}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New user</DialogTitle>
            <DialogDescription>
              A one-time password is generated and shown once after saving. There is no self
              sign-up.
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={form.submit} noValidate>
            <FormError message={form.formError} />
            <CreateUserFields form={form} sites={sites} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={form.finish}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.isSubmitting}>
                {form.isSubmitting ? 'Creating…' : 'Create user'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <OneTimePasswordDialog secret={form.secret} onClose={form.clear} />
    </>
  );
}
