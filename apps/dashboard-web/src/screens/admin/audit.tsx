// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ReactNode } from 'react';
import { useAuditLog } from '../../api';
import { LoadMore } from '../../components/load-more';
import { PageHeader } from '../../components/page-header';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import { AuditTable } from './audit-table';

export function AdminAuditScreen() {
  const audit = useAuditLog();
  const entries = audit.data?.pages.flatMap((page) => page.items) ?? [];

  let body: ReactNode;
  if (audit.isPending) body = <LoadingBlock label="Loading audit log" />;
  else if (audit.isError && entries.length === 0) {
    body = <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />;
  } else if (entries.length === 0) {
    body = (
      <EmptyState title="Nothing logged yet" description="Administrator actions appear here." />
    );
  } else {
    body = (
      <div className="grid gap-3">
        <AuditTable entries={entries} />
        {audit.isError ? (
          <ErrorState error={audit.error} onRetry={() => void audit.fetchNextPage()} />
        ) : null}
        <LoadMore
          loaded={entries.length}
          noun="entries"
          endLabel="end of log"
          hasMore={audit.hasNextPage}
          fetching={audit.isFetchingNextPage}
          onMore={() => void audit.fetchNextPage()}
          moreLabel="Load older entries"
        />
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Audit log"
        description="Every administrator action, newest first. Entries cannot be edited."
      />
      {body}
    </div>
  );
}
