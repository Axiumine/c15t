// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { AuditEntry } from '@consent/shared';
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
import { ACTION_LABELS } from './audit-labels';

function Details({ metadata }: Readonly<{ metadata: AuditEntry['metadata'] }>) {
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

export function AuditTable({ entries }: Readonly<{ entries: AuditEntry[] }>) {
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
