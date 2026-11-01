// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site } from '@consent/shared';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useAdminSites, useCreateSite, useUpdateSite } from '../../api';
import { SiteStatusBadge } from '../../components/badges';
import { ConfirmDialog } from '../../components/confirm-dialog';
import { PageHeader } from '../../components/page-header';
import { SiteForm, type SiteFormValues } from '../../components/site-form';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';

type Action = { kind: 'create' } | { kind: 'edit'; site: Site } | { kind: 'status'; site: Site };

function SiteRow({ site, onAction }: Readonly<{ site: Site; onAction: (action: Action) => void }>) {
  return (
    <TableRow>
      <TableCell>
        <Link to="/sites/$key" params={{ key: site.key }} className="font-medium hover:underline">
          {site.name}
        </Link>
        <span className="block font-mono text-xs text-muted-foreground">{site.key}</span>
      </TableCell>
      <TableCell className="max-w-72 break-words">{site.domains.join(', ')}</TableCell>
      <TableCell>
        <SiteStatusBadge status={site.status} />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onAction({ kind: 'edit', site })}
          >
            Edit<span className="sr-only"> {site.name}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onAction({ kind: 'status', site })}
          >
            {site.status === 'active' ? 'Disable' : 'Enable'}
            <span className="sr-only"> {site.name}</span>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function SitesTable({
  sites,
  onAction,
}: Readonly<{ sites: readonly Site[]; onAction: (action: Action) => void }>) {
  return (
    <Table>
      <caption className="sr-only">All sites</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Site</TableHead>
          <TableHead>Domains</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sites.map((site) => (
          <SiteRow key={site.key} site={site} onAction={onAction} />
        ))}
      </TableBody>
    </Table>
  );
}

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

function SiteDialog({ action, onClose }: Readonly<{ action: Action | null; onClose: () => void }>) {
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

function StatusDialog({ site, onClose }: Readonly<{ site: Site | null; onClose: () => void }>) {
  const update = useUpdateSite();
  const disabling = site?.status === 'active';
  const name = site?.name ?? '';
  const confirm =
    site === null
      ? undefined
      : () =>
          update.mutate(
            { siteKey: site.key, changes: { status: disabling ? 'disabled' : 'active' } },
            { onSuccess: onClose },
          );
  return (
    <ConfirmDialog
      open={site !== null}
      onOpenChange={() => {
        update.reset();
        onClose();
      }}
      title={disabling ? `Disable ${name}?` : `Enable ${name}?`}
      description={
        disabling
          ? 'The site stops serving its banner and consent requests. Its records are kept. You can enable it again at any time.'
          : 'The site starts serving its banner and consent requests again.'
      }
      confirmLabel={disabling ? 'Disable site' : 'Enable site'}
      destructive={disabling}
      pending={update.isPending}
      error={update.error}
      onConfirm={() => confirm?.()}
    />
  );
}

export function AdminSitesScreen() {
  const sites = useAdminSites();
  const [action, setAction] = useState<Action | null>(null);
  const close = () => setAction(null);

  let body: ReactNode;
  if (sites.isPending) body = <LoadingBlock label="Loading sites" />;
  else if (sites.isError)
    body = <ErrorState error={sites.error} onRetry={() => void sites.refetch()} />;
  else if (sites.data.items.length === 0) {
    body = (
      <EmptyState
        title="No sites yet"
        description="Create the first site to start collecting consent."
        action={
          <Button type="button" onClick={() => setAction({ kind: 'create' })}>
            <Plus aria-hidden="true" />
            New site
          </Button>
        }
      />
    );
  } else body = <SitesTable sites={sites.data.items} onAction={setAction} />;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Manage sites"
        description="Sites are disabled, never deleted: their consent records are legal proof."
        actions={
          <Button type="button" onClick={() => setAction({ kind: 'create' })}>
            <Plus aria-hidden="true" />
            New site
          </Button>
        }
      />
      {body}
      <SiteDialog
        key={action?.kind === 'edit' ? action.site.key : 'new'}
        action={action}
        onClose={close}
      />
      <StatusDialog site={action?.kind === 'status' ? action.site : null} onClose={close} />
    </div>
  );
}
