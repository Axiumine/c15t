// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ConsentRecord } from '@consent/shared';
import type { useConsents } from '../../api';
import { LoadMore } from '../../components/load-more';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import { RecordsTable } from './consent-records-table';

export function RecordsBody({
  records,
  items,
  onOpen,
}: Readonly<{
  records: ReturnType<typeof useConsents>;
  items: readonly ConsentRecord[];
  onOpen: (record: ConsentRecord) => void;
}>) {
  if (records.isPending) return <LoadingBlock label="Loading records" />;
  if (records.isError && items.length === 0) {
    return <ErrorState error={records.error} onRetry={() => void records.refetch()} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No records found"
        description="Nothing matches these filters. Widen the date range or clear the subject ID."
      />
    );
  }
  return (
    <div className="grid gap-3">
      <RecordsTable items={items} onOpen={onOpen} />
      {records.isError ? (
        <ErrorState error={records.error} onRetry={() => void records.fetchNextPage()} />
      ) : null}
      <LoadMore
        loaded={items.length}
        noun="records"
        endLabel="end of list"
        hasMore={records.hasNextPage}
        fetching={records.isFetchingNextPage}
        onMore={() => void records.fetchNextPage()}
      />
    </div>
  );
}
