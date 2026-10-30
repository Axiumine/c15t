// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { AuditAction, AuditEntry } from '@consent/shared';
import type { ReactNode } from 'react';
import { useAuditLog } from '../../api';
import { LoadMore } from '../../components/load-more';
import { PageHeader } from '../../components/page-header';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import { Badge } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatDateTime } from '../../lib/format';

export const ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  'site.create': 'Site created',
  'site.update': 'Site updated',
  'site.disable': 'Site disabled',
  'site.enable': 'Site enabled',
  'user.create': 'User created',
  'user.update': 'User updated',
  'user.set-sites': 'Site assignments changed',
  'user.reset-password': 'Password reset',
  'user.ban': 'User banned',
  'user.unban': 'User unbanned',
  'user.revoke-sessions': 'Sessions revoked',
};

function Details({ metadata }: { metadata: AuditEntry['metadata'] }) {
  if (Object.keys(metadata).length === 0) return <span className="text-muted-foreground">–</span>;
  return (
    <details>
      <summary className="cursor-pointer text-xs text-link">Show</summary>
      <pre className="mt-1 max-w-80 overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
        {JSON.stringify(metadata, null, 2)}
      </pre>
    </details>
  );
}

function AuditTable({ entries }: { entries: AuditEntry[] }) {
  return (
    <Table>
      <caption className="sr-only">Administrator actions, newest first</caption>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Who</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Target</TableHead>
          <TableHead>Details</TableHead>
          <TableHead>IP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="whitespace-nowrap text-xs">
              {formatDateTime(entry.createdAt)}
            </TableCell>
            <TableCell className="text-xs break-all">
              {entry.actorEmail ?? entry.actorId ?? 'System'}
            </TableCell>
            <TableCell className="whitespace-nowrap">{ACTION_LABELS[entry.action]}</TableCell>
            <TableCell>
              <Badge variant="outline">{entry.targetType}</Badge>{' '}
              <span className="font-mono text-xs break-all">{entry.targetId}</span>
            </TableCell>
            <TableCell>
              <Details metadata={entry.metadata} />
            </TableCell>
            <TableCell className="font-mono text-xs">{entry.ip ?? '–'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

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
