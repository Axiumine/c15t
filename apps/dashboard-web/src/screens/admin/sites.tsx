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

function SitesTable({ sites, onAction }: { sites: Site[]; onAction: (action: Action) => void }) {
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
          <TableRow key={site.key}>
            <TableCell>
              <Link
                to="/sites/$key"
                params={{ key: site.key }}
                className="font-medium hover:underline"
              >
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
        ))}
      </TableBody>
    </Table>
  );
}

function SiteDialog({ action, onClose }: { action: Action | null; onClose: () => void }) {
  const create = useCreateSite();
  const update = useUpdateSite();
  const open = action?.kind === 'create' || action?.kind === 'edit';

  async function submit(values: SiteFormValues) {
    if (action?.kind === 'edit') {
      await update.mutateAsync({
        siteKey: action.site.key,
        changes: { name: values.name, domains: values.domains, policyPreset: values.policyPreset },
      });
    } else {
      await create.mutateAsync(values);
    }
    onClose();
  }

  // These dialogs have no Radix trigger, so a change request always means "dismissed".
  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{action?.kind === 'edit' ? 'Edit site' : 'New site'}</DialogTitle>
          <DialogDescription>
            {action?.kind === 'edit'
              ? 'Saved changes reach the consent service within moments.'
              : 'After saving, add the nginx lines shown on the site Setup tab.'}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <SiteForm
            site={action?.kind === 'edit' ? action.site : undefined}
            submitLabel={action?.kind === 'edit' ? 'Save changes' : 'Create site'}
            onSubmit={submit}
            onCancel={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ site, onClose }: { site: Site | null; onClose: () => void }) {
  const update = useUpdateSite();
  const disabling = site?.status === 'active';
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
      title={disabling ? `Disable ${site?.name}?` : `Enable ${site?.name}?`}
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
