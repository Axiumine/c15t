// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Link, Outlet } from '@tanstack/react-router';
import { ApiError, useSite } from '../../api';
import { SiteStatusBadge } from '../../components/badges';
import { PageHeader } from '../../components/page-header';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';

const tab =
  'border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-foreground';

function SiteNotFound() {
  return (
    <EmptyState
      title="Site not found"
      description="It does not exist, or it is not assigned to you."
      action={
        <Button asChild variant="outline">
          <Link to="/sites">Back to sites</Link>
        </Button>
      }
    />
  );
}

function SiteTabs({ siteKey }: Readonly<{ siteKey: string }>) {
  return (
    <nav aria-label="Site sections" className="-mb-2 flex flex-wrap border-b">
      <Link
        to="/sites/$key"
        params={{ key: siteKey }}
        activeOptions={{ exact: true }}
        className={tab}
      >
        Overview
      </Link>
      <Link to="/sites/$key/consents" params={{ key: siteKey }} className={tab}>
        Consent records
      </Link>
      <Link to="/sites/$key/setup" params={{ key: siteKey }} className={tab}>
        Setup
      </Link>
    </nav>
  );
}

export function SiteLayoutScreen({ siteKey }: Readonly<{ siteKey: string }>) {
  const site = useSite(siteKey);

  if (site.isPending) return <LoadingBlock label="Loading site" />;
  if (site.isError) {
    // A missing site and a site the user may not see look the same on purpose.
    if (site.error instanceof ApiError && site.error.kind === 'not-found') return <SiteNotFound />;
    return <ErrorState error={site.error} onRetry={() => void site.refetch()} />;
  }

  const { data } = site;
  return (
    <div className="grid gap-6">
      <PageHeader
        title={data.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{data.key}</span>
            <SiteStatusBadge status={data.status} />
            <span className="break-words">{data.domains.join(', ')}</span>
          </span>
        }
      />
      {data.status === 'disabled' ? (
        <Alert variant="warning">
          <AlertDescription>
            This site is disabled: it no longer serves the banner. Its consent records are kept.
          </AlertDescription>
        </Alert>
      ) : null}
      <SiteTabs siteKey={siteKey} />
      <Outlet />
    </div>
  );
}
