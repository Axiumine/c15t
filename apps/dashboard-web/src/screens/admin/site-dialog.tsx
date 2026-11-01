// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useCreateSite, useUpdateSite } from '../../api';
import { SiteForm } from '../../components/site-form';
import type { SiteFormValues } from '../../components/site-form-schema';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import type { SiteAction } from './site-action';

const CREATE_COPY = {
  title: 'New site',
  description: 'After saving, add the nginx lines shown on the site Setup tab.',
  submitLabel: 'Create site',
} as const;

const EDIT_COPY = {
  title: 'Edit site',
  description: 'Saved changes reach the consent service within moments.',
  submitLabel: 'Save changes',
} as const;

export function SiteDialog({
  action,
  onClose,
}: Readonly<{ action: SiteAction | null; onClose: () => void }>) {
  const create = useCreateSite();
  const update = useUpdateSite();
  const editing = action?.kind === 'edit' ? action.site : undefined;
  const open = action?.kind === 'create' || editing !== undefined;
  const copy = editing === undefined ? CREATE_COPY : EDIT_COPY;

  async function submit(values: SiteFormValues) {
    if (editing === undefined) {
      await create.mutateAsync(values);
    } else {
      await update.mutateAsync({
        siteKey: editing.key,
        changes: { name: values.name, domains: values.domains, policyPreset: values.policyPreset },
      });
    }
    onClose();
  }

  // These dialogs have no Radix trigger, so a change request always means "dismissed".
  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {open ? (
          <SiteForm
            site={editing}
            submitLabel={copy.submitLabel}
            onSubmit={submit}
            onCancel={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
