// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { POLICY_PRESET_LABELS, type Site } from '@consent/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useMe, useSites } from '../api';
import { SiteStatusBadge } from '../components/badges';
import { PageHeader } from '../components/page-header';
import { EmptyState, ErrorState, LoadingBlock } from '../components/states';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';

function SiteCard({ site }: { site: Site }) {
  return (
    <Card className="grid gap-2 p-4 hover:bg-accent/40">
      <div className="flex items-start justify-between gap-2">
        <h2 className="min-w-0 text-base font-semibold break-words">
          <Link
            to="/sites/$key"
            params={{ key: site.key }}
            className="after:absolute after:inset-0 hover:underline"
          >
            {site.name}
          </Link>
        </h2>
        <SiteStatusBadge status={site.status} />
      </div>
      <p className="font-mono text-xs text-muted-foreground">{site.key}</p>
      <p className="text-sm break-words">{site.domains.join(', ')}</p>
      <p className="text-xs text-muted-foreground">{POLICY_PRESET_LABELS[site.policyPreset]}</p>
    </Card>
  );
}

export function SitesListScreen() {
  const sites = useSites();
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';

  let body: ReactNode;
  if (sites.isPending) body = <LoadingBlock label="Loading sites" />;
  else if (sites.isError)
    body = <ErrorState error={sites.error} onRetry={() => void sites.refetch()} />;
  else if (sites.data.items.length === 0) {
    body = (
      <EmptyState
        title="No sites yet"
        description={
          isAdmin
            ? 'Add the first website to start collecting consent.'
            : 'No site has been assigned to you. Ask an administrator for access.'
        }
        action={
          isAdmin ? (
            <Button asChild>
              <Link to="/admin/sites">Manage sites</Link>
            </Button>
          ) : undefined
        }
      />
    );
  } else {
    body = (
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sites.data.items.map((site) => (
          <li key={site.key} className="relative">
            <SiteCard site={site} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Sites"
        description={isAdmin ? 'Every website on the platform.' : 'The websites assigned to you.'}
      />
      {body}
    </div>
  );
}
