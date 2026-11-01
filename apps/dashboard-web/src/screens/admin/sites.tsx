// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useAdminSites } from '../../api';
import { PageHeader } from '../../components/page-header';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import { Button } from '../../components/ui/button';
import type { SiteAction } from './site-action';
import { SiteDialog } from './site-dialog';
import { StatusDialog } from './site-status-dialog';
import { SitesTable } from './sites-table';

export function AdminSitesScreen() {
  const sites = useAdminSites();
  const [action, setAction] = useState<SiteAction | null>(null);
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
